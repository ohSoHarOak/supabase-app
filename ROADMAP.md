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
- [ ] Full QA pass before the demo (founder request 2026-07-14): run every weekly test script (weeks 1–7) against production, click through every UI flow start to finish (light + dark, laptop-sized window), exercise error states (bad input, declined test card `4000 0000 0000 0002`, double-submits), and log anything broken as `[!]` items to fix before demo day
- [ ] Fix bugs surfaced during founder + tester testing
- [ ] Deploy final version to Render production tier
- [ ] Prepare a short "known issues / what's next for Phase 2" note

### 🧑 Founder Tasks
- [ ] Supabase dashboard settings for the Week 8 auth pass (5 minutes, needed before reset emails and the owner portal work in production):
  1. **Authentication → URL Configuration**: set Site URL to `https://petpro-app.onrender.com` and add `https://petpro-app.onrender.com/**` (and `http://localhost:3000/**` for dev) to Redirect URLs — password-reset and magic-link emails refuse to link anywhere not on this list.
  2. **Authentication → Providers → Email**: set Minimum password length to **12** so Supabase's own setting matches the API's policy.
- [ ] Sign off on the Week 8 build tasks above (all built and verified 2026-07-15) — QA pass, bug fixes, and final deploy start after this sign-off.
- [ ] Try the owner portal yourself first: as a professional, add a client whose email is YOUR real email, then visit `/portal`, request a login link, and walk the loop (sign, pay with the test card, message). Note: until the Resend domain is verified only Supabase's own auth emails deliver reliably — the magic link comes from Supabase, so it works regardless.
- [ ] Also still open from Week 7: run `week7-test.ps1`, trigger a contract-signed email, and confirm Week 7 status — plus verify itchytail.com at resend.com/domains before any client-facing email matters for the demo.
- [ ] Recruit a friend or family member to test the owner portal cold, without your help
- [ ] Collect their feedback and any points of confusion
- [ ] Run the full end-to-end integration test yourself
- [ ] Confirm the production deployment is accessible and stable
- [ ] Prepare and deliver the 8-week demo

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
| `.\scripts\week5-test.ps1` | Full Stripe payment loop, paid exactly once | **Yes** — pays with test card `4242…` in the browser |
| `.\scripts\week6-test.ps1` | Scheduling loop: service → recurring series → conflict 409 → complete → auto-invoice → series cancel | None |
| `.\scripts\week7-test.ps1` | Messaging idempotency + draft sync, contract emails queued, signed-contract document, reminder lifecycle, live email-key probe | None (step 7 sends a real email once `RESEND_API_KEY` is set) |

---

## Running Notes / Blockers Log

*Use this space for anything that doesn't fit neatly into a single week's checklist — a decision that needs revisiting, a recurring issue, a scope question.*

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
| 7 — Messaging | ✅ Done (deployed, verified live on Render) | 🔄 Email key + walkthrough pending |
| 8 — Owner Portal + Demo | 🔄 Build tasks done (auth pass, edit UI, Today cues, owner portal, 11-step test) — QA/deploy await founder sign-off | 🔄 Supabase settings + sign-off pending |
