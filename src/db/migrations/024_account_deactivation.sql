-- 024: Account lifecycle — deactivation seam (Workstream D / P2-15).
--
-- Two nullable columns on `accounts`. Both are deliberate additions flagged
-- per CLAUDE.md and mirrored in src/types/index.ts (Account).
--
-- 1. stripe_connect_account_id — the M-Connect seam.
--    Workstream D is sequenced BEFORE Workstream M precisely so this link
--    exists first. It is a NULLABLE, REPLACEABLE pointer to a Stripe Connect
--    account, never hardwired into the payment path. M-Connect will populate
--    it during "Get paid" onboarding; deactivation NULLs it (a terminated
--    relationship must be able to drop the connected account cleanly). Nothing
--    reads it yet — this migration only carves the seam.
--
-- 2. deactivated_at — when the account was deactivated. NULL for active/
--    suspended accounts. Lets us tell "never deactivated" from "deactivated at
--    time T" without overloading updated_at, and gives support/audit a date.
--    The status enum already has 'deactivated' (migration 001) — this is the
--    timestamp that pairs with the flip.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, so re-runs are no-ops.

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id text,
  ADD COLUMN IF NOT EXISTS deactivated_at            timestamptz;

COMMENT ON COLUMN accounts.stripe_connect_account_id IS
  'M-Connect seam: nullable/replaceable Stripe Connect account id. NULLed on deactivation. Never assume it is set in the payment path.';
COMMENT ON COLUMN accounts.deactivated_at IS
  'When status was flipped to deactivated (Workstream D). NULL unless deactivated.';
