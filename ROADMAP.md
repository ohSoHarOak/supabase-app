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

### 🧑 Founder Tasks
- [ ] Run test script — schedule a recurring weekly walk
- [ ] Mark one instance complete, confirm an invoice generates automatically
- [ ] Note anything about the scheduling logic that doesn't match how you'd actually run walks
- [ ] Decide: for weekly/monthly-billed services, when should the invoice generate? (End of the billing week/month, or with the first completed walk of the period?) Per-visit auto-invoicing works today; this decision unlocks the other cadences.
- [ ] Confirm status: mark this week done, or note what broke

---

## Week 7 — Messaging + Notifications

### 🤖 Claude Code Tasks
- [ ] Build message threads + messages (REST first)
- [ ] Wire real-time delivery via Supabase Realtime
- [ ] Build offline draft sync endpoint
- [ ] Build email notifications for: contract ready, contract signed, payment received, appointment reminder
  - Founder requirement (2026-07-13): the **contract signed** email goes to the client **with the signed contract included**. Decision to make at build time: attach as PDF (needs an HTML→PDF step) vs. a secure view link to the signed copy — PDF preferred, fall back to link if PDF generation gets heavy.
- [ ] Keep notification sending channel-agnostic (template + recipient + channel), with email as the only channel for now — so SMS walk reports (backlog P2-2) plug in later without rework
- [ ] Extend the UI: simple message thread view
- [ ] Write manual test script (send message → confirm real-time delivery → trigger event → confirm email)

### 🧑 Founder Tasks
- [ ] Create Resend or SendGrid account, note API key
- [ ] Provide email API key to Claude Code via `.env` (not chat)
- [ ] Run test script — send a message, confirm it arrives in real time
- [ ] Trigger a contract signing, confirm the email notification arrives
- [ ] Confirm status: mark this week done, or note what broke

---

## Week 8 — Owner Portal + End-to-End Testing + Demo Prep

### 🤖 Claude Code Tasks
- [ ] Harden password requirements for security compliance (founder request 2026-07-13): raise minimum length to 12, require mixed character classes, reject common/breached passwords, matching validation in both the signup API and Supabase Auth settings — must land before the demo creates real accounts
- [ ] Build minimal owner portal: magic-link login, view schedule, view/sign contract, view/pay invoice, message the professional
- [ ] Write full integration test script covering the entire loop: signup → client → pet → contract → sign → schedule → complete walk → invoice → pay → notify
  - Head start (2026-07-15): `npm test` (`scripts/test-e2e.ts`) already covers signup → client → pet → contract → sign → schedule → complete → auto-invoice in one command, local or `--base-url` Render — verified green against both. Week 8 extends it with the owner-portal, pay, and notify legs.
- [ ] Full QA pass before the demo (founder request 2026-07-14): run every weekly test script (weeks 1–7) against production, click through every UI flow start to finish (light + dark, laptop-sized window), exercise error states (bad input, declined test card `4000 0000 0000 0002`, double-submits), and log anything broken as `[!]` items to fix before demo day
- [ ] Fix bugs surfaced during founder + tester testing
- [ ] Deploy final version to Render production tier
- [ ] Prepare a short "known issues / what's next for Phase 2" note

### 🧑 Founder Tasks
- [ ] Recruit a friend or family member to test the owner portal cold, without your help
- [ ] Collect their feedback and any points of confusion
- [ ] Run the full end-to-end integration test yourself
- [ ] Confirm the production deployment is accessible and stable
- [ ] Prepare and deliver the 8-week demo

---

## Phase 2 Backlog — Captured, Not Scheduled

*Founder feature requests logged 2026-07-13 (P2-1…P2-5) and 2026-07-14 (P2-6…P2-8). These are out of scope for the 8-week Phase 1 build (the Week 8 demo doesn't depend on them), but earlier weeks lay seams for them so nothing has to be rebuilt. Do not start these until Phase 1 is done and the founder pulls them in.*

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

---

## Running Notes / Blockers Log

*Use this space for anything that doesn't fit neatly into a single week's checklist — a decision that needs revisiting, a recurring issue, a scope question.*

- 2026-07-13: `files.zip` (the original scaffold from a prior session) is gone. Full scaffold rebuilt from `PHASE_1_SUMMARY.md` + `SPEC.md`. `PHASE_1_SUMMARY.md` still describes the old plan (custom JWT, S3, Heroku) — the code follows `CLAUDE.md`'s locked stack instead (Supabase Auth, Supabase Storage, Render).
- 2026-07-13: `DATABASE_URL` received; migrations applied and full auth flow verified locally. Remaining Week 1 blocker: Render deploy (founder: create Render account, connect the GitHub repo, add the three Supabase env vars in Render's dashboard — `render.yaml` handles the rest).
- 2026-07-14: Week 5 build complete and deployed. Live payment verification blocked by a malformed `STRIPE_SECRET_KEY` in Render (bad paste — see Week 5 founder note). This is the second pasted-key failure (Week 2's Supabase key was the first): after fixing a key in Render, the quickest sanity check is re-running the relevant week's test script.
- 2026-07-14 (later session): Stripe key fixed in both Render and local `.env`; verified by a live probe, then the full payment loop passed all 8 steps of `week5-test.ps1` against Render (founder paid with the test card). Later that day the webhook was set up and verified end to end (after one misconfiguration — see the Week 5 founder note): a live test payment landed via the webhook itself, `stripe_event_id` recorded. Week 5 is functionally complete; only the founder's final "confirm status" checkbox remains.
- 2026-07-14: Week 5 confirmed done by founder. Alongside it, 3 more feature requests logged (own payment processor, branded invoices, in-app tap-to-pay) — captured as P2-6…P2-8 — plus a pre-demo QA pass added to Week 8. ⚠️ P2-6 as stated ("own payment processor") conflicts with the `CLAUDE.md` hard constraint **Stripe only**; the recommended path (Stripe Connect) satisfies the request without breaking it — founder decision parked in P2-6.
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
| 6 — Scheduling | ✅ Done (verified live on Render) | Not started |
| 7 — Messaging | Not started | Not started |
| 8 — Owner Portal + Demo | Not started | Not started |
