# PetPro Connect — Known Issues & What's Next

*Phase 1 demo build, as of 2026-07-16. Companion to `ROADMAP.md` (what was built) and `PHASE_2_ROADMAP.md` (what comes next, in detail).*

Everything below is either a **deliberate Phase 1 scope decision** or a **known gap with a plan**. Nothing here is a surprise — each item traces to a decision logged in the roadmap.

---

## What works today, end to end

Signup/login → add clients & pets → generate a contract from real client data → sign it in person (locked permanently the moment it's signed) → set up services → book recurring walks with conflict detection → mark a walk complete → invoice auto-generates → client pays by card → payment recorded exactly once → both sides get notified. Plus a pet-owner portal where the client signs, pays, and messages you themselves.

Verified against the live deployment on 2026-07-16: all 11 automated end-to-end steps, every weekly test script (weeks 1–7), and a full click-through of every screen in light and dark mode.

---

## Known limitations (Phase 1)

**Email delivery is limited until a domain is verified.** Notifications currently deliver only to the Resend account owner's inbox. Verify `itchytail.com` at resend.com/domains before any real client should receive email. The app itself is fine — messages queue and send automatically once the domain clears.

**Owner-portal login links are rate-limited.** Magic links come from Supabase's built-in mailer, which allows only a couple of emails per hour. Portal sessions last about an hour before a fresh link is needed. Fine for real use; it needs planning around for a live demo.

**Security hardening is scheduled, not done.** There are no Postgres row-level-security policies — every bit of tenant isolation lives in application code that scopes queries by account. Cross-role access was verified to 403 in both directions, but the belt-and-braces layer (RLS, `helmet` headers, rate limiting, explicit CORS) is Phase 2's first security review, before any new feature work.

**Payments run through the platform's own Stripe account.** Each professional is not yet paid into their own account, and the Stripe Checkout page shows the platform's branding rather than theirs. Stripe Connect is the planned path (P2-6) and the payment layer was built so it slots in without rework.

**Card payments only.** Cash, check, and Venmo can't be recorded — an invoice becomes paid only through Stripe. Real walkers get handed cash constantly, so this is a high-priority Phase 2 item (P2-9).

**No-show and late-cancel fees can't be charged.** The data model knows about them and the contract promises them, but the UI offers only Cancel and Mark complete (P2-10).

**Some screens are thinner than the data behind them.** Vaccination records have a full API and no UI at all; pet profiles support photo, date of birth, microchip, medical conditions, and feeding notes but the form shows only the basics; vacation/time-off blocking exists in the schema without a UI. A recurring theme worth knowing: the API is consistently ahead of the interface, so most of these are thin UI slices rather than backend work (P2-11).

---

## Deliberate scope decisions (not oversights)

- **In-person signing only.** Remote e-signature (Nitro Sign) was deferred to a post-demo fast-follow; the owner portal already covers remote signing for clients who have a portal login.
- **Signed contracts are print-to-PDF, not server-generated PDFs.** The signed copy renders as a print-styled page — browser Print → "Save as PDF" produces the file. A real PDF pipeline wasn't worth the dependency weight pre-demo.
- **Per-visit and per-day services auto-invoice; weekly/monthly/package don't.** When those cadences *should* generate an invoice is an open product decision. They invoice manually meanwhile.
- **Boarding doesn't block other bookings.** Boarders can be walked mid-stay and multiple boarding clients can overlap. Walk-vs-walk double-booking is still refused.
- **One email, one account.** An address can be a professional login or a portal login, not both. Dual-role accounts would be a deliberate Phase 2+ change.

---

## What's next — Phase 2

`PHASE_2_ROADMAP.md` organizes this into workstreams. In short:

1. **Closeout & security** — the tenant-isolation audit, RLS, HTTP hardening, and cross-tenant regression tests. Gates everything else.
2. **The cash-money gaps** — record payments taken outside Stripe (P2-9) and enforce no-show/late-cancel fees (P2-10). Both are things a real walker hits in week one.
3. **Mobile-ready, then UI polish** — the demo runs on a laptop; walkers work from a phone.
4. **The feature backlog** — walker ratings, automatic walk reports with photos, calendar sync, an onboarding wizard, branded invoices, tap-to-pay, and the full pet/vaccination profile (P2-1…P2-11).
5. **Multi-profession** — the same core already models trainers, groomers, sitters, and boarding; expanding beyond dog walking is configuration plus UI, not a rebuild.
