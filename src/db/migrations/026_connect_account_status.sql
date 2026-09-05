-- 026: Stripe Connect onboarding status (M-Connect).
--
-- 024 added accounts.stripe_connect_account_id as the seam — the nullable,
-- replaceable link to the walker's connected account. Having the id is NOT the
-- same as being able to take money: an Express account exists the moment we
-- create it, but Stripe only turns on capabilities once the walker has finished
-- identity/bank verification, which can take minutes or days.
--
-- The BLOCK decision (2026-08-29) rides on that difference: card collection is
-- refused until the connected account can actually accept a charge. These
-- columns are the cached answer, so the gate doesn't make a Stripe round trip
-- on every checkout and every page render.
--
-- They are a CACHE, not the source of truth. Stripe is. They are refreshed on
-- the account.updated webhook, when the walker returns from hosted onboarding,
-- and on demand. Treat a stale `true` as the risk to design against: the worst
-- case is one refused charge from Stripe, which is recoverable, rather than
-- money silently routed to the wrong account.
--
-- All three default FALSE so every existing row is "not ready" until proven
-- otherwise — the safe direction for a gate.

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS stripe_connect_charges_enabled   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_connect_payouts_enabled   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_connect_details_submitted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_connect_synced_at         timestamptz;

COMMENT ON COLUMN accounts.stripe_connect_charges_enabled IS
  'Cache of Stripe account.charges_enabled. THIS is what gates collecting payment (BLOCK, 2026-08-29). Source of truth is Stripe; refreshed by webhook, onboarding return, and on demand.';

COMMENT ON COLUMN accounts.stripe_connect_payouts_enabled IS
  'Cache of Stripe account.payouts_enabled — whether money actually reaches the walker''s bank. Can lag charges_enabled; surfaced to the walker, not used as the charge gate.';

COMMENT ON COLUMN accounts.stripe_connect_details_submitted IS
  'Cache of Stripe account.details_submitted — whether the walker finished the hosted onboarding form. Distinguishes "never started" from "submitted, awaiting Stripe review" in the UI.';

COMMENT ON COLUMN accounts.stripe_connect_synced_at IS
  'When the three flags above were last read from Stripe. NULL means never synced.';

-- Which connected account a charge was actually created on.
--
-- Not redundant with accounts.stripe_connect_account_id: that one is a
-- *replaceable link* and is allowed to change or be nulled (disconnect,
-- relationship termination, deactivation). A Checkout Session, once created,
-- lives on ONE Stripe account forever, and every later read of it — the
-- webhook-independent sync path, a refund, a dispute — has to address that
-- same account or Stripe answers "no such session".
--
-- Deriving it from the walker's current link at read time would work right up
-- until the moment it mattered: a walker who disconnects with an unpaid
-- invoice outstanding would strand it, unreconcilable. So the routing is
-- recorded on the invoice at charge time and read back from there.
--
-- NULL means a pre-M-Connect invoice, charged on the platform account.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id text;

COMMENT ON COLUMN invoices.stripe_connect_account_id IS
  'The connected account this invoice''s Checkout Session was created on, captured at charge time. Read back by the sync and webhook paths. NULL = pre-M-Connect, charged on the platform account.';
