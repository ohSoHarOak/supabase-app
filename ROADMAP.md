# PetPro Connect — 8-Week Roadmap & Task Tracker

*Place this file as `ROADMAP.md` in the repo root, alongside `CLAUDE.md`. Both Claude Code and the founder update it directly as work progresses — it's the shared source of truth for where things stand.*

---

## How This Works

Each week has two lists:

- **🤖 Claude Code Tasks** — technical build items. Claude Code marks these as it completes work in each session.
- **🧑 Founder Tasks** — things only you can do (accounts, credentials, product decisions, real-world testing). You mark these yourself.

**Status legend** (use at the start of each line):

| Symbol | Meaning |
|---|---|
| `[ ]` | Not started |
| `[x]` | ✅ Done |
| `[~]` | 🔄 In progress |
| `[!]` | ⚠️ Issue — see note below the item |
| `[d]` | ⏸️ Delayed — see note below the item |

**When you mark something `[!]` or `[d]`, add a one-line note directly under it** explaining what's blocking it. That note is how each side finds out about problems without a separate meeting — Claude Code reads your notes at the start of a session, and you read Claude Code's notes when you check in.

**Weekly rhythm:** At the end of each week, both lists should be fully checked off before moving to the next week's build. If something's not done, mark it `[d]`, note why, and decide together whether it blocks next week or can run in parallel.

---

## Week 1 — Foundation: Environment, Auth, Deployment

### 🤖 Claude Code Tasks
- [x] Scaffold repo structure per existing `src/` layout
  - Note (2026-07-13): the original scaffold zip (`files.zip`) no longer exists, so the structure was rebuilt from scratch per `PHASE_1_SUMMARY.md`, adapted to the locked stack (Supabase Auth/Storage, Render, in-person signing only).
- [x] Connect to Supabase project once founder provides credentials
  - Verified with `npx tsx scripts/check-supabase.ts` — URL + service key work.
- [x] Run all 10 migrations against Supabase Postgres
  - Applied 2026-07-13 (26 tables). Verified live: the events append-only trigger blocks UPDATE and DELETE as designed.
- [x] Replace custom JWT auth with Supabase Auth (email/password for professionals)
  - Built on Supabase Auth from the start — no custom JWT ever existed in this rebuild.
- [x] Build professional signup + login API endpoints
  - Verified end-to-end 2026-07-13: `scripts/week1-test.ps1` passes all 4 steps (health → signup → login → authenticated session) against live Supabase.
- [x] Deploy service to Render, confirm publicly reachable
  - Deployed 2026-07-13 after two fixes: build command needed `--include=dev` (Render sets NODE_ENV=production, which skips the TypeScript compiler), and the service-key env var needed the exact name `SUPABASE_SERVICE_KEY`. Founder ran `week1-test.ps1` against the live URL — all 4 steps passed.
- [x] Write a manual test script for founder to run (signup → login → get session)
  - `scripts/week1-test.ps1` — run it in PowerShell after migrations + deploy.

### 🧑 Founder Tasks
- [x] Create Supabase account, create project, note connection credentials
- [x] Create Render account, connect GitHub repo
- [x] Add environment variables to Render (never commit secrets to git)
- [x] Provide Claude Code with Supabase credentials via `.env` (not chat)
- [x] Run Week 1 test script — sign up and log in through the live API
- [x] Confirm status: mark this week done, or note what broke
  - Confirmed 2026-07-13: test passed against the live Render deployment. Week 1 done.

---

## Week 2 — Client & Pet Management (CRM)

### 🤖 Claude Code Tasks
- [x] Build `ClientService` — CRUD for clients
- [x] Build Pet CRUD — profiles, vaccination records, medical notes
- [x] Build search/filter across client + pet fields
  - `GET /api/clients?q=...` matches client name/email/phone/address AND pet name/breed (a pet hit surfaces its client).
- [x] Add input validation (required fields, email/phone format)
- [x] Write manual test script (add clients/pets, search, confirm results)
  - `scripts/week2-test.ps1` — all 7 steps verified 2026-07-13 against live Supabase. Run it against the Render URL with `-BaseUrl`.

### 🧑 Founder Tasks
- [x] Run test script — add 3 clients with 2 pets each
- [x] Search by pet name and owner email, confirm results are accurate
- [x] Note any client/pet fields that don't match how real walkers actually track this info
  - 2026-07-13: pet weight changed from kg to pounds per founder feedback (migration 011, `weight_lb`).
- [x] Confirm status: mark this week done, or note what broke
  - Confirmed 2026-07-13: all 7 steps of `week2-test.ps1` passed against the live Render deployment (https://petpro-app.onrender.com). Week 2 done. (Along the way: the Supabase service key on Render had to be re-pasted — a bad copy was rejected by Supabase as "Invalid API key".)

---

## Week 3 — Contracts Part 1: Generation & In-Person Signing

### 🤖 Claude Code Tasks
- [x] Build contract template storage + variable substitution
  - Template CRUD + `POST /api/contract-templates/seed` (copies the packaged CA template, idempotent). Substitution is generic `{{snake_case}}` — any template, any profession.
- [x] Wire `ContractService.generateContract()` to real client/pet/service data
  - Pulls client, pets, per-client cancellation window + no-show fee, emergency contact, preferred vet, and provider profile; manual `variables` fill the rest (service data until Weeks 5–6 exist). Response lists any unresolved placeholders.
- [x] Build in-person signing flow — capture signature image, lock the contract
  - `POST /api/contracts/:id/sign` — signature stored in private Supabase Storage bucket as evidence AND embedded into the HTML as a data URI (an immutable document can't depend on expiring links), then status→signed in a single UPDATE.
- [x] Confirm the immutability trigger actually blocks edits to signed contracts
  - Verified 2026-07-13 against live Supabase: editing HTML or un-signing returns 409 from the DB trigger; editing the client afterward leaves the snapshot untouched.
- [x] Write manual test script (generate → sign → attempt edit → confirm blocked)
  - `scripts/week3-test.ps1` — all 8 steps pass locally. Run against Render with `-BaseUrl`.

### 🧑 Founder Tasks
- [x] Draft 1–2 real contract templates (or provide existing ones) — include the notice that terms should be reviewed by your own legal counsel
  - 2026-07-13: Founder provided CA dog-walking agreement; converted to seed template (`templates/contracts/`) with merge fields + legal-review notice, approved by founder. Counsel review of two substantive edits (mutual 7-day termination, payment terms) still recommended before first real client signs.
- [x] Run test script — generate a contract, sign it in-person
  - 2026-07-13: founder ran `week3-test.ps1` against the live Render deploy — all 8 steps green.
- [x] Try editing the client's info afterward, confirm the signed contract doesn't change
  - Covered by test steps 6–7 (edit blocked with 409; client rename + policy change left the signed snapshot untouched).
- [x] Confirm status: mark this week done, or note what broke
  - Confirmed 2026-07-13. Week 3 done.

---

## Week 4 — Contract Signing Hardening + Client-Facing Polish

> **Decision locked:** launch with **in-person signing only**. Nitro Sign electronic signing is deferred to a post-demo fast-follow (Phase 1.5). This week's freed-up time goes toward closing the biggest gap for showing potential clients: a minimal usable interface. Weeks 1–3 only built API endpoints — nobody outside a developer can "see" the product through Postman calls alone.

### 🤖 Claude Code Tasks
- [x] Harden in-person signing flow: edge cases (missing signature, retry on failure, clear error states)
  - UI blocks empty signature/name with inline errors; sign failures keep the signature on the pad for retry; signed contracts render read-only (no edit/sign controls); duplicate-sign already 409s server-side.
- [x] Build a minimal web UI for the professional side: login, client list, add client/pet, generate + sign contract
  - `public/` (index.html + styles.css + app.js) — vanilla JS, no build step, served by the same Express app. Screens per approved mockup: login/signup, Today (needs-attention cues + active clients + search), 3-step new client, client detail (pets, policies, contracts), new contract, sign (drawable signature pad). Brand palette per SPEC.md, light+dark.
- [x] Wire the UI to the Week 1–3 API endpoints (no new backend logic, just a usable front door)
  - Only server change: `express.static('public')`. UI-side conveniences: auto-seeds the CA template on first contract, voids the old draft when terms are re-edited, flips a prospect client to active after their first signed contract.
- [x] Basic responsive styling — doesn't need to be polished, needs to not look broken on a laptop screen during a demo
- [x] Write a manual test script covering the UI flow end-to-end
  - `scripts/week4-test.ps1` (UI served + API smoke). Full flow also driven in-browser 2026-07-13: signup → client → 2 pets → generate → sign → client flipped to active.

### 🧑 Founder Tasks
- [x] Review the minimal UI — does it feel like something you could put in front of a real dog walker?
- [x] Test the full flow through the UI yourself: add a client, generate a contract, sign it in-person
- [x] Note anything confusing or missing before it becomes a demo-day surprise
  - 2026-07-13: founder checked these off after testing the live UI — no blocking issues noted.
- [x] Confirm status: mark this week done, or note what broke
  - Confirmed 2026-07-13. Week 4 done. (Founder's checkoff edit briefly reverted the roadmap to a stale copy — reconciled same day; watch for OneDrive/editor stale-copy overwrites when editing this file.)

**Note:** Nitro Sign integration moves to Phase 1.5 (post-demo). The original plan is preserved below for when you pick it up.

<details>
<summary>Deferred: Nitro Sign Integration Plan (Phase 1.5)</summary>

**Claude Code Tasks:**
- [ ] Wire `NitroSignProvider` to Nitro Sign sandbox account
- [ ] Build webhook endpoint with signature verification
- [ ] On webhook: download signed PDF, upload to Supabase Storage, update contract status
- [ ] Write manual test script (send → sign → webhook fires → PDF stored)

**Founder Tasks:**
- [ ] Create Nitro Sign developer/sandbox account, obtain API keys
- [ ] Provide keys to Claude Code via `.env` (not chat)
- [ ] Run test script — send yourself a contract, sign it on your phone
- [ ] Confirm the webhook fires and the signed PDF lands in storage automatically

</details>

---

## Week 5 — Payments: Stripe Integration

> **Scope decision (2026-07-14):** Phase 1 charges the founder's own Stripe account directly (platform charges). Full **Stripe Connect** — where each professional completes Stripe onboarding and gets their own connected account — is deferred to the Phase 3 marketplace; the `PaymentService` seam is built so it slots in without changing callers. Payment collection uses **Stripe Checkout** (hosted payment page): no card data ever touches our server, and the test card `4242 4242 4242 4242` works out of the box.

### 🤖 Claude Code Tasks
- [x] Set up Stripe integration (test mode)
  - Built 2026-07-14 and deployed to Render. `PaymentService` + `/api/billable-items`, `/api/invoices` (+ `/checkout`, `/sync`, `/void`, `/transactions`), `/api/webhooks/stripe`, `/api/events`. Stripe API failures surface as readable errors, which is how the key problem below was diagnosed.
- [x] Build `stripe_products` for per-visit billing first (simplest cadence)
  - Billable items backed by real Stripe Products/Prices; invoice = item × quantity (e.g. 3 visits) or a custom amount. Migration 012 added `invoices.description` + `invoices.stripe_checkout_session_id` (deliberate additions, flagged per CLAUDE.md).
- [x] Build invoice generation tied to `billing_cadence`
  - Per-visit (`one_time`) fully wired now; `week`/`month` items create recurring Stripe prices, and Week 6's walk-completion → auto-invoice hook will drive cadence timing.
- [x] Build Stripe webhook handler with idempotency via `stripe_event_id`
  - Signature-verified raw-body handler. Idempotent two ways: `stripe_event_id` UNIQUE blocks replays, and a payment-intent check stops the webhook and the sync fallback double-recording the same payment.
- [x] Fire `payment_received` event on successful payment
  - Fires exactly once, on the not-paid → paid transition. `invoice_generated` also logged. `GET /api/events` exposes the log.
- [x] Extend the Week 4 UI: invoice view + Stripe payment screen
  - Billing section on client detail (invoice list, new-invoice form, void, "Collect payment" → Stripe-hosted Checkout) + payment confirmation screen on return. Verified in-browser 2026-07-14 (invoice create/void/event log locally; Stripe-dependent steps blocked by the key issue below).
- [x] Write manual test script (generate invoice → pay with test card → confirm event log)
  - `scripts/week5-test.ps1` — opens Checkout in your browser for the pay step, then verifies paid-exactly-once + event log.
- [x] Verify the full payment loop live
  - 2026-07-14: all 8 steps of `week5-test.ps1` passed against the live Render deployment — founder paid with the test card, invoice flipped to paid exactly once (idempotency held through sync replays), and `payment_received` landed in the event log ($90.00).

### 🧑 Founder Tasks
- [x] Create Stripe account, enable test mode, note API keys
- [x] Provide Stripe test keys to Claude Code via `.env` (not chat)
  - 2026-07-14 (later session): resolved and verified. Local `.env` now has both Stripe keys (correct `sk_test_`/`pk_test_` prefixes, 107 chars), and the Render key works — a live API probe created a Stripe product without error.
- [x] Create the webhook endpoint: Stripe Dashboard → Developers → Webhooks → Add endpoint → URL `https://petpro-app.onrender.com/api/webhooks/stripe`, event `checkout.session.completed` — then put the signing secret in Render as `STRIPE_WEBHOOK_SECRET`
  - 2026-07-14: done and verified. First attempt was subscribed to the wrong events (the dashboard's Accounts-v2 preset — `v2.core.account.*` — so payments never fired it and the sync fallback quietly covered). Founder recreated it with the `checkout.session.*` events + fresh secret in Render; a live test payment was then recorded by the webhook itself (confirmed by `stripe_event_id` on the transaction).
- [x] Run test script — generate an invoice, pay with a Stripe test card
  - 2026-07-14: founder completed the Checkout payment during the live `week5-test.ps1` run — all 8 steps green.
- [x] Confirm the payment is recorded and shows in the event log
  - Verified by test steps 7–8: exactly one succeeded transaction, exactly one `payment_received` event.
- [x] Confirm status: mark this week done, or note what broke
  - Confirmed 2026-07-14. Week 5 done. Founder also logged 3 new feature requests (own payment processor, branded invoices, in-app tap-to-pay) — captured as P2-6…P2-8 below — plus a pre-demo QA pass, added to Week 8.
cd C:\Users\itchy\OneDrive\Desktop\PetPro
powershell -ExecutionPolicy Bypass -File .\scripts\week7-test.ps1 -BaseUrl "https://petpro-app.onrender.com"
---

## Week 6 — Scheduling

> **Scope decision (2026-07-15):** auto-invoice on completion fires for **per-visit** services only (walk done → $X invoice, zero manual steps). Weekly/monthly/package cadences still create invoices manually via the Week 5 billing UI — when those should generate (end of week? first walk of the period?) is a founder call, parked below in the founder tasks. Conflict detection covers appointments; the `availability_blocks` table (vacation/personal time) exists in the schema but has no UI yet — a Phase 2 candidate.

### 🤖 Claude Code Tasks
- [x] Build `services` CRUD (the walk/training product a client is buying)
  - `SchedulingService` + `/api/services`. Per-client, typed (`private_walk`…`boarding`), price + billing cadence + duration. New services default to `active`; no hard delete — "End" retires a service so its walk history keeps context. UI: Services section on client detail + inline "＋ New service…" right in the booking form.
- [x] Build `appointments` CRUD with weekly recurrence
  - `/api/appointments` — `repeat_weeks: N` books a weekly series as real rows (first occurrence carries `FREQ=WEEKLY;COUNT=N`, the rest point at it via `recurrence_parent_id`), so the calendar, conflicts, and completion all work on plain rows. Reschedule via PATCH; cancel supports scope `one` or `following` ("End series" in the UI).
- [x] Build conflict detection (prevent double-booking a time slot)
  - Every occurrence of a series is overlap-checked against the professional's scheduled appointments before anything is inserted — a clash 409s the whole request with a readable list ("Wed, Jul 22, 3:15 PM overlaps Dana Whitfield's 3:00 PM appointment"), so a recurring booking never half-lands.
- [x] Wire "mark appointment complete" → fires `walk_completed` event → triggers invoice
  - Per-visit services auto-invoice at the service price (linked via `invoices.service_id`, filled from migration-007's until-now-unused column). The scheduled→completed guard makes a double-tap complete (and bill) exactly once — verified by test step 7. Invoice lands in the client's Billing section with Week 5's "Collect payment" ready to go.
- [x] Capture structured completion data on "mark complete" — actual start/end time, walk notes, good-dog and got-a-treat flags — stored on the appointment and included in the `walk_completed` event payload (seam for the Phase 2 walk-report auto-message; see backlog item P2-2)
  - Migration 013 adds `actual_start_at/actual_end_at/completion_notes/good_dog/got_a_treat` (deliberate type additions per CLAUDE.md — this task is the sanction). The event payload also carries `next_appointment_starts_at` from the recurrence series, so P2-2's "see you next Tuesday" needs zero extra scheduling work.
- [x] Extend the UI: calendar/list view of appointments, "mark complete" button
  - Schedule tab: Monday–Sunday week view with prev/this/next navigation, today highlighted, ↻ weekly badges. "Mark complete" expands a walk-report form inline (times prefilled, notes, 🐶/🦴 checkboxes) — the button even shows the invoice amount for per-visit services. Completed walks display their report on the card.
- [x] Write manual test script (schedule recurring walk → complete → confirm auto-invoice)
  - `scripts/week6-test.ps1` — all 8 steps passed 2026-07-15, locally **and against the live Render deployment** (service → 4-week series → conflict 409 → complete with report → auto-invoice → double-complete refused → walk_completed payload → series cancel). Full UI flow also driven in-browser same day. Unlike Week 5, this script is fully automated — no payment step, so it makes a good smoke test any time.

### 🤖 Founder-requested updates (logged & built 2026-07-15, after the Week 6 build)
- [x] "Billed" options depend on the service Type — e.g. Boarding offers **per day** / one-time / per package (new `per_day` cadence, migration 014). Per-day services auto-invoice on completion at **price × days of the stay** (a 44-hour boarding = 2 days), same zero-manual-steps flow as per-visit.
- [x] Service Types filter by the professional's profile — new **Profile** tab (top nav) with "Services you offer" checkboxes; a dog walker who checks only walks never sees Grooming/Boarding when adding a service. Unset = all types shown, so existing accounts are unaffected. (`professional_profiles.offered_service_types`, `PATCH /api/auth/profile` — the profile mapping this needed. P2-5's onboarding wizard should set this during signup.)
- [x] "# of sessions" field next to Price on both add-service forms — stored on the service (`services.session_count`), shown in the service list (e.g. "Training package · $500.00 per package · 10 sessions"). Phase 2 can count completed sessions against it for package tracking.
- All three verified 2026-07-15: `npm test` step 8 covers them end-to-end (green locally + Render), and the UI flows were driven in-browser.
- [x] Boarding is **not exclusive time** (founder decision 2026-07-15): boarders don't block walks mid-stay, and multiple boarding clients can overlap freely (per day/week/month). Boarding stays are exempt from conflict detection in both directions — they're never blocked, and they never block anything. Walk-vs-walk double-booking is still refused. Covered by `npm test` step 8.

### 🧑 Founder Tasks
- [x] Run test script — schedule a recurring weekly walk
  - Covered 2026-07-15: `week6-test.ps1` and `npm test` both ran green against the live Render deployment (recurring series booked, conflicts blocked, series cancel).
- [x] Mark one instance complete, confirm an invoice generates automatically
  - Verified live: per-visit walk → $30 invoice, per-day boarding → price × days, each exactly once.
- [x] Note anything about the scheduling logic that doesn't match how you'd actually run walks
  - 2026-07-15: founder review produced 4 changes, all built and deployed same day — type-dependent billing options (incl. per-day), profile-mapped service types, "# of sessions" field, and boarding made non-exclusive (boarders can walk dogs mid-stay and take multiple concurrent boarders).
- [d] Decide: for weekly/monthly-billed services, when should the invoice generate? (End of the billing week/month, or with the first completed walk of the period?) Per-visit auto-invoicing works today; this decision unlocks the other cadences.
  - Deferred 2026-07-15 at week close: per-visit and per-day auto-invoicing cover the demo scenarios, and weekly/monthly services can invoice manually via the Week 5 billing UI meanwhile. Doesn't block Week 7 — decide whenever; the completion hook is already in place.
- [x] Confirm status: mark this week done, or note what broke
  - Closed 2026-07-15 at founder direction. Week 6 done.

---

## Week 7 — Messaging + Notifications

### 🤖 Claude Code Tasks
- [x] Build message threads + messages (REST first)
  - `MessagingService` + `/api/threads` (one thread per client, race-safe get-or-create), `/api/threads/:id/messages`, mark-read, unread counts. Built 2026-07-15.
- [x] Wire real-time delivery via Supabase Realtime
  - Migration 015: RLS on messages/threads + realtime publication, so the browser subscribes with the public anon key + the user's JWT and can only ever receive its own threads. Verified live in-browser: "● live" indicator, API-sent message appeared in an open conversation with no reload. An 8s polling fallback covers the CDN/socket failing — messaging never goes dark.
- [x] Build offline draft sync endpoint
  - `POST /api/messages/sync` — device-generated `client_draft_id` + the schema's UNIQUE constraint make every retry idempotent (verified: resend + sync of an already-sent draft report `duplicate`, never a double message). UI queues failed sends in localStorage and syncs on reconnect.
- [x] Build email notifications for: contract ready, contract signed, payment received, appointment reminder
  - All four wired (payment = receipt to client AND "you got paid" to the professional, both riding Week 5's paid-exactly-once transition; reminders = 24h before, auto-cancelled when the walk is cancelled/completed, auto-shifted on reschedule). Templates render at **send time** from ids, so a stale reminder can't fire and a fixed email typo is picked up automatically. **Decision (2026-07-15): print-styled HTML, not server-side PDF** — the signed email attaches the standalone HTML copy; browser Print → "Save as PDF" produces the PDF. A real PDF pipeline (puppeteer-sized dependency) wasn't worth it pre-demo; revisit only if clients ask.
- [x] Keep notification sending channel-agnostic (template + recipient + channel), with email as the only channel for now — so SMS walk reports (backlog P2-2) plug in later without rework
  - Everything is a `notification_queue` row (template + recipient + channel); email goes through an `IEmailProvider` adapter (Resend implemented, SendGrid would be a drop-in). SMS later = second adapter + `channel: 'sms'`, no caller changes. **With no email key set, the app runs fine — rows queue as `pending` and send automatically once `RESEND_API_KEY` lands** (worker retries every 30s). `POST /api/notifications/test` is the founder's key probe.
- [x] Add "Print / download" on the signed-contract view *(added 2026-07-15, user-walkthrough finding W-1)*
  - `GET /api/contracts/:id/document` renders the standalone print-styled copy (same rendering the signed email attaches, so both are always identical); the signed-contract view got "⬇ Download" (.html file) and "🖨 Print / save as PDF" (hidden-iframe print — immune to popup blockers).
- [x] Extend the UI: simple message thread view
  - Messages tab: thread list (previews, unread badges, "message a client" starter) + conversation view (bubbles, Enter to send, live delivery, queued-offline state). "✉ Message" shortcut on client detail. Verified in-browser 2026-07-15.
- [x] Write manual test script (send message → confirm real-time delivery → trigger event → confirm email)
  - `scripts/week7-test.ps1` (7 steps, incl. the email-key probe with founder instructions) — green locally 2026-07-15. `npm test` extended to 10 steps: messaging idempotency + notification queue/reminder lifecycle.

### 🧑 Founder Tasks
- [x ] Create Resend or SendGrid account, note API key
  - Build assumed **Resend** (simpler API; SendGrid still drops in behind the adapter if you prefer it). Put the key in local `.env` AND Render as `RESEND_API_KEY`. Note: until you verify a sending domain in Resend, emails only deliver to the Resend account owner's own inbox — enough for all Week 7 testing.
- [x] Provide email API key to Claude Code via `.env` (not chat)
- [x] Run test script — send a message, confirm it arrives in real time
  - `.\scripts\week7-test.ps1` (add `-BaseUrl` for Render). Step 7 probes the email key live — per our earlier key-paste incidents, don't trust "key is in" until that step says SENT. For real-time: open the same conversation in two browser windows and send from one.
- [x] Trigger a contract signing, confirm the email notification arrives
  - Client needs an email address on file; the signed email arrives with their copy of the agreement attached.
- [x] Confirm status: mark this week done, or note what broke

---

## Week 8 — Owner Portal + End-to-End Testing + Demo Prep

### 🤖 Claude Code Tasks
- [x] Harden password requirements for security compliance (founder request 2026-07-13): raise minimum length to 12, require mixed character classes, reject common/breached passwords, matching validation in both the signup API and Supabase Auth settings — must land before the demo creates real accounts
  - Built 2026-07-15: `src/services/passwordPolicy.ts` enforces 12+ chars, 3-of-4 character classes, a common-password list, and a live HaveIBeenPwned breach check (k-anonymity — only a 5-char hash prefix leaves the server; fails open so an HIBP outage can't block signups). Applies to signup, reset, and change. Verified live incl. `P@ssw0rd1234` rejected as breached. ⚠️ The Supabase-side setting is dashboard-only — founder task below.
- [x] Forgot-password + change-password *(added 2026-07-15, user-walkthrough finding W-2)* — the login screen has no reset link and the Profile tab can't change a password, so a locked-out professional is a dead end today. Supabase Auth's built-in recovery flow covers the reset email; build alongside the password-hardening task above so both ship as one auth pass.
  - Built 2026-07-15: "Forgot your password?" on the login screen → Supabase recovery email → in-app "choose a new password" screen; Profile tab gets Change password (current password required). Full loop verified live: wrong current password 401, old password stops working, new one logs in. ⚠️ The recovery email link only works once the app URL is allowlisted in Supabase — founder task below.
- [x] Edit client & pet details from the UI *(added 2026-07-15, user-walkthrough finding W-3)* — UI-only work over existing endpoints. (Signed contracts stay immutable regardless — edits only affect the live record, as Week 3 verified.)
  - Built 2026-07-15: ✎ Edit on client detail opens a full edit form (contact, emergency contact, cancellation window, no-show fee — first UI for that field, P2-10 groundwork — entry instructions); each pet card gets ✎ inline editing. Verified in-browser.
- [x] Today screen: today's walks + money cues *(added 2026-07-15, user-walkthrough finding W-4)*
  - Built 2026-07-15: "Today's schedule" agenda at the top of the home screen; unpaid (and overdue, once `due_date` is used) invoice cues in "Needs your attention"; client phone/email are now `tel:`/`mailto:` links on client detail. Verified in-browser.
- [x] Build minimal owner portal: magic-link login, view schedule, view/sign contract, view/pay invoice, message the professional
  - Built 2026-07-15 at `/portal` (own small page: `public/portal.html` + `portal.js`). Owner logs in with the email their walker has on file — magic link only goes out if that email matches a real client, first session auto-creates the `owner` account and links `clients.owner_account_id` (the Week 2 seam). Home: upcoming visits, sign/pay cues, signed agreements, payment history. Signing = the Week 3 signature-pad flow over the owner's login (Nitro Sign stays deferred); first signed contract still auto-activates the client. Paying = Week 5 Stripe Checkout with a portal return screen. Messaging = Week 7 threads with 8s polling. All owner routes are scoped through the client link; cross-role access 403s both directions (verified). Note: magic-link sessions last ~1 hour, then the portal asks for a fresh link — fine for Phase 1.
- [x] Write full integration test script covering the entire loop: signup → client → pet → contract → sign → schedule → complete walk → invoice → pay → notify
  - Head start (2026-07-15): `npm test` (`scripts/test-e2e.ts`) already covers signup → client → pet → contract → sign → schedule → complete → auto-invoice in one command, local or `--base-url` Render — verified green against both. Week 8 extends it with the owner-portal, pay, and notify legs.
  - Done 2026-07-15: step 11 mints the owner's magic-link token server-side (the same generateLink→verifyOtp the emailed link performs), then drives session-linking, overview, remote signing (asserting the contract_signed email queues — the notify leg), Stripe Checkout creation + unpaid-stays-open sync (the pay leg; completing payment with the test card remains the human step in `week5-test.ps1`), owner↔professional messaging idempotency, and cross-role 403s. All 11 steps green locally **and against the live Render deployment** (2026-07-15, post-deploy).
- [~] Full QA pass before the demo (founder request 2026-07-14): run every weekly test script (weeks 1–7) against production, click through every UI flow start to finish (light + dark, laptop-sized window), exercise error states (bad input, declined test card `4000 0000 0000 0002`, double-submits), and log anything broken as `[!]` items to fix before demo day
  - **Automated legs done 2026-07-16 — one bug found (Q-1 below), now fixed.** Against live Render: `npm test` all 11 steps green; `week1/2/3/4/6/7-test.ps1` all green. **Week 5 now all 8 steps green** — founder paid the test card later the same day; see Q-3.
  - **UI click-through (both themes, 1440×900):** signup → client → pet → contract generate → sign-and-lock → client auto-flips to active → invoice → Today cue — all worked. Console clean, no horizontal overflow. Light 13:1 contrast (AAA), dark renders correctly. Clients tab, Schedule week view, Messages, Profile all render; W-1 Download/Print, W-2 change-password, W-3 ✎ edit, W-4 agenda + unpaid cue all present and working.
  - **Error states exercised:** empty required field + malformed email blocked (native validation; server-side 422 independently proven by week2 step 5); empty signature blocked with inline error; triple-clicked "Save & add pets" created exactly **one** client (button disables → "Working…"); password policy rejects short / single-class / common / **breached** (live HIBP) and accepts a strong one; portal login refuses a professional's email (409 w/ "+alias" guidance), 422s a malformed one, and returns a generic `sent:true` for unknown addresses (no account-existence leak).
- [x] **Q-1: "‹ All clients" back link on client detail went to Today, not Clients** — `public/app.js:708` rendered `<a href="#/today">‹ All clients</a>`. Same residue as the "Clients tab not clickable" report: the 2026-07-16 fix gave Clients its own `#/clients` screen but this link still pointed at the old alias, so the label lied about where it went.
  - **Fixed 2026-07-16** (`#/today` → `#/clients`). Verified in a local browser, not just by reading the diff: clicking "‹ All clients" now lands on the Clients screen with the Clients tab highlighted. Swept the rest of `app.js` for the same stale-alias pattern — every other `#/today` jump is a legitimate error-fallback or the post-login redirect. ⚠️ **Not yet deployed** — needs a commit + push (Render auto-deploys) to reach the demo.
  - Related, **not** changed: the new-client form's Cancel links (`app.js:542`, `app.js:569`) also go to `#/today`, but that form is reachable from both Today and Clients, so cancelling from Clients dumps you on Today. Unlike Q-1 this isn't a lie — "Cancel" promises no destination — so it was left alone rather than quietly altering the demo path. Founder call: point Cancel at `#/clients` too, or leave it.
- [x] **Q-2: Supabase dashboard settings — founder updated them 2026-07-16.** The URL allowlist and min-password-length settings were applied in the Supabase dashboard. **Standing caveat, not a blocker:** the allowlist governs the link *inside* the email, which can't be verified from our side without inbox access — `/api/auth/forgot-password` returning `sent:true` only proves Supabase accepted the send. It's proven the first time a real magic link is clicked and lands somewhere valid; the founder's owner-portal walkthrough (open, above) is the natural place that happens. Worth knowing given env keys have twice been pasted malformed — "it's set in the dashboard" and "it works" aren't the same claim here.
- [x] **Q-3: live payment loop — CLOSED 2026-07-16, and it proved more than the script would have.** Founder paid the test card on the Checkout the QA run had opened ($90.00, `cs_test_a1OMEXqOWFj64F…`). Because that script had already been stopped, **nothing on our side was polling** — yet the invoice still flipped to `paid` and `payment_received` fired with `"via": "webhook"`. That's the webhook recording a real payment entirely unassisted, which the normal script run (where the sync fallback is racing the webhook) can't distinguish. Verified against live Render: invoice `paid` $90.00; **exactly one** succeeded `payment_transactions` row carrying `stripe_event_id` (webhook's own record, not sync); 3 further sync replays still left exactly one transaction; exactly one `payment_received` event. Week 5 steps 6–8 are therefore green.
- [x] **Q-4: declined-card error state — CLOSED 2026-07-16, founder ran it.** Founder put the declined card `4000 0000 0000 0002` through Checkout against production and confirmed the decline surfaced. Entering card numbers is the human step by this roadmap's own convention (Test Scripts table; Week 8 line 276), so this could only ever close here. **Caveat worth keeping:** what was explicitly confirmed is that the card declined — the other half of the brief (invoice stays `open`, not stuck mid-state) wasn't separately reported. Not chased down, because the W-5…W-8 flow change re-opens the Week 5 QA leg anyway and this re-runs there; if the invoice had stuck it would surface then.
- [x] Fix bugs surfaced during founder + tester testing
  - **Q-1 fixed, browser-verified, and deployed 2026-07-16** (commits `6147595` + `af49624`, live on Render ~45s after push; production confirmed serving `href="#/clients"`, and `npm test` 11/11 still green post-deploy). Q-2 and Q-4 are founder actions, not code bugs. No other defects surfaced in the QA pass.
- [~] Deploy final version to Render production tier
  - **Code side done 2026-07-16** — `main` is pushed, auto-deployed, and verified live (11/11 `npm test` against the deployed URL, health OK). This is the final cut unless the founder's remaining checks surface something.
  - ⚠️ **"Production tier" is still a founder decision, and it's a live demo risk.** `render.yaml` says `plan: free`, but that file is ignored (the service is dashboard-managed) — so the real tier can only be confirmed in the Render dashboard. **Render's free tier sleeps after ~15 min idle and takes ~50s to cold-start**, which in front of an audience looks like a broken app. Either upgrade to a paid instance, or warm the URL right before demoing (see the demo-day note below). Weak evidence it may not be sleeping: the first request of the QA session returned in 0.34s — but it had likely been warmed by the founder's own testing.
- [x] Prepare a short "known issues / what's next for Phase 2" note
  - Written 2026-07-16: **`KNOWN_ISSUES.md`** at the repo root. Covers what works end to end, known limitations (email domain, magic-link rate limit, security hardening scheduled not done, platform-Stripe branding, no cash/Venmo, no no-show fees, schema-ahead-of-UI gaps), deliberate scope decisions (in-person signing, print-to-PDF, cadence invoicing, non-exclusive boarding, one-email-one-account), and the Phase 2 ordering. Written so nothing in it is a surprise on demo day — every item traces to a decision already logged here.

### 🧑 Founder Tasks
- [x] Supabase dashboard settings for the Week 8 auth pass (5 minutes, needed before reset emails and the owner portal work in production):
  1. **Authentication → URL Configuration**: set Site URL to `https://petpro-app.onrender.com` and add `https://petpro-app.onrender.com/**` (and `http://localhost:3000/**` for dev) to Redirect URLs — password-reset and magic-link emails refuse to link anywhere not on this list.
  2. **Authentication → Providers → Email**: set Minimum password length to **12** so Supabase's own setting matches the API's policy.
- [x] Sign off on the Week 8 build tasks above (all built and verified 2026-07-15) — QA pass, bug fixes, and final deploy start after this sign-off.
- [x ] Try the owner portal yourself first: as a professional, add a client whose email is a **"+" alias of your real inbox** (e.g. `nitro.shae.clark+pup@gmail.com` — lands in your normal inbox but counts as a separate login), then visit `/portal`, request a login link, and walk the loop (sign, pay with the test card, message). Don't use an email that's already a PetPro login — the portal now refuses those with a clear message instead of a dead end. Note: the magic link comes from Supabase (not Resend), so it delivers regardless of domain verification — but Supabase's built-in mailer is rate-limited to a couple of emails per hour, and the portal now says so instead of pretending the link was sent.
  - 2026-07-16: first attempt hit "already a user with that email" — diagnosed and fixed same day (see Running Notes). Also: diagnosis sent a genuine magic link to shae_clark@itchytail.com — if that mailbox exists, that link is real and safe to use.
- [x] Also still open from Week 7: run `week7-test.ps1`, trigger a contract-signed email, and confirm Week 7 status — plus verify itchytail.com at resend.com/domains before any client-facing email matters for the demo.
- [ ] Recruit a friend or family member to test the owner portal cold, without your help
- [ ] Collect their feedback and any points of confusion
- [ ] Run the full end-to-end integration test yourself
- [ ] Confirm the production deployment is accessible and stable
- [ ] Prepare and deliver the 8-week demo — **recommended method: live web app on your laptop, two devices, with a recorded backup.** See "Demo Day — Delivery Plan" below.

---

## Post-Walkthrough Adjustments — W-5…W-13 (logged 2026-07-16, decisions locked)

> Founder walkthrough findings after the Week 8 QA pass. **All design questions resolved with the founder 2026-07-16** — decisions recorded inline so the build doesn't re-litigate them. ⚠️ **Not yet scheduled against the demo** — see the sequencing note at the end; this is Phase-1.5-sized and carries a legal-review dependency.

**The through-line:** services stop being something you set up loosely on a client and become **something the contract creates**. The contract is the source of truth, because that's what the client actually agreed to a price for.

- [x] **W-5: service form moves out of client setup and into contract generation — BUILT 2026-07-16** (`9ccb24e` + `00c46af`). Field order as specified: **Pet → Type → Price → # of sessions → Billed → Duration → Notes**. "Name" removed from the form.
  - *Decisions held up:* Name is auto-built as "Type — Pet" server-side (`buildServiceName`, `SchedulingService.ts`) into the existing NOT NULL `services.name`; Notes reuses `services.description`; `session_count` already existed from migration 014. **No migration needed for any of the three**, as the decision predicted.
  - *Verified in a browser:* a walk for Pepper became "Private walk — Pepper", and the document's Key Terms read "Private walk" / "$30.00 per visit (30 min)" — derived, never typed.
- [x] **W-6: one contract carries multiple services, each with its own pet selection — BUILT 2026-07-16.** Repeatable block with "＋ Add another service"; per-service pet checkboxes; Remove appears only when there's more than one.
  - *Decision held up:* multi-pet per service via `service_pets` — confirmed dead since Week 2 and now written to. One walk covering two dogs = one service at one price.
  - *Live assumption fixed and verified:* `{{pet_list}}` is now the union of the services' pets. A Pepper-only contract no longer silently covers Biscuit. Contracts generated **without** services keep the old every-pet behaviour, so nothing pre-W-5 changes meaning.
  - ⚠️ **Multi-service generation is refused until W-9 lands** — see the guard under W-9. The form and data layer are done; it unlocks with the template.
- [x] **W-7: services are born on signing — BUILT 2026-07-16.** Contract services are created as `draft` at generation and flip to `active` in `activateServicesForContract` on the signed transition, after the status UPDATE wins its concurrency race, so exactly one signer activates them. `contract_signed` now carries `services_activated`.
  - *Decision held up:* profile services are contract-fed; the ad-hoc "Add a service" form is gone from the client profile.
  - *Ordering call worth knowing:* if activation ever throws, the contract stays validly signed. A service that didn't activate is recoverable; a signature rolled back because a service insert failed is not.
- [x] **W-8: "＋ Add services" reuses the contract flow — BUILT 2026-07-16.** The button routes into contract generation rather than adding a service directly. `POST /api/services` still exists for scripts and seeded data — it's the UI bypass that was the problem, not the endpoint.
- [!] **W-5a: schema change the design note didn't anticipate — `services.contract_id` (migration 016).** The note said W-5…W-7 needed no migration; that was true for `name`/`description`/`session_count` but not for the contract→service link. `contracts.service_id` (005) is a **single** nullable FK — one contract, one service — and W-6 needs 1:N, so the link moved to the child side where it belongs. Nullable: pre-W-5 services have no originating contract, and null means "predates W-5", not "invalid". `contracts.service_id` left in place, unread, rather than dropped. **Applied to the live database 2026-07-16.**
- [~] **W-9: contract template — services table + addendum variant. ⚠️ Still needs counsel review for the CA v2 + addendum — but no longer blocks multi-service contracts.**
  - **2026-07-17: founder supplied a "Pet Services Agreement" (.docx in `templates/contracts/`), now converted and packaged as a second seeded template** alongside the CA agreement. It carries `{{services_table}}`, so **multi-service contracts generate today** under this template (browser + API verified: two services, zero unresolved placeholders); the CA v1 stays single-service-guarded until counsel returns the v2. Seeding now copies every packaged template, so existing accounts pick it up on their next visit to the new-contract page; contract rows title themselves from the template name.
  - ⚠️ **Provenance caveat, stated plainly: this template has NOT been through counsel.** The source document is a generic template (the .docx even opened with an AI-chatbot preamble — stripped in conversion), not the reviewed drafts in `COUNSEL_REVIEW.md`. Conversion decisions and open legal questions are documented in the template file's header — notably: it charges the FULL service fee for late cancels (the CA agreement charges the per-client no-show fee), it has no emergency-vet spending cap (so the generate form's cap field doesn't apply to it), and the source's late-fee clause was dropped (the app has no late-fee mechanism). The in-document legal-review notice was added. **Recommendation stands: send this template with the existing counsel packet rather than treating the gate as closed.** Key Terms currently has fixed `Walk type` / `Schedule` / `Fees` rows; multi-service (W-6) turns those into a **services table**. W-8 additionally wants an **addendum** variant ("supplements the agreement dated X") rather than a fresh standalone agreement. Both change the part of the document that actually binds — route through the same legal review already flagged for the CA template's two substantive edits.
  - **Drafts ready to send 2026-07-17 — `templates/contracts/COUNSEL_REVIEW.md` is the packet.** Three files: `dog-walking-agreement-ca-v2.html` (services table), `dog-walking-addendum-ca.html` (addendum), and the packet framing both plus the two already-flagged edits as **one** review, since a second round-trip costs another cycle of the demo date. Neither draft is seeded — v1 stays live until counsel signs off.
  - **The mechanism is built and proven, not just claimed (2026-07-17).** Registered the v2 draft as a template and generated a real three-service contract against it: the table rendered as markup (not escaped), rows read "Private walk — Pepper", "Training session — Biscuit", "$400.00 per package (10 sessions)", and one multi-pet "Group walk — Pepper & Biscuit" at a single price. Zero unresolved placeholders. **So counsel's wording is genuinely the only thing missing for the services table — no further code.**
  - *The addendum, unlike the table, does need code once its shape is settled:* it references `{{original_agreement_date}}` and `{{original_pet_list}}`, which need a link from an addendum to its parent agreement. Deliberately not built yet — packet question 4 (do addenda stack or supersede?) could change the data model, and building before that answer risks building it twice.
  - *Substantive questions the drafting surfaced, all in the packet:* whether a pet added by addendum is covered by the original's health certifications and vet authorization via incorporation by reference; whether the emergency vet cap is per-incident, per-pet, or aggregate once several pets are on one agreement (ambiguous in v1 too, but multi-service makes it bite); and whether the walker's free-text service Notes belong in a binding document at all, given the table's precedence clause would resolve a contradiction **in the walker's favour**.
  - *Design note the walkthrough didn't anticipate:* the table **cannot** ride through the normal variable path, because every variable is HTML-escaped on the way in (`ContractService.ts`) — deliberately: template markup is trusted, interpolated client data is not. `{{services_table}}` is therefore the **one** trusted-markup seam, where the markup is ours and every cell is still escaped. The escape was not weakened for everything else to make this work.
  - *Guard, so the gap can't produce a wrong document:* generating a contract with **more than one service** against a template lacking `{{services_table}}` is **refused** (422, `template_single_service_only`) with a message naming the legal review. The pre-W-9 template describes one service in fixed rows, so rendering two into it would bind the client to both while describing one. A blocked contract beats a wrong one — and that's the exact drift W-5…W-7 exist to remove. Browser-verified: refused cleanly, no contract or service rows written.
- [x] **W-10: email the signed contract to the client — ALREADY BUILT, no work needed.** `NotificationService.ts:348` sends to `client.email` with the signed document attached, on the signed transition; QA confirmed it queues. **It didn't arrive because Resend's domain isn't verified** (email only reaches the Resend account owner's inbox) and the client needs an email on file. Founder task, already open below — not a build item.
- [x] **W-11: phone formatting `(555)010-1234` — BUILT 2026-07-17.** *Decision:* format **on entry and display**, US 10-digit only; anything else (international, extensions) left exactly as typed. **No backfill** — existing rows reformat when next edited. Rationale: client search matches the stored phone text (`ClientService.ts:103`) and `tel:` links are built from it, so rewriting stored values has blast radius. Production data is already mixed (`"+1 (555) 010-1234"` and `"510-222-3333"`).
  - Built as `fmtPhone()` in `app.js`: phone fields format on blur (delegated listener, so re-rendered forms need no re-wiring) and again at save, so the stored value is the formatted one; client-detail display formats stored values without touching them. 10 digits — or 11 with a leading 1, which is the same US number — qualify; anything else passes through untouched. *Browser-verified:* `555 010 1234` became `(555)010-1234` on blur and saved that way; `+44 20 7946 0958` survived exactly as typed next to it.
- [x] **W-12: profile image + logo placeholder only — BUILT 2026-07-17.** *Decision:* placeholder now, **no upload plumbing pre-demo**. Real upload (Supabase Storage, same pattern as signature images) rides with **P2-7** branded invoices; pet photos stay in **P2-11**. Note for expectations: Stripe's Checkout page shows the *platform's* branding regardless, until Stripe Connect (P2-6).
  - Profile tab now opens with a media card: initials avatar standing in for the profile photo, and a dashed logo tile (paw mark) for the business logo — each captioned with when the real upload arrives, so it reads as a preview, not a broken feature. No dead upload buttons. Browser-verified.
- [x] **W-13: cancel / pause / extend a recurring service — BUILT 2026-07-17, without Stripe.** `services.status` already has `active`/`paused`/`ended` and `services.end_date` exists, and weekly/monthly cadences invoice manually today — so the UI can expose End/Pause/extend immediately with zero Stripe involvement.
  - Service rows on client detail now carry the full lifecycle: **Pause / Resume** (booking on a paused service already 409s server-side, so pause genuinely stops new walks), **End** behind a confirm that first counts the service's upcoming booked walks and says they stay on the schedule (already-booked walks are the client's plan, not ours to silently cancel — the walker cancels them from Schedule if they shouldn't happen), and **Set / Change end date** as an inline date editor (with "No end date" to clear). `end_date` shows in the row as "until September 30, 2026" — rendered date-only, since `new Date('YYYY-MM-DD')` parses UTC and would shift a day in US timezones. All UI over the existing `PATCH /api/services`; zero backend changes. *Browser-verified:* set-date → pause → resume → end-with-confirm all exercised live; `npm test` 11/11 and `week6-test.ps1` 8/8 green after.
  - *Decision:* **Stripe Subscriptions are Phase 2, and go behind Stripe Connect (P2-6)** — not before. Two reasons: (1) all money currently flows through the founder's own Stripe account, and recurring revenue for every walker compounds that tax/liability question with each client; (2) subscriptions **retire the deferred `[d]` invoice-timing decision** (Week 6) outright, because Stripe bills on the cycle.
  - *Current state worth knowing:* recurring Stripe **Prices are created but never used** — `stripe_price_id` is stored and never read, every Checkout is `mode: 'payment'` with an inline one-off price, and **no Stripe Customers exist**. So nothing recurring bills recurringly today; that price is a vestigial Week 5 seam. Real subscriptions need: Customer per client, `mode: 'subscription'` Checkout (card saved once), `invoice.paid` / `invoice.payment_failed` / `customer.subscription.*` webhooks, Stripe-invoice→our-invoice mapping that respects the paid-exactly-once guard, and dunning.

**✅ Sequencing — DECIDED 2026-07-16: hold the demo, build W-5…W-13 first.** Founder call: the demo waits for the updates rather than shipping on the current build with W-5…W-13 as Phase 1.5. Consequences accepted, and now on the critical path:

1. **W-9's legal review is the long pole and it isn't ours.** The demo date is now gated on counsel returning the services-table + addendum template edits, bundled with the CA template's two substantive edits already flagged. **Founder: send this to counsel first — before the build lands, not after.** Everything else here is work we control; this one is calendar time we can only spend by starting it.
2. **The QA pass closed 2026-07-16 re-opens.** Weeks 3, 5, and 6 all touch services, so they get re-run against the new flow once W-5…W-8 land. Q-1's fix stays; the green run doesn't transfer.
3. **Build order:** W-5 → W-6 → W-7 → W-8 (the contract→services spine, in that order — each depends on the one before), then W-11 / W-12 / W-13 which are independent and can land any time. W-9 is counsel-gated and rides in when it returns. W-10 needs no work.

**Progress 2026-07-16: W-5, W-6, W-7, W-8 built and browser-verified** (`9ccb24e` backend, `00c46af` UI), plus migration 016 applied live. e2e 11/11, week3 8/8, week6 8/8 green against local after the change. ~~Remaining: W-11 (phone formatting), W-12 (image placeholders), W-13 (cancel/pause/extend)~~ **Progress 2026-07-17: W-11, W-12, W-13 all built and browser-verified** (UI-only — `public/app.js` + `styles.css`, no backend or schema changes; e2e 11/11 + week6 8/8 green after). **The build side of W-5…W-13 is now complete. Remaining: W-9 only, which is counsel's turn, not ours** — plus the QA pass that re-runs weeks 3/5/6 against the new flow before the demo.

**QA items closed by founder 2026-07-16 (see Q-2 / Q-4 above):** Supabase dashboard settings updated (Q-2), and the declined card confirmed run against production (Q-4). **The Week 8 QA pass is therefore fully closed — and immediately re-opens for weeks 3/5/6 under this flow change.** That isn't wasted work: it closed the pre-W-5 build cleanly, so anything the next pass finds is attributable to W-5…W-8 rather than to unknown pre-existing state.

---

## Demo Day — Delivery Plan

*Added 2026-07-16 after the QA pass. The recommendation is grounded in what QA actually found, not in what would look nicest.*

**Method: live web app, on your own laptop, driving two screens — with a recorded walkthrough as backup.**

Why live rather than slides or a video: the whole point of Phase 1 is that the loop *actually works* against real Stripe, real Supabase, and a real deployment. A recording of a working app is strictly less convincing than the app, and this build survived a full QA pass — it can take the weight. Slides can't show a contract locking itself or an invoice appearing the instant a walk is marked done.

Why two devices: the story lands hardest when the audience sees **both sides**. Laptop = your professional view (Today → client → contract → schedule → mark complete → invoice). Phone or a second window = the pet owner's portal (they sign, they pay, they message you). One flow, two perspectives, no hand-waving about "and the client would see…".

**The three risks that can actually break a live demo — all fixable in advance:**

1. **Cold start.** If the Render service is on the free tier it sleeps after ~15 min idle and takes ~50s to wake — which reads as "the app is broken". **Load the URL a few minutes before you present**, or upgrade the instance. Confirm the tier in the Render dashboard.
2. **Magic-link rate limit — the sharpest one.** Supabase's built-in mailer allows only a couple of login-link emails per hour, and portal sessions last ~1 hour. **Do not request a portal link live in front of people.** Log the portal in ~10 minutes beforehand and leave the tab/phone open. If you must show the link arriving, that's your one shot — don't burn it rehearsing an hour before.
3. **Email visibility.** Until `itchytail.com` is verified at resend.com/domains, notification email only reaches the Resend account owner's inbox. **Use a "+" alias of your own inbox** (e.g. `nitro.shae.clark+pup@gmail.com`) for the demo client so the contract-signed email and payment receipt actually land somewhere you can show.

**Pre-seed, don't create from scratch.** Have a demo client with pets, a signed contract, a booked recurring walk, and payment history already in place — then create *one* new thing live (a walk completion → auto-invoice is the best single "wow" moment: zero manual steps, money appears). Building an entire client from an empty account live burns minutes and invites typos.

**The moments worth showing, in order:** (1) mark a walk complete → invoice appears by itself; (2) pay it with the test card → it flips to paid and the event log records it exactly once; (3) sign a contract → try to edit it → the database itself refuses; (4) hand over to the owner portal for the client's-eye view.

**Backup:** record the full loop as a screen capture beforehand. Not to play instead of the demo — to have in your pocket if the venue wifi dies. Also keep `KNOWN_ISSUES.md` open in a tab: if someone asks "can it take cash?" or "is it secure?", the honest, already-planned answer is better than an improvised one.

---

## Phase 2 Backlog — Captured, Not Scheduled

> **Phase 2 now has its own roadmap: `PHASE_2_ROADMAP.md`** (created 2026-07-15). The items below remain the detailed specs; the Phase 2 roadmap references them by number and adds the ordering, workstreams (mobile, UI/UX, multi-profession, code cleanup), and QA/security gates. Add new backlog detail here; add scheduling there.

*Founder feature requests logged 2026-07-13 (P2-1…P2-5) and 2026-07-14 (P2-6…P2-8); P2-9…P2-11 logged 2026-07-15 from a typical-user walkthrough of the live UI (see Running Notes). These are out of scope for the 8-week Phase 1 build (the Week 8 demo doesn't depend on them), but earlier weeks lay seams for them so nothing has to be rebuilt. Do not start these until Phase 1 is done and the founder pulls them in.*

### P2-1: Walker ratings (1–5 dogs)
Clients rate walkers on a 1–5 **dog** scale (not stars), 5 = best, 1 = needs improvement. Half-dog ratings (e.g. 4.5) are supported — store as a numeric with one decimal place, validated to 0.5 increments.
- Natural home: owner portal (extends Week 8's portal). Ratings attach to the walker's *account*, keeping the marketplace seam — a future Phase 3 marketplace can surface the same ratings unchanged.
- Needs a new `ratings` table + type in `src/types/index.ts` (deliberate addition — flag at build time per CLAUDE.md).

### P2-2: Walk-report auto-message on completion
Walker can opt in (per-walker setting) to: scan-in/scan-out ends the walk, and completion automatically sends the client a message with walk stats — time of walk, distance, "were they a good dog," "did they get a treat," free-form notes. If the appointment is recurring, the message includes the date/time of the next walk.
- **Seam laid in Week 6:** completion data (times, notes, flags) is captured on the appointment and carried in the `walk_completed` event payload — the auto-message is then just an event consumer.
- Next-walk date comes from Week 6's recurrence data; no new scheduling work needed.
- ⚠️ **Founder decisions required before build:**
  - "Automated **text**" means SMS — the locked stack has email only (Resend/SendGrid). SMS needs a new provider (e.g. Twilio) and per-message cost. Alternative: in-app message + email first, SMS later. Per the marketplace seams, SMS would go behind a provider adapter, and Week 7's channel-agnostic notification structure is the hook for it.
  - "Scanned in" mechanism is undecided — QR tag on the leash/collar, NFC, or a plain check-in/out button in the walker's app. Distance stats additionally require GPS tracking during the walk (a mobile-app-sized feature; note the maps-adapter seam).

### P2-3: Photos + notes attached to the walk report
Walker can save pictures and notes during/after a walk that get attached to the P2-2 completion message.
- Notes are already captured by the Week 6 seam. Photos add: upload to Supabase Storage (already in stack), attachment references in the `walk_completed` payload, and media handling in whichever channel sends the report (email embeds are easy; SMS becomes MMS — another provider consideration).

### P2-4: Walker calendar sync with live check-in updates
Walker can subscribe their personal calendar (Google/Apple/Outlook) to their walk schedule, and the calendar updates automatically after every check-in (e.g. a walk shows as started/completed, recurring instances stay current).
- Week 6 already builds the in-app calendar/list view — Phase 1 stops there.
- Phase 2 adds an authenticated iCal feed URL (simplest: calendars poll the feed, so "updates after every check-in" falls out for free) — full two-way Google Calendar API sync only if the feed proves insufficient.
- Depends on P2-2's check-in mechanism existing.

### P2-5: Signup onboarding wizard
New professionals get a mini onboarding right after signup: prompts to add their information, services offered, years in service, profile picture, etc. (founder request 2026-07-13).
- The data model already supports all of it — `professional_profiles` has `bio`, `years_experience`, `service_areas`, `profile_photo_url` — so this is UI + a photo upload to Supabase Storage, no schema work.
- "Services offered" should reuse the Week 6 `services` catalog rather than a free-text list, so onboarding feeds scheduling directly.
- If Week 8 demo prep has slack, a slim 2-screen version (name/photo/years + services) is a strong "wow" for the signup demo — decide then.

### P2-6: Owner-selectable payment processor
Professionals can set up their own payment processing instead of everything running through the founder's Stripe account (founder request 2026-07-14).
- ⚠️ **This touches a hard constraint.** `CLAUDE.md` locks payments to **Stripe only**. The request splits into two very different asks:
  1. **Each professional gets paid into their own account, still via Stripe** — that's **Stripe Connect**, already planned as the Phase 3 marketplace seam. The `PaymentService` was built so Connect slots in without changing callers. No constraint change needed. **Recommended path.**
  2. **Support non-Stripe processors** (Square, PayPal, etc.) — a much bigger lift: a payment-provider adapter interface (like `IeSignProvider`), per-processor webhook/idempotency handling, and a deliberate amendment to the locked constraint in `CLAUDE.md`. Founder decision required before any build.
- Do not start either until Phase 1 is done; when picked up, do Connect first and only revisit multi-processor if real users demand it.

### P2-7: Branded invoices — logo + business name
Owner can add their logo and business name so invoices look like *their* business (founder request 2026-07-14).
- Business name already exists on `professional_profiles`; needs a logo upload (Supabase Storage, same pattern as signature images) and rendering on the invoice view + payment confirmation + (Week 7) payment emails.
- Caveat: the Stripe **Checkout page** itself shows the *Stripe account's* branding — in Phase 1's platform-charge model that's the founder's account, the same for every professional. Per-professional branding on Checkout only becomes possible with Stripe Connect (P2-6). Our own invoice/receipt surfaces can be fully branded now.
- Small enough to be a Week 8 slack candidate alongside P2-5 if demo prep goes fast — a branded invoice is a strong demo moment.

### P2-8: In-person payment in the app — tap to pay
When collecting payment in person, the payment should happen inside the app rather than a link the client deals with later; ideally tap-to-pay on the walker's phone (founder request 2026-07-14).
- Stripe does support this — **Stripe Terminal / Tap to Pay on iPhone & Android** — but only through native mobile SDKs. Phase 1 is a web app, so true tap-to-pay is a mobile-app-sized feature (same bucket as P2-2's GPS tracking).
- Web-feasible interim options for the in-person moment: (a) open the existing Stripe Checkout **embedded inside the app** and hand the phone to the client, or (b) show a **QR code** the client scans to pay on their own phone immediately. Either is a modest extension of the Week 5 checkout flow.
- Founder decisions when picked up: interim option (a)/(b) now vs. waiting for a native app, and whether a card-present reader (Stripe's hardware) is worth it before phones-only tap-to-pay.

### P2-9: Record payments taken outside Stripe (cash, check, Venmo/Zelle)
Real walkers get handed cash and Venmo constantly, but today the only way an invoice becomes `paid` is through Stripe — there is no "mark as paid" for money collected outside the app, so those invoices sit "awaiting payment" forever (or get voided, losing the revenue record).
- Build: a "Record payment — cash / check / other" action on the invoice that creates a transaction with a `payment_method` marker and fires the same `payment_received` event, reusing `PaymentService`'s paid-exactly-once guard so a Stripe payment and a manual one can never double-record.
- ⚠️ Founder decision at pickup: manual mark-paid is trust-based (a mistap says a client paid who didn't) — decide whether it needs an undo window or a confirmation step.
- Strong Week 8 slack candidate: cash is common enough that a demo walker may ask about it unprompted.

### P2-10: No-show & late-cancel fee flow
The data model already knows about this — `AppointmentStatus` includes `no_show` and clients carry `no_show_fee_cents` + `cancellation_window_hours`, and the contract even promises the fee — but the UI offers only Cancel / Mark complete, so the policy is unenforceable in practice.
- Build: a "No-show" outcome on the appointment card that sets the status and (per-visit style) auto-invoices the client's no-show fee; on Cancel, compare against the cancellation window and offer the late-cancel fee when inside it.
- Founder decisions at pickup: is the fee auto-charged or offered-then-confirmed? Does a late cancel still consume a package session (once P2-11-era package tracking exists)?

### P2-11: Full pet profile + vaccination records UI
The schema and API are far richer than the UI shows. Pets support photo, date of birth, color, microchip, medical conditions, and feeding notes; a `vaccination_records` table has full add/list/delete API support (built Week 2) — but the UI exposes only name/breed/weight/vet/behavior, and vaccinations appear nowhere.
- Build: expand the pet card/form to the full field set (photo upload = Supabase Storage, same pattern as signatures), plus a vaccinations list with expiry dates.
- Expiring/expired vaccinations are a natural "Needs your attention" cue (ties into W-4's cue work) — rabies expiry is something real walkers genuinely track for liability.
- Client `general_notes` is in the same boat (schema yes, UI no) — fold it in here.

---

## Test Scripts — Quick Reference

*Every test runs from the command line at the repo root. Add `-BaseUrl "https://petpro-app.onrender.com"` (PowerShell scripts) or `-- --base-url https://petpro-app.onrender.com` (npm test) to run against production instead of localhost.*

| Command | What it proves | Human steps? |
|---|---|---|
| `npm test` | **The everything check** — weeks 1–8 in one command (11 steps): auth, CRM + search, contract sign + immutability, billing + void, scheduling (recurrence, conflicts, complete → auto-invoice, per-day boarding, profile service mapping), event log, messaging (idempotent sends + draft sync), notifications (queued emails + reminder lifecycle), owner portal (magic-link session, remote sign + email, Stripe checkout, messaging, cross-role 403s). Run this before/after any deploy. | None — fully automated |
| `.\scripts\week1-test.ps1` | Signup → login → authenticated session | None |
| `.\scripts\week2-test.ps1` | Clients + pets CRUD, search across both | None |
| `.\scripts\week3-test.ps1` | Contract generate → sign → immutability lock | None |
| `.\scripts\week4-test.ps1` | UI is served + API smoke test | None |
| `.\scripts\week5-test.ps1` | Full Stripe payment loop, paid exactly once (8/8 green against Render 2026-07-16 — webhook recorded the payment with no polling running) | **Yes** — pays with test card `4242…` in the browser. Declined-card run (`4000 0000 0000 0002`) still outstanding — see Q-4 |
| `.\scripts\week6-test.ps1` | Scheduling loop: service → recurring series → conflict 409 → complete → auto-invoice → series cancel | None |
| `.\scripts\week7-test.ps1` | Messaging idempotency + draft sync, contract emails queued, signed-contract document, reminder lifecycle, live email-key probe | None (step 7 sends a real email once `RESEND_API_KEY` is set) |

---

## Running Notes / Blockers Log

*Use this space for anything that doesn't fit neatly into a single week's checklist — a decision that needs revisiting, a recurring issue, a scope question.*

- 2026-07-17 (later): **Founder's "Pet Services Agreement" integrated; everything deployed.** The founder added a Pet Services Agreement .docx to `templates/contracts/`; converted to a second packaged template with the services table (multi-service contracts now generate under it — verified with two services, zero unresolved placeholders) and deployed with all pending commits at founder direction. Provenance flagged in the W-9 item above: the source is a generic template with an AI-chatbot preamble (stripped), **not** counsel language — the recommendation to route it through the existing counsel packet stands. One conversion bug caught and fixed before commit: the template header comment originally used literal merge-field tokens, which generation substitutes even inside comments — a second services table (with client data) landed inside the frozen document's comment block; the comment now names fields without braces, regenerated clean. Also fixed alongside: contract rows titled themselves "Dog Walking Service Agreement" unconditionally; they now use the joined template name. *Observation, not fixed: voiding a draft contract leaves its `draft` services on the client profile (harmless — drafts can't be booked — but they accumulate; pre-existing W-7 behavior, worth a Phase 2 cleanup).* 
- 2026-07-17: **W-11, W-12, W-13 built and browser-verified — the W-5…W-13 build side is complete; W-9 (counsel) is the only open build item.** All three are UI-only (`public/app.js` + `styles.css`, no backend/schema/migration changes): phone formatting per the locked decision (US 10-digit formats on blur + save, international/extensions untouched, no backfill), profile photo + business logo placeholders on the Profile tab (no dead upload buttons — captions say uploads arrive with P2-7), and the full service lifecycle on client detail (Pause/Resume, End behind a confirm that counts still-booked walks, inline Set/Change/Clear end date). Verified in-browser via the real flow (signup → client → pet → contract → sign → service controls) plus `npm test` 11/11 and `week6-test.ps1` 8/8 locally. Mid-session the founder checked off the Week 7 close-out (week7 test + signed-contract email + itchytail.com verified at Resend) — that ROADMAP edit merged cleanly with this session's, no stale-copy incident. **Next session: the weeks 3/5/6 QA re-run against the contract→services flow, then deploy — after that the demo waits only on counsel.**
- 2026-07-16 (QA session, later): **Q-1 fixed; live payment loop closed by the founder's test-card payment — webhook proved itself unassisted.** The founder paid the Checkout that the stopped QA script had opened. Because nothing was polling by then, the webhook was the *only* thing that could have recorded it — and it did: invoice `paid`, one succeeded transaction stamped with `stripe_event_id`, one `payment_received` with `via: webhook`, and three sync replays afterwards still left exactly one transaction. This is a stronger result than a normal `week5-test.ps1` run, where the sync fallback races the webhook and can mask a broken one (exactly what happened in Week 5's first misconfigured-webhook incident). Week 5 is now 8/8 green. Q-1 (the `‹ All clients` → `#/today` back link) is fixed and verified in a browser, and the rest of `app.js` swept for the same stale-alias pattern — clean. **Still open, both needing the founder:** Q-2 (Supabase URL allowlist — unverifiable without an inbox, breaks reset + magic links in production if unset) and Q-4 (declined-card `4000 0000 0000 0002` error state). **The Q-1 fix is uncommitted** — it reaches the demo only after a commit + push.
- 2026-07-16 (QA session): **Formal Week 8 QA pass run — the build holds up; one real bug (Q-1).** Everything automated is green against live Render: `npm test` 11/11, and weeks 1/2/3/4/6/7 scripts all pass. Full UI click-through in both themes found exactly one defect — Q-1, the "‹ All clients" back link pointing at `#/today` (`app.js:708`), which is the *same* stale-alias residue as this morning's "Clients tab not clickable" report; worth a quick grep for other Week-4-era `#/clients` assumptions when fixing. Error states all behave (double-submit guard verified by triple-clicking: exactly one client created; breached-password rejection confirmed live via HIBP; portal correctly refuses professional emails and doesn't leak account existence). **Three things QA could not close, all needing the founder:** the test-card payment legs (Q-3 — designated the human step by this roadmap, so it was left rather than faked), the Supabase dashboard settings (Q-2 — the allowlist can't be verified without an inbox, and reset/magic links break in production without it), and Resend domain verification (emails currently reach only the Resend account owner's inbox — `npm test` step 10 notes 0 sent/0 refused for this reason). Also noticed, not acted on: a stray `.claude/settings.local - Copy.json` (untracked, classic OneDrive conflict-copy naming) and two stray pasted shell-command lines sitting inside the Week 5 section of this file (~line 184) — both smell like the OneDrive/editor artifacts already logged here; left alone for the founder to remove. **Side note worth knowing:** mid-session, `Get-ChildItem`/`ls` began reporting the whole repo — and the whole Desktop — as empty while `dir` read it fine; OneDrive had touched the folder minutes earlier. Nothing was lost, but if a tool ever claims this repo is empty, re-check with `dir` before believing it.
- 2026-07-16 (later): **"Clients tab not clickable" (founder QA finding) — fixed and live.** The tab was never broken: `#/clients` had been aliased to the Today screen since Week 4, which became indistinguishable from a dead button once Today led with the schedule agenda. Clients now has its own screen (full list grouped Active/Pending/Inactive, search incl. pet names, + New client, correct tab highlight). Verified in-browser and deployed. Day ends here — next session picks up any further founder QA findings, then the formal QA pass once the build tasks are signed off.
- 2026-07-16: **Founder's portal test failed with "already a user with that email" — fixed.** Root causes, all shipped same day: (1) requesting a portal magic link creates a Supabase auth user immediately, but the link going unclicked (or the send silently failing) left it *orphaned* — any later signup with that email then hit Supabase's raw "already been registered" error; signup now adopts such orphans and proceeds. (2) The portal login swallowed every Supabase send error and always claimed "link on its way" — real failures (notably Supabase's ~2-emails/hour built-in mailer rate limit) now surface as readable errors. (3) An email that's already a professional login sent a link that dead-ended in a 403 *after* clicking — the portal now refuses those up front and suggests a "+" alias. One email = one account (accounts.email is unique) stands as the Phase 1 rule; dual-role accounts would be a deliberate Phase 2+ change. All 11 `npm test` steps still green after the fixes.

- 2026-07-15 (Week 8 build session): **Week 8 build tasks complete, stopped before QA at founder direction** — the QA pass, bug fixes, final deploy, and known-issues note wait for founder sign-off on the built tasks. Shipped as two commits: (1) the auth pass (password policy incl. live HaveIBeenPwned check, forgot/change password) + client/pet edit UI (W-3) + Today agenda & unpaid-invoice cues (W-4); (2) the owner portal (magic-link login, remote signing, Stripe checkout, messaging) + `npm test` step 11. No new migrations — the portal runs entirely on seams laid in Weeks 1–7 (`clients.owner_account_id`, the `owner` account type, channel-agnostic notifications). All 11 `npm test` steps green locally AND against the live Render deployment (pushed + auto-deployed same day, consistent with every prior week — the "deploy final version" task stays open for the post-QA final cut); every flow also driven in-browser. **Founder's turn:** the two Supabase dashboard settings (URL allowlist + min password length 12 — reset emails and production magic links depend on the allowlist), then sign off on the build tasks so QA can start. Week 7's founder checkboxes are also still open.

- 2026-07-15 (Week 7 build session): **Week 7 Claude Code side complete** — messaging (REST + Supabase Realtime + offline draft sync + Messages tab), channel-agnostic notifications (contract ready/signed, payment receipt + you-got-paid, 24h appointment reminders), and W-1's print/download on signed contracts. Migration 015 applied to live Supabase (RLS + realtime publication for messages). All 10 `npm test` steps + all 7 `week7-test.ps1` steps green locally; full messaging flow driven in-browser (realtime delivery confirmed live). **Deployed to Render same day — all 10 `npm test` steps green against https://petpro-app.onrender.com.** **Two decisions made at build time:** (1) signed-contract copy is print-styled HTML, not server-side PDF — browser Print → Save-as-PDF covers the PDF need with zero heavy dependencies; (2) payment emails go to both sides (client receipt + professional "you got paid"). **Founder's turn:** create the Resend account, put `RESEND_API_KEY` in `.env` + Render, then run `week7-test.ps1` — everything email-related is already queued and sends the moment the key lands.

- 2026-07-15 (later): **`PHASE_2_ROADMAP.md` created** at founder direction — Phase 2 organized into workstreams: 0 (Phase 1 code cleanup — baseline verified same day: typecheck clean, 0 audit vulnerabilities, all commits pushed), Q (QA checkpoints + two scheduled security reviews — audit found no RLS policies and no helmet/rate-limiting, both scheduled into review #1), M (mobile-ready, PWA-first), U (UI/UX polish + modernization), X (multi-profession expansion for trainers/groomers/sitters/boarding), F (the P2-1…P2-11 backlog, tiered). Living document; Weeks 7–8 here still finish first.
- 2026-07-15 (post-close): **Typical-user walkthrough of the live UI** (Claude, acting as a brand-new dog walker, drove the full flow in-browser: signup → new client → pet → service → contract generate/sign → recurring booking → mark complete → auto-invoice — everything worked, no bugs found). Findings are UX/coverage gaps, labeled **W-1…W-4** where scheduled: **W-1** no way to print/hand the client a signed contract → added to Week 7 (pairs with the contract-signed email). **W-2** no forgot-password/change-password anywhere → added to Week 8 (pairs with password hardening). **W-3** clients and pets can't be *edited* through the UI at all (API PATCH exists; UI never calls it except the status flip) → added to Week 8. **W-4** Today screen shows no walks and "Needs your attention" ignores unpaid invoices → added to Week 8. Bigger items went to the backlog as **P2-9** (record cash/Venmo payments — no non-Stripe mark-as-paid exists), **P2-10** (no-show/late-cancel fees — `no_show` status and per-client fee fields exist but are unreachable from the UI), and **P2-11** (full pet profile + vaccination records — Week 2's vaccination API has zero UI). A recurring theme worth knowing: the schema/API is consistently ahead of the UI, so most of these are thin UI slices, not backend work.
- 2026-07-15 (end of day): **Week 6 closed by founder.** All build tasks and founder review done; the only carry-over is the `[d]` invoice-timing decision for weekly/monthly cadences (non-blocking — the completion hook exists, per-visit/per-day already auto-invoice). Next session starts Week 7 — Messaging + Notifications: the founder's first task there is creating a Resend or SendGrid account and putting the API key in `.env`/Render, so that can happen in parallel before the build session.
- 2026-07-13: `files.zip` (the original scaffold from a prior session) is gone. Full scaffold rebuilt from `PHASE_1_SUMMARY.md` + `SPEC.md`. `PHASE_1_SUMMARY.md` still describes the old plan (custom JWT, S3, Heroku) — the code follows `CLAUDE.md`'s locked stack instead (Supabase Auth, Supabase Storage, Render).
- 2026-07-13: `DATABASE_URL` received; migrations applied and full auth flow verified locally. Remaining Week 1 blocker: Render deploy (founder: create Render account, connect the GitHub repo, add the three Supabase env vars in Render's dashboard — `render.yaml` handles the rest).
- 2026-07-14: Week 5 build complete and deployed. Live payment verification blocked by a malformed `STRIPE_SECRET_KEY` in Render (bad paste — see Week 5 founder note). This is the second pasted-key failure (Week 2's Supabase key was the first): after fixing a key in Render, the quickest sanity check is re-running the relevant week's test script.
- 2026-07-14 (later session): Stripe key fixed in both Render and local `.env`; verified by a live probe, then the full payment loop passed all 8 steps of `week5-test.ps1` against Render (founder paid with the test card). Later that day the webhook was set up and verified end to end (after one misconfiguration — see the Week 5 founder note): a live test payment landed via the webhook itself, `stripe_event_id` recorded. Week 5 is functionally complete; only the founder's final "confirm status" checkbox remains.
- 2026-07-14: Week 5 confirmed done by founder. Alongside it, 3 more feature requests logged (own payment processor, branded invoices, in-app tap-to-pay) — captured as P2-6…P2-8 — plus a pre-demo QA pass added to Week 8. ⚠️ P2-6 as stated ("own payment processor") conflicts with the `CLAUDE.md` hard constraint **Stripe only**; the recommended path (Stripe Connect) satisfies the request without breaking it — founder decision parked in P2-6.
- 2026-07-15 (later): Founder logged 3 scheduling updates (type-dependent billing options incl. per-day, profile-mapped service types, # of sessions field) — built same day, see the Week 6 addendum. Migration 014 applied to live Supabase. A "Test Scripts — Quick Reference" section was also added above so every test command is findable in one place. Open question resolved same day by founder: boarding does NOT block other bookings — boarders can walk dogs mid-stay and take multiple concurrent boarders; conflict detection now exempts boarding both directions.
- 2026-07-15: Added `npm test` — a one-command, cross-platform E2E test (`scripts/test-e2e.ts`, plain Node/tsx, no browser or Stripe step) covering weeks 1–6: auth, CRM + search, contract sign + immutability, billing + void, scheduling recurrence/conflicts/complete → auto-invoice, event log. 7 steps, all green locally and against Render. The weekly `.ps1` scripts remain the founder-facing walkthroughs; `npm test` is the quick regression check before any deploy.
- 2026-07-15: Week 6 build complete and deployed — all 8 steps of `week6-test.ps1` green locally AND against the live Render deployment; full UI flow verified in-browser. Migration 013 applied to live Supabase. Two decisions parked: (1) invoice timing for weekly/monthly/package cadences (founder task above — per-visit auto-invoicing already works); (2) `availability_blocks` (vacation/personal time) has schema but no UI — conflict detection currently checks appointments only. Founder walkthrough is the only thing left for Week 6.
- 2026-07-13: Founder logged 4 feature requests (ratings, walk-report auto-text, photos on reports, calendar sync). Captured as Phase 2 Backlog P2-1…P2-4 above; two small seam tasks added to Weeks 6 and 7 so they bolt on later without rework. Open founder decision parked in P2-2: SMS provider (Twilio?) vs. email/in-app first, and the scan-in mechanism.

---

## Status at a Glance

*Update this table at the end of each week — a quick way for either of you to see overall health without reading every checkbox.*

| Week | Claude Code Status | Founder Status |
|---|---|---|
| 1 — Foundation | ✅ Done | ✅ Done |
| 2 — CRM | ✅ Done | ✅ Done |
| 3 — Contracts (in-person) | ✅ Done | ✅ Done |
| 4 — Contracts Hardening + UI | ✅ Done | ✅ Done |
| 5 — Payments | ✅ Done (full loop verified live) | ✅ Done |
| 6 — Scheduling | ✅ Done (verified live on Render) | ✅ Done |
| 7 — Messaging | ✅ Done (deployed, verified live on Render) | ✅ Done 2026-07-17 (week7 test run, signed-contract email confirmed, itchytail.com verified at Resend) |
| 8 — Owner Portal + Demo | ✅ QA pass closed 2026-07-16: weeks 1–7 + `npm test` all green, payment loop verified live via webhook, Q-1 fixed + deployed, Q-2/Q-4 closed by founder. **Weeks 3/5/6 re-run after W-5…W-8** | ✅ Supabase settings applied, declined card run |
| Phase 1.5 — W-5…W-13 | ✅ **Complete and deployed 2026-07-17**: W-5…W-8 + migration 016, W-11/W-12/W-13, and the founder's Pet Services Agreement packaged as a multi-service template. **Post-deploy QA re-run: e2e 11/11 + week3 8/8 + week6 8/8 all green against production.** Week 5's card-payment leg is the one remaining QA step (founder) | ⏳ **CA v2 + addendum still with counsel; Pet Services Agreement recommended to join that review. Week 5 card run + demo prep remain** |
