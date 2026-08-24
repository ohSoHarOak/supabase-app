# PetPro Connect — Phase 4 Roadmap: App Design & Brand Identity

*Created 2026-08-23 at founder direction. Fourth in the `ROADMAP.md` (Phase 1) → `PHASE_2_ROADMAP.md` → `PHASE_3_ROADMAP.md` line. This file collects the **design and brand** work — the logo, the visual language, and the pass that makes the app look like a product someone paid for. It is a **living document** — same status legend and update habits as the other three. **Nothing here starts until the founder pulls it in** (with one exception worth pulling forward early — see "Pull This Forward" below).*

---

## What Lives in Phase 4

Design is currently spread thin across three phases and nobody owns the whole of it. Phase 4 owns it:

1. **Brand identity** — the PetPro mark, wordmark, and lockups; the palette promoted from "colors that were picked in Week 4" to a defined system; typography; iconography; voice.
2. **The visual design language** — real design tokens (spacing, type scale, radii, elevation, motion), one component vocabulary, working light/dark parity.
3. **The app redesign itself** — every screen brought onto that language, on both frontends (professional app + owner portal) and the Android shell.
4. **Everywhere the brand appears that isn't a screen** — app icon, splash, Play Store listing, emails, printable documents, shared walk-report cards.

### What Phase 4 is *not*

- **Not Workstream U** (`PHASE_2_ROADMAP.md` → UI/UX Polish & Modernization). U is a **usability** pass: empty/loading/error states, a11y, focus order, confirmations, micro-UX debt. It fixes screens that *behave* badly. Phase 4 decides what screens *look like*. They touch the same files, so the boundary matters — see **Overlap with Workstream U** below, and decision **D4-1**.
- **Not P2-7** (`PHASE_3_ROADMAP.md` → branded invoices). P2-7 puts **the walker's** logo on **their** invoices. Phase 4 is about **our** logo on **our** product. Both land on the invoice surface, so they should be designed together but they are separate work.
- **Not a rewrite.** The Vite + TypeScript decision (Workstream U, 2026-07-19) is the build pipeline; Phase 4 is the design that ships on it. No framework adoption rides in here.

**ID note:** items use `B-x` / `V-x` / `A-x` / `N-x` / `E-x` prefixes. Those letters are unused by the other three roadmaps (which use `W-`, `F-`, `C-`, `R-`, `O-`, `Q-`, `M0-`, `P2-`), so IDs stay globally unambiguous and can be cited across documents. Once assigned, an ID never changes — same stable-reference rule Phase 3 follows for `P2-x`.

**Ground rules carried over (do not expire):** all `CLAUDE.md` hard constraints still apply. Two matter directly here:
- **The structural contract at the top of `web/public/styles.css` is off-limits.** Everything above `END STRUCTURAL CONTRACT` is load-bearing — the contract viewer's definite height, the zoom transform origin, the signature canvas's `touch-action: none`. It breaks *silently*: F-8 (2026-07-18) collapsed the portal's contract pane to 150px and shipped to real testers. `npm run check:structure` (part of `npm test`) is the gate. A whole-app restyle is exactly the kind of work that trips this, so it is called out in every workstream below.
- **One stylesheet serves three frontends** (`index.html`, `portal.html`, `pay.html` — see `ROADMAP.md` → "Frontend Architecture — Shared-Stylesheet Coupling"). Every restyle hits the professional app, the owner portal, and the payment page at once. Verify all three, every time.

**Status legend** (same as the other roadmaps): `[ ]` not started · `[x]` done · `[~]` in progress · `[!]` issue · `[d]` delayed — with a one-line note under any `[!]`/`[d]`.

---

## Where the Design Stands Today (audited 2026-08-23)

Honest baseline, so Phase 4 starts from facts rather than vibes.

**What's already good — keep it:**
- **A real brand palette exists and is documented** (`SPEC.md` → UI/UX Requirements): steel blue `#2B7192` for structure, orange `#F58941` reserved for the single primary action per screen, sage `#6D9280` for success/active, warm neutrals (paper `#F7F2EB`, hairline `#E5E0D6`), blue-black ink `#1E2B33`, dark brown `#4B2508` on orange fills (white on orange fails contrast). The "orange appears once per screen" discipline is a genuinely good rule and it survived eight weeks of building. **Phase 4 refines this palette; it does not throw it away.**
- Colors are already CSS custom properties in `:root` (`web/public/styles.css:57`) — the mechanical part of tokenization is half done for color.
- Dark mode exists and covers the core surfaces.
- `font-variant-numeric: tabular-nums` on money and counts; `text-wrap: balance` on headings. Small, correct details.

**What's placeholder or missing:**
- **The logo is a placeholder.** `web/public/icon.svg` is a flat paw-in-a-circle: no wordmark, one color-way, no dark variant, no maskable-safe version, no horizontal lockup for the app header. It reads as a stand-in because it is one.
- **The Android launcher icon and splash are still the stock Capacitor/Android Studio defaults** — `values/ic_launcher_background.xml` is `#FFFFFF`, `drawable-v24/ic_launcher_foreground.xml` is the default robot, `drawable*/splash.png` is generated boilerplate. **This is a hard blocker for a Play Store submission**, not a polish item.
- **The PWA manifest ships one icon** (`icon.svg`, `purpose: "any"`). No maskable icon, no PNG fallbacks — Android will letterbox or crop it into whatever shape the launcher wants.
- **Tokens are color-only.** No spacing scale, no type scale, no radius or elevation tokens — sizes are hardcoded per rule (`font-size: 22px`, `13.5px`, `12px`, `padding: 0 20px`…). This is the single biggest source of drift as screens multiply.
- **Dark mode is ad-hoc where it matters.** `#7FB4CD` is hardcoded in at least six separate `@media (prefers-color-scheme: dark)` blocks (link color, `.backlink`, `.day-head.today`, `.appt-time`…) instead of being a token. Every new dark-mode surface repeats the copy-paste.
- **The font stack is Windows-first**: `"Segoe UI Variable Text", "Segoe UI", -apple-system, …`. On the Android device the app actually ships to, none of those resolve — it renders in Roboto. The product looks materially different on the founder's laptop than on a walker's phone, which is where design decisions are currently being judged from.
- **No print stylesheet in `styles.css`**, while two print-shaped surfaces exist or are planned (the signed contract, W-1; the printable invoice/receipt, P2-7/F-6). Print is a design surface with its own rules and it's currently unowned.
- **Profile photo + business logo are dashed placeholder tiles** (W-12, 2026-07-17) — deliberately, with real upload riding along with P2-7 in Phase 3.
- **No app store creative at all**: no feature graphic, no screenshots, no listing copy.

---

## Pull This Forward: the Play Store blocker — **PULLED 2026-08-23 (D4-4 decided)**

**B-1 through B-4, B-8 and N-1…N-3 (the mark + the Android icon, splash, and web icon set) are pulled into Phase 2's Workstream M** as **M-Brand**, ahead of submission. Google Play will not accept a build wearing the stock Android robot, and the icon is the first thing any tester sees. That subset is roughly a week of design work plus an afternoon of asset generation — small enough to interleave, and it makes every Workstream M test build look real. Everything else in Phase 4 can wait its turn.

**How the split works — read before editing either file.** The **specs stay here** (this is where B-1…B-4, B-8, N-1…N-3 are written, and IDs never move); **the schedule lives in `PHASE_2_ROADMAP.md` → Workstream M → M-Brand**, which tracks them by ID. Tick an item in *both* places when it lands, and don't re-specify the work in Phase 2 — cite the ID. The pulled items are marked **⏩ M-Brand** below.

**N-3 came along with N-1/N-2** (it was not in the original recommendation): the maskable/PNG icon set is generated from the same mark in the same sitting, the PWA manifest ships one unmaskable `icon.svg` today, and leaving it behind would mean regenerating from the same source file twice. **B-8 (trademark check) also came along, and gates the rest** — see the sequencing warning in M-Brand.

**Not pulled:** B-5 (typography), B-6 (iconography), B-7 (voice), B-9 (brand guide). None of them block Play, and B-5 in particular carries an open licensing decision (**D4-3**). ⚠️ **Consequence to accept knowingly:** the mark gets drawn before the brand's typeface is chosen, so the **wordmark and lockups (B-2) may need revisiting** once B-5 lands. That is the accepted cost of unblocking the icon early — the *symbol* (B-3), which is what the launcher icon and splash actually use, is unaffected by the type decision.

---

## Workstream B — Brand Identity & Logo

*The mark, and the rules for using it. Everything else in Phase 4 is downstream of this, so it goes first.*

> ⏩ **B-1…B-4 and B-8 are pulled forward into Workstream M (D4-4, 2026-08-23)** — scheduled in `PHASE_2_ROADMAP.md` → **M-Brand**, specs stay here. B-5…B-7 and B-9 remain Phase 4.

- [ ] ⏩ **B-1: Brand brief — decide what PetPro should feel like.** One page, founder-authored, before any drawing: who it's for (a solo walker running a business from a phone, one-handed, outdoors, in daylight), the three adjectives (`SPEC.md` says "premium, minimalist" — is that still right?), what it must *not* look like (the cute-cartoon-paw category most pet apps sit in), and two or three products whose feel is the target. **Deliverable: `docs/brand/BRIEF.md`.**
- [ ] ⏩ **B-2: Name and mark lockup decisions.** The product is "PetPro Connect" in `manifest.webmanifest` and `strings.xml`, "PetPro" as `short_name`. Decide which is the brand and which is the product name, then design to that. Deliverables: primary mark (icon alone), wordmark (type alone), horizontal lockup (mark + wordmark for the app header), stacked lockup (login screen, emails, print).
- [ ] ⏩ **B-3: Design the mark.** The paw is the obvious route and also the most crowded one — worth exploring at least one non-paw direction (a leash line, a tag silhouette, a monogram) before defaulting. Requirements, all non-negotiable, from where the mark actually has to live:
  - Legible at **16px** (favicon) and inside a **maskable safe zone** (Android adaptive icons crop to a circle, squircle, or rounded square depending on launcher — art must sit inside the centre 66%).
  - Works in **one flat color** (print, email, embroidery on a walker's shirt someday) and reversed out of steel blue.
  - Distinct silhouette in **light and dark**, and against the `#F7F2EB` paper *and* the `#12262F` dark surface.
  - Vector source of truth (SVG), not a raster export.
- [ ] ⏩ **B-4: Palette v2.** Keep the four brand colors and the once-per-screen orange rule; fill the gaps found in the audit: a proper link/interactive color (replaces the six hardcoded `#7FB4CD`s), a full neutral ramp instead of `--ink`/`--ink-soft`/`--hairline`, semantic status colors (only `--alert: #A44A3F` exists — there's no warning, no info, and sage is doing double duty as brand + success), and dark-mode partners for every one. **Every pair goes through a contrast check: WCAG 2.1 AA is a `SPEC.md` requirement, not an aspiration.**
- [ ] **B-5: Typography.** Pick a type pairing and stop relying on the OS. Two viable routes: (a) a self-hosted variable webfont — better and consistent everywhere, costs a license check + ~30–60KB and a load-performance decision; (b) an honest platform stack that names Roboto explicitly so Android stops being an accident. ⚠️ **Licensing is a real decision, not a detail** — a font licensed for web is not automatically licensed for an embedded mobile app. Verify before adopting (**D4-3**).
- [ ] **B-6: Iconography.** The UI currently mixes emoji (🐶/🦴 on walk reports) with unstyled glyphs. Choose one open-licensed icon set (or draw a small one) and one stroke weight. Emoji can stay where it's *content* (a walk report's mood marker) but not where it's *interface*.
- [ ] **B-7: Voice & microcopy rules.** Short section in the brand doc: how the product talks (the existing copy is plain and warm — that's a choice worth writing down), how errors are phrased, sentence case vs title case, how money/dates/durations are written. Feeds Workstream X's terminology audit, which has to rewrite half this copy for groomers and trainers anyway.
- [ ] ⏩ **B-8: ⚠️ Trademark sanity check before the mark is finalized.** "PetPro" is a common construction in this market. A quick USPTO + app-store search *before* the logo is on a Play listing, business cards, and every client's invoice is cheap; discovering a conflict afterward is not. Founder task, possibly with counsel — the same counsel who reviewed the contract template.
- [ ] **B-9: Brand guide.** `docs/brand/` — the marks as SVG source, palette with hex + token names + contrast pairs, type scale, icon rules, clear-space and minimum-size rules, do/don't examples. Short and real, not a 40-page agency deck.
- [ ] **QA checkpoint B:** every mark variant rendered at 16 / 32 / 48 / 192 / 512px, on light and dark, in circle / squircle / square masks, and in one flat color — printed on actual paper once. Founder sign-off closes the workstream.

---

## Workstream V — Visual Design Language

*Turning the identity into something the code can use. This is where Phase 4 and Workstream U genuinely share work — read D4-1 before starting.*

- [ ] **V-1: Full token set.** Extend `:root` beyond color: spacing scale (a 4px base covers what's there today), type scale with line heights, radii, elevation/shadow steps, motion durations and easings, z-index layers. Named semantically (`--space-3`, `--radius-card`, `--text-body`), so a value change is one edit rather than a hunt through 1,500 lines.
- [ ] **V-2: Semantic color layer.** Two tiers: raw brand colors (`--steel`, `--orange`) and semantic aliases (`--surface`, `--surface-raised`, `--text-primary`, `--border-subtle`, `--action-primary`, `--link`). **Components reference only the semantic layer.** This is what makes dark mode a token swap instead of a per-rule `@media` block — and it retires the six hardcoded `#7FB4CD`s in one pass.
- [ ] **V-3: Component vocabulary.** One button set (primary / secondary / quiet / destructive, with real disabled and loading states), one card, one form field with label + hint + error, one table/list row, one modal, one toast, one empty state, one skeleton. Documented on a `/styleguide` page rendered from the same CSS — so it can't drift from the app the way a Figma file would.
- [ ] **V-4: Layout & responsive rules.** Content max-width (currently a hardcoded `860px`), the breakpoint set, the mobile layout contract (bottom nav vs header nav), safe-area insets for Android notches and gesture bars, and the one-handed reach rule from `SPEC.md` — primary actions in the bottom third on phones.
- [ ] **V-5: Motion.** Small and consistent: what animates (state changes, sheet entry, toasts), what never does (anything that delays a walker mid-walk), durations, and `prefers-reduced-motion` honored throughout.
- [ ] **V-6: Dark mode as a first-class theme, not an override.** Design the dark surfaces deliberately rather than inverting: currently `--card: #1C4C64` in dark makes cards *steel blue*, which collides with the brand's structural color. Includes elevation-in-dark rules (lighter = raised) and a decision on a manual theme toggle vs. following the OS.
- [ ] **V-7: Print stylesheet.** A real `@media print` block for the signed contract (W-1) and the printable invoice/receipt (P2-7/F-6): no chrome, no nav, black-on-white, the one-color mark, page-break rules, URLs spelled out. Coordinate with P2-7 so professional branding and PetPro branding don't fight on the same page.
- [ ] **QA checkpoint V:** the styleguide page renders every component in light and dark at mobile and desktop widths; contrast validated across the whole token set; `npm run check:structure` green; all three frontends still render (professional app, owner portal, pay page).

---

## Workstream A — App Surface Redesign

*Applying the language, screen by screen. Ships incrementally — one screen fully redesigned beats five half-restyled, same rule as always.*

- [ ] **A-1: Screen inventory + priority order.** List every screen across `app.js`, `portal.js`, and `pay.js`; rank by how often a real walker sees it. Expected top of the list: dashboard/today, client detail, contract signing, appointment create/complete, the portal overview.
- [ ] **A-2: Redesign the entry surfaces first** — login, signup, and the owner-portal magic-link screen. Highest brand impact per screen, lowest functional risk, and the login page already has its own treatment (`body.login-bg`) to build on.
- [ ] **A-3: Dashboard / today.** `SPEC.md`'s stated shape: today's schedule, upcoming appointments, recent messages, payment status. Currently a list; should be the screen that tells a walker what to do next.
- [ ] **A-4: Client + pet surfaces.** `SPEC.md` calls for "large photo-based pet cards" — this is the most visible gap between the spec's intent and what exists. **Sequencing note:** the photo upload it needs is P2-11 (Phase 3). Design the card for photos *and* for the no-photo case, so the empty state isn't an afterthought when photos land.
- [ ] **A-5: Contract + signing flow.** ⚠️ **The highest-risk screen in the app to touch** — `[data-doc-shell]`, `[data-doc-frame]`, and `[data-sigpad]` all live here, all three are in the structural contract, and this exact screen is what F-8 broke silently. Restyle around the contract, never through it; re-verify in both frontends and on a real touch device.
- [ ] **A-6: Scheduling + walk completion.** Includes the walk report card — which per `SPEC.md` is shared by owners with light PetPro branding, making it the product's organic acquisition surface. It deserves the most design attention of any single component.
- [ ] **A-7: Owner portal.** Different audience, same language: a pet owner sees this a few times a month, not daily. Simpler, warmer, less dense than the professional app.
- [ ] **A-8: Payment surfaces.** The pay page and invoice views. ⚠️ Stripe's hosted Checkout shows the *Stripe account's* branding regardless of what we do (platform account today; per-professional only with Stripe Connect / P2-6) — design the handoff so the jump to Stripe doesn't feel like leaving the product.
- [ ] **A-9: Native shell polish.** Splash-to-app transition, status/nav bar colors matching the theme, keyboard-avoidance behavior, and the pull-to-refresh/scroll physics that make a Capacitor app feel native rather than wrapped.
- [ ] **QA checkpoint A:** every redesigned screen verified in both frontends, light and dark, on a real Android device and a desktop browser; `npm test` (incl. `check:structure`) green; **a cold user drives the core flow unaided** — the same exercise as Week 8 and QA checkpoint U, which is the only honest test of whether a redesign helped.

---

## Workstream N — App Icon, Splash & Store Presence

*Everything a user sees before the app opens. Blocked on B-3; blocks the Play submission.*

- [ ] ⏩ **N-1: Android adaptive icon** — foreground + background layers replacing the stock `ic_launcher_foreground` / `ic_launcher_background`, generated at every mipmap density, verified in circle / squircle / rounded-square masks and against a busy wallpaper. Includes the monochrome layer for Android 13+ themed icons.
- [ ] ⏩ **N-2: Splash screen** — replace the generated `splash.png` across all `drawable-port-*` / `drawable-land-*` densities; dark-mode variant; the Capacitor splash config (duration, fade, background color) tuned so it doesn't sit longer than the app needs.
- [ ] ⏩ **N-3: PWA/web icon set** — maskable icon (`purpose: "maskable"`), PNG fallbacks at 192/512, apple-touch-icon, favicon; `manifest.webmanifest` `theme_color`/`background_color` re-checked against palette v2 and dark mode.
- [ ] **N-4: Play Store listing creative** — feature graphic (1024×500), phone screenshots (device-framed, captioned — real screens from a seeded demo account, never mockups of features that don't exist), short + full description, category and tags.
- [ ] **N-5: Listing copy + policy pages** — the description in the product's voice (B-7), plus the privacy policy and terms URLs Play requires. **Note:** Workstream D shipped real deactivation and PII-scrub behavior, so the privacy policy can describe what the app actually does rather than boilerplate.
- [ ] **N-6: iOS asset set** — deferred with the iOS port (Phase 3): App Store icon, launch screen, screenshots at Apple's required sizes. Listed here so it isn't rediscovered mid-submission.
- [ ] **QA checkpoint N:** icon and splash verified on at least two real Android devices with different launchers and both themes; listing assets checked against Play's current spec sheet before upload.

---

## Workstream E — Branded Surfaces Outside the App

*The product shows up in inboxes, on paper, and in screenshots owners send friends. Same brand, or it isn't one.*

- [ ] **E-1: Email templates.** One shared layout already exists — `emailLayout()` at `NotificationService.ts:78` — so this is one file, well placed. Needs: the mark in the header, palette v2, a real type scale, dark-mode-safe colors (Gmail and Outlook both invert; test it), plain-text parity, and 600px-table-with-inline-styles discipline because email clients still live in 2004.
- [ ] **E-2: Printable documents.** Signed contract (W-1) and printable invoice/receipt (F-6/C-4/R-12, spec'd under P2-7 in Phase 3), on V-7's print stylesheet. ⚠️ **Coordinate with P2-7:** the walker's logo is the primary brand on their invoice; PetPro's is a footer credit at most. Get that hierarchy right or it looks like the walker is billing on someone else's stationery.
- [ ] **E-3: Shared walk report card.** `SPEC.md` designates this the organic acquisition channel — an owner shares a walk card and a stranger sees PetPro. Design for the share context (screenshot, text message, social crop), including the API-free SVG route trace `SPEC.md` specifies. **Depends on P2-3 (photos) and P2-2 (GPS trace); design it now so those land into a finished shape.**
- [ ] **E-4: Marketing/landing page.** Currently there is none — `/` is the app. Decide whether Phase 4 includes a public landing page or the Play listing carries that load alone (**D4-5**).
- [ ] **QA checkpoint E:** emails rendered in Gmail web, Gmail Android, Outlook, and Apple Mail (light + dark); the contract and an invoice printed on paper and checked for page breaks and legibility.

---

## Overlap with Workstream U — read before scheduling

Workstream U (Phase 2) already contains **"Design-system tightening: extract the ad-hoc CSS into named tokens (spacing, type scale, radii, palette already exists per `SPEC.md`), one card/button/form vocabulary used everywhere, consistent light/dark parity."** That is, almost word for word, V-1 through V-3 and V-6.

Doing both means doing the work twice — tokenize once against today's ad-hoc values, then again against palette v2 and a new type scale. **Recommendation: move U's design-system bullet into Phase 4** and leave U as the pure usability/accessibility pass it otherwise is (empty/loading/error states, a11y, focus, confirmations, micro-UX debt) — those are valuable independent of what the app looks like and shouldn't wait on brand decisions.

Second-best alternative if Phase 4 stays far out: let U do the **mechanical** half (extract every hardcoded value into a token, keeping today's values) and let Phase 4 supply the **new values**. That's cheap to redo — one file of token definitions — as long as U resists inventing a design vocabulary it will have to abandon.

Either way, **U's a11y pass should re-run after Phase 4**, because a color and type change invalidates every contrast measurement taken before it.

---

## Dependencies & Sequencing

**Phase 4 depends on:**
- **Vite + TypeScript** (Workstream U's decision, 2026-07-19) — worth having before Workstream A. Redesigning `app.js` as a single growing file, then porting it, is the same work twice.
- **Workstream M's Capacitor shell** — for A-9 and all of N.
- **P2-11 (pet photos), P2-3 (walk photos), P2-2 (GPS trace)** — all Phase 3, all feeding A-4 and E-3. Design for them; don't block on them.

**Blocks:**
- **The Play Store submission** blocks on N-1/N-2 (see "Pull This Forward").
- **Workstream S's tier/pricing screens** — a paywall is a conversion surface; building it before the design language exists means rebuilding it.

### Proposed order

| Order | What | Why |
|---|---|---|
| 1 | **B-1…B-4, B-8** + **N-1…N-3** *(pull forward into Workstream M)* | Trademark check, mark, icon, splash. Unblocks Play; every test build stops looking unfinished |
| 2 | B-5…B-7, B-9 | Type, icons, voice, brand guide — completes the identity |
| 3 | Workstream V | Tokens and components. One pass, after the values are known |
| 4 | Workstream A (in A-1's priority order) | Screen by screen onto the language, incrementally shippable |
| 5 | Workstream E | Email, print, report cards — after the language is settled |
| 6 | N-4/N-5, then E-4 | Store creative uses real redesigned screens, so it comes last |
| — | N-6 | Rides with the iOS port (Phase 3) |

---

## Founder Decisions Queue

*None blocking today. Each gets logged with a date when decided, same habit as Phases 1–3.*

- [ ] **D4-1: Where does the design system get built — Workstream U or Phase 4?** See "Overlap with Workstream U." Recommendation: move it to Phase 4, leave U as the usability pass.
- [ ] **D4-2: Who designs this?** Founder + Claude Code, a contract designer for the identity only (B-1…B-4, B-9) with the system built in-house, or a designer for the whole phase. Materially changes the timeline and the budget. A mark that ends up on every invoice, email, and store listing is a reasonable place to spend money once.
- [ ] **D4-3: Typography — licensed webfont or platform stack?** Includes verifying that any license covers **embedded mobile app** use, not just web. Blocks B-5.
- [x] **D4-4: Pull the logo + Android icon forward into Workstream M?** — **DECIDED 2026-08-23 (founder): yes.** Scheduled as **M-Brand** in `PHASE_2_ROADMAP.md`; scope is **B-1…B-4, B-8 + N-1…N-3** (N-3 and B-8 added to the original recommendation — see "Pull This Forward" for why). Specs stay in this file; the schedule lives in Phase 2. **Two consequences accepted with the decision:** the mark is drawn before typography (B-5) is chosen, so the **wordmark/lockups may need a second pass** later — the symbol itself, which is what the icon uses, is unaffected; and **B-2 needs D4-6 answered** ("PetPro" vs "PetPro Connect") before the wordmark can be drawn, which promotes D4-6 from a someday-decision to a near-term one.
- [ ] **D4-5: Is a public marketing/landing page in scope (E-4), or does the Play listing carry it?**
- [ ] **D4-6: "PetPro" vs "PetPro Connect"** — which is the brand, which is the product (B-2)? Also worth settling how this relates to the sending domains already in use (`eastwestoak.com` verified at Resend, `itchytail.com` also verified) — a brand mismatch in the From line costs deliverability trust.
- [ ] **D4-7: Manual dark/light toggle, or follow the OS only?** (V-6.) A toggle is a settings screen plus a persisted preference; following the OS is free.
- [ ] **D4-8: How far does "premium, minimalist" (`SPEC.md`) still hold** now that the real user is a walker looking at a phone in daylight with a dog on the leash? Legibility and target size may matter more than restraint. Feeds B-1.

---

## Status at a Glance

| Workstream | Status |
|---|---|
| B — Brand identity & logo | Spec'd 2026-08-23. **B-1…B-4 + B-8 pulled into Phase 2 (M-Brand)** — track status there. B-5…B-7, B-9 remain here, not started |
| V — Visual design language | Not started — overlaps Workstream U, see D4-1 |
| A — App surface redesign | Not started — wants Vite migration first |
| N — Icon, splash & store | **N-1…N-3 pulled into Phase 2 (M-Brand)** — they block the Play submission; track status there. N-4/N-5 (listing creative + copy) and N-6 (iOS, Phase 3) remain here, not started |
| E — Branded surfaces (email, print, report cards) | Not started |

*Phase 2 work is tracked in `PHASE_2_ROADMAP.md`; Phase 3 (iOS port + the six relocated backlog items) in `PHASE_3_ROADMAP.md`. **The pulled M-Brand items are scheduled in Phase 2 but still specified here** — see "Pull This Forward" for the two-file convention.*

---

## Changelog

- **2026-08-23 (later)** — **D4-4 decided: yes, pull the logo + Android icon forward.** Scope pulled into `PHASE_2_ROADMAP.md` → Workstream M as **M-Brand**: **B-1…B-4, B-8** (brief, name/lockups, the mark, palette v2, trademark check) and **N-1…N-3** (adaptive icon, splash, PWA/web icon set). Two additions to the original recommendation, both because they're the same sitting or a prerequisite: **N-3** (one mark → one asset-generation pass, and the manifest ships a single unmaskable icon today) and **B-8** (the trademark check has to clear *before* the mark is finalized, not after). Specs stay in this file, schedule lives in Phase 2, items marked **⏩** here. Accepted consequences logged on D4-4: the mark precedes typography (B-5), so **wordmark/lockups may need a second pass** — the symbol the icon uses is unaffected — and **D4-6** ("PetPro" vs "PetPro Connect") is promoted to near-term because B-2 can't draw a wordmark without it. Not pulled: B-5, B-6, B-7, B-9, N-4…N-6.
- **2026-08-23** — Document created at founder direction: Phase 4 = app design + logo. Five workstreams defined (**B** brand identity & logo, **V** visual design language, **A** app surface redesign, **N** icon/splash/store presence, **E** branded surfaces outside the app), each with a QA checkpoint. Baseline audited against the real code rather than assumed: the `SPEC.md` palette is live in `styles.css:57` and worth keeping, but the logo is a placeholder paw with no wordmark or maskable variant, **the Android launcher icon and splash are still stock Capacitor defaults** (a Play-submission blocker), tokens are color-only with no spacing/type/radius scale, dark mode hardcodes `#7FB4CD` in six places, the font stack is Windows-first so the Android build silently renders in Roboto, and there is no print stylesheet. Recommended pulling **B-1…B-4 + N-1…N-3 forward into Phase 2's Workstream M** ahead of submission. Flagged the **overlap with Workstream U** — U's "design-system tightening" bullet duplicates V-1…V-3/V-6 — with a recommendation to move it here and leave U as the usability/a11y pass. Eight decisions logged in the queue (**D4-1…D4-8**), all open.
