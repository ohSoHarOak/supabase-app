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
- [ ] Harden in-person signing flow: edge cases (missing signature, retry on failure, clear error states)
- [ ] Build a minimal web UI for the professional side: login, client list, add client/pet, generate + sign contract
- [ ] Wire the UI to the Week 1–3 API endpoints (no new backend logic, just a usable front door)
- [ ] Basic responsive styling — doesn't need to be polished, needs to not look broken on a laptop screen during a demo
- [ ] Write a manual test script covering the UI flow end-to-end

### 🧑 Founder Tasks
- [ ] Review the minimal UI — does it feel like something you could put in front of a real dog walker?
- [ ] Test the full flow through the UI yourself: add a client, generate a contract, sign it in-person
- [ ] Note anything confusing or missing before it becomes a demo-day surprise
- [ ] Confirm status: mark this week done, or note what broke

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

### 🤖 Claude Code Tasks
- [ ] Set up Stripe Connect integration (test mode)
- [ ] Build `stripe_products` for per-visit billing first (simplest cadence)
- [ ] Build invoice generation tied to `billing_cadence`
- [ ] Build Stripe webhook handler with idempotency via `stripe_event_id`
- [ ] Fire `payment_received` event on successful payment
- [ ] Extend the Week 4 UI: invoice view + Stripe payment screen
- [ ] Write manual test script (generate invoice → pay with test card → confirm event log)

### 🧑 Founder Tasks
- [ ] Create Stripe account, enable test mode, note API keys
- [ ] Provide Stripe test keys to Claude Code via `.env` (not chat)
- [ ] Run test script — generate an invoice, pay with a Stripe test card
- [ ] Confirm the payment is recorded and shows in the event log
- [ ] Confirm status: mark this week done, or note what broke

---

## Week 6 — Scheduling

### 🤖 Claude Code Tasks
- [ ] Build `services` CRUD (the walk/training product a client is buying)
- [ ] Build `appointments` CRUD with weekly recurrence
- [ ] Build conflict detection (prevent double-booking a time slot)
- [ ] Wire "mark appointment complete" → fires `walk_completed` event → triggers invoice
- [ ] Capture structured completion data on "mark complete" — actual start/end time, walk notes, good-dog and got-a-treat flags — stored on the appointment and included in the `walk_completed` event payload (seam for the Phase 2 walk-report auto-message; see backlog item P2-2)
- [ ] Extend the UI: calendar/list view of appointments, "mark complete" button
- [ ] Write manual test script (schedule recurring walk → complete → confirm auto-invoice)

### 🧑 Founder Tasks
- [ ] Run test script — schedule a recurring weekly walk
- [ ] Mark one instance complete, confirm an invoice generates automatically
- [ ] Note anything about the scheduling logic that doesn't match how you'd actually run walks
- [ ] Confirm status: mark this week done, or note what broke

---

## Week 7 — Messaging + Notifications

### 🤖 Claude Code Tasks
- [ ] Build message threads + messages (REST first)
- [ ] Wire real-time delivery via Supabase Realtime
- [ ] Build offline draft sync endpoint
- [ ] Build email notifications for: contract ready, contract signed, payment received, appointment reminder
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
- [ ] Build minimal owner portal: magic-link login, view schedule, view/sign contract, view/pay invoice, message the professional
- [ ] Write full integration test script covering the entire loop: signup → client → pet → contract → sign → schedule → complete walk → invoice → pay → notify
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

*Founder feature requests logged 2026-07-13. These are out of scope for the 8-week Phase 1 build (the Week 8 demo doesn't depend on them), but Weeks 6–7 lay seams for them so nothing has to be rebuilt. Do not start these until Phase 1 is done and the founder pulls them in.*

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

---

## Running Notes / Blockers Log

*Use this space for anything that doesn't fit neatly into a single week's checklist — a decision that needs revisiting, a recurring issue, a scope question.*

- 2026-07-13: `files.zip` (the original scaffold from a prior session) is gone. Full scaffold rebuilt from `PHASE_1_SUMMARY.md` + `SPEC.md`. `PHASE_1_SUMMARY.md` still describes the old plan (custom JWT, S3, Heroku) — the code follows `CLAUDE.md`'s locked stack instead (Supabase Auth, Supabase Storage, Render).
- 2026-07-13: `DATABASE_URL` received; migrations applied and full auth flow verified locally. Remaining Week 1 blocker: Render deploy (founder: create Render account, connect the GitHub repo, add the three Supabase env vars in Render's dashboard — `render.yaml` handles the rest).
- 2026-07-13: Founder logged 4 feature requests (ratings, walk-report auto-text, photos on reports, calendar sync). Captured as Phase 2 Backlog P2-1…P2-4 above; two small seam tasks added to Weeks 6 and 7 so they bolt on later without rework. Open founder decision parked in P2-2: SMS provider (Twilio?) vs. email/in-app first, and the scan-in mechanism.

---

## Status at a Glance

*Update this table at the end of each week — a quick way for either of you to see overall health without reading every checkbox.*

| Week | Claude Code Status | Founder Status |
|---|---|---|
| 1 — Foundation | ✅ Done | ✅ Done |
| 2 — CRM | ✅ Done | ✅ Done |
| 3 — Contracts (in-person) | ✅ Done | ✅ Done |
| 4 — Contracts Hardening + UI | Not started | Not started |
| 5 — Payments | Not started | Not started |
| 6 — Scheduling | Not started | Not started |
| 7 — Messaging | Not started | Not started |
| 8 — Owner Portal + Demo | Not started | Not started |
