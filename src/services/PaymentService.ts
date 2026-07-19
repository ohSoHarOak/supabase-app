import Stripe from 'stripe';
import { env } from '../config/env';
import { supabaseAdmin } from '../config/supabase';
import {
  BillingCadence,
  BillingPeriod,
  Invoice,
  InvoiceStatus,
  PaymentTransaction,
  Service,
  SessionBalance,
  StripeProduct,
} from '../types';
import { clientService } from './ClientService';
import { ServiceError } from './errors';
import { eventService } from './EventService';
import { notificationService } from './NotificationService';

// ------------------------------------------------- recurring billing math ----
// Founder decision 2026-07-17 (resolves the Week 6 [d]): weekly / biweekly /
// monthly services invoice at the END of each billing period. These helpers
// are the one place period math lives; SchedulingService uses them when a
// service is created, activated, or resumed.

export const RECURRING_CADENCES: readonly BillingCadence[] = ['weekly', 'biweekly', 'monthly'];

export function isRecurringCadence(cadence: BillingCadence): boolean {
  return (RECURRING_CADENCES as BillingCadence[]).includes(cadence);
}

const PERIOD_NOUN: Record<string, string> = { weekly: 'week', biweekly: '2 weeks', monthly: 'month' };

function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function ymdToday(): string {
  return ymd(new Date());
}

/** One billing period after fromYmd. Monthly rides Date's month arithmetic
 *  (Jan 31 + 1 month lands early March) — acceptable drift for Phase 1. */
export function advancePeriod(fromYmd: string, cadence: BillingCadence): string {
  const [y, m, d] = fromYmd.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (cadence === 'monthly') date.setMonth(date.getMonth() + 1);
  else date.setDate(date.getDate() + (cadence === 'biweekly' ? 14 : 7));
  return ymd(date);
}

/** When a recurring service comes alive: its first invoice lands one period
 *  after its start date (or after today, if the start is unset or already
 *  past — reviving an old start date would owe periods nobody was served). */
export function initialInvoiceDate(startYmd: string | null | undefined, cadence: BillingCadence): string {
  const today = ymdToday();
  const anchor = startYmd && startYmd > today ? startYmd : today;
  return advancePeriod(anchor, cadence);
}

function formatYmd(value: string): string {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export interface BillableItemInput {
  name: string;
  unit_amount_cents: number;
  billing_period: BillingPeriod;
}

export interface CreateInvoiceInput {
  client_id: string;
  /** Bill from a saved billable item (unit price × quantity)… */
  billable_item_id?: string | null;
  quantity?: number;
  /** …or an ad-hoc amount with a description. */
  amount_cents?: number | null;
  description?: string | null;
  due_date?: string | null;
  /** The service this invoice bills for (set by Week 6's auto-invoice). */
  service_id?: string | null;
  /** R-2/R-3: visits this invoice prepays for `service_id`. Once the invoice
   *  is paid, completions draw down against it instead of billing again. */
  sessions_purchased?: number | null;
}

interface RecordPaymentInput {
  paymentIntentId: string | null;
  amountCents: number;
  /** Stripe event id when called from the webhook; null from the sync path. */
  stripeEventId: string | null;
}

/**
 * Payments — Week 5 (Marketplace Seam 4: generic billing).
 *
 * Stripe products are billable items attached to an account, never
 * "walker subscriptions". Phase 1 charges the platform Stripe account
 * directly (the founder is the only professional); per-professional
 * Stripe Connect accounts are the Phase 3 marketplace upgrade and slot
 * in here without changing callers.
 *
 * Payment collection uses Stripe Checkout (hosted page). An invoice is
 * marked paid by either path, idempotently:
 *   - webhook  (checkout.session.completed, keyed by stripe_event_id)
 *   - sync     (retrieve the Checkout Session on return from Stripe)
 */
export class PaymentService {
  private stripeClient: Stripe | null = null;

  private get stripe(): Stripe {
    if (!env.stripeSecretKey) {
      throw new ServiceError(
        'stripe_not_configured',
        'Stripe is not configured — set STRIPE_SECRET_KEY in the environment.',
        503
      );
    }
    if (!this.stripeClient) this.stripeClient = new Stripe(env.stripeSecretKey);
    return this.stripeClient;
  }

  /** Surface Stripe failures as readable API errors instead of a bare 500 —
   *  "Invalid API key" vs "amount too small" matters to whoever is debugging. */
  private async stripeCall<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Stripe.errors.StripeError) {
        throw new ServiceError('stripe_error', `Stripe: ${err.message}`, 502);
      }
      throw err;
    }
  }

  // ------------------------------------------------------ billable items ----

  /** Create a billable item, backed by a real Stripe Product + Price. */
  async createBillableItem(accountId: string, input: BillableItemInput): Promise<StripeProduct> {
    const product = await this.stripeCall(() =>
      this.stripe.products.create({
        name: input.name,
        metadata: { petpro_account_id: accountId },
      })
    );
    const price = await this.stripeCall(() =>
      this.stripe.prices.create({
        product: product.id,
        currency: 'usd',
        unit_amount: input.unit_amount_cents,
        // billing_period_enum values map 1:1 onto Stripe recurring intervals.
        ...(input.billing_period === 'one_time'
          ? {}
          : { recurring: { interval: input.billing_period } }),
      })
    );

    const { data, error } = await supabaseAdmin
      .from('stripe_products')
      .insert({
        account_id: accountId,
        stripe_product_id: product.id,
        stripe_price_id: price.id,
        name: input.name,
        unit_amount_cents: input.unit_amount_cents,
        billing_period: input.billing_period,
      })
      .select()
      .single();
    if (error) throw new ServiceError('billable_item_create_failed', error.message, 500);
    return data as StripeProduct;
  }

  async listBillableItems(accountId: string): Promise<StripeProduct[]> {
    const { data, error } = await supabaseAdmin
      .from('stripe_products')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false });
    if (error) throw new ServiceError('billable_item_list_failed', error.message, 500);
    return (data ?? []) as StripeProduct[];
  }

  private async getBillableItem(accountId: string, itemId: string): Promise<StripeProduct> {
    const { data, error } = await supabaseAdmin
      .from('stripe_products')
      .select('*')
      .eq('id', itemId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (error) throw new ServiceError('billable_item_lookup_failed', error.message, 500);
    if (!data) throw new ServiceError('billable_item_not_found', 'Billable item not found.', 404);
    return data as StripeProduct;
  }

  // ---------------------------------------------------- prepaid balances ----

  /**
   * R-2/R-3: how many prepaid visits each service has left.
   *
   *   remaining = SUM(sessions_purchased over PAID invoices) - COUNT(completed
   *               appointments)
   *
   * The used side is **derived, never stored**, so it cannot drift away from
   * the schedule the way a counter column would (same reasoning as O-1's
   * derived "setup complete"). Only `paid` invoices count — an unpaid package
   * is a quote, and crediting visits against it would let a client walk for
   * free by never paying.
   *
   * Two grouped queries for the whole set, not one per service.
   */
  async sessionBalances(
    professionalAccountId: string,
    serviceIds: string[]
  ): Promise<Map<string, SessionBalance>> {
    const balances = new Map<string, SessionBalance>();
    const ids = [...new Set(serviceIds)].filter(Boolean);
    if (ids.length === 0) return balances;

    const [invoicesRes, apptsRes] = await Promise.all([
      supabaseAdmin
        .from('invoices')
        .select('service_id, sessions_purchased')
        .eq('professional_account_id', professionalAccountId)
        .in('service_id', ids)
        .eq('status', 'paid')
        .not('sessions_purchased', 'is', null),
      supabaseAdmin
        .from('appointments')
        .select('service_id')
        .eq('professional_account_id', professionalAccountId)
        .in('service_id', ids)
        .eq('status', 'completed'),
    ]);
    if (invoicesRes.error) throw new ServiceError('session_balance_failed', invoicesRes.error.message, 500);
    if (apptsRes.error) throw new ServiceError('session_balance_failed', apptsRes.error.message, 500);

    for (const row of invoicesRes.data ?? []) {
      const id = row.service_id as string;
      const current = balances.get(id) ?? { purchased: 0, used: 0, remaining: 0 };
      current.purchased += (row.sessions_purchased as number) ?? 0;
      balances.set(id, current);
    }
    // Services with completed walks but no prepaid invoice never enter the
    // map — "no package" and "a package with nothing left" must stay
    // distinguishable, or every ordinary service would look exhausted.
    for (const row of apptsRes.data ?? []) {
      const id = row.service_id as string;
      const current = balances.get(id);
      if (current) current.used += 1;
    }
    for (const balance of balances.values()) {
      balance.remaining = Math.max(0, balance.purchased - balance.used);
    }
    return balances;
  }

  // ------------------------------------------------------------ invoices ----

  async createInvoice(professionalAccountId: string, input: CreateInvoiceInput): Promise<Invoice> {
    // Ownership check — also 404s a client that isn't this professional's.
    const client = await clientService.getClient(professionalAccountId, input.client_id);

    let amountCents: number;
    let description: string | null = input.description ?? null;
    const quantity = input.quantity ?? 1;

    if (input.billable_item_id) {
      const item = await this.getBillableItem(professionalAccountId, input.billable_item_id);
      amountCents = item.unit_amount_cents * quantity;
      if (!description) description = quantity > 1 ? `${item.name} × ${quantity}` : item.name;
    } else if (input.amount_cents) {
      amountCents = input.amount_cents;
    } else {
      throw new ServiceError(
        'invoice_amount_required',
        'Provide either billable_item_id or amount_cents.',
        422
      );
    }

    const { data, error } = await supabaseAdmin
      .from('invoices')
      .insert({
        professional_account_id: professionalAccountId,
        client_id: client.id,
        service_id: input.service_id ?? null,
        amount_cents: amountCents,
        description,
        due_date: input.due_date ?? null,
        // R-2/R-3: only meaningful alongside a service — a package with
        // nothing to draw down against is a number with no home.
        sessions_purchased: input.service_id ? input.sessions_purchased ?? null : null,
        status: 'open',
      })
      .select()
      .single();
    if (error) throw new ServiceError('invoice_create_failed', error.message, 500);
    const invoice = data as Invoice;

    await eventService.publish({
      actorAccountId: professionalAccountId,
      eventType: 'invoice_generated',
      subjectType: 'invoice',
      subjectId: invoice.id,
      metadata: { client_id: client.id, amount_cents: amountCents, description },
    });

    return invoice;
  }

  async listInvoices(
    professionalAccountId: string,
    options: { clientId?: string; status?: InvoiceStatus } = {}
  ): Promise<Invoice[]> {
    let builder = supabaseAdmin
      .from('invoices')
      .select('*')
      .eq('professional_account_id', professionalAccountId)
      .order('created_at', { ascending: false });
    if (options.clientId) builder = builder.eq('client_id', options.clientId);
    if (options.status) builder = builder.eq('status', options.status);

    const { data, error } = await builder;
    if (error) throw new ServiceError('invoice_list_failed', error.message, 500);
    return (data ?? []) as Invoice[];
  }

  async getInvoice(professionalAccountId: string, invoiceId: string): Promise<Invoice> {
    const { data, error } = await supabaseAdmin
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .eq('professional_account_id', professionalAccountId)
      .maybeSingle();
    if (error) throw new ServiceError('invoice_lookup_failed', error.message, 500);
    if (!data) throw new ServiceError('invoice_not_found', 'Invoice not found.', 404);
    return data as Invoice;
  }

  async voidInvoice(professionalAccountId: string, invoiceId: string): Promise<Invoice> {
    const invoice = await this.getInvoice(professionalAccountId, invoiceId);
    if (invoice.status === 'paid') {
      throw new ServiceError('invoice_paid', 'A paid invoice cannot be voided.', 409);
    }
    const { data, error } = await supabaseAdmin
      .from('invoices')
      .update({ status: 'void' })
      .eq('id', invoiceId)
      .select()
      .single();
    if (error) throw new ServiceError('invoice_void_failed', error.message, 500);
    return data as Invoice;
  }

  async listTransactions(professionalAccountId: string, invoiceId: string): Promise<PaymentTransaction[]> {
    await this.getInvoice(professionalAccountId, invoiceId); // ownership check
    const { data, error } = await supabaseAdmin
      .from('payment_transactions')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('occurred_at', { ascending: false });
    if (error) throw new ServiceError('transaction_list_failed', error.message, 500);
    return (data ?? []) as PaymentTransaction[];
  }

  // ------------------------------------------------------------ checkout ----

  /**
   * Create a Stripe Checkout Session for an open invoice. Returns the hosted
   * payment page URL; the client pays there and Stripe redirects back to the
   * app, which calls syncInvoicePayment() as a webhook-independent fallback.
   */
  async createCheckoutSession(
    professionalAccountId: string,
    invoiceId: string,
    origin: string,
    options: { portal?: boolean } = {}
  ): Promise<{ invoice: Invoice; checkout_url: string }> {
    const invoice = await this.getInvoice(professionalAccountId, invoiceId);
    if (invoice.status === 'paid') {
      throw new ServiceError('invoice_paid', 'This invoice is already paid.', 409);
    }
    if (invoice.status === 'void' || invoice.status === 'uncollectible') {
      throw new ServiceError('invoice_not_payable', `A ${invoice.status} invoice cannot be paid.`, 409);
    }

    const session = await this.stripeCall(() =>
      this.stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: invoice.currency,
            unit_amount: invoice.amount_cents,
            product_data: { name: invoice.description || 'Pet care services' },
          },
        },
      ],
      metadata: { invoice_id: invoice.id },
      payment_intent_data: { metadata: { invoice_id: invoice.id } },
        // Stripe sends the payer back to whichever app started the checkout —
        // the professional UI or the Week 8 owner portal.
        success_url: `${origin}${options.portal ? '/portal' : '/'}#/invoice/${invoice.id}/return`,
        cancel_url: `${origin}${options.portal ? '/portal' : '/'}#/invoice/${invoice.id}/return?canceled=1`,
      })
    );
    if (!session.url) throw new ServiceError('checkout_failed', 'Stripe returned no checkout URL.', 500);

    // Remember the session so the sync path can reconcile without a webhook.
    const { data, error } = await supabaseAdmin
      .from('invoices')
      .update({ stripe_checkout_session_id: session.id })
      .eq('id', invoice.id)
      .select()
      .single();
    if (error) throw new ServiceError('invoice_update_failed', error.message, 500);

    return { invoice: data as Invoice, checkout_url: session.url };
  }

  /**
   * Webhook-independent reconciliation: ask Stripe whether the invoice's
   * Checkout Session is paid, and record the payment if so. Safe to call
   * any number of times.
   */
  async syncInvoicePayment(professionalAccountId: string, invoiceId: string): Promise<Invoice> {
    const invoice = await this.getInvoice(professionalAccountId, invoiceId);
    if (invoice.status === 'paid' || !invoice.stripe_checkout_session_id) return invoice;

    const session = await this.stripeCall(() =>
      this.stripe.checkout.sessions.retrieve(invoice.stripe_checkout_session_id!)
    );
    if (session.payment_status === 'paid') {
      await this.recordPayment(invoice.id, {
        paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
        amountCents: session.amount_total ?? invoice.amount_cents,
        stripeEventId: null,
      });
    }
    return this.getInvoice(professionalAccountId, invoiceId);
  }

  // ------------------------------------------------------------- webhook ----

  /**
   * Verify and process a Stripe webhook delivery. Idempotent two ways:
   * the stripe_event_id UNIQUE column blocks replays of the same event,
   * and recordPayment() skips a payment already recorded by the sync path.
   */
  async handleWebhook(rawBody: Buffer, signature: string | undefined): Promise<{ handled: boolean }> {
    if (!env.stripeWebhookSecret) {
      throw new ServiceError(
        'webhook_not_configured',
        'STRIPE_WEBHOOK_SECRET is not set — configure the webhook endpoint in the Stripe dashboard first.',
        503
      );
    }
    if (!signature) {
      throw new ServiceError('webhook_unsigned', 'Missing Stripe-Signature header.', 400);
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, env.stripeWebhookSecret);
    } catch (err) {
      throw new ServiceError('webhook_bad_signature', (err as Error).message, 400);
    }

    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object as Stripe.Checkout.Session;
        const invoiceId = session.metadata?.invoice_id;
        if (session.payment_status === 'paid' && invoiceId) {
          await this.recordPayment(invoiceId, {
            paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
            amountCents: session.amount_total ?? 0,
            stripeEventId: event.id,
          });
          return { handled: true };
        }
        return { handled: false };
      }
      default:
        // Unhandled event types are acknowledged so Stripe stops retrying.
        return { handled: false };
    }
  }

  // ------------------------------------------------------ record payment ----

  /**
   * Record a successful payment exactly once, then mark the invoice paid and
   * fire the payment_received event — only on the not-paid → paid transition,
   * so replays and the webhook+sync double-path never double-fire it.
   */
  private async recordPayment(invoiceId: string, input: RecordPaymentInput): Promise<void> {
    const { data: invoiceRow, error: invoiceError } = await supabaseAdmin
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .maybeSingle();
    if (invoiceError) throw new ServiceError('invoice_lookup_failed', invoiceError.message, 500);
    if (!invoiceRow) return; // stale metadata on a Stripe object — nothing to record
    const invoice = invoiceRow as Invoice;

    // Skip the transaction insert if this payment is already recorded —
    // by event id (webhook replay) or by payment intent (sync + webhook).
    let alreadyRecorded = false;
    if (input.stripeEventId) {
      const { data } = await supabaseAdmin
        .from('payment_transactions')
        .select('id')
        .eq('stripe_event_id', input.stripeEventId)
        .maybeSingle();
      alreadyRecorded = Boolean(data);
    }
    if (!alreadyRecorded && input.paymentIntentId) {
      const { data } = await supabaseAdmin
        .from('payment_transactions')
        .select('id')
        .eq('invoice_id', invoiceId)
        .eq('stripe_payment_intent_id', input.paymentIntentId)
        .eq('status', 'succeeded')
        .limit(1);
      alreadyRecorded = Boolean(data && data.length > 0);
    }

    if (!alreadyRecorded) {
      const { error } = await supabaseAdmin.from('payment_transactions').insert({
        invoice_id: invoiceId,
        stripe_payment_intent_id: input.paymentIntentId,
        stripe_event_id: input.stripeEventId,
        amount_cents: input.amountCents,
        status: 'succeeded',
      });
      // A unique-violation race on stripe_event_id means another delivery
      // beat us to it — that's the idempotency working, not a failure.
      if (error && !/duplicate key/i.test(error.message)) {
        throw new ServiceError('transaction_record_failed', error.message, 500);
      }
    }

    // not-paid → paid transition; the .neq guard makes it fire exactly once.
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('invoices')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', invoiceId)
      .neq('status', 'paid')
      .select()
      .maybeSingle();
    if (updateError) throw new ServiceError('invoice_update_failed', updateError.message, 500);

    if (updated) {
      await eventService.publish({
        actorAccountId: invoice.professional_account_id,
        eventType: 'payment_received',
        subjectType: 'invoice',
        subjectId: invoiceId,
        metadata: {
          client_id: invoice.client_id,
          amount_cents: input.amountCents,
          stripe_payment_intent_id: input.paymentIntentId,
          via: input.stripeEventId ? 'webhook' : 'sync',
        },
      });

      // Week 7 emails, both riding the same paid-exactly-once transition the
      // event does: a receipt to the client, a "you got paid" to the
      // professional. enqueue never throws.
      await notificationService.enqueue({
        accountId: invoice.professional_account_id,
        category: 'payment',
        template: 'payment_receipt',
        data: { invoice_id: invoiceId },
      });
      await notificationService.enqueue({
        accountId: invoice.professional_account_id,
        category: 'payment',
        template: 'payment_received',
        data: { invoice_id: invoiceId },
      });
    }
  }

  // ------------------------------------------------- recurring invoicing ----

  /**
   * One worker pass: invoice every active weekly/biweekly/monthly service
   * whose billing period has ended, and advance its next_invoice_date.
   *
   * Exactly-once per period: the advance UPDATE is compare-and-set on the
   * current next_invoice_date, so overlapping passes can't both invoice the
   * same period. The advance wins BEFORE the invoice is created — a crash in
   * between loses at most one invoice (recoverable by hand via the Week 5
   * billing UI); the reverse order could double-bill, which is not.
   *
   * Services the feature has never seen (next_invoice_date null) are
   * scheduled one period out and NOT invoiced — no surprise catch-up
   * invoices for periods that predate the feature.
   */
  async generateRecurringInvoices(): Promise<number> {
    const today = ymdToday();
    const { data, error } = await supabaseAdmin
      .from('services')
      .select('*')
      .eq('status', 'active')
      .in('billing_cadence', RECURRING_CADENCES as string[]);
    if (error) throw new ServiceError('recurring_invoice_scan_failed', error.message, 500);

    let generated = 0;
    for (const service of (data ?? []) as Service[]) {
      try {
        if (!service.next_invoice_date) {
          await supabaseAdmin
            .from('services')
            .update({ next_invoice_date: advancePeriod(today, service.billing_cadence) })
            .eq('id', service.id)
            .is('next_invoice_date', null);
          continue;
        }
        if (service.next_invoice_date > today) continue;
        // W-13 end date: a service that has run past its end has nothing
        // left to bill; the walker Ends it (or extends the date) from the UI.
        if (service.end_date && service.next_invoice_date > service.end_date) continue;

        const next = advancePeriod(service.next_invoice_date, service.billing_cadence);
        const { data: claimed, error: claimError } = await supabaseAdmin
          .from('services')
          .update({ next_invoice_date: next })
          .eq('id', service.id)
          .eq('next_invoice_date', service.next_invoice_date)
          .select()
          .maybeSingle();
        if (claimError || !claimed) continue; // another pass got here first

        await this.createInvoice(service.professional_account_id, {
          client_id: service.client_id,
          amount_cents: service.price_cents,
          description: `${service.name} — ${PERIOD_NOUN[service.billing_cadence] ?? 'period'} ending ${formatYmd(service.next_invoice_date)}`,
          service_id: service.id,
        });
        generated++;
      } catch (err) {
        // One service's failure must not starve the rest of the pass.
        console.error(`[billing] recurring invoice failed for service ${service.id}:`, err);
      }
    }
    return generated;
  }
}

export const paymentService = new PaymentService();

/** Interval driver for period-end invoicing, mirroring the notification
 *  worker. Runs a pass at boot too: on hosting that sleeps between requests
 *  (Render free tier), boot is the one moment we know we're awake. */
export function startRecurringInvoiceWorker(intervalMs = 5 * 60_000): NodeJS.Timeout {
  const pass = () =>
    void paymentService.generateRecurringInvoices().then(
      (n) => {
        if (n > 0) console.log(`[billing] generated ${n} recurring invoice(s)`);
      },
      (err) => console.error('[billing] recurring invoice pass failed:', err)
    );
  pass();
  const timer = setInterval(pass, intervalMs);
  timer.unref();
  return timer;
}
