# Contract Templates

Seed templates for contract generation. `ContractService.generateContract()` substitutes `{{snake_case}}` placeholders with real account/client/pet data and stores the result as the contract's `generated_html`.

## Live

**`pet-services-agreement.html` — the Pet Services Agreement — is the only template the app seeds** (founder decision 2026-07-17; the CA v2 + addendum counsel packet was removed the same day). It carries `{{services_table}}`, so one contract can describe multiple services with different pets, prices, and cadences. Source: `Pet Services Agreement.docx` (founder-supplied; conversion decisions are documented in the HTML file's header comment).

⚠️ The source was a generic template, not counsel-reviewed language. The in-document legal-review notice is load-bearing: both parties are told to have their own counsel review before signing.

## Retained, not seeded

- `dog-walking-agreement-ca.html` (+ `Dog_Walking_Agreement_CA_TEMPLATE.docx`) — the v1 CA dog-walking agreement, live from Week 3 until 2026-07-17. Kept for history: accounts that seeded it still hold their own copy in `contract_templates`, and signed contracts generated from it remain valid immutable snapshots. It has no `{{services_table}}`, so multi-service generation against it is refused (422 `template_single_service_only`).

## Placeholder reference

| Placeholder | Source | Notes |
|---|---|---|
| `{{effective_date}}` | generation time | date the contract is generated |
| `{{provider_business_name}}` | professional account | business name shown as "Service Provider" |
| `{{provider_name}}` | professional account | printed name in signature block |
| `{{client_name}}` `{{client_address}}` `{{client_phone}}` `{{client_email}}` | `clients` | |
| `{{pet_list}}` | the contract's services (W-6) | union of the services' pets; falls back to every pet when a contract has no services |
| `{{services_table}}` | the contract's services (W-6) | **The one trusted-markup placeholder.** Every other value is HTML-escaped; this renders a `<table>` built by `servicesTableHtml()`, where the markup is ours and each cell is still escaped. |
| `{{service_schedule}}` | chosen at generation | e.g. "Mon/Wed/Fri, 30-minute midday walk" |
| `{{start_date}}` | chosen at generation | first day of service |
| `{{cancellation_window_hours}}` | `clients.cancellation_window_hours` | |
| `{{emergency_contact}}` | `clients` | name + phone of the emergency contact |
| `{{preferred_vet}}` | `pets.emergency_vet` | first pet with a vet on file |
| `{{client_signature_image}}` `{{provider_signature_image}}` | signing flow | replaced with `<img>` of the captured signature at signing, not generation |
| `{{signed_date}}` | signing flow | filled when signed |
| `{{walk_type}}` `{{service_price}}` `{{no_show_fee}}` `{{key_handling}}` `{{emergency_vet_cap}}` `{{photo_consent}}` | legacy / CA v1 only | still resolved when present (derived from the structured service or the generate form), but the Pet Services Agreement doesn't use them |

Write template comments **without** literal `{{...}}` tokens — substitution runs on the whole file, comments included; a braces token in a comment gets replaced with real client data into the frozen document.

## Rules

- Once a contract's status is `signed`, its `generated_html` is immutable (DB trigger enforces this).
- Signature placeholders survive generation and are only filled by the signing flow.
- Every template must include the legal-review notice near the top.
