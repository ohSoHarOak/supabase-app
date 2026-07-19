import path from 'path';
import express from 'express';
import { authRouter } from './routes/auth';
import { clientsRouter, petsRouter } from './routes/clients';
import { contractTemplatesRouter, contractsRouter } from './routes/contracts';
import {
  billableItemsRouter,
  eventsRouter,
  invoicesRouter,
  payLinkRouter,
  stripeWebhookRouter,
} from './routes/billing';
import { appointmentsRouter, servicesRouter } from './routes/scheduling';
import { messagesRouter, threadsRouter } from './routes/messaging';
import { notificationsRouter } from './routes/notifications';
import { portalRouter } from './routes/portal';
import { errorHandler } from './middleware/errorHandler';
import { env } from '../config/env';

export function createServer(): express.Express {
  const app = express();
  // Render terminates TLS at its proxy; this makes req.protocol report
  // https so Stripe Checkout return URLs are built correctly.
  app.set('trust proxy', 1);

  // The Stripe webhook must see the raw request bytes for signature
  // verification, so it mounts before the JSON body parser.
  app.use('/api/webhooks/stripe', stripeWebhookRouter);

  app.use(express.json({ limit: '1mb' }));

  // Week 4 web UI — static files, no build step. Served from the repo's
  // public/ directory (process.cwd() is the repo root locally and on Render).
  app.use(express.static(path.join(process.cwd(), 'public')));

  // Week 8 owner portal — its own small page, same static directory.
  app.get('/portal', (_req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'portal.html'));
  });

  // R-17: the public pay page. No login — the token in ?t= is the authority.
  app.get('/pay', (_req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'pay.html'));
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, data: { service: 'petpro-connect', status: 'healthy' } });
  });

  // Public config for the browser: the anon key is designed to be public
  // (RLS is what protects data) — the UI needs it to subscribe to Realtime.
  app.get('/api/config', (_req, res) => {
    res.json({
      ok: true,
      data: { supabase_url: env.supabaseUrl, supabase_anon_key: env.supabaseAnonKey },
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/clients', clientsRouter);
  app.use('/api/pets', petsRouter);
  app.use('/api/contract-templates', contractTemplatesRouter);
  app.use('/api/contracts', contractsRouter);
  app.use('/api/services', servicesRouter);
  app.use('/api/appointments', appointmentsRouter);
  app.use('/api/billable-items', billableItemsRouter);
  app.use('/api/invoices', invoicesRouter);
  // Unauthenticated by design — see the note on payLinkRouter.
  app.use('/api/pay', payLinkRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api/threads', threadsRouter);
  app.use('/api/messages', messagesRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/portal', portalRouter);

  app.use((_req, res) => {
    res.status(404).json({ ok: false, error: { code: 'not_found', message: 'Route not found.' } });
  });
  app.use(errorHandler);

  return app;
}
