import { supabaseAdmin } from '../config/supabase';
import { Account } from '../types';
import { eventService } from './EventService';
import { ServiceError } from './errors';
import { getStripe, stripeCall } from './stripe';

/**
 * M-Connect — Stripe Connect onboarding and the payout gate.
 *
 * The walker is the merchant. Money moves from the client's card to the
 * walker's own Stripe account without landing in the platform balance
 * (see `chargeRouting()` and its use in PaymentService). The platform takes
 * nothing — DECIDED 2026-09-04, see `platformFeeCents`.
 *
 * Two states that look alike and are not:
 *   - `stripe_connect_account_id` exists  → we have an account
 *   - `charges_enabled`                   → it can actually take money
 * A connected account exists the instant we create it; Stripe enables
 * capabilities only after identity and bank verification, which can take
 * minutes or days. Everything here turns on that distinction, because the
 * BLOCK decision (2026-08-29) gates collection on the second, not the first.
 *
 * The connected account is a **replaceable link, never hardwired** (the seam
 * from Workstream D / P2-15): `disconnect()` clears it, deactivation nulls it,
 * and nothing in the payment path assumes it is permanent.
 */

/** How the walker's payout setup looks to the UI and to the gate. */
export interface ConnectStatus {
  connected: boolean;
  account_id: string | null;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  /** The gate. Collecting payment is refused unless this is true. */
  payout_ready: boolean;
  synced_at: string | null;
  /**
   * One field the UI can switch on, so four booleans don't get re-derived
   * (and re-derived differently) in three places.
   *   not_started    — no connected account yet
   *   incomplete     — account exists, walker hasn't finished the form
   *   pending_review — form submitted, Stripe hasn't enabled charges yet
   *   ready          — can collect
   */
  state: 'not_started' | 'incomplete' | 'pending_review' | 'ready';
  /** Present only in `pending_review`/`incomplete` — what Stripe still wants. */
  requirements_due?: string[];
}

/**
 * API version for the preview v2 account-session endpoint. Pinned, not floating:
 * a preview version string is the only thing making that endpoint reachable, so
 * it belongs somewhere obvious rather than inline at the call site.
 */
const SESSION_PREVIEW_VERSION = '2026-06-24.preview';

/**
 * US phone to E.164, which is the only shape Stripe accepts. Profiles store
 * them as `(555)010-0100`. Returns null rather than guessing when the digits
 * do not look like a US number — a rejected account creation is worse than an
 * account without a phone.
 */
function toE164(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

/** Re-check with Stripe before refusing a charge if the cache is older than this. */
const STALE_CACHE_MS = 60_000;

/** Fields the v2 account API only returns when asked for them. */
const ACCOUNT_INCLUDE = ['configuration.merchant', 'identity', 'requirements'] as const;

/**
 * The connected-account shape, in one place because it encodes a decision with
 * money attached.
 *
 * ⚠️ ACCOUNTS V2, not v1. Stripe refuses `accounts.create({type:'express'})`
 * for new integrations, so the dashboard/liability choice is expressed as a v2
 * `dashboard` plus `defaults.responsibilities`.
 *
 * DECIDED 2026-09-05 (founder): the WALKER carries chargebacks and pays
 * Stripe's processing fees. `losses_collector` and `fees_collector` are both
 * `'stripe'` — "stripe" here means Stripe collects from the connected account,
 * i.e. the walker, not from us.
 *
 * This supersedes the 2026-07-19 "Express" decision. Why the shape changed:
 * `dashboard:'express'` + `losses_collector:'stripe'` is rejected by Stripe as
 * an unsupported configuration (verified 2026-09-04, re-confirmed as a control
 * in the 2026-09-05 probe). Express structurally means the PLATFORM absorbs
 * losses, which paired badly with `platformFeeCents` being 0 — the founder
 * would have carried chargeback exposure while earning nothing per charge.
 *
 * The earlier note here claimed `dashboard:'full'` was the only walker-liable
 * option Stripe supports. That was wrong: it had only ever tested 'express' and
 * 'full'. Probed 2026-09-05 against test mode, one account per row:
 *
 *   dashboard  losses       fees          result
 *   none       application  application   accepted
 *   none       stripe       stripe        accepted  <- this config
 *   none       stripe       application   accepted
 *   full       stripe       stripe        accepted
 *   express    stripe       stripe        REJECTED  (control, as expected)
 *
 * `none` is preferred over `full` because it keeps liability on the walker
 * WITHOUT provisioning them a full Stripe account and login — the walker stays
 * inside our app, which is what the embedded UI (Workstream M) needs.
 *
 * ⚠️ These properties are FIXED AT CREATION. Changing this constant affects
 * accounts created after the change and silently leaves existing ones on the
 * old liability model. Safe today only because no live connected account
 * exists (both .env and .env.prod are still on sk_test as of 2026-09-05). Once
 * a real walker onboards, changing this is a per-account migration with a
 * human in the loop, not a constant edit.
 *
 * ⚠️ Hosted account links still work on `dashboard:'none'` (probed 2026-09-05),
 * so the redirect path stays functional while the embedded UI is built. The
 * two are not a flag-day switch.
 */
const ACCOUNT_CONFIGURATION = {
  dashboard: 'none' as const,
  responsibilities: {
    losses_collector: 'stripe' as const,
    fees_collector: 'stripe' as const,
  },
};

export class ConnectService {
  // ------------------------------------------------------------- reading ----

  /** Status from the local cache — no Stripe round trip. */
  async status(accountId: string): Promise<ConnectStatus> {
    const account = await this.loadAccount(accountId);
    return this.toStatus(account);
  }

  /**
   * Read Stripe and persist the result. Called on the onboarding return, from
   * the `account.updated` webhook, and on demand — the three moments the
   * cached flags can be wrong.
   */
  async refresh(accountId: string): Promise<ConnectStatus> {
    const account = await this.loadAccount(accountId);
    if (!account.stripe_connect_account_id) return this.toStatus(account);

    let remote;
    try {
      remote = await stripeCall(() =>
        getStripe().v2.core.accounts.retrieve(account.stripe_connect_account_id!, {
          include: [...ACCOUNT_INCLUDE],
        })
      );
    } catch (err) {
      // The stored account is gone on Stripe's side (deleted in the dashboard,
      // or the platform's test data was reset). Clear the dead link rather than
      // leaving the walker permanently blocked by an id that resolves to
      // nothing — the next onboarding start will mint a fresh account.
      if (err instanceof ServiceError && /No such account|resource_missing/i.test(err.message)) {
        await this.clearLink(accountId, 'stripe_account_missing');
        return this.status(accountId);
      }
      throw err;
    }

    // v2 replaces v1's three booleans with capability statuses and a
    // requirements list. The mapping is deliberate, and finer than v1 was:
    //   charges  — the card_payments capability is actually 'active'
    //   payouts  — money can reach the bank, which lags charges
    //   details  — nothing is still waiting on the WALKER. Entries awaiting
    //              Stripe mean the form is done and under review, which is a
    //              different screen from "you still owe us information".
    const caps = remote.configuration?.merchant?.capabilities;
    const entries = remote.requirements?.entries ?? [];
    const awaitingUser = entries.filter((e) => e.awaiting_action_from === 'user');

    const patch = {
      stripe_connect_charges_enabled: caps?.card_payments?.status === 'active',
      stripe_connect_payouts_enabled: caps?.stripe_balance?.payouts?.status === 'active',
      stripe_connect_details_submitted: awaitingUser.length === 0,
      stripe_connect_synced_at: new Date().toISOString(),
    };

    const becameReady = patch.stripe_connect_charges_enabled && !account.stripe_connect_charges_enabled;
    const updated = await this.patchAccount(accountId, patch);

    if (becameReady) {
      // Worth an event: this is the moment a walker can be paid, and it
      // happens asynchronously (Stripe's verification), so there is no
      // request to attribute it to otherwise.
      await eventService.publish({
        actorAccountId: accountId,
        eventType: 'connect_charges_enabled',
        subjectType: 'account',
        subjectId: accountId,
        metadata: { stripe_account_id: account.stripe_connect_account_id },
      });
    }

    return this.toStatus(
      updated,
      awaitingUser.map((e) => e.description).filter((d): d is string => Boolean(d))
    );
  }

  // ------------------------------------------------------- onboarding ----

  /**
   * Start (or resume) hosted onboarding. Returns a single-use Stripe URL.
   *
   * Creates the connected account on first call and stores the id immediately.
   * Account links expire and are single-use by design, so this is called again
   * every time the walker resumes — it is not a one-shot.
   */
  async startOnboarding(
    accountId: string,
    origin: string
  ): Promise<{ url: string; account_id: string }> {
    const account = await this.loadAccount(accountId);
    if (account.account_type !== 'professional') {
      throw new ServiceError('not_a_professional', 'Only a professional account can set up payouts.', 403);
    }

    const connectedId = account.stripe_connect_account_id ?? (await this.createConnectedAccount(account));

    const link = await stripeCall(() =>
      getStripe().v2.core.accountLinks.create({
        account: connectedId,
        use_case: {
          type: 'account_onboarding',
          account_onboarding: {
            configurations: ['merchant'],
            // Stripe sends the walker back here when the link expires before
            // it is used; the app just starts a fresh one rather than
            // dead-ending on an expired URL.
            refresh_url: `${origin}/#/profile?connect=refresh`,
            // On completion the client calls /api/connect/refresh before
            // rendering, so the walker never lands on a stale "not set up".
            return_url: `${origin}/#/profile?connect=return`,
          },
        },
      })
    );

    return { url: link.url, account_id: connectedId };
  }

  /**
   * Components the embedded UI may mount, in one place so the surface the
   * walker gets is a decision rather than whatever a component happened to be
   * passed at a call site.
   *
   * ⚠️ `account_onboarding` is deliberately ABSENT. Onboarding goes through
 * Stripe's hosted page (decided 2026-09-05) because the embedded onboarding
 * component cannot complete the Stripe user authentication this liability
 * config forces. Enabling a component we never mount would only widen the
 * session's scope for nothing. Re-add it here and in `web/src/connect.js`
 * together, or not at all.
 *
 * `dispute_management` is the point of the exercise: with the walker liable
   * for chargebacks (see ACCOUNT_CONFIGURATION), they must be able to actually
   * respond to a dispute from inside our app. Liability without the tooling to
   * contest is the worst of both worlds.
   *
   * All of these were confirmed to issue a session secret on this account
   * config, probed 2026-09-05.
   */
  /**
   * The same surface in the shape the **v2** endpoint wants.
   *
   * ⚠️ v2 is not v1 with a different URL. It rejects `features` outright
   * ("components.payments.features: Unknown field") and calls the same idea
   * `scopes`, which it sets itself — the defaults already include
   * `payment_dispute_management`, `payment_refund_management` and
   * `capture_payments`, so nothing is lost by omitting them. It also has no
   * `disputes_list` component at all.
   *
   * Sending the v1 payload here does not error loudly; it fails the v2 call,
   * which silently falls back to v1 and looks like it worked. That happened
   * once already — hence this constant existing separately rather than the two
   * shapes being one object someone assumes is portable.
   */
  private static readonly SESSION_COMPONENTS_V2 = {
    notification_banner: { enabled: true },
    payouts: { enabled: true },
    payments: { enabled: true },
  };

  private static readonly SESSION_COMPONENTS = {
    notification_banner: { enabled: true },
    payouts: { enabled: true },
    payments: {
      enabled: true,
      features: {
        dispute_management: true,
        refund_management: true,
        capture_payments: true,
      },
    },
  };

  /**
   * Tier gate on payouts. DECIDED 2026-09-05: receiving money is Paid-tier only.
   *
   * ⚠️ Tiers do not exist yet (Workstream S), so there is nothing to read and
   * this can only evaluate one way today — it lets everyone through. It exists
   * as a real checkpoint anyway, on purpose: when the tier column lands, turning
   * this on is this function plus that column, not an archaeology expedition to
   * find every place onboarding can begin. There are already two (the hosted
   * link and the embedded session) and that is exactly how gates grow holes.
   */
  private async assertCanOnboardToConnect(account: Account): Promise<void> {
    // TODO(Workstream S): once `accounts` carries a tier, enforce:
    //   if (account.tier !== 'paid') {
    //     throw new ServiceError(
    //       'tier_required',
    //       'Upgrade to receive payments from clients.',
    //       402
    //     );
    //   }
    void account;
  }

  /**
   * Mint a client secret for the embedded Connect components.
   *
   * Replaces the hosted redirect for onboarding, but does NOT remove it —
   * `startOnboarding` still works on this account config (probed 2026-09-05)
   * and stays as the fallback for a walker whose browser cannot run the
   * embedded components.
   *
   * ⚠️ Sessions are short-lived and single-account. The client re-requests
   * rather than caching, same as account links: a stale secret fails at mount
   * time, which is a worse place to discover it than at request time.
   */
  async createAccountSession(
    accountId: string
  ): Promise<{ client_secret: string; account_id: string }> {
    const account = await this.loadAccount(accountId);
    if (account.account_type !== 'professional') {
      throw new ServiceError('not_a_professional', 'Only a professional account can set up payouts.', 403);
    }
    await this.assertCanOnboardToConnect(account);

    const connectedId = account.stripe_connect_account_id ?? (await this.createConnectedAccount(account));

    const clientSecret = await this.mintSessionSecret(connectedId);
    return { client_secret: clientSecret, account_id: connectedId };
  }

  /**
   * Mint the embedded-components secret, preferring the v2 session endpoint.
   *
   * ⚠️ Our connected accounts are **v2**, but the Stripe SDK only exposes the
   * **v1** `accountSessions` endpoint, so that is what this used at first. The
   * v1 endpoint happily returns a secret for a v2 account -- and the embedded
   * `account_onboarding` component then failed to authenticate against it
   * ("An error occurred while authenticating your account"), while hosted
   * onboarding on the same account worked. Matching the session's API version
   * to the account's is the leading explanation.
   *
   * ⚠️ `/v2/core/account_sessions` is a **PREVIEW** API — it 404s unless the
   * `Stripe-Version` header ends in `.preview`, and preview APIs can change
   * without the usual deprecation window. That is why this falls back to v1
   * rather than depending on it: if the preview version stops being accepted,
   * onboarding degrades to the behaviour we already had instead of breaking.
   * Revisit when Stripe promotes this out of preview and into the SDK.
   */
  private async mintSessionSecret(connectedId: string): Promise<string> {
    try {
      const v2 = (await stripeCall(() =>
        getStripe().rawRequest(
          'POST',
          '/v2/core/account_sessions',
          { account: connectedId, components: ConnectService.SESSION_COMPONENTS_V2 },
          { apiVersion: SESSION_PREVIEW_VERSION }
        )
      )) as { client_secret?: string };
      if (v2?.client_secret) return v2.client_secret;
      console.warn('[connect] v2 account session returned no client_secret; falling back to v1');
    } catch (err) {
      // Preview API withdrawn, version rejected, or a transient failure. None
      // of those should stop a walker onboarding, so fall through to v1.
      console.warn(
        `[connect] v2 account session failed, falling back to v1: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const session = await stripeCall(() =>
      getStripe().accountSessions.create({
        account: connectedId,
        components: ConnectService.SESSION_COMPONENTS,
      })
    );
    return session.client_secret;
  }

  /**
   * Create the connected account and persist the link.
   *
   * ⚠️ Ordering hazard, deliberate: the account is created at Stripe first and
   * stored second. If the store fails we have orphaned a Stripe account, which
   * is why the id is logged loudly — an orphan is recoverable by hand, whereas
   * storing first would mean persisting an id that may not exist.
   */
  private async createConnectedAccount(account: Account): Promise<string> {
    // `display_name` is REQUIRED for Checkout, not cosmetic: Stripe refuses a
    // session on a connected account with no account/business name ("In order
    // to use Checkout, you must set an account or business name"). It is also
    // what the walker's client sees on the hosted payment page, so it should
    // be the business name rather than anything of ours. `requireCompleteProfile`
    // guards the onboarding route, so business_name is present by the time we
    // get here; full_name is a belt-and-braces fallback.
    const { data: profile } = await supabaseAdmin
      .from('professional_profiles')
      .select('business_name, full_name')
      .eq('account_id', account.id)
      .maybeSingle();
    const displayName =
      (profile?.business_name as string | null) ?? (profile?.full_name as string | null) ?? account.email;

    // ⚠️ `contact_phone` is not decoration. Because the walker carries losses,
    // Stripe collects their requirements, which means Stripe makes them
    // authenticate as a Stripe user — and that verification uses one-time
    // codes. Creating the account without a phone gives that flow nothing to
    // send a code to. `requireCompleteProfile` guarantees a phone exists by the
    // time we get here, so there is no reason to withhold it.
    const contactPhone = toE164(account.phone);

    const createWith = (phone: string | null) =>
      getStripe().v2.core.accounts.create({
        contact_email: account.email,
        ...(phone ? { contact_phone: phone } : {}),
        display_name: displayName,
        dashboard: ACCOUNT_CONFIGURATION.dashboard,
        identity: { country: 'us', entity_type: 'individual' },
        defaults: {
          currency: 'usd',
          responsibilities: ACCOUNT_CONFIGURATION.responsibilities,
        },
        configuration: {
          merchant: { capabilities: { card_payments: { requested: true } } },
        },
        metadata: { sitstayplay_account_id: account.id },
        include: [...ACCOUNT_INCLUDE],
      });

    // ⚠️ Stripe's phone validation is STRICTER than ours. It rejects numbers
    // that are correctly E.164-formatted but not real — 555 area codes, for
    // one — and our profile form happily accepts those. A phone Stripe
    // dislikes must never cost the walker their payout account, so a
    // phone-specific rejection retries without it: worse authentication
    // ergonomics beats no account at all.
    let created;
    try {
      created = await stripeCall(() => createWith(contactPhone));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!contactPhone || !/phone/i.test(msg)) throw err;
      console.warn(`[connect] Stripe rejected contact_phone for account ${account.id}; retrying without it: ${msg}`);
      created = await stripeCall(() => createWith(null));
    }

    try {
      await this.patchAccount(account.id, { stripe_connect_account_id: created.id });
    } catch (err) {
      console.error(
        `[connect] ORPHANED Stripe account ${created.id} — created for account ${account.id} but the link could not be stored. Attach it by hand or delete it.`
      );
      throw err;
    }

    await eventService.publish({
      actorAccountId: account.id,
      eventType: 'connect_account_created',
      subjectType: 'account',
      subjectId: account.id,
      metadata: { stripe_account_id: created.id },
    });

    return created.id;
  }

  /**
   * Break the link — relationship termination, or a walker moving to a
   * different Stripe account. Deliberately does NOT delete anything at Stripe:
   * the walker's account, its history and its payouts are theirs, not ours.
   */
  async disconnect(accountId: string, reason = 'disconnected_by_user'): Promise<ConnectStatus> {
    const account = await this.loadAccount(accountId);
    if (!account.stripe_connect_account_id) return this.toStatus(account);
    await this.clearLink(accountId, reason);
    return this.status(accountId);
  }

  // ------------------------------------------------------------- the gate ----

  /**
   * BLOCK (2026-08-29). Throws unless this professional can actually take a
   * card payment. Called from the service layer rather than as route
   * middleware on purpose: three surfaces reach the charge path — the
   * professional app, the owner portal, and the public pay link — and a list
   * of route shapes is exactly the thing that grows a hole. Same reasoning as
   * `requireCompleteProfile`'s note about riding on the capability.
   */
  async assertCanCollect(professionalAccountId: string): Promise<void> {
    let account = await this.loadAccount(professionalAccountId);

    // Self-healing: a walker who just finished verification should not be
    // blocked by a cache we never refreshed. Only on the refusal path, so the
    // happy path stays free of Stripe round trips.
    if (!account.stripe_connect_charges_enabled && account.stripe_connect_account_id) {
      const syncedAt = account.stripe_connect_synced_at
        ? Date.parse(account.stripe_connect_synced_at)
        : 0;
      if (Date.now() - syncedAt > STALE_CACHE_MS) {
        await this.refresh(professionalAccountId);
        account = await this.loadAccount(professionalAccountId);
      }
    }

    if (account.stripe_connect_charges_enabled) return;

    const status = this.toStatus(account);
    throw new ServiceError(
      'payout_not_ready',
      status.state === 'not_started'
        ? 'Set up payments before collecting from a client — your payout account isn\'t connected yet.'
        : status.state === 'incomplete'
          ? 'Finish your payment setup before collecting — Stripe still needs a few details.'
          : 'Your payout account is still being verified by Stripe. You can\'t collect payment until that finishes.',
      403
    );
  }

  /**
   * How a charge for this professional must be routed.
   *
   * The Checkout Session is created ON the connected account (`stripeAccount`),
   * so funds settle to the walker rather than into the platform balance, and
   * the hosted page carries the walker's branding — which is what
   * `PHASE_3_ROADMAP` → P2-7 assumes when it says per-professional Checkout
   * branding needs Connect. It also makes BLOCK structurally true rather than
   * merely enforced: with no connected account there is no account to charge on.
   *
   * ⚠️ Routing is NOT the same as liability. Who absorbs a refund or chargeback
   * is set by `ACCOUNT_CONFIGURATION.responsibilities`, not by where the charge
   * is created. As of 2026-09-05 that is the WALKER — settled, not open. See the
   * note on that constant for the decision and the configurations Stripe allows.
   *
   * One operational consequence: the walker's events arrive on the webhook as
   * connected-account events with `event.account` set, so the Stripe endpoint
   * has to be configured to send them.
   */
  async chargeRouting(professionalAccountId: string): Promise<{ stripeAccount: string }> {
    const account = await this.loadAccount(professionalAccountId);
    if (!account.stripe_connect_account_id) {
      throw new ServiceError('payout_not_ready', 'No connected payout account.', 403);
    }
    return { stripeAccount: account.stripe_connect_account_id };
  }

  /** Reverse lookup for webhook events, which arrive keyed by Stripe's id. */
  async findByStripeAccountId(stripeAccountId: string): Promise<Account | null> {
    const { data, error } = await supabaseAdmin
      .from('accounts')
      .select('*')
      .eq('stripe_connect_account_id', stripeAccountId)
      .maybeSingle();
    if (error) throw new ServiceError('lookup_failed', error.message, 500);
    return (data as Account) ?? null;
  }

  // ------------------------------------------------------------ internals ----

  private async loadAccount(accountId: string): Promise<Account> {
    const { data, error } = await supabaseAdmin
      .from('accounts')
      .select('*')
      .eq('id', accountId)
      .maybeSingle();
    if (error) throw new ServiceError('lookup_failed', error.message, 500);
    if (!data) throw new ServiceError('account_not_found', 'Account not found.', 404);
    return data as Account;
  }

  private async patchAccount(accountId: string, patch: Record<string, unknown>): Promise<Account> {
    const { data, error } = await supabaseAdmin
      .from('accounts')
      .update(patch)
      .eq('id', accountId)
      .select()
      .single();
    if (error) throw new ServiceError('account_update_failed', error.message, 500);
    return data as Account;
  }

  private async clearLink(accountId: string, reason: string): Promise<void> {
    await this.patchAccount(accountId, {
      stripe_connect_account_id: null,
      stripe_connect_charges_enabled: false,
      stripe_connect_payouts_enabled: false,
      stripe_connect_details_submitted: false,
      stripe_connect_synced_at: null,
    });
    await eventService.publish({
      actorAccountId: accountId,
      eventType: 'connect_disconnected',
      subjectType: 'account',
      subjectId: accountId,
      metadata: { reason },
    });
  }

  private toStatus(account: Account, requirementsDue?: string[]): ConnectStatus {
    const connected = Boolean(account.stripe_connect_account_id);
    const charges = Boolean(account.stripe_connect_charges_enabled);
    const submitted = Boolean(account.stripe_connect_details_submitted);

    const state: ConnectStatus['state'] = !connected
      ? 'not_started'
      : charges
        ? 'ready'
        : submitted
          ? 'pending_review'
          : 'incomplete';

    return {
      connected,
      account_id: account.stripe_connect_account_id,
      charges_enabled: charges,
      payouts_enabled: Boolean(account.stripe_connect_payouts_enabled),
      details_submitted: submitted,
      payout_ready: charges,
      synced_at: account.stripe_connect_synced_at,
      state,
      ...(requirementsDue?.length ? { requirements_due: requirementsDue } : {}),
    };
  }
}

export const connectService = new ConnectService();
