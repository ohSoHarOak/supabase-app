-- 021: Send an invoice to an absent pet owner (founder finding 2026-07-18
-- during the Week 5 test-card run; decisions D6 + D7).
--
-- The gap: creating an invoice told the client NOTHING. PaymentService
-- published an `invoice_generated` event but enqueued no notification, and no
-- invoice template existed at all — payment_receipt and payment_received both
-- fire only AFTER the money arrives. Meanwhile "Collect payment" opens Stripe
-- Checkout in the WALKER's browser, which only works if the owner is standing
-- there. So an invoice reached an absent owner only if they independently
-- logged into the portal and noticed.
--
-- 1. pay_token — a high-entropy random token (32 bytes, base64url) minted the
--    first time an invoice is sent. It backs a PUBLIC, login-free "view and
--    pay this invoice" page, because requiring a portal login to pay a bill
--    reintroduces Supabase's ~2-magic-links-per-hour ceiling on the exact
--    path where friction costs the walker money.
--
--    ⚠️ SECURITY, stated plainly since this is a new public surface:
--    the token is a bearer capability. Anyone holding it can view ONE
--    invoice's amount, description and status, and start a Stripe Checkout
--    for it. It grants nothing else — no client record, no pets, no other
--    invoice, no session, no cookie. 32 random bytes is 256 bits, so guessing
--    is not a threat; the realistic exposure is a forwarded email, and the
--    worst outcome there is a stranger PAYING someone's bill.
--
--    Deliberately NOT a Stripe Checkout URL in the email: those sessions
--    expire in ~24h, so an invoice opened on the weekend would be dead.
--    The token is durable and mints a fresh Checkout on each visit.
--
--    NULL until first sent — an invoice nobody sent has no public surface.
--
-- 2. sent_at — when the invoice was last emailed, so the UI can say "sent
--    3 days ago" and the walker knows whether to chase. NULL = never sent,
--    which is every invoice before this migration and every auto-invoice
--    from a completed walk until the walker sends it (decision D7: sending
--    is explicit, or a daily walker emails their client daily).

ALTER TABLE invoices
  ADD COLUMN pay_token text UNIQUE,
  ADD COLUMN sent_at timestamptz;

CREATE INDEX idx_invoices_pay_token ON invoices (pay_token) WHERE pay_token IS NOT NULL;

COMMENT ON COLUMN invoices.pay_token IS
  'Bearer capability for the public /pay/<token> page: view + pay THIS invoice only. 32 random bytes. NULL until the invoice is first sent. Never reuse across invoices.';
COMMENT ON COLUMN invoices.sent_at IS
  'When the invoice was last emailed to the client. NULL = never sent (sending is an explicit action, per decision D7).';
