-- 014: Week 6 founder feedback (2026-07-15) — scheduling functional updates.
--
-- 1. 'per_day' billing cadence: boarding/sitting are day-priced, not
--    visit-priced. (New enum value is only ADDed here, never used in this
--    migration — required for ALTER TYPE inside a transaction.)
-- 2. offered_service_types on the professional's profile: drives which
--    service types their UI offers (a dog walker shouldn't see Grooming).
--    Empty array = no preference = show everything, so existing accounts
--    are unaffected until they pick.
-- 3. session_count on services: "# of sessions" a package includes
--    (e.g. "Training package — $500 for 10 sessions").

ALTER TYPE billing_cadence_enum ADD VALUE IF NOT EXISTS 'per_day';

ALTER TABLE professional_profiles
  ADD COLUMN offered_service_types text[] NOT NULL DEFAULT '{}';

ALTER TABLE services
  ADD COLUMN session_count integer CHECK (session_count IS NULL OR session_count > 0);
