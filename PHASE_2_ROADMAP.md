# PetPro Connect — Phase 2 Roadmap

*Created 2026-07-15 at founder direction. This is a **living document** — we add to it as development continues, using the same status legend and update habits as `ROADMAP.md`. The Phase 1 tracker (`ROADMAP.md`) remains the source of truth until the Week 8 demo ships; **nothing in this file starts before then** unless the founder explicitly pulls an item forward.*

---

## How This Works

Phase 2 is organized into **workstreams** instead of fixed weeks, because scope will keep growing. Each workstream ends with a **QA checkpoint** and the phase has scheduled **security reviews** (Workstream Q) — a workstream isn't done until its gate passes. A proposed sequencing order is at the bottom; the founder re-prioritizes as we learn.

**Status legend** (same as `ROADMAP.md`): `[ ]` not started · `[x]` done · `[~]` in progress · `[!]` issue · `[d]` delayed — with a one-line note under any `[!]`/`[d]`.

**Ground rules carried over — these do not expire with Phase 1:**
- All `CLAUDE.md` hard constraints still apply: modular monolith, REST only, Stripe only, eSign via `IeSignProvider`, append-only events, signed-contract immutability, types live in `src/types/index.ts`.
- The four marketplace seams stay intact: typed accounts, event log, provider adapters, generic billing. Workstream X exists to *exercise* those seams, not bypass them.
- One feature fully working beats several half-done. Commit after each working feature.

---

## Workstream 0 — Phase 1 Closeout & Code Cleanup

*Goal: start Phase 2 from a verifiably clean base. Baseline measured 2026-07-15: working tree clean, all Phase 1 work committed & pushed, `npm run typecheck` passes with zero errors, `npm audit` reports zero vulnerabilities.*

- [ ] Post-demo cleanup pass over `src/` and `public/`: remove dead code and unused exports, resolve stray TODOs, confirm every service follows the `AccountService`/`ContractService` pattern, consistent `ServiceError` usage across routes
- [ ] Repo hygiene: `PHASE_1_SUMMARY.md` still describes the abandoned stack (custom JWT, S3, Heroku) — archive or rewrite it so no doc contradicts the as-built system; refresh `ARCHITECTURE.md` to match what actually shipped
- [ ] Decide and apply dependency upgrades (deliberate, one at a time, `npm test` green after each): Express 4→5, Zod 3→4, TypeScript 5→7, `@types/node` 20→current. None are urgent (zero vulnerabilities today) — this is about not accumulating a scary jump later
- [ ] Set up CI (GitHub Actions): `typecheck` + `npm test` on every push, so a broken commit can't sit unnoticed
  - ⚠️ Depends on the test-data decision in the Founder Decisions Queue — `npm test` currently creates real rows in the live Supabase project
- [ ] Establish a test-data cleanup routine: Phase 1 test runs have been seeding accounts/clients into the production database; decide on a purge script or a separate test project
- [ ] **QA checkpoint 0:** full `npm test` + all weekly scripts green against Render after the cleanup lands — proves the cleanup changed structure, not behavior

## Workstream Q — QA Checkpoints & Security Reviews (recurring, gates the other workstreams)

*QA checkpoints are listed inside each workstream. The security reviews below are their own scheduled events, not afterthoughts. Findings from either get logged as `[!]` items in the owning workstream.*

- [ ] **Security review #1 — before any Phase 2 feature work (pairs with Workstream 0):**
  - Tenant-isolation audit: the server talks to Supabase with the **service key** and there are **no Postgres RLS policies** (verified 2026-07-15) — every bit of data isolation lives in app code scoping queries by `professional_account_id`. Audit every endpoint for a missing scope, and decide whether to add RLS as a second net (recommended once the owner portal adds a second account type reading the same tables)
  - Add the missing HTTP hardening layer (verified absent 2026-07-15): `helmet` security headers, rate limiting on auth + webhook endpoints, an explicit CORS policy
  - Secrets review: confirm nothing sensitive is committed, Render env vars are least-privilege, and document a key-rotation drill (we've had two bad-paste incidents — a written 5-minute rotation procedure is cheap insurance)
  - Input-validation sweep: confirm every route body goes through Zod, including query params
- [ ] Add **cross-tenant regression tests** to `npm test`: professional B attempting to read/modify professional A's clients, contracts, invoices, appointments must get 404/403 — this makes the tenant audit permanent instead of one-time
- [ ] Standing rule from here on: **every new endpoint ships with a tenant-scoping test** in the same commit
- [ ] **Security review #2 — after Workstream X + the owner portal are live:** re-run the tenant audit with two account types (owner vs. professional) reading shared tables; verify magic-link auth can't reach professional-only surfaces; re-check webhook signature verification and idempotency under the expanded event set
- [ ] Device/browser QA matrix (used by checkpoints M and U): iPhone Safari, Android Chrome, desktop Chrome/Edge/Firefox — light + dark mode

## Workstream M — Mobile: Android-first native app

> **Founder direction 2026-07-19: build a real native app, Android first.** This supersedes the earlier PWA-first stance (a good mobile web app was going to come first, native only when a feature demanded it). The founder's original goal was an app for iOS **and** Android; the plan below gets there in phases. Phase 1 (the web app) is unchanged and remains the demo surface for now. iOS follows in **Phase 3** (below).

**Approach:** Capacitor wraps the existing web app (`public/`) into an Android shell — still one deployable, same backend. Native device features are Capacitor plugins called from the existing UI, pulled forward from the backlog.

**Why Android-first:**
- Android builds on the founder's **Windows** machine — no Mac needed. That constraint moves to Phase 3 with iOS.
- Google Play does **not** apply Apple's 4.2 "not just a website" wrapper rejection, so native features here are driven by walker value, not review-clearing. (Apple's 4.2 gauntlet re-enters in Phase 3.)

### Native features pulled forward (Phase 2, Android)
- [ ] **QR / barcode check-in — with manual fallback** (P2-2, decided 2026-07-19): scan the dog's tag to start/end a visit; a "Start walk" button **always** works with no tag. QR is a convenience the walker *may* use, never a dependency (candidate for a paid tier — see gating). App generates a per-pet QR to print/attach.
- [ ] **GPS walk tracking — starts on walk start** (P2-2, founder note 2026-07-19): live route + distance, running **only** from "Start walk" to "Complete walk" — no always-on/background location. Implemented as an Android **foreground service** with an ongoing "Walk in progress" notification during the walk only (permission-friendly and battery-friendly vs. always-on).
- [ ] **Tap-to-Pay (Android)** (P2-8, pulled into Phase 2 for testing 2026-07-19): Stripe Terminal SDK, connection-token endpoint, in-person card flow. Needs an **NFC + Android 11+** device Stripe supports. Routes to the walker's connected account once **M-Connect** is done; on the platform account for founder-only testing before then. Independent of QR/GPS — can be resequenced ahead of M1 if testing payments early matters, provided the security gate (M0.5) is done first.
- [ ] **Push notifications**: native channel extending Week 7's `notification_queue` (reminders, walk-done, new message, payment).
- [ ] **Camera / photos** (P2-3, P2-7, P2-11): dog photo on the walk report; pet photos; profile/logo.
- [ ] **Calendar integration** (P2-4): push walks to the phone's calendar.
- [ ] **Local notifications + "walk in progress" home-screen widget.**

### M-Connect — Payment setup: "Get paid" (Stripe Connect / P2-6)
*Gap found 2026-07-19: the simplified onboarding has **no way for a professional to set up getting paid** — today all money routes to the platform (founder) Stripe account. Real walkers can't receive money until this exists, and Tap-to-Pay to a real walker's account depends on it.*
- [ ] **Stripe Connect Express** (founder decision 2026-07-19) — Stripe-hosted KYC/onboarding.
  - ⚠️ **Do not hardwire the connected account.** It must be disconnectable/changeable later — e.g. if the professional relationship is terminated — so build it behind the same seam as **P2-15** account deactivation, not as a permanent one-time link. Storing the `account_id` is a nullable, replaceable link on the account, never an assumption baked into the payment path.
- [ ] Generate onboarding link, store connected `account_id`, handle the incomplete-onboarding (not-payout-ready) state.
- [ ] Route charges (Checkout **and** Tap-to-Pay) to the walker's connected account. `PaymentService` was built so Connect slots in without changing callers.
- [ ] "Set up payments" step in the onboarding wizard (skippable) **plus** a persistent Profile card until complete.
- [ ] **Not mobile-specific** — build on web, the Android app inherits it. Slots **before** Tap-to-Pay (M2). Founder-only testing can defer it (platform-account fallback); real-walker payment testing needs it first.

### Foundation & polish (folded in from the original Workstream M)
- [ ] Responsive audit at 375px: navigation, tables/cards, forms, the schedule week view (7 columns won't fit → mobile day/agenda layout), modals and toasts.
- [ ] Touch-first pass: tap-target sizes, the signature pad under touch (test on a real phone — pointer events differ from mouse), mobile date/time pickers.
- [ ] PWA baseline: manifest + icons, service worker with a safe cache strategy (never cache API responses that would show stale schedules), graceful offline message. (Week 7's offline draft-sync endpoint is the seam — don't rebuild it, just don't break it.)
- [ ] **Vite + TypeScript build step** (still the Workstream U modernization decision below — *recommended*, not yet founder-approved): Capacitor expects a web build pipeline; bolting plugins onto the single 2,742-line `app.js` is fragile.
- [ ] One-handed field workflow: check schedule / mark complete / collect payment each ≤ 2 taps from home (builds on Phase 1 finding W-4).
- [ ] **Security gate before payments face public installs** (pairs with Security review #1): `helmet`, rate-limiting on auth + webhook endpoints, on-device auth-token storage review.

### Feature gating (forward reference — not built in Phase 2)
Pricing tiers (**Workstream S**) will later decide free vs. paid. Build every Phase 2 feature behind a **clean entitlement check** from the start so gating is a config change, not a refactor — same discipline already written into Workstream S. Premium-tier candidates to flag now: **QR check-in, GPS tracking, Tap-to-Pay, photo walk reports, calendar sync**.

### Phase estimates & time-to-test (Android)
| Phase | Scope | Build (wks) | Testable on Android at the end |
|---|---|---|---|
| **M0** Foundation | responsive + touch + PWA + Vite + Capacitor Android shell + dev signing | 2–2.5 | existing app in the native shell on a real device |
| **M0.5** Security gate | helmet, rate-limiting, token-storage review | ~1 | same app, safe on real devices |
| **M-Connect** Get-paid | Stripe Connect Express onboarding + charge routing | 2–3 | connect a payout account (web + Android) |
| **M1** Core natives | QR + manual fallback, GPS-on-walk-start, push, camera/photos | 3–3.5 | scan a tag → track a real walk → photo → push |
| **M2** Tap-to-Pay | Stripe Terminal in-person card flow | 2–3 | a real in-person card tap on the phone |
| **M3** Depth & polish | calendar, local notifications, widget, one-handed | 2–2.5 | feels native, not wrapped |
| **M-Play** Submission | Play Console listing, data-safety, signing, internal → closed test | ~1 + Google gate | live in Play internal/closed testing |

- **First testable on a phone:** ~2–2.5 wks (M0).
- **QR + GPS + push + photos:** ~6–7 wks in (later if M-Connect precedes M1).
- **Everything submission-ready:** ~**13–16 wks** with Connect in the first cycle; ~11–13.5 if Connect is deferred to founder-only testing.
- **Uncertainty drivers:** GPS foreground service, Tap-to-Pay device eligibility, and Google's ~14-day / ~20-tester **new-account gate** — create the Play account **early** so its clock runs in parallel with the M-phases.

- [ ] **QA checkpoint M:** full E2E (signup → client → contract → sign → book → complete → invoice → pay) executed **on a real Android phone**, plus the device matrix from Workstream Q.

### Phase 3 — iOS port + Biometric Login *(deferred, scoped when Phase 2 is testing)*
The **iOS port** is the main Phase 3 driver — it's what needs a **Mac or cloud build environment** and re-entry into **Apple's review** (where Phase 2's native-feature depth pays off against guideline 4.2). **Biometric Login** rides here too (it's small and also works on Android — cheap to pull into the Android build later if wanted; kept in Phase 3 per founder call 2026-07-19). Rough size when picked up: **~5–8 weeks**.

## Workstream U — UI/UX Polish & Modernization

*The Phase 1 UI was built to be demoable, not delightful. This workstream is a deliberate design pass — informed by real feedback from the Week 8 demo and the owner-portal cold tester.*

- [ ] Heuristic review of every screen against a written checklist: empty states, loading states, error states, destructive-action confirmations, success feedback, back-navigation coherence — log findings as checklist items here
- [ ] Design-system tightening: extract the ad-hoc CSS into named tokens (spacing, type scale, radii, palette already exists per `SPEC.md`), one card/button/form vocabulary used everywhere, consistent light/dark parity
- [ ] Accessibility pass: labels and roles (the a11y tree is already decent), focus states, contrast in both themes, keyboard-only walkthrough of the core flow
- [ ] Modernization decision — **vanilla JS vs. a build step** (founder decision, recommendation below): `public/app.js` is a single growing file; owner portal + messaging + mobile layouts will roughly double it. Recommendation: adopt **Vite + TypeScript** for the front end (keeps the no-framework simplicity, adds modules/type-safety/hot-reload) and only reach for a framework if state management genuinely hurts. Either way this stays one deployable — no separate front-end service
- [ ] Micro-UX debt from the Phase 1 walkthrough not already scheduled in Weeks 7–8: clickable `tel:`/`mailto:` everywhere client contact info appears, truncated text affordances, timezone display sanity check
- [ ] Onboarding wizard (P2-5) lands here once the design pass sets the visual vocabulary
- [ ] **QA checkpoint U:** cold-user test (repeat of the Week 8 exercise — someone unfamiliar drives the app without help), plus the device matrix

## Workstream X — Multi-Profession Infrastructure (trainers, groomers, sitters, boarding)

*The architecture was built for this from day one — `account_type` enum, generic `ServiceType`, profile-mapped offerings (Week 6), generic billing. Phase 2's job is to finish the last mile: the places where the **UI and copy** still assume "dog walker."*

- [ ] Terminology audit: the UI says "walks"/"walk report"/"No walks" in places where the service might be grooming or a training session — make labels service-type-aware (data model needs nothing; this is presentation). The event name `walk_completed` stays (append-only log; renaming events breaks history) — map it to friendly copy at display time
- [ ] Contract template library: one seeded CA dog-walking agreement exists today. Add per-profession starter templates (training, grooming, sitting/boarding) with the same merge-field system — founder sources/reviews the legal text, same legal-counsel notice as Phase 1
- [ ] Service-type-aware completion reports: the Week 6 walk report (times, notes, 🐶/🦴) is the template — grooming wants before/after photos (seam: P2-3), training wants progress notes, boarding already has per-day stays. Extend the completion form per `ServiceType` without forking the appointment model
- [ ] Boarding/sitting stay UX: multi-day stays exist in the model (per-day billing, non-exclusive time) — give them check-in/check-out date UI instead of the walk-shaped time picker
- [ ] Profession-aware onboarding: P2-5's wizard sets `offered_service_types` at signup so a groomer's first session already looks like a grooming app
- [ ] Seam-integrity check (do this last, it's the marketplace insurance): no hardcoded `account_type` checks crept in, all significant actions still publish events, billing still treats products as "billable items attached to an account"
- [ ] **QA checkpoint X:** run the full E2E flow as three personas — walker, groomer, boarder — each seeing only their world (service types, labels, templates)

## Workstream S — Subscription Tiers: Just Me / Essential / Business

*Added 2026-07-15 at founder direction: access to PetPro Connect becomes a paid signup with three account tiers. This is the use case the `CLAUDE.md` "generic billing" seam was explicitly built for — a professional's subscription is a billable item attached to their account, running through the same Stripe machinery as their clients' invoices, not a parallel system. Subscription revenue goes to the founder's Stripe account (unaffected by the P2-6 Stripe Connect question, which concerns client-payment payouts).*

- [ ] Founder defines the **tier matrix** (see Decisions Queue — blocks everything below): which features belong to each tier, monthly price, annual option, free-trial policy. Working assumption to react against, based on the names: **Just Me** = solo professional, core workflow (clients, contracts, scheduling, invoicing); **Essential** = solo + the premium conveniences (auto walk reports, branded invoices, calendar sync, vaccination tracking); **Business** = everything + multi-staff
- [ ] Model tiers in Stripe Billing: three Products with recurring Prices; new `subscriptions` type + tier field on the account (deliberate additions to `src/types/index.ts`, flagged per `CLAUDE.md`)
- [ ] Signup flow: choose tier → Stripe Checkout in subscription mode → account activates on webhook confirmation (same signature-verification + idempotency pattern as Week 5). Trial-first vs. card-up-front is a founder call in the tier matrix
- [ ] **Entitlement middleware**: one central "does this account's tier include this feature" check, same discipline as `account_type` — never scattered hardcoded tier checks in service code, so re-packaging tiers later is a config change, not a refactor
- [ ] Subscription lifecycle handling: payment failed → grace period → **read-only lockout, never data deletion** (a walker's client records are their business — losing them over a failed card would be unforgivable); cancel and downgrade behavior defined per the tier matrix
- [ ] Billing settings screen (extends the Profile tab): current plan, upgrade/downgrade with Stripe's proration, payment-method update + receipts via the Stripe customer portal (no card data ever on our server, as always)
- [ ] ⚠️ **"Business" likely implies multi-staff** — employees under one business account is a real data-model expansion (who owns clients, whose schedule shows whose walks, per-seat pricing). If the founder confirms that's what Business means, it gets scoped as its own workstream item rather than smuggled in here
- [ ] Grandfathering: founder's own account, demo accounts, and any pre-tier signups get flagged exempt so turning tiers on can't lock out existing users
- [ ] **QA checkpoint S:** E2E with a test card — sign up on each tier → entitlements enforced correctly → simulate payment failure → grace → lockout → recovery → cancel; tier changes apply exactly once (idempotent webhooks). Entitlement enforcement also gets added to **Security review #2's** scope, since a tier check is an access-control boundary

## Workstream F — Feature Backlog Build-Out

*The detailed specs live in `ROADMAP.md` → "Phase 2 Backlog" (P2-1…P2-11) — they are not duplicated here. This is the priority ordering, revised as the founder learns from real users.*

**Tier 1 — quick wins, mostly thin UI over existing APIs (candidates to interleave early):**
- [ ] P2-9 Record payments taken outside Stripe (cash/check/Venmo)
- [ ] P2-11 Full pet profile + vaccination records UI (vaccination expiry feeds "Needs your attention")
- [ ] P2-7 Branded invoices (logo + business name)
- [ ] P2-10 No-show & late-cancel fee flow
- [ ] P2-5 Signup onboarding wizard *(scheduled inside Workstreams U + X above)*

**Tier 2 — client-facing value, needs founder decisions first:**
- [ ] **Nitro Sign electronic signing (the "Phase 1.5" deferral from Week 4)** — the full plan is preserved in `ROADMAP.md` Week 4's collapsed section; goes through `IeSignProvider` as always
- [ ] P2-2 Walk-report auto-message on completion (decisions: SMS vs email/in-app first; check-in mechanism)
- [ ] P2-3 Photos + notes on walk reports
- [ ] P2-1 Walker ratings (1–5 dogs 🐕)
- [ ] P2-4 Calendar sync (iCal feed first)

**Tier 3 — big lifts, gated on explicit founder decisions:**
- [ ] P2-6 Per-professional payouts → **Stripe Connect** (the marketplace payment seam; the non-Stripe-processor variant needs a `CLAUDE.md` constraint amendment and stays parked)
- [ ] P2-8 In-person tap-to-pay (native-app-sized; interim QR/embedded-Checkout options documented in the backlog item)
- [ ] **QA checkpoint F:** each shipped Tier item extends `npm test` with its own leg before it's called done

---

## Proposed Sequencing

*A proposal, not a contract — the founder reorders as priorities emerge from the demo.*

| Order | What | Why first |
|---|---|---|
| 1 | Workstream 0 + Security review #1 | Clean, audited base before anything is built on it |
| 2 | Workstream M (mobile) | Highest-leverage gap for real walkers; everything after inherits it |
| 3 | Workstream U (polish) + Tier 1 features interleaved | Demo feedback will be fresh; Tier 1 items are small enough to ride along |
| 4 | Workstream X (professions) + Security review #2 | Opens the market; the second security review catches what expansion changed |
| 5 | Workstream S (subscription tiers) | Turn on paid signup once the product is polished and mobile-ready enough to be worth paying for — gating signups behind a paywall before then costs adoption. Founder can pull it earlier if revenue timing demands |
| 6 | Tiers 2–3 by founder priority | Each needs decisions logged in the queue below |

## Founder Decisions Queue

*Decisions Phase 2 needs from you, none blocking today. Each gets logged with a date when made, same habit as Phase 1.*

- [ ] **Test-data strategy** (blocks CI in Workstream 0): separate Supabase project for tests vs. a cleanup script against the live one
- [ ] **Front-end modernization** (Workstream U): approve/decline the Vite + TypeScript recommendation — now also the front-end pipeline Workstream M's Capacitor wrap wants, so this decision is on the mobile critical path
- [x] **PWA vs. native timing** — **DECIDED 2026-07-19: native app, Android-first** (Capacitor wrap + native features), iOS in Phase 3. Supersedes the PWA-first plan. See Workstream M.
- [x] **QR check-in mechanism** (P2-2) — **DECIDED 2026-07-19: QR with a manual "Start walk" fallback.** QR is an option the walker can use, never a dependency; candidate for a paid tier.
- [x] **Payout account type** (Workstream M / P2-6) — **DECIDED 2026-07-19: Stripe Connect Express.** Requirement: the connected account must be changeable/disconnectable if the professional relationship is terminated — not hardwired (build behind the P2-15 deactivation seam).
- [ ] **Payment setup: block vs. fall back** (Workstream M / M-Connect): until a walker completes Connect onboarding, is collecting payment **blocked**, or does it **fall back to the platform account**? — OPEN
- [ ] **Platform fee** (Workstream M / M-Connect): does PetPro take a percentage of each transaction, or pass 100% to the walker? — OPEN
- [ ] **RLS as a second isolation net** (Security review #1): recommended once the owner portal is live — approve the migration work
- [ ] **eSign timing**: when does Nitro Sign (Phase 1.5) actually start — before or after mobile?
- [ ] **Tier matrix** (blocks Workstream S): which features land in Just Me vs. Essential vs. Business, monthly prices, annual discount yes/no, free trial vs. card-up-front
- [ ] **What "Business" includes**: if it means multiple staff under one account, that's a data-model expansion to scope separately (seats, client ownership, per-staff schedules)
- [ ] **When tiers switch on**: proposed as step 5 in sequencing (after polish + mobile) — pull earlier only if revenue timing demands it
- [ ] **Which professions launch first** in Workstream X (affects which contract templates to source)
- [ ] *(carried from Phase 1, still open)* Invoice timing for weekly/monthly-billed services

## Status at a Glance

| Workstream | Status |
|---|---|
| 0 — Closeout & cleanup | Not started (baseline verified clean 2026-07-15) |
| Q — QA & security reviews | Not started (review #1 scheduled with Workstream 0) |
| M — Mobile (Android-first native) | Planned & spec'd 2026-07-19 (Android-first; Tap-to-Pay + Stripe Connect Express in scope; iOS → Phase 3). Not started |
| U — UI/UX polish | Not started |
| X — Multi-profession | Not started |
| S — Subscription tiers | Not started (blocked on tier-matrix decision) |
| F — Feature backlog | Not started |

## Changelog

- **2026-07-19** — **Workstream M rewritten as an Android-first native app** at founder direction, superseding the PWA-first plan. Capacitor wrap + native features pulled forward from the backlog: QR check-in with manual fallback (P2-2), GPS walk tracking that starts only on walk start (P2-2), Tap-to-Pay on Android for testing (P2-8), push, camera/photos (P2-3/7/11), calendar (P2-4), local notifications + widget. New **M-Connect** item closes a gap found in onboarding — no way for a professional to set up getting paid (all money currently routes to the platform account); **Stripe Connect Express** chosen, with a requirement that the connected account be changeable/disconnectable on relationship termination (P2-15 seam). **iOS + Biometric Login moved to Phase 3** (Mac/cloud build env + Apple review). Estimates: first testable on a phone ~2–2.5 wks; submission-ready ~13–16 wks with Connect in the first cycle. Decisions logged: native/Android-first, QR-with-fallback, Stripe Express (all decided); **block-vs-fall-back** and **platform fee** left OPEN. Feature-gating note added so Phase 2 features sit behind clean entitlement checks for the Workstream S tiers.
- **2026-07-15 (later)** — **Workstream S added at founder direction: paid signup with three account tiers — Just Me, Essential, Business** — built on the generic-billing seam via Stripe Billing subscriptions, with central entitlement checks, never-delete-data lockout policy, and its own QA checkpoint. Three new items in the Founder Decisions Queue (tier matrix; whether Business means multi-staff; when tiers switch on) and a sequencing row (proposed step 5, after polish + mobile). Entitlement enforcement added to Security review #2's scope.
- **2026-07-15** — Document created at founder direction: workstreams 0/Q/M/U/X/F defined; Phase 1 backlog P2-1…P2-11 tiered into Workstream F; security posture baselined (no RLS, no helmet/rate-limiting — scheduled into review #1); code baseline verified (typecheck clean, zero audit vulnerabilities, all work committed). Phase 1 Weeks 7–8 still run under `ROADMAP.md` first.
