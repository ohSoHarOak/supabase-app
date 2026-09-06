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
import { connectRouter } from './routes/connect';
import { appointmentsRouter, servicesRouter } from './routes/scheduling';
import { messagesRouter, threadsRouter } from './routes/messaging';
import { notificationsRouter } from './routes/notifications';
import { portalRouter } from './routes/portal';
import { errorHandler } from './middleware/errorHandler';
import { securityHeaders, corsMiddleware, authLimiter, refreshLimiter, webhookLimiter } from './middleware/security';
import { env } from '../config/env';

export function createServer(): express.Express {
  const app = express();
  // Render terminates TLS at its proxy; this makes req.protocol report
  // https so Stripe Checkout return URLs are built correctly. It also gives
  // express-rate-limit the real client IP from X-Forwarded-For.
  app.set('trust proxy', 1);

  // Security headers (helmet) + explicit default-deny CORS, before any route.
  app.use(corsMiddleware);
  app.use(securityHeaders);

  // The Stripe webhook must see the raw request bytes for signature
  // verification, so it mounts before the JSON body parser. Rate-limited to
  // cap forged floods (real Stripe traffic stays well under the ceiling).
  app.use('/api/webhooks/stripe', webhookLimiter, stripeWebhookRouter);

  // Profile photo / logo uploads carry a base64 image, which the 1mb default
  // below would reject. A larger parser mounts first for just that path; the
  // client downscales before sending, so real payloads stay small. express.json
  // is a no-op once the body is read, so the global parser skips it afterward.
  app.use('/api/auth/profile/image', express.json({ limit: '6mb' }));

  app.use(express.json({ limit: '1mb' }));

  // Web UI — built by Vite into dist-web/ (Workstream M / M0-a). `npm run build`
  // runs `vite build`; in dev the front-end is served by the Vite dev server
  // (`npm run dev:web`, proxying /api here). process.cwd() is the repo root
  // locally and on Render.
  const webDir = path.join(process.cwd(), 'dist-web');
  app.use(express.static(webDir));

  // Week 8 owner portal — its own small page, same built directory.
  app.get('/portal', (_req, res) => {
    res.sendFile(path.join(webDir, 'portal.html'));
  });

  // R-17: the public pay page. No login — the token in ?t= is the authority.
  app.get('/pay', (_req, res) => {
    res.sendFile(path.join(webDir, 'pay.html'));
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, data: { service: 'sitstayplay', status: 'healthy' } });
  });

  // Public config for the browser: the anon key is designed to be public
  // (RLS is what protects data) — the UI needs it to subscribe to Realtime.
  app.get('/api/config', (_req, res) => {
    res.json({
      ok: true,
      data: {
        supabase_url: env.supabaseUrl,
        supabase_anon_key: env.supabaseAnonKey,
        // Publishable key, not the secret one. The embedded Connect components
        // need it in the browser; it identifies the platform and authorises
        // nothing on its own. Null when unset so the client can fall back to
        // the hosted redirect rather than failing to mount.
        stripe_publishable_key: env.stripePublishableKey ?? null,
      },
    });
  });

  // Rate-limit the CREDENTIAL surfaces only — not the whole auth router.
  //
  // `/api/auth` also carries routine authenticated traffic: `GET /me` fires on
  // every Profile view, and profile saves/photo uploads live here too. Sharing
  // one 20/15min bucket with login meant ordinary use exhausted the budget and
  // then locked the user out of logging back in (hit on-device 2026-08-17).
  // These are the endpoints where guessing is the actual threat:
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/signup', authLimiter);
  app.use('/api/auth/forgot-password', authLimiter);
  app.use('/api/auth/reset-password', authLimiter);
  app.use('/api/auth/change-password', authLimiter);
  app.use('/api/auth/deactivate', authLimiter);
  // Frequent but unguessable — its own headroom (see refreshLimiter).
  app.use('/api/auth/refresh', refreshLimiter);
  // Everything else under /api/auth sits behind requireAuth already.
  app.use('/api/auth', authRouter);
  app.use('/api/clients', clientsRouter);
  app.use('/api/pets', petsRouter);
  app.use('/api/contract-templates', contractTemplatesRouter);
  app.use('/api/contracts', contractsRouter);
  app.use('/api/services', servicesRouter);
  app.use('/api/appointments', appointmentsRouter);
  app.use('/api/billable-items', billableItemsRouter);
  app.use('/api/connect', connectRouter);
  app.use('/api/invoices', invoicesRouter);
  // Unauthenticated by design — see the note on payLinkRouter. Rate-limited
  // since it has no session in front of it.
  app.use('/api/pay', authLimiter, payLinkRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api/threads', threadsRouter);
  app.use('/api/messages', messagesRouter);
  app.use('/api/notifications', notificationsRouter);
  // Throttle the magic-link request specifically (the rest of the portal is
  // behind an authenticated session); runs before the portal router.
  app.use('/api/portal/login', authLimiter);
  app.use('/api/portal', portalRouter);

  app.use((_req, res) => {
    res.status(404).json({ ok: false, error: { code: 'not_found', message: 'Route not found.' } });
  });
  app.use(errorHandler);

  return app;
}
