# Counsel Review Packet — PetPro Connect contract templates

*Prepared 2026-07-17. Covers roadmap items W-9 (services table + addendum) and the two substantive edits flagged 2026-07-13.*

> **These drafts were prepared by the founder's engineering tooling, not by a lawyer.** They are a starting point for review, not a legal opinion. Nothing here should be used with a real client until reviewed and corrected.

---

## What's being asked

Four things, deliberately bundled into one review because the product launch is waiting on the round-trip and a second pass costs another cycle.

| # | Item | Status |
|---|---|---|
| 1 | Mutual 7-day termination (§4) | **Live today**, never reviewed |
| 2 | Payment / suspension terms (§5) | **Live today**, never reviewed |
| 3 | Services table replacing three Key Terms rows | **New draft** — `dog-walking-agreement-ca-v2.html` |
| 4 | Addendum variant | **New draft** — `dog-walking-addendum-ca.html` |

Items 1 and 2 are **unchanged, carried over verbatim** into the v2 draft, so counsel rules on exactly the words that are live in production today.

**Files to review**

- `dog-walking-agreement-ca.html` — v1, currently live. Baseline.
- `dog-walking-agreement-ca-v2.html` — v2 draft. Differs from v1 **only** in the Services table and the three sections that pointed at the deleted rows (§1, §3, §5). Everything else is byte-for-byte v1.
- `dog-walking-addendum-ca.html` — the addendum draft. New document.

---

## Background: what changed in the product

A contract used to describe **one** service — one walk type, one price, one schedule. It now carries **several**, each covering different pets at different prices and cadences: Pepper on private walks, Biscuit on a 10-session training package, on the same agreement.

Three Key Terms rows (`Walk type`, `Schedule`, `Fees & payment`) could only ever describe one service, so they become a table. Until this is approved, the software **refuses** to generate a multi-service contract rather than render two services into a document that describes one — so the current live template can't produce a wrong document while this sits in review.

The addendum exists because clients add services *after* signing ("can you also do Biscuit's training?"). The alternatives were a fresh standalone agreement each time, or letting the walker add services with no signature at all. The second is what this whole change exists to prevent.

---

## Item 3 — Services table (`-v2`)

**The change.** Three Key Terms rows become a Services table with columns: Service | Pet(s) | Fee | Notes. `Schedule` stays in Key Terms as a written description of the arrangement.

**Questions**

1. **Does the conflict clause still hold?** v1 says "In case of conflict between the Key Terms and the sections below, the Key Terms control." v2 extends this to "the Key Terms and the Services table". Fees now live in the table rather than a Key Terms row — does that need different language to keep the same precedence?
2. **§1 group-walk risk.** v1 disclosed group-walk risk unconditionally, because Walk Type was one value. In v2 it's conditional ("where a service is provided as a group walk"), since only some services may be group walks. **Is a conditional disclosure still adequate**, or should the risk language stay unconditional regardless of what's in the table?
3. **Free-text "Notes" column.** The walker types this per service. It renders inside the binding document. **Should Notes appear in the agreement at all**, or stay internal? A walker typing something contradicting a term would create a conflict the table's precedence clause resolves *in the walker's favour* — which may not be intended.
4. **Emergency vet cap with multiple pets.** Key Terms says "Up to {{cap}}". With several pets on several services, **is that per incident, per pet, or aggregate?** Ambiguous in v1 too, but multi-service makes it likely to matter.

---

## Item 4 — Addendum (`dog-walking-addendum-ca.html`)

**The intent.** Add services to a signed agreement without replacing it, and without re-signing the whole thing.

**Questions**

1. **Is this sufficient as the §17 amendment?** The Original Agreement §17 says it "may only be amended in writing signed by both parties." The addendum is drafted as exactly that, signed by both. **Does this satisfy §17, or does §17 itself need rewording** to contemplate addenda explicitly?
2. **Pets not on the original agreement — the one we're least sure about.** If the addendum adds a service for a pet the original never listed, that pet isn't covered by the original's §6 health certifications or its Key Terms vet authorization. Addendum §3 attempts to extend both **by reference**. **Is incorporation by reference enough**, or must those certifications be restated in full — or the original amended to add the pet to its Key Terms?
3. **Independent termination.** Addendum §5 lets either party terminate the added services on the same notice **without** terminating the Original Agreement. That's a product choice ("stop the training, keep the walks") — **is it drafted correctly**, and does it create a gap where the original survives with no services under it?
4. **Stacking.** Nothing limits how many addenda attach to one agreement. A client could accumulate several over a year, each supplementing the last. **Should each addendum supersede prior ones, or accumulate?** The draft assumes accumulate. Is a consolidated restatement needed past some point?
5. **Fee precedence.** Addendum §4 says the added services' fees are in its own table and the original's payment terms apply unchanged. **Is there a conflict** with the original's "Key Terms control" clause, given the addendum's table isn't in the original's Key Terms?

---

## Items 1 & 2 — the two edits already flagged (unchanged, live today)

Both are in production and have never been reviewed. They are **not modified** in the v2 draft.

1. **§4 — mutual 7-day termination.** "Either party may terminate this Agreement with seven (7) days' written notice." Plus a 3-business-day cancel-without-charge window if services haven't begun. Is the notice period enforceable and appropriate for a California consumer services agreement, and is the cancellation window consistent with any applicable statutory right?
2. **§5 — payment and suspension.** "Invoices are due upon receipt" and the provider "may suspend services while an account is more than fifteen (15) days past due." Is suspension-on-arrears enforceable as drafted, and does "due upon receipt" need a stated period?

---

## Not being asked

- **Electronic signature validity (§18).** Signing is in-person on the walker's device today; remote signing goes through the client's own portal login. Flagging it only so the assumption is visible.
- **Anything outside the CA template.** Other states are out of scope until this one is settled.

---

## What happens after review

Counsel's corrected wording drops into the template body. The software already renders the services table from structured data (`{{services_table}}`), so **approved wording is the only thing missing** — no further engineering for item 3.

The addendum needs a small amount of engineering regardless of the outcome: it references `{{original_agreement_date}}` and `{{original_pet_list}}`, which require linking an addendum to its parent agreement in the database. That work is not blocked by counsel and can proceed in parallel — but it shouldn't be built until the addendum's *shape* is confirmed, since question 4 (stacking) could change the data model.
