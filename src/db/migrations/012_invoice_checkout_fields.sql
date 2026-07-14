-- 012: Week 5 payments — two deliberate additions to invoices (flagged to
-- founder per CLAUDE.md):
--   description                — human-readable line item; shown in the UI
--                                and as the product name on Stripe Checkout.
--   stripe_checkout_session_id — the Checkout Session collecting this
--                                invoice, so payment status can be reconciled
--                                directly from Stripe even if the webhook
--                                isn't configured or hasn't arrived yet.

ALTER TABLE invoices
  ADD COLUMN description text,
  ADD COLUMN stripe_checkout_session_id text;
