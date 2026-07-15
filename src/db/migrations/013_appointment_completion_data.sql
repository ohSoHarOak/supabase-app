-- 013: Week 6 — structured completion data captured when a walk is marked
-- complete. This is the seam for the Phase 2 walk-report auto-message (P2-2):
-- the same fields are carried in the walk_completed event payload, so the
-- future auto-message is just an event consumer — no schema rework later.

ALTER TABLE appointments
  ADD COLUMN actual_start_at  timestamptz,
  ADD COLUMN actual_end_at    timestamptz,
  ADD COLUMN completion_notes text,
  ADD COLUMN good_dog         boolean,
  ADD COLUMN got_a_treat      boolean;
