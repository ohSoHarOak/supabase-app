# AI Development Prompt: PetPro Connect (v2)

## Project Overview

Design and develop a modern, secure, cloud-based mobile and web application called **PetPro Connect** — a business management platform for pet care professionals, launching with **professional dog walkers**.

The architecture must support future expansion into trainers, groomers, sitters, boarding facilities, rescues, and veterinary referral partners **without redesign**. Achieve this through a service-type abstraction in the data model (a "service" has a type, duration model, and billing model) rather than walker-specific assumptions — not through premature microservices.

---

## Build Phasing (Required)

Build in three phases. Do not begin a later phase until the prior phase is functional end-to-end.

**Phase 1 — Core Business Manager (MVP):** Accounts, client CRM, pet profiles, contracts & signing, scheduling, payments (Stripe only), messaging, notifications, owner web portal.

**Phase 2 — Differentiators:** QR check-in/out, GPS walk tracking with offline queueing, walk report cards, calendar sync (one-way export first), analytics dashboard.

**Phase 3 — Marketplace (separate revenue experiment):** Business directory, advertising, rewards/check-ins. Treat as an independent product with its own success criteria; do not let it block Phases 1–2. Phase 1 builds the four marketplace seams (see "Marketplace Readiness" below) so Phase 3 bolts on without touching core modules.

---

## Target Users

* **Primary:** Professional dog walkers (solo and small teams)
* **Owner-facing (explicit requirement):** Pet owners interact through a **magic-link web portal** in v1 (no owner app download required): view schedule, sign contracts, watch live walks, receive report cards, message their walker, pay invoices. A native owner app is a future phase.
* **Future professionals:** Trainers, groomers, sitters, boarding, rescues, kennels
* **Commercial (Phase 3):** Local businesses advertising to walkers and owners

---

## Core Design Principles

Modern, clean, fast, mobile-first, secure, accessible (WCAG 2.1 AA), cloud-based, cross-platform (iOS, Android, responsive web), modular monolith architecture with clear domain boundaries.

---

## Core Modules

### 1. User Accounts (Phase 1)

Professional profiles: name, business name, bio, years of experience, services offered (group/private walks), service areas, profile photo, gallery, licenses/insurance/certification documents (with expiry dates and renewal reminders), contact info.

### 2. Client Management / CRM (Phase 1)

Client profiles containing:

* **Owner:** name, address, phone, email, emergency contact
* **Service:** start/end date, walk type (group/private), schedule, price, **billing cadence (configurable: weekly, biweekly, monthly, per-visit, per-package)**
* **Policies:** cancellation window, no-show fee, key/entry instructions
* **Notes:** vaccinations, medical, behavior, feeding, general

Fast search and filtering across all client and pet fields.

### 3. Pet Profiles (Phase 1)

Each client may have multiple pets. Fields: name, photo, breed, age/DOB, weight, color, vaccination records **with expiry dates that drive automatic reminders**, medical conditions, behavior notes, emergency vet, microchip number, QR tag assignment (Phase 2).

Pet photos are used throughout the app for quick identification (list rows, calendar entries, map markers).

### 4. Contracts & Signing (Phase 1)

Auto-generate service agreements populated from the client profile: client info, pet info, service type, schedule, pricing, duration, cancellation/no-show policy, terms & conditions.

Signing options:

1. **In person:** capture a drawn signature on the professional's device, with timestamp and signer identity.
2. **Electronic:** send via **Nitro Sign API integration** (Professional tier).

On signing: store the signed PDF, **snapshot the contract terms immutably** (later edits to the client profile never alter a signed contract), lock the record, activate the client, and trigger the onboarding workflow.

> Contracts are provided as templates; display a notice that templates should be reviewed by the professional's own legal counsel and that enforceability varies by jurisdiction. Do not market contracts as "legally binding."

### 5. Scheduling & Calendar (Phase 1)

Day/week/month views. Create, move, and repeat appointments; view availability; conflict detection. Appointments display pet photos.

**Calendar sync (Phase 2):** one-way ICS feed export to Google, Apple, and Outlook first; two-way sync is a later enhancement (it is significantly harder and should not block launch).

### 6. QR Check-In / Check-Out (Phase 2)

Each pet gets a printable QR tag; each professional has a unique QR identity.

* **Pickup scan:** record timestamp; record GPS coordinates **only on paid tiers**.
* **Drop-off scan:** record timestamp; end service.
* History: pickup/drop-off times, duration; route history on paid tiers.
* Must work offline: scans queue locally and sync when connectivity returns.

### 7. GPS Walk Tracking — Paid Tiers (Phase 2)

* Live walk view for owners (via portal link), completed route playback, distance, timestamps, start/finish notifications.
* Map markers show dog photo, dog name, walker name — **visible only to that pet's owner and the professional; never on any public or shared map**.
* **Offline-first requirement:** GPS points buffer on-device during signal loss and upload on reconnect. Battery-efficient location sampling. GPS capture itself is satellite-based and independent of cell service; only upload, live view, and tile loading are network-dependent.
* **Owner-facing signal-gap state (required):** when the server stops receiving points mid-walk, the owner portal shows the last known location with an explicit status ("low-signal area — tracking continues on-device"), never a silently frozen marker. On reconnect, the route backfills and the live marker resumes. Walker-side map falls back to the API-free route trace if tiles can't load.
* **Walk report cards:** auto-generated post-walk summary (route, duration, distance, photos taken during the walk, notes, bathroom breaks) sent to the owner. Owners can share them; each shared card carries light PetPro branding (organic acquisition channel). **Report-card routes render API-free:** draw the recorded GPS trace as an SVG/canvas polyline on a stylized background — no basemap tile or map-load call. Report cards are the highest-volume map-shaped surface (generated per walk, re-opened and shared by owners), so keeping them off the metered map API removes the platform's largest map-cost multiplier.

### 8. Messaging (Phase 1)

Secure in-app messaging between owner and professional: push notifications, image sharing, read receipts, system-generated service updates (walk started/completed).

Security posture: **encryption in transit (TLS) and at rest** — not end-to-end encryption, since the platform must inject system messages and retain audit logs.

### 9. Payments (Phase 1)

**Stripe only for v1** (Stripe Connect for onboarding professionals). Additional gateways are future work.

* Invoices auto-generate per the client's configured billing cadence
* One-time and recurring payments, payment requests, reminders, receipts, history
* **Tips** on completed services
* Refunds and cancellation-fee charges per the client's stored policy
* Payment status visible on the dashboard

### 10. Business Directory & Advertising (Phase 3)

Business profiles (photos, description, offers, contact, website, hours), paid placement packages, map presence. Ship only after Phases 1–2 have an active user base; success criteria are separate (number of paying business accounts, ad renewal rate).

### 11. Rewards System (Phase 3)

Check-in-based loyalty at participating businesses; businesses define thresholds and rewards (e.g., 10 visits → 20% off).

### 12. Notifications (Phase 1, expanding with features)

Upcoming appointments, payment reminders, contract expiry, vaccination expiry, license/insurance expiry, walk started/completed, messages, promotions. Per-category preferences and quiet hours; owners and professionals control their own channels (push/email/SMS).

### 13. Security & Compliance (Phase 1)

* MFA, role-based permissions, encryption in transit and at rest
* Secure document storage (contracts, insurance, vaccination records)
* GDPR and CCPA compliance: data export and deletion on request
* PCI scope minimized by delegating card handling entirely to Stripe
* Automated backups, audit logs of sensitive actions (contract signing, payment events, data exports)

---

## Subscription Model

### Free — "Starter"

For walkers just starting out. **Up to 10 active clients.**

Client management, pet profiles, manual scheduling, basic calendar, contract templates with in-person signing, basic messaging, manual payment tracking, basic profile page, QR tags with timestamp-only scans.

No GPS tracking, no Nitro Sign, no automatic invoicing.

### Professional (Paid)

Everything in Free, plus: unlimited clients, Nitro Sign e-signatures, GPS tracking with live sharing and route playback, walk report cards with in-walk photo uploads, offline sync, calendar export, automatic invoicing via Stripe, recurring payments and automated requests, advanced reminders, analytics dashboard, priority support.

### Business (Paid, higher tier)

Everything in Professional, plus: multi-user accounts with roles and permissions, employee scheduling and walk assignment, team activity overview, business-level analytics and reporting, payroll-ready data export, customer reviews, custom branding on report cards and portal, custom contract templates, API access, data export. (Phase 3 adds: advertising platform access, promoted map placement, reward campaign management.) White-label and dedicated account management are future options.

### Business roles & Account Owner access

Terminology: **Account Owner** is the business owner/administrator of a Business-tier account — distinct from **pet owners** (clients). Use these exact terms throughout the product to avoid ambiguity.

Business accounts support three roles: **Account Owner** (full access), **Manager** (configurable subset), and **Employee/Walker** (own assignments only).

The Account Owner has full visibility and administrative access across the business, including every employee's:

* **Profile:** bio, photo, services, and credential documents (licenses, insurance, certifications) with expiry status
* **Calendar & scheduling:** each employee's full calendar, assigned walks, and availability — with the ability to create, reassign, and cancel appointments on their behalf
* **Content & activity:** walk history, GPS routes, report cards, in-walk photos, and QR scan records generated under the business account
* **Client communications:** message threads between employees and the business's clients (messaging under a Business account is business property, not private)
* **Money:** payments collected, invoices issued, and payroll-ready export per employee

Employees see only their own schedule, their assigned clients and pets, and their own walk history; Managers see what the Account Owner delegates. All content generated under the business account (client records, contracts, report cards, threads) belongs to the business — if an employee leaves, the Account Owner deactivates the login and all data, clients, and history remain with the business.

Transparency requirement: employees are informed at onboarding that their profile, schedule, walk activity (including GPS during service), and client communications are visible to the Account Owner. Access to this data is itself recorded in the audit log.

### Map access by tier

Interactive map rendering is metered by the provider, so map entitlements are an explicit, backend-enforced part of each tier. An owner's access always follows their professional's tier.

**Free — no interactive maps.** QR scans record timestamps only (no GPS stamp). Client addresses display as text with a deep link that opens the phone's native maps app — useful navigation at zero API cost. No live view, no route playback, no map-based report cards.

**Professional — full walk-loop maps.** Live walk map for the walker, owner live-view via the portal (one map session per active walk), and interactive route playback on walk history. Report cards remain API-free SVG renders at every tier, so the per-walk artifact never consumes map quota.

**Business — team maps.** Everything in Professional, plus a team dispatch view rendering all active walks on one map. Phase 3 adds the promoted-placement/POI layer to Business-tier maps via feature flag.

Because GPS capture itself is free (device hardware) and Free-tier users trigger zero map loads, metered map usage is generated almost entirely by paying tiers — map spend scales with revenue rather than with signups.

---

## Marketplace Readiness — build the seams, not the feature

The marketplace (directory, advertising, rewards, reviews) is deferred, but the core product must be built so it plugs in later **without modifying any core module**. Marketplace modules may depend only on the four platform seams below. Core modules must never import from or depend on marketplace modules.

**Seam 1 — Typed accounts.** The accounts table carries an `account_type` from day one (`professional`, `owner`; `business` added later). Auth, sessions, and role-based permissions are written against account type, never hardcoded to two roles. A business account later means a new type plus a new profile shape — no auth or permission rework.

**Seam 2 — Event log.** All significant actions are recorded as append-only events: `(actor_account_id, event_type, location, occurred_at, metadata JSON)`. Phase 1–2 event types: QR scan, walk started/completed, contract signed, payment received. Rewards check-ins become a new event type consumed by the rewards module; loyalty thresholds are queries over this table. Build the event log for audit and walk history now; it doubles as the rewards backbone later.

**Seam 3 — Layered maps with a provider adapter.** Every map view renders as independent, toggleable layers (route layer, live-marker layer). Business POI pins and promoted placements become an additional layer enabled by feature flag. Map components must accept a list of layers, not hardcode their contents. The map component consumes a **provider adapter interface** (render map, plot polyline, plot markers, fit bounds) rather than a vendor SDK directly — Google Maps is the launch adapter; a MapLibre/OpenStreetMap adapter can be swapped in by configuration if metered map costs bite at scale.

**Seam 4 — Generic billing.** Model Stripe products as "billable items attached to an account," not "walker subscriptions." Subscription tiers, ad packages, and promoted placements are all products; invoicing and receipts are account-level. No billing rework when businesses start paying.

**Plus feature flags per module**, so marketplace modules can ship dark and be enabled per region or cohort.

**Explicitly deferred (no seam needed — these live entirely inside Phase 3 modules):** ad serving and rotation logic, review submission and moderation, the business self-serve dashboard, and the reward ledger/redemption flow.

---

## Future Expansion

Service-type abstraction should make these additions configuration-plus-module work, not rewrites: grooming appointments, training lesson packages, boarding reservations (calendar becomes occupancy-based), rescue org management, vet referrals, adoption platform, product marketplace, insurance integrations, AI scheduling and AI-generated walk summaries, wearable/smart-collar integrations, Apple Watch companion.

---

## Technical Requirements

* iOS and Android apps (cross-platform framework acceptable, e.g., React Native or Flutter) + responsive web app
* **Owner portal:** web-based, magic-link authentication, no account creation friction
* **REST API** (single API style for v1; GraphQL only if a concrete need emerges)
* **Modular monolith** with clear domain boundaries (accounts, CRM, scheduling, contracts, payments, tracking, messaging) — structured so any domain can be extracted to a service later
* Cloud-native deployment, managed Postgres, object storage for documents/images
* Stripe Connect; Nitro Sign API
* **Maps via a provider adapter** (see Marketplace Readiness, Seam 3): Google Maps Platform is the launch provider, with Apple Maps optional on iOS; the adapter interface keeps MapLibre/OpenStreetMap available as a swap-in. GPS point capture uses device location services directly (no API cost); metered map loads occur only when rendering an interactive map view.
* **Map access is gated by product tier** (see "Map access by tier" below), and the backend enforces the gate — clients never receive a map session they aren't entitled to.
* **Map cost controls from day one:** per-day quota caps and budget alerts configured in the provider console; per-SKU usage instrumented per tenant so map spend is attributable to tiers and features.
* Push notifications (APNs/FCM), transactional email, optional SMS
* Real-time messaging (WebSocket or managed service)
* **Offline-first sync layer** for scans, GPS points, and message drafts
* QR/barcode generation and scanning
* Analytics/event instrumentation from day one

---

## UI/UX Requirements

**Brand palette (required):** primary steel blue `#2B7192` for structure (headers, navigation, map surfaces — with a derived deep shade `#1C4C64` for the darkest surfaces), orange `#F58941` reserved exclusively for primary actions and the live GPS route, and sage `#6D9280` for success/active states and map-terrain texture. Neutrals are warm (paper `#F7F2EB`, hairlines `#E5E0D6`) with blue-black text `#1E2B33`. Accessibility rule: use dark brown text (`#4B2508`) on orange fills — white on `#F58941` fails contrast; white text is fine on steel blue. Because orange appears only on the single most important action per screen, it retains its call-to-action weight.

Premium, minimalist, one-handed mobile use. Light and dark modes. Dashboard: today's schedule, upcoming appointments, recent messages, payment status. Large photo-based pet cards. Interactive maps with pet-photo markers (private to the owner/professional). Fast search. WCAG 2.1 AA. Consistent branding across mobile and web.

---

## Success Criteria (Measurable)

**Phase 1 is successful when:** a professional can onboard a new client, generate and sign a contract, schedule recurring walks, complete a service, invoice, and get paid — entirely within the app; time from signup to first signed contract under 15 minutes.

**Phase 2 is successful when:** ≥50% of paid users run GPS tracking on a majority of walks; report cards are delivered for ≥80% of tracked walks; GPS data survives connectivity loss without gaps at sync.

**Business metrics to instrument:** activation (first client added within 48h), free→paid conversion, monthly retention, MRR, report-card share rate (organic acquisition signal).
