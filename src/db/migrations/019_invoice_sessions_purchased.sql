-- 019: Prepaid visits (founder feedback R-2/R-3, decision D4 2026-07-18).
--
-- "Walks are pre-paid unless otherwise noted." Until now every per_visit
-- completion created a fresh invoice (SchedulingService.completeAppointment),
-- so a walk the client had already paid for prompted to bill them again.
--
-- This column records how many visits an invoice BUYS. A client prepays for
-- 10 walks; each completion draws one down and bills nothing; when the
-- balance runs out, completions go back to invoicing as before.
--
-- NULL = not a prepaid purchase, which is every invoice created before this
-- migration and every ordinary one-off invoice after it. Deliberately NOT
-- defaulted to 1: "this invoice bought one visit" and "this invoice isn't a
-- package" are different claims, and back-dating the first onto historical
-- rows would silently credit clients visits nobody sold them.
--
-- The consumed count is deliberately NOT stored. It is COUNT(completed
-- appointments for the service) — derived, so it cannot drift out of sync
-- with the schedule the way a counter column would. Same reasoning as O-1's
-- derived "setup complete".

ALTER TABLE invoices
  ADD COLUMN sessions_purchased integer
    CHECK (sessions_purchased IS NULL OR sessions_purchased > 0);

COMMENT ON COLUMN invoices.sessions_purchased IS
  'Visits this invoice prepays for its service_id. NULL = not a prepaid package. Balance remaining = SUM(sessions_purchased) over PAID invoices - COUNT(completed appointments); the used side is derived, never stored.';
