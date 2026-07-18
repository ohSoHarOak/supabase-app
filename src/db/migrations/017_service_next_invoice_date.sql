-- Founder decision 2026-07-17 (resolves the Week 6 [d]): weekly / biweekly /
-- monthly services auto-invoice at the END of each billing period.
--
-- next_invoice_date is the day the current period's invoice becomes due to
-- generate. The recurring-invoice worker (PaymentService) invoices services
-- whose date has arrived and advances it by one period, using the update as
-- a race guard so a period is invoiced exactly once.
--
-- NULL means "not yet scheduled": pre-existing services are left NULL by
-- this migration and initialized by the worker's first pass at one period
-- from that day — deliberately no backfill, so deploying this feature can
-- never produce surprise catch-up invoices for periods nobody agreed to.

ALTER TABLE services ADD COLUMN next_invoice_date date;

COMMENT ON COLUMN services.next_invoice_date IS
  'End of the current billing period for weekly/biweekly/monthly services; the recurring-invoice worker invoices and advances it. NULL = not scheduled (per-visit/per-day/package services, or awaiting first worker pass).';
