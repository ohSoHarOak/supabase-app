import type { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env';

const isProduction = process.env.NODE_ENV === 'production';

// The two Supabase origins the browser talks to directly: the REST/auth origin
// (https) and the same host over wss for Realtime messaging.
const supabaseOrigin = new URL(env.supabaseUrl).origin; // https://<ref>.supabase.co
const supabaseWs = supabaseOrigin.replace(/^https:/, 'wss:'); // wss://<ref>.supabase.co

/**
 * Security headers (helmet).
 *
 * We keep helmet's strict defaults — including `script-src 'self'`,
 * `script-src-attr 'none'` (no inline event handlers), `object-src 'none'`,
 * `base-uri 'self'`, and `frame-ancestors 'self'` — and widen only the two
 * directives the frontend actually needs:
 *   - connect-src: add the Supabase REST origin + its wss:// for Realtime
 *   - img-src: add data: (base64 signature images) and https: (pet photo URLs)
 * script-src stays 'self': M0-b bundles @supabase/supabase-js into the app, so
 * the old jsdelivr CDN allowance is gone. helmet's default
 * `style-src 'self' https: 'unsafe-inline'` already covers the inline <style>
 * block in a server-rendered contract document.
 *
 * HSTS is left on in production and disabled locally so it can't pin
 * http://localhost dev to https.
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'connect-src': ["'self'", supabaseOrigin, supabaseWs],
      'img-src': ["'self'", 'data:', 'https:'],
    },
  },
  // HSTS on in production; off locally so it can't pin http://localhost to https.
  ...(isProduction ? {} : { strictTransportSecurity: false }),
});

// ------------------------------------------------------------ rate limiting ----

function isLoopback(ip: string | undefined): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

// Never throttle local development or the e2e suite (both hit the server over
// loopback); production (real client IPs via `trust proxy`) is always limited.
const skipLocalDev = (req: Request): boolean => !isProduction && isLoopback(req.ip);

function tooMany(_req: Request, res: Response): void {
  res.status(429).json({
    ok: false,
    error: { code: 'rate_limited', message: 'Too many requests. Please wait a moment and try again.' },
  });
}

/**
 * Credential + unauthenticated-surface limiter: login, signup, password reset,
 * portal magic-link requests, and the public pay link. Caps brute-force and
 * abuse without affecting normal use (a person signs in a handful of times).
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipLocalDev,
  handler: tooMany,
});

/**
 * Session-refresh limiter (M0.5).
 *
 * Refresh is NOT brute-forceable — the refresh token is a high-entropy secret,
 * so guessing is not the threat model — but it is called routinely (hourly, and
 * on any 401), so it must not share the 20/15min credential budget. Putting it
 * there caused a real lockout: a spent budget makes refresh fail, which logs the
 * user out, and the login that follows is throttled too. Generous ceiling that
 * still bounds a runaway client.
 */
export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipLocalDev,
  handler: tooMany,
});

/**
 * Stripe webhook limiter — generous (Stripe stays well under this) but caps a
 * flood of forged calls. Dropped events are retried by Stripe, so a ceiling is
 * safe. Signature verification already rejects forgeries cheaply; this bounds
 * the volume that reaches it.
 */
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipLocalDev,
  handler: tooMany,
});

// -------------------------------------------------------------------- CORS ----

// Default-deny: browser requests from an unlisted origin get no CORS headers and
// are blocked by the browser. Requests with no Origin header (same-origin
// navigations, curl, the Stripe webhook) are allowed.
//
// Capacitor native shells (Workstream M) call the API cross-origin: Android
// serves the bundled app from https://localhost, iOS (Phase 3) from
// capacitor://localhost. A remote web page cannot forge these origins, so
// allowing them by default is safe and is what lets the native app reach the
// backend. Any additional browser origins come from APP_ORIGINS (comma list).
const NATIVE_APP_ORIGINS = ['https://localhost', 'capacitor://localhost'];
const allowedOrigins = [
  ...NATIVE_APP_ORIGINS,
  ...(process.env.APP_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
];

export const corsMiddleware = cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false); // no CORS headers -> the browser blocks the response
  },
  credentials: false,
});
