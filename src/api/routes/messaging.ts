import { Router } from 'express';
import { z } from 'zod';
import { messagingService } from '../../services/MessagingService';
import { notificationService } from '../../services/NotificationService';
import { requireAuth, requireAccountType } from '../middleware/auth';

// ----------------------------------------------------------- validation ----

const createThreadSchema = z.object({
  client_id: z.string().uuid('client_id must be a UUID.'),
});

const sendMessageSchema = z.object({
  body: z.string().trim().min(1, 'Message body is required.').max(4000),
  client_draft_id: z.string().trim().min(1).max(120).nullish(),
});

const draftSyncSchema = z.object({
  drafts: z
    .array(
      z.object({
        client_id: z.string().uuid('client_id must be a UUID.'),
        client_draft_id: z.string().trim().min(1, 'client_draft_id is required.').max(120),
        body: z.string().trim().min(1, 'Message body is required.').max(4000),
      })
    )
    .min(1, 'At least one draft is required.')
    .max(100, 'Sync at most 100 drafts per request.'),
});

function validationError(res: import('express').Response, issues: z.ZodIssue[]): void {
  res.status(422).json({
    ok: false,
    error: { code: 'validation', message: issues.map((i) => i.message).join(' ') },
  });
}

// -------------------------------------------------------------- threads ----

// Professional-only for now; the Week 8 owner portal opens the client side.
export const threadsRouter = Router();
threadsRouter.use(requireAuth, requireAccountType('professional'));

/** GET /api/threads — all threads with client, latest message, unread count. */
threadsRouter.get('/', async (req, res, next) => {
  try {
    const threads = await messagingService.listThreads(req.account!.id);
    res.json({ ok: true, data: threads });
  } catch (err) {
    next(err);
  }
});

/** POST /api/threads { client_id } — get or create the thread for a client. */
threadsRouter.post('/', async (req, res, next) => {
  try {
    const parsed = createThreadSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    const thread = await messagingService.getOrCreateThread(req.account!.id, parsed.data.client_id);
    res.status(201).json({ ok: true, data: thread });
  } catch (err) {
    next(err);
  }
});

/** GET /api/threads/:id/messages?after=<iso> — oldest first; `after` for polling. */
threadsRouter.get('/:id/messages', async (req, res, next) => {
  try {
    const messages = await messagingService.listMessages(req.account!.id, req.params.id, {
      after: typeof req.query.after === 'string' ? req.query.after : undefined,
    });
    res.json({ ok: true, data: messages });
  } catch (err) {
    next(err);
  }
});

/** POST /api/threads/:id/messages { body, client_draft_id? } */
threadsRouter.post('/:id/messages', async (req, res, next) => {
  try {
    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    const { message, duplicate } = await messagingService.sendMessage(
      req.account!.id,
      req.params.id,
      parsed.data
    );
    // O-2: let the owner know, but not per keystroke in a chatty thread —
    // this goes out in 5 minutes and the renderer cancels it if they've
    // already read the message in the portal by then. Skipped on a duplicate
    // resend, which is the same message arriving twice.
    if (!duplicate) {
      await notificationService.enqueue({
        accountId: req.account!.id,
        category: 'message',
        template: 'message_received',
        data: { message_id: message.id, origin: `${req.protocol}://${req.get('host')}` },
        scheduledFor: new Date(Date.now() + 5 * 60_000).toISOString(),
      });
    }
    res.status(duplicate ? 200 : 201).json({ ok: true, data: message });
  } catch (err) {
    next(err);
  }
});

/** POST /api/threads/:id/read — mark the other side's messages read. */
threadsRouter.post('/:id/read', async (req, res, next) => {
  try {
    await messagingService.markThreadRead(req.account!.id, req.params.id);
    res.json({ ok: true, data: { read: true } });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------- messages ----

export const messagesRouter = Router();
messagesRouter.use(requireAuth, requireAccountType('professional'));

/** POST /api/messages/sync { drafts: [{ client_id, client_draft_id, body }] }
 *  Offline-first sync: idempotent per draft, partial failures reported per item. */
messagesRouter.post('/sync', async (req, res, next) => {
  try {
    const parsed = draftSyncSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    const results = await messagingService.syncDrafts(req.account!.id, parsed.data.drafts);
    res.json({ ok: true, data: results });
  } catch (err) {
    next(err);
  }
});
