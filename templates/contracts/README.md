# Contract Templates

Seed templates for Week 3 contract generation. `ContractService.generateContract()` substitutes `{{snake_case}}` placeholders with real account/client/pet data and stores the result as the contract's `generated_html`.

Two files per template — keep them in sync:

- `dog-walking-agreement-ca.html` — what the app actually loads and substitutes
- `Dog_Walking_Agreement_CA_TEMPLATE.docx` — founder/legal review copy (2 pages)

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

## Rules

- Once a contract's status is `signed`, its `generated_html` is immutable (DB trigger enforces this).
- Signature placeholders survive generation and are only filled by the in-person signing flow.
- Every template must include the legal-review notice near the top.
