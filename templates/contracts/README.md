# Contract Templates

Seed templates for Week 3 contract generation. `ContractService.generateContract()` substitutes `{{snake_case}}` placeholders with real account/client/pet data and stores the result as the contract's `generated_html`.

Two files per template — keep them in sync:

- `dog-walking-agreement-ca.html` — what the app actually loads and substitutes
- `Dog_Walking_Agreement_CA_TEMPLATE.docx` — founder/legal review copy (2 pages)

## Live vs draft

**Live:** `dog-walking-agreement-ca.html` (v1). This is the only template the app seeds and the only one a real contract can be generated from.

**Drafts awaiting counsel (W-9)** — not seeded, not usable until approved. See `COUNSEL_REVIEW.md` for what counsel is being asked:

| HTML (app) | .docx (review copy) | What it is |
|---|---|---|
| `dog-walking-agreement-ca-v2.html` | `Dog_Walking_Agreement_CA_v2_DRAFT.docx` | Multi-service variant. Identical to v1 except the Services table and §1/§3/§5, which referenced the deleted Key Terms rows. |
| `dog-walking-addendum-ca.html` | `Dog_Walking_Addendum_CA_DRAFT.docx` | Adds services to an already-signed agreement instead of replacing it. |

The `.docx` copies are generated, not hand-edited — regenerate them rather than editing, or they drift from the HTML the software actually renders. Every substantive sentence is checked word-for-word against its HTML counterpart; the first build silently genericized the mandatory legal-review notice to "this document" and the check caught it.

The addendum needs two placeholders that **do not exist yet** — `{{original_agreement_date}}` and `{{original_pet_list}}` — which require linking an addendum to its parent contract. Deliberately unbuilt: `COUNSEL_REVIEW.md` question 4 (do addenda stack or supersede?) could change the data model.

## Placeholder reference

| Placeholder | Source | Notes |
|---|---|---|
| `{{effective_date}}` | generation time | date the contract is generated |
| `{{provider_business_name}}` | professional account | business name shown as "Service Provider" |
| `{{provider_name}}` | professional account | printed name in signature block |
| `{{client_name}}` `{{client_address}}` `{{client_phone}}` `{{client_email}}` | `clients` | |
| `{{pet_list}}` | `pets` | e.g. "Biscuit (Golden Retriever), Mochi (Corgi)" |
| `{{walk_type}}` | chosen at generation | "Private Walk" or "Group Walk" — resolved, not left as an option |
| `{{service_schedule}}` | manual until Week 6 | e.g. "Mon/Wed/Fri, 30-minute midday walk" |
| `{{service_price}}` | manual until Week 5 | e.g. "$30 per 30-minute walk" |
| `{{cancellation_window_hours}}` | `clients.cancellation_window_hours` | used in Key Terms + Sections 2–3 |
| `{{no_show_fee}}` | `clients.no_show_fee_cents` | formatted as dollars |
| `{{key_handling}}` | chosen at generation | e.g. "One key held by Service Provider" — no codes/lockbox details (those stay in `clients.entry_instructions`) |
| `{{emergency_vet_cap}}` | chosen at generation | e.g. "$500" |
| `{{preferred_vet}}` `{{emergency_contact}}` | chosen at generation | candidate future client/pet fields — flag before adding to `src/types` |
| `{{photo_consent}}` | chosen at generation | "Yes" or "No" — resolved at generation |
| `{{start_date}}` | chosen at generation | first day of service |
| `{{client_signature_image}}` `{{provider_signature_image}}` | signing flow | replaced with `<img>` of captured signature at signing, not generation |
| `{{signed_date}}` | signing flow | filled when signed |
| `{{services_table}}` | the contract's services (W-6) | **The one trusted-markup placeholder.** Every other value is HTML-escaped; this renders a `<table>` built by `servicesTableHtml()`, where the markup is ours and each cell is still escaped. Draft templates only until W-9 clears. |
| `{{original_agreement_date}}` `{{original_pet_list}}` | **not implemented** | Addendum draft only. Needs a parent-contract link before the addendum can render. |

`{{walk_type}}` and `{{service_price}}` are **derived from the structured services since W-5** — the walker no longer types them. They persist in v1 only; the v2 draft replaces both with `{{services_table}}`.

## Rules

- Once a contract's status is `signed`, its `generated_html` is immutable (DB trigger enforces this).
- Signature placeholders survive generation and are only filled by the in-person signing flow.
- Every template must include the legal-review notice near the top.
