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
- [d] Deploy service to Render, confirm publicly reachable
  - Waiting on founder: create Render account + connect repo. `render.yaml` blueprint is ready in the repo root.
- [x] Write a manual test script for founder to run (signup → login → get session)
  - `scripts/week1-test.ps1` — run it in PowerShell after migrations + deploy.

### 🧑 Founder Tasks
- [x] Create Supabase account, create project, note connection credentials
- [ ] Create Render account, connect GitHub repo
- [ ] Add environment variables to Render (never commit secrets to git)
- [x] Provide Claude Code with Supabase credentials via `.env` (not chat)
- [ ] Run Week 1 test script — sign up and log in through the live API
- [ ] Confirm status: mark this week done, or note what broke

---

## Week 2 — Client & Pet Management (CRM)

### 🤖 Claude Code Tasks
- [ ] Build `ClientService` — CRUD for clients
- [ ] Build Pet CRUD — profiles, vaccination records, medical notes
- [ ] Build search/filter across client + pet fields
- [ ] Add input validation (required fields, email/phone format)
- [ ] Write manual test script (add clients/pets, search, confirm results)

### 🧑 Founder Tasks
- [ ] Run test script — add 3 clients with 2 pets each
- [ ] Search by pet name and owner email, confirm results are accurate
- [ ] Note any client/pet fields that don't match how real walkers actually track this info
- [ ] Confirm status: mark this week done, or note what broke

---

## Week 3 — Contracts Part 1: Generation & In-Person Signing

### 🤖 Claude Code Tasks
- [ ] Build contract template storage + variable substitution
- [ ] Wire `ContractService.generateContract()` to real client/pet/service data
- [ ] Build in-person signing flow — capture signature image, lock the contract
- [ ] Confirm the immutability trigger actually blocks edits to signed contracts
- [ ] Write manual test script (generate → sign → attempt edit → confirm blocked)

### 🧑 Founder Tasks
- [ ] Draft 1–2 real contract templates (or provide existing ones) — include the notice that terms should be reviewed by your own legal counsel
- [ ] Run test script — generate a contract, sign it in-person
- [ ] Try editing the client's info afterward, confirm the signed contract doesn't change
- [ ] Confirm status: mark this week done, or note what broke

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

## Running Notes / Blockers Log

*Use this space for anything that doesn't fit neatly into a single week's checklist — a decision that needs revisiting, a recurring issue, a scope question.*

- 2026-07-13: `files.zip` (the original scaffold from a prior session) is gone. Full scaffold rebuilt from `PHASE_1_SUMMARY.md` + `SPEC.md`. `PHASE_1_SUMMARY.md` still describes the old plan (custom JWT, S3, Heroku) — the code follows `CLAUDE.md`'s locked stack instead (Supabase Auth, Supabase Storage, Render).
- 2026-07-13: `DATABASE_URL` received; migrations applied and full auth flow verified locally. Remaining Week 1 blocker: Render deploy (founder: create Render account, connect the GitHub repo, add the three Supabase env vars in Render's dashboard — `render.yaml` handles the rest).

---

## Status at a Glance

*Update this table at the end of each week — a quick way for either of you to see overall health without reading every checkbox.*

| Week | Claude Code Status | Founder Status |
|---|---|---|
| 1 — Foundation | Done except Render deploy (waiting on founder's Render account) | In progress |
| 2 — CRM | Not started | Not started |
| 3 — Contracts (in-person) | Not started | Not started |
| 4 — Contracts Hardening + UI | Not started | Not started |
| 5 — Payments | Not started | Not started |
| 6 — Scheduling | Not started | Not started |
| 7 — Messaging | Not started | Not started |
| 8 — Owner Portal + Demo | Not started | Not started |
