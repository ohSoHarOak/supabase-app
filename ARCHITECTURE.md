# Sit.Stay.Play — Architecture (as built)

*Written 2026-08-17 from the shipped code, closing the Workstream 0 "repo hygiene" gap.
`CLAUDE.md` has always referenced this file, but it had never actually existed in this
repo — the name came from the original scaffold package (see `PHASE_1_SUMMARY.md`, now
archived), which was abandoned before the rebuild. Everything below describes what is
**actually in the repository**, not what was once planned.*

---

## 1. What this is

A business-management platform for pet-care professionals. Phase 1 targets dog walkers;
the data model is deliberately generic so trainers, groomers, sitters, and boarding
facilities need no redesign.

**One deployable.** A single Node.js/Express app serves both the REST API and the built
front-end. There are no microservices, no separate front-end host, and no GraphQL.

## 2. Stack

| Concern | Choice |
|---|---|
| Runtime | Node.js ≥22 (supabase-js Realtime needs a global `WebSocket`), TypeScript strict |
| API | Express 4, REST only |
| Database | Supabase Postgres (`supabaseAdmin` service role; `supabaseAnon` for auth grants) |
| Auth | Supabase Auth — email/password for professionals, magic link for owners |
| Storage | Supabase Storage (signature images, profile photos/logos) |
| Payments | Stripe — hosted Checkout, so card data never touches our server |
| Email | Resend, behind an `IEmailProvider` adapter |
| Hosting | Render |
| Front-end | Vanilla JS ES modules, bundled by Vite → `dist-web/` |
| Mobile | Capacitor Android shell wrapping the same build |

## 3. Layering

```
HTTP  →  src/api/routes/*      thin: Zod-validate, call a service, shape the envelope
         src/api/middleware/*  auth, account type, profile completeness, CORS, helmet, limits
         src/services/*        all business logic and DB access
         src/integrations/*    vendor adapters behind interfaces
         Supabase / Stripe
```

Routes own no business logic. Services own no HTTP concepts. Every response is
`{ ok: true, data }` or `{ ok: false, error: { code, message } }` — clients (and the e2e
suite) key off `error.code`, never the prose message.

`src/services/errors.ts` defines `ServiceError(code, message, status)`; the central error
handler maps it to the envelope. Services throw it rather than returning ad-hoc shapes.

### Directory map

```
src/
  api/
    server.ts            app assembly, route mounting, static serving
    routes/              auth billing clients contracts messaging notifications portal scheduling
    middleware/          auth.ts (requireAuth, requireAccountType, requireCompleteProfile)
                         security.ts (helmet CSP, CORS allowlist, rate limiters)
  services/              Account Client Contract Event Messaging Notification Payment Portal Scheduling
                         + contractDocument, imageUpload, passwordPolicy, errors
  integrations/
    email/               IEmailProvider + ResendEmailProvider
    esign/               IeSignProvider  (Nitro Sign deferred to Phase 1.5 — interface only)
  db/migrations/         001…025, applied in order
  types/index.ts         source of truth for every data shape
web/
  src/                   app.js (professional UI) · portal.js (owner) · pay.js (public pay link)
                         shared.js · config.js · tokenStore.js · pwa.js
  public/styles.css      static asset, not bundled
android/                 Capacitor Android project
scripts/                 e2e suite, structure check, native-build guard, weekly test scripts
```

## 4. The four marketplace seams

These exist so a Phase 3 marketplace can plug in without touching core modules. Treat
them as load-bearing:

1. **Typed accounts** — `account_type` drives permissions via `requireAccountType(...)`.
   Never hardcode a role check.
2. **Append-only event log** — significant actions `INSERT` into `events`. A database
   trigger rejects `UPDATE`/`DELETE`; do not try to work around it.
3. **Provider adapters** — eSign and email go through interfaces. Service code must never
   import a vendor SDK directly.
4. **Generic billing** — Stripe products are "billable items attached to an account,"
   not hardcoded walker subscriptions.

## 5. Auth and access control

Three middlewares compose, in this order:

- `requireAuth` — verifies the Supabase access token, loads the Sit.Stay.Play account, rejects
  non-active accounts.
- `requireAccountType('professional' | 'owner')` — seam 1.
- `requireCompleteProfile` — M0.5. Contracts and payments stay locked until onboarding is
  complete. Applied to **create/issue paths only**; reads stay open (the client screen
  fetches contracts and invoices unconditionally) and void/sync stay open so nobody is
  trapped mid-flow. It sits at the *middleware* layer deliberately, so service-layer
  callers — walk-completion auto-invoicing, the billing-cadence worker — are unaffected.

**Sessions.** Login returns access + refresh tokens. `POST /api/auth/refresh` exchanges a
refresh token for a fresh session and re-checks deactivation each time, so a closed
account cannot refresh its way back to life. Supabase **rotates** refresh tokens, so the
client must persist what comes back; the browser refreshes once on a 401 and retries,
single-flight so concurrent 401s cannot race each other into a logout.

**Client-side token storage** goes through `web/src/tokenStore.js`, an intentionally
**async** seam (localStorage today; a Keystore-backed plugin on native without touching
call sites). Only secrets pass through it — cached profile data stays in plain
localStorage.

## 6. Security posture

- **helmet** with a CSP kept strict: `script-src 'self'`, `script-src-attr 'none'`,
  widened only for the Supabase REST + `wss:` origins and `data:`/`https:` images.
- **CORS default-deny.** Unlisted origins get no CORS headers. `https://localhost` and
  `capacitor://localhost` are allowed because that is the origin the native shell serves
  from; extra browser origins come from `APP_ORIGINS`.
- **Rate limiting, scoped by threat model.** The credential limiter (20/15min) covers
  only guessable surfaces — login, signup, password reset/change, deactivate. Session
  refresh has its own headroom (60/15min): frequent but unguessable. Routine authenticated
  routes are not throttled; they are already behind `requireAuth`. *(Scoping the limiter
  to the whole `/api/auth` router once locked a real user out — see M0-RATELIMIT.)*
- **RLS on all 26 public tables** (migration 023) as a second net behind app-level
  tenant scoping. The service role bypasses it; the anon PostgREST surface is deny-all.
- **Password policy** — 12+ chars, 3-of-4 character classes, common-password list, and a
  k-anonymity HaveIBeenPwned check that fails open so an outage cannot block signup.
- **Tenant isolation** is enforced in every service by `professional_account_id`, and is
  regression-tested (e2e step 15). Standing rule: every new endpoint ships with a
  tenant-scoping test in the same commit.
- **On-device**: `allowBackup="false"` plus `data_extraction_rules.xml` keep the token out
  of Google cloud backup *and* device-to-device transfer.

## 7. Domain invariants

- **Signed contracts are immutable.** Once `status = 'signed'`, `generated_html` never
  changes; a DB trigger enforces it and returns 409. The signature is embedded as a data
  URI so the document cannot depend on an expiring link.
- **Events are append-only** (trigger-enforced).
- **Auto-invoicing is exactly-once.** The scheduled→completed transition is the guard, so
  a double-tap bills once. Per-visit and per-day services invoice on completion; weekly/
  monthly bill at period end via a worker that advances `next_invoice_date`.
- **Prepaid packages draw down** before new invoices are raised.
- **Stripe webhooks are idempotent** two ways: a `UNIQUE` `stripe_event_id`, and a
  payment-intent check so the webhook and the sync fallback cannot double-record.
- **Boarding is not exclusive time** — boarding stays are exempt from conflict detection
  in both directions; walk-vs-walk double-booking is still refused.

## 8. Notifications

Everything is a `notification_queue` row: **template + recipient + channel**. Email is the
only live channel, behind `IEmailProvider`. Templates render at **send time** from ids, so
a stale reminder cannot fire and a fixed typo is picked up automatically. Reminders are
cancelled when a walk is cancelled and shifted when it is rescheduled.

Adding push (M1) is a new adapter plus `channel: 'push'` and device-token storage —
senders and callers do not change. That was the point of the design.

## 9. Front-end and mobile

Three surfaces share `shared.js` and one stylesheet: the professional app (`app.js`), the
owner portal (`portal.js`), and the login-free pay link (`pay.js`). Hash-routed, no
framework. `scripts/check-structure.mjs` guards a small set of load-bearing `[data-*]`
hooks that fail silently if broken — it exists because that happened once.

**Mobile.** Capacitor wraps the same `dist-web` output; assets ship on-device and the app
serves from `https://localhost`, calling the backend absolutely via `API_BASE`. That value
is compiled in from `VITE_API_BASE` at build time — empty is correct for web (same-origin)
and fatal on native, so `npm run build:native` refuses to build without it.

## 10. Environments and testing

- **Test project vs prod.** Local dev and CI point at a separate Supabase test project;
  production is reached only through a gitignored `.env.prod`. Tests never write to prod.
- **`npm test`** = structure check + a 16-step end-to-end suite run against a live server,
  covering auth/onboarding gate/token refresh, CRM, contracts and immutability, payments,
  scheduling, events, messaging, notifications, the owner portal, prepaid draw-down,
  contract terms, pay links, cross-tenant isolation, and account lifecycle.
- **CI** runs typecheck + the full e2e on every push and PR.

## 11. Deliberate non-goals

Microservices · GraphQL · a second payment processor · a separate front-end service ·
server-side PDF rendering (print-styled HTML + the browser's Save-as-PDF instead) ·
storing raw bank details (Stripe-hosted onboarding will own that in M-Connect).
