import { Router, raw } from 'express';
import { z } from 'zod';
import { paymentService } from '../../services/PaymentService';
import { eventService } from '../../services/EventService';
import { requireAuth, requireAccountType } from '../middleware/auth';

// ----------------------------------------------------------- validation ----

const billableItemSchema = z.object({
  name: z.string().trim().min(1, 'Item name is required.'),
  unit_amount_cents: z
    .number()
    .int('Amount must be whole cents.')
    .positive('Amount must be positive.')
    .max(100_000_000, 'Amount is unreasonably large.'),
  billing_period: z.enum(['one_time', 'week', 'month']).default('one_time'),
});

const createInvoiceSchema = z
  .object({
    client_id: z.string().uuid('client_id must be a UUID.'),
    billable_item_id: z.string().uuid().nullish(),
    quantity: z.number().int().min(1).max(1000).optional(),
    amount_cents: z.number().int().positive().max(100_000_000).nullish(),
    description: z.string().trim().min(1).max(500).nullish(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'due_date must be YYYY-MM-DD.').nullish(),
    // R-2/R-3: an invoice can prepay N visits of a service. Week 6's
    // auto-invoice always set service_id service-side; the route never
    // accepted it, so until now the UI could not create a linked invoice.
    service_id: z.string().uuid().nullish(),
    sessions_purchased: z.number().int().min(1).max(1000).nullish(),
  })
  .refine((v) => v.billable_item_id || v.amount_cents, {
    message: 'Provide either billable_item_id or amount_cents.',
  })
  .refine((v) => v.billable_item_id || v.description, {
    message: 'A custom amount needs a description.',
  })
  .refine((v) => !v.sessions_purchased || v.service_id, {
    message: 'Prepaid visits need the service they apply to.',
  });

function validationError(res: import('express').Response, issues: z.ZodIssue[]): void {
  res.status(422).json({
    ok: false,
    error: { code: 'validation', message: issues.map((i) => i.message).join(' ') },
  });
}

// -------------------------------------------------------- billable items ----

export const billableItemsRouter = Router();
billableItemsRouter.use(requireAuth, requireAccountType('professional'));

/** GET /api/billable-items */
billableItemsRouter.get('/', async (req, res, next) => {
  try {
    const items = await paymentService.listBillableItems(req.account!.id);
    res.json({ ok: true, data: items });
  } catch (err) {
    next(err);
  }
});

/** POST /api/billable-items — creates the Stripe Product + Price behind it. */
billableItemsRouter.post('/', async (req, res, next) => {
  try {
    const parsed = billableItemSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    const item = await paymentService.createBillableItem(req.account!.id, parsed.data);
    res.status(201).json({ ok: true, data: item });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------- invoices ----

export const invoicesRouter = Router();
invoicesRouter.use(requireAuth, requireAccountType('professional'));

/** POST /api/invoices — from a billable item (× quantity) or a custom amount. */
invoicesRouter.post('/', async (req, res, next) => {
  try {
    const parsed = createInvoiceSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    const invoice = await paymentService.createInvoice(req.account!.id, parsed.data);
    res.status(201).json({ ok: true, data: invoice });
  } catch (err) {
    next(err);
  }
});

/** GET /api/invoices?client_id=<uuid>&status=<status> */
invoicesRouter.get('/', async (req, res, next) => {
  try {
    const status = req.query.status as
      | 'draft'
      | 'open'
      | 'paid'
      | 'void'
      | 'uncollectible'
      | undefined;
    const invoices = await paymentService.listInvoices(req.account!.id, {
      clientId: typeof req.query.client_id === 'string' ? req.query.client_id : undefined,
      status,
    });
    res.json({ ok: true, data: invoices });
  } catch (err) {
    next(err);
  }
});

/** GET /api/invoices/:id */
invoicesRouter.get('/:id', async (req, res, next) => {
  try {
    const invoice = await paymentService.getInvoice(req.account!.id, req.params.id);
    res.json({ ok: true, data: invoice });
  } catch (err) {
    next(err);
  }
});

/** GET /api/invoices/:id/transactions — the payment log behind an invoice. */
invoicesRouter.get('/:id/transactions', async (req, res, next) => {
  try {
    const transactions = await paymentService.listTransactions(req.account!.id, req.params.id);
    res.json({ ok: true, data: transactions });
  } catch (err) {
    next(err);
  }
});

/** POST /api/invoices/:id/checkout — returns the Stripe-hosted payment URL. */
invoicesRouter.post('/:id/checkout', async (req, res, next) => {
  try {
    // Send Stripe back to wherever the app is being served from (works for
    // localhost and Render alike; trust proxy makes req.protocol correct).
    const origin = `${req.protocol}://${req.get('host')}`;
    const result = await paymentService.createCheckoutSession(req.account!.id, req.params.id, origin);
    res.json({ ok: true, data: result });
  } catch (err) {
    next(err);
  }
});

/** POST /api/invoices/:id/send — email the invoice to the client (R-17).
 *  Explicit rather than automatic on creation: walks auto-invoice on
 *  completion, so auto-sending would email a daily client every day. */
invoicesRouter.post('/:id/send', async (req, res, next) => {
  try {
    const origin = `${req.protocol}://${req.get('host')}`;
    const invoice = await paymentService.sendInvoice(req.account!.id, req.params.id, origin);
    res.json({ ok: true, data: invoice });
  } catch (err) {
    next(err);
  }
});

/** POST /api/invoices/:id/sync — reconcile payment status straight from Stripe. */
invoicesRouter.post('/:id/sync', async (req, res, next) => {
  try {
    const invoice = await paymentService.syncInvoicePayment(req.account!.id, req.params.id);
    res.json({ ok: true, data: invoice });
  } catch (err) {
    next(err);
  }
});

/** POST /api/invoices/:id/void */
invoicesRouter.post('/:id/void', async (req, res, next) => {
  try {
    const invoice = await paymentService.voidInvoice(req.account!.id, req.params.id);
    res.json({ ok: true, data: invoice });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------- Stripe webhook ----

/**
 * Mounted BEFORE express.json() — Stripe signature verification needs the
 * raw request bytes, and a parsed body can't be re-serialized byte-for-byte.
 * No auth: authenticity comes from the signature itself.
 */
export const stripeWebhookRouter = Router();
stripeWebhookRouter.post('/', raw({ type: 'application/json' }), async (req, res, next) => {
  try {
    const result = await paymentService.handleWebhook(
      req.body as Buffer,
      req.headers['stripe-signature'] as string | undefined
    );
    res.json({ ok: true, data: { received: true, ...result } });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------ public pay link ----

/**
 * R-17 / 021: the login-free "view and pay this invoice" surface.
 *
 * ⚠️ This router is deliberately UNAUTHENTICATED — that is the whole point,
 * since the recipient has no account and requiring one would put Supabase's
 * ~2-magic-links-per-hour ceiling in front of paying a bill. Authenticity
 * comes from the 256-bit token in the URL, exactly as the Stripe webhook
 * above takes its authenticity from a signature rather than a session.
 *
 * The token authorises TWO things and nothing else: reading one invoice's
 * amount/description/status, and starting a Stripe Checkout for it. The
 * service layer returns a narrow projection rather than the invoice row, so
 * a forwarded link cannot leak the client's details or any other invoice.
 */
export const payLinkRouter = Router();

payLinkRouter.get('/:token', async (req, res, next) => {
  try {
    const data = await paymentService.invoiceByPayToken(req.params.token);
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});

payLinkRouter.post('/:token/checkout', async (req, res, next) => {
  try {
    const origin = `${req.protocol}://${req.get('host')}`;
    const data = await paymentService.checkoutByPayToken(req.params.token, origin);
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------- events ----

export const eventsRouter = Router();
eventsRouter.use(requireAuth);

/** GET /api/events?limit=50 — the account's view of the append-only log. */
eventsRouter.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const events = await eventService.getEventsVisibleTo(req.account!.id, limit);
    events.sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));
    res.json({ ok: true, data: events });
  } catch (err) {
    next(err);
  }
});
