import { Router } from 'express';
import { z } from 'zod';
import { portalService } from '../../services/PortalService';
import { messagingService } from '../../services/MessagingService';
import { accountService } from '../../services/AccountService';
import { renderContractDocument } from '../../services/contractDocument';
import { requireAuth, requireAccountType } from '../middleware/auth';

export const portalRouter = Router();

function validationError(res: import('express').Response, message: string): void {
  res.status(422).json({ ok: false, error: { code: 'validation', message } });
}

// ------------------------------------------------------- public (no auth) ----

/** POST /api/portal/login — email a magic link (only to addresses a professional has on file). */
portalRouter.post('/login', async (req, res, next) => {
  try {
    const parsed = z.object({ email: z.string().email() }).safeParse(req.body);
    if (!parsed.success) return validationError(res, 'A valid email is required.');
    const redirectTo = `${req.protocol}://${req.get('host')}/portal`;
    await portalService.requestLoginLink(parsed.data.email, redirectTo);
    res.json({ ok: true, data: { sent: true } });
  } catch (err) {
    next(err);
  }
});

/** POST /api/portal/session — exchange the magic-link token for a portal session. */
portalRouter.post('/session', async (req, res, next) => {
  try {
    const parsed = z.object({ access_token: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return validationError(res, 'access_token is required.');
    const session = await portalService.establishSession(parsed.data.access_token);
    res.json({ ok: true, data: session });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------ owner-only routes ----

portalRouter.use(requireAuth, requireAccountType('owner'));

/** GET /api/portal/overview — clients + pets + professional, upcoming walks, contracts, invoices. */
portalRouter.get('/overview', async (req, res, next) => {
  try {
    const data = await portalService.overview(req.account!.id);
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});

/** GET /api/portal/contracts/:id/document — the print-styled agreement (view + Save as PDF). */
portalRouter.get('/contracts/:id/document', async (req, res, next) => {
  try {
    const contract = await portalService.getContract(req.account!.id, req.params.id);
    const profile = await accountService.getProfessionalProfile(contract.professional_account_id);
    const document = renderContractDocument(contract, {
      businessName: profile?.business_name ?? profile?.full_name ?? null,
    });
    res.type('html').send(document);
  } catch (err) {
    next(err);
  }
});

const signSchema = z.object({
  signer_name: z.string().trim().min(1, 'Signer name is required.'),
  signature_image: z.string().min(50, 'signature_image must be a base64 PNG or JPEG.'),
});

/** POST /api/portal/contracts/:id/sign — the owner signs from their own device. */
portalRouter.post('/contracts/:id/sign', async (req, res, next) => {
  try {
    const parsed = signSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues.map((i) => i.message).join(' '));
    const contract = await portalService.signContract(req.account!.id, req.params.id, parsed.data);
    res.json({ ok: true, data: contract });
  } catch (err) {
    next(err);
  }
});

/** POST /api/portal/invoices/:id/checkout — Stripe-hosted payment page. */
portalRouter.post('/invoices/:id/checkout', async (req, res, next) => {
  try {
    const origin = `${req.protocol}://${req.get('host')}`;
    const result = await portalService.createCheckout(req.account!.id, req.params.id, origin);
    res.json({ ok: true, data: result });
  } catch (err) {
    next(err);
  }
});

/** POST /api/portal/invoices/:id/sync — reconcile payment status after returning from Stripe. */
portalRouter.post('/invoices/:id/sync', async (req, res, next) => {
  try {
    const invoice = await portalService.syncInvoice(req.account!.id, req.params.id);
    res.json({ ok: true, data: invoice });
  } catch (err) {
    next(err);
  }
});

/** POST /api/portal/threads — get-or-create the conversation with the professional. */
portalRouter.post('/threads', async (req, res, next) => {
  try {
    const parsed = z.object({ client_id: z.string().uuid() }).safeParse(req.body);
    if (!parsed.success) return validationError(res, 'client_id must be a UUID.');
    const thread = await portalService.getOrCreateThread(req.account!.id, parsed.data.client_id);
    res.status(201).json({ ok: true, data: thread });
  } catch (err) {
    next(err);
  }
});

/** GET /api/portal/threads/:id/messages?after=<iso> — oldest-first; `after` powers polling. */
portalRouter.get('/threads/:id/messages', async (req, res, next) => {
  try {
    await messagingService.getThreadForOwner(req.account!.id, req.params.id);
    const messages = await messagingService.listMessagesInThread(req.params.id, {
      after: typeof req.query.after === 'string' ? req.query.after : undefined,
    });
    res.json({ ok: true, data: messages });
  } catch (err) {
    next(err);
  }
});

const sendSchema = z.object({
  body: z.string().trim().min(1, 'Message body is required.').max(4000),
  client_draft_id: z.string().max(80).nullish(),
});

/** POST /api/portal/threads/:id/messages — idempotent via client_draft_id, like the professional side. */
portalRouter.post('/threads/:id/messages', async (req, res, next) => {
  try {
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues.map((i) => i.message).join(' '));
    const thread = await messagingService.getThreadForOwner(req.account!.id, req.params.id);
    const result = await messagingService.sendIntoThread(thread, req.account!.id, {
      body: parsed.data.body,
      client_draft_id: parsed.data.client_draft_id ?? undefined,
    });
    res.status(result.duplicate ? 200 : 201).json({ ok: true, data: result });
  } catch (err) {
    next(err);
  }
});

/** POST /api/portal/threads/:id/read */
portalRouter.post('/threads/:id/read', async (req, res, next) => {
  try {
    await messagingService.getThreadForOwner(req.account!.id, req.params.id);
    await messagingService.markReadInThread(req.params.id, req.account!.id);
    res.json({ ok: true, data: { read: true } });
  } catch (err) {
    next(err);
  }
});
