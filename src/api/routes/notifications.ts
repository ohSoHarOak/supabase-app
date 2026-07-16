import { Router } from 'express';
import { z } from 'zod';
import { notificationService } from '../../services/NotificationService';
import { requireAuth, requireAccountType } from '../middleware/auth';

const testSchema = z.object({
  /** Defaults to the professional's own account email. */
  to: z.string().email('Must be a valid email.').optional(),
});

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth, requireAccountType('professional'));

/** GET /api/notifications?status=pending|sent|failed|cancelled — own queue, newest first. */
notificationsRouter.get('/', async (req, res, next) => {
  try {
    const status = req.query.status as 'pending' | 'sent' | 'failed' | 'cancelled' | undefined;
    const rows = await notificationService.listForAccount(req.account!.id, { status });
    res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
});

/** POST /api/notifications/process — send this account's due notifications now.
 *  Mainly for test scripts; the background worker does this every 30s anyway. */
notificationsRouter.post('/process', async (req, res, next) => {
  try {
    const summary = await notificationService.processDue({ accountId: req.account!.id });
    res.json({ ok: true, data: summary });
  } catch (err) {
    next(err);
  }
});

/** POST /api/notifications/test { to? } — the "is my email key working?" probe.
 *  Queues a test email (default: to yourself) and processes it immediately. */
notificationsRouter.post('/test', async (req, res, next) => {
  try {
    const parsed = testSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(422).json({
        ok: false,
        error: { code: 'validation', message: parsed.error.issues.map((i) => i.message).join(' ') },
      });
    }
    const queued = await notificationService.enqueue({
      accountId: req.account!.id,
      category: 'test',
      template: 'test',
      data: parsed.data.to ? { to: parsed.data.to } : {},
    });
    const summary = await notificationService.processDue({ accountId: req.account!.id });
    const row = queued
      ? (await notificationService.listForAccount(req.account!.id)).find((r) => r.id === queued.id)
      : null;
    res.json({ ok: true, data: { notification: row ?? queued, summary } });
  } catch (err) {
    next(err);
  }
});
