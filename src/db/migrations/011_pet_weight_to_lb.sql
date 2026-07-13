-- 011: Founder feedback (Week 2) — walkers track weight in pounds, not kg.
-- Existing rows are test data only, so no value conversion is performed.

ALTER TABLE pets RENAME COLUMN weight_kg TO weight_lb;
