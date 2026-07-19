-- 020: Contract term + renewal notice (founder feedback R-10/R-11/R-16,
-- decision D5 2026-07-18).
--
-- Contracts had NO term, end date, or expiry of any kind — `contracts` carried
-- only `signed_at`. So "set a contract renewal notification" had nothing to
-- fire against, and "cancel a contract" could only mean voiding a draft.
-- These are deliberate type additions, flagged per CLAUDE.md.
--
-- 1. contracts.end_date — the day the agreement's term runs out. NULL means
--    open-ended, which is what every existing contract is; there is no
--    defensible date to backfill onto an agreement whose text never named
--    one, and inventing one would send renewal notices for terms nobody
--    agreed to.
--
-- 2. contracts.renewal_notice_days — per-contract override of how far ahead
--    to warn. NULL = use the professional's default below.
--
-- 3. professional_profiles.default_renewal_notice_days — the founder's
--    general default (30 per D5), adjustable per contract as D5 requires.
--
-- Deliberately NOT added: a "renewal notice sent" flag. Whether a notice has
-- gone out is already knowable from notification_queue (a row for this
-- contract with template contract_renewal_due), exactly as appointment
-- reminders work. A second source of truth for "did we send it" is how
-- double-sends and silent misses both happen.
--
-- Signed contracts stay immutable: none of this touches generated_html, and
-- the 005 trigger still guards it. end_date is a scheduling fact ABOUT the
-- agreement, not part of the agreement text.

ALTER TABLE contracts
  ADD COLUMN end_date date,
  ADD COLUMN renewal_notice_days integer
    CHECK (renewal_notice_days IS NULL OR (renewal_notice_days >= 0 AND renewal_notice_days <= 365));

ALTER TABLE professional_profiles
  ADD COLUMN default_renewal_notice_days integer NOT NULL DEFAULT 30
    CHECK (default_renewal_notice_days >= 0 AND default_renewal_notice_days <= 365);

CREATE INDEX idx_contracts_end_date ON contracts (end_date) WHERE end_date IS NOT NULL;

COMMENT ON COLUMN contracts.end_date IS
  'Day the agreement term ends. NULL = open-ended (every pre-020 contract). Drives the renewal notice; never part of the immutable signed HTML.';
COMMENT ON COLUMN contracts.renewal_notice_days IS
  'Days before end_date to warn both parties. NULL = fall back to professional_profiles.default_renewal_notice_days.';
