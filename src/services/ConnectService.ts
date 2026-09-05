import { supabaseAdmin } from '../config/supabase';
import { Account } from '../types';
import { eventService } from './EventService';
import { ServiceError } from './errors';
import { getStripe, stripeCall } from './stripe';

/**
 * M-Connect — Stripe Connect Express onboarding and the payout gate.
 *
 * The walker is the merchant. Money moves from the client's card to the
 * walker's own Stripe account without landing in the platform balance
 * (see `chargeRouting()` and its use in PaymentService). The platform takes
 * nothing — DECIDED 2026-09-04, see `platformFeeCents`.
 *
 * Two states that look alike and are not:
 *   - `stripe_connect_account_id` exists  → we have an account
 *   - `charges_enabled`                   → it can actually take money
 * An Express account exists the instant we create it; Stripe enables
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

/** Re-check with Stripe before refusing a charge if the cache is older than this. */
const STALE_CACHE_MS = 60_000;

/** Fields the v2 account API only returns when asked for them. */
const ACCOUNT_INCLUDE = ['configuration.merchant', 'identity', 'requirements'] as const;

/**
 * The connected-account shape, in one place because it encodes a decision with
 * money attached.
 *
 * ⚠️ ACCOUNTS V2, not v1. Stripe now refuses `accounts.create({type:'express'})`
 * for new integrations ("Stripe no longer recommends Accounts v1"), so the
 * 2026-07-19 "Stripe Connect Express" decision is implemented as a v2 account
 * with `dashboard: 'express'` — same product (Stripe-hosted onboarding, light
 * dashboard for the walker), current API.
 *
 * ⚠️ `responsibilities` is the liability model, and Stripe forces the choice:
 * `dashboard: 'express'` with `losses_collector: 'stripe'` is REJECTED as an
 * unsupported configuration (verified 2026-09-04). Express means the PLATFORM
 * carries fees and losses — i.e. the founder absorbs chargebacks.
 *
 * That pairs badly with the platform fee being 0 (2026-09-04): the platform
 * would carry refund and chargeback exposure while earning nothing per
 * transaction. The alternative Stripe does support is `dashboard: 'full'` with
 * `losses_collector: 'stripe'`, which puts liability on the walker but gives
 * them a full Stripe account and departs from the recorded Express decision.
 *
 * Left as Express — faithful to what was decided — and flagged for the founder
 * rather than silently switched. Changing it is this constant plus a doc note.
 */
const ACCOUNT_CONFIGURATION = {
  dashboard: 'express' as const,
  responsibilities: {
    losses_collector: 'application' as const,
    fees_collector: 'application' as const,
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
   * Creates the Express account on first call and stores the id immediately.
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

    const connectedId = account.stripe_connect_account_id ?? (await this.createExpressAccount(account));

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
   * Create the Express account and persist the link.
   *
   * ⚠️ Ordering hazard, deliberate: the account is created at Stripe first and
   * stored second. If the store fails we have orphaned a Stripe account, which
   * is why the id is logged loudly — an orphan is recoverable by hand, whereas
   * storing first would mean persisting an id that may not exist.
   */
  private async createExpressAccount(account: Account): Promise<string> {
    const created = await stripeCall(() =>
      getStripe().v2.core.accounts.create({
        contact_email: account.email,
        dashboard: ACCOUNT_CONFIGURATION.dashboard,
        identity: { country: 'us', entity_type: 'individual' },
        defaults: {
          currency: 'usd',
          responsibilities: ACCOUNT_CONFIGURATION.responsibilities,
        },
        configuration: {
          merchant: { capabilities: { card_payments: { requested: true } } },
        },
        metadata: { petpro_account_id: account.id },
        include: [...ACCOUNT_INCLUDE],
      })
    );

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
  async disconnect(accountId: string): Promise<ConnectStatus> {
    const account = await this.loadAccount(accountId);
    if (!account.stripe_connect_account_id) return this.toStatus(account);
    await this.clearLink(accountId, 'disconnected_by_user');
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
   * is set by `ACCOUNT_CONFIGURATION.responsibilities`, which Stripe ties to the
   * dashboard type — and for Express that is the PLATFORM, not the walker. See
   * the note on that constant; it is an open founder question, not a settled one.
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
