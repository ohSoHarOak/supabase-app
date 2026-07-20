# PetPro Connect — Phase 3 Roadmap

*Created 2026-07-19 at founder direction. Mirrors the `ROADMAP.md` (Phase 1) → `PHASE_2_ROADMAP.md` (Phase 2) split. This file collects work deferred past Phase 2. It is a **living document** — same status legend and update habits as the other two roadmaps. **Nothing here starts until the founder pulls it in.***

---

## What Lives in Phase 3

Two things:

1. **iOS port + Biometric Login** — already scoped inside `PHASE_2_ROADMAP.md` → Workstream M → "Phase 3 — iOS port + Biometric Login." That's the driver that needs a Mac or cloud build environment and re-entry into Apple's review (guideline 4.2). It is **not duplicated here**; see that section for the detail. Rough size when picked up: ~5–8 weeks.
2. **Backlog items moved out of the Phase 2 feature backlog** (below), at founder direction 2026-07-19.

**Stable-ID note:** the items below keep their original `P2-x` identifiers even though they now live in Phase 3. The number is a **stable reference**, not a phase marker — both `ROADMAP.md` and `PHASE_2_ROADMAP.md` cite these IDs in a dozen places (e.g. `C-4/P2-7`, `R-6b/P2-12`, O-1's `P2-14`), and renumbering them to `P3-x` would break every one of those references. They were logged under Phase 2 numbering; only their scheduling changed.

**Ground rules carried over (do not expire):** all `CLAUDE.md` hard constraints still apply — modular monolith, REST only, Stripe only, eSign via `IeSignProvider`, append-only events, signed-contract immutability, types in `src/types/index.ts`. The four marketplace seams stay intact. One feature fully working beats several half-done; commit after each.

**Status legend** (same as the other roadmaps): `[ ]` not started · `[x]` done · `[~]` in progress · `[!]` issue · `[d]` delayed.

---

## Backlog Moved From Phase 2 (relocated 2026-07-19)

*These six were part of `ROADMAP.md`'s "Phase 2 Backlog" and tiered into `PHASE_2_ROADMAP.md`'s Workstream F. The founder moved them to Phase 3 on 2026-07-19. Their `ROADMAP.md` entries are now redirect stubs pointing here. **P2-2 was explicitly kept in Phase 2** — Workstream M's QR check-in + GPS native features depend on it.*

### P2-1: Walker ratings (1–5 dogs)
Clients rate walkers on a 1–5 **dog** scale (not stars), 5 = best, 1 = needs improvement. Half-dog ratings (e.g. 4.5) are supported — store as a numeric with one decimal place, validated to 0.5 increments.
- Natural home: owner portal (extends Week 8's portal). Ratings attach to the walker's *account*, keeping the marketplace seam — a future Phase 3 marketplace can surface the same ratings unchanged.
- Needs a new `ratings` table + type in `src/types/index.ts` (deliberate addition — flag at build time per CLAUDE.md).

### P2-7: Branded invoices — logo + business name
Owner can add their logo and business name so invoices look like *their* business (founder request 2026-07-14).
- Business name already exists on `professional_profiles`; needs a logo upload (Supabase Storage, same pattern as signature images) and rendering on the invoice view + payment confirmation + (Week 7) payment emails.
- Caveat: the Stripe **Checkout page** itself shows the *Stripe account's* branding — in Phase 1's platform-charge model that's the founder's account, the same for every professional. Per-professional branding on Checkout only becomes possible with Stripe Connect (P2-6). Our own invoice/receipt surfaces can be fully branded now.
- Small enough to be a Week 8 slack candidate alongside P2-5 if demo prep goes fast — a branded invoice is a strong demo moment.
- 2026-07-18 (tester question F-6): make each invoice row in client Billing (and the owner portal) open a **printable invoice/receipt document** — same print-styled-HTML approach as the signed contract (W-1), branded per this item. Today invoices are list rows only; the paid/open status and history are all there, but there's nothing to hand a client.

### P2-9: Record payments taken outside Stripe (cash, check, Venmo/Zelle)
Real walkers get handed cash and Venmo constantly, but today the only way an invoice becomes `paid` is through Stripe — there is no "mark as paid" for money collected outside the app, so those invoices sit "awaiting payment" forever (or get voided, losing the revenue record).
- Build: a "Record payment — cash / check / other" action on the invoice that creates a transaction with a `payment_method` marker and fires the same `payment_received` event, reusing `PaymentService`'s paid-exactly-once guard so a Stripe payment and a manual one can never double-record.
- ⚠️ Founder decision at pickup: manual mark-paid is trust-based (a mistap says a client paid who didn't) — decide whether it needs an undo window or a confirmation step.
- Strong Week 8 slack candidate: cash is common enough that a demo walker may ask about it unprompted.

### P2-11: Full pet profile + vaccination records UI
The schema and API are far richer than the UI shows. Pets support photo, date of birth, color, microchip, medical conditions, and feeding notes; a `vaccination_records` table has full add/list/delete API support (built Week 2) — but the UI exposes only name/breed/weight/vet/behavior, and vaccinations appear nowhere.
- Build: expand the pet card/form to the full field set (photo upload = Supabase Storage, same pattern as signatures), plus a vaccinations list with expiry dates.
- Expiring/expired vaccinations are a natural "Needs your attention" cue (ties into W-4's cue work) — rabies expiry is something real walkers genuinely track for liability.
- Client `general_notes` is in the same boat (schema yes, UI no) — fold it in here.

### P2-12: Bring-your-own contract template (upload)
Professionals can upload and use their own contracts instead of (or alongside) the packaged Pet Services Agreement (founder request 2026-07-17).
- The backend seam already exists: `contract_templates` is per-account, and `POST`/`PATCH /api/contract-templates` accept arbitrary `body_html` — what's missing is UI.
- The real work is conversion: what owners actually have is a .docx or PDF with no merge fields, so an upload needs either a guided "map your fields" step or docx→HTML tooling. The Pet Services Agreement conversion (2026-07-17) is the manual prototype of exactly this — its decisions (bracket→merge-field mapping, services table placement, signature block) are the checklist to automate.
- ⚠️ Safety rails to decide at pickup: template markup is *trusted* by design (interpolated data is escaped, the template itself renders as-is), so uploaded HTML must be sanitized or constrained; and every template must keep the legal-review notice and the signing placeholders (`{{client_signature_image}}`, `{{provider_signature_image}}`, `{{signed_date}}`) or the signing flow breaks. Comments must avoid literal `{{...}}` tokens (substitution runs everywhere — learned the hard way 2026-07-17).

### P2-14: Default price + duration per service type
Split out of O-1 step 2 (2026-07-18) because nothing stores it. `services` rows are **contract-born by design** (F-4), so a per-type default is a genuinely new concept: a `service_type_defaults` table (or a jsonb column on `professional_profiles`) keyed by account + service type, holding `price_cents`, `duration_minutes`, and `billing_cadence`.
- Value: contract generation pre-fills instead of asking for a price every time — the founder sets "private walk = $30, 45 min" once.
- ⚠️ Keep it a *default*, not a constraint: the contract stays the source of truth for what a client actually pays, or F-4's root cause comes back in a new shape.

---

## Changelog

- **2026-07-19** — Document created at founder direction. Six items moved out of the Phase 2 backlog into Phase 3: **P2-1** (walker ratings), **P2-7** (branded invoices), **P2-9** (record outside-Stripe payments), **P2-11** (full pet profile + vaccination UI), **P2-12** (bring-your-own contract upload), **P2-14** (default price/duration per service type). They keep their `P2-x` IDs as stable references. **P2-2 was explicitly kept in Phase 2** because Workstream M's QR check-in + GPS native features are built on it. The iOS port + Biometric Login (already scoped in `PHASE_2_ROADMAP.md` Workstream M) is noted here as the other Phase 3 driver but not duplicated.
