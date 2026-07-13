-- 007: Payments — Stripe products, invoices, transaction log.
-- Marketplace Seam 4: Stripe products are "billable items attached to an
-- account", NOT hardcoded walker subscriptions.

CREATE TYPE billing_period_enum AS ENUM ('one_time', 'week', 'month');
CREATE TYPE invoice_status_enum AS ENUM ('draft', 'open', 'paid', 'void', 'uncollectible');
CREATE TYPE transaction_status_enum AS ENUM ('pending', 'succeeded', 'failed', 'refunded');

CREATE TABLE stripe_products (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  stripe_product_id text,
  stripe_price_id   text,
  name              text NOT NULL,
  unit_amount_cents integer NOT NULL,
  billing_period    billing_period_enum NOT NULL,
  metadata          jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_stripe_products_account ON stripe_products (account_id);

CREATE TABLE invoices (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  client_id               uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_id              uuid REFERENCES services(id),
  stripe_invoice_id       text UNIQUE,
  amount_cents            integer NOT NULL,
  currency                text NOT NULL DEFAULT 'usd',
  status                  invoice_status_enum NOT NULL DEFAULT 'draft',
  due_date                date,
  paid_at                 timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoices_professional ON invoices (professional_account_id);
CREATE INDEX idx_invoices_client ON invoices (client_id);
CREATE INDEX idx_invoices_status ON invoices (status);

CREATE TRIGGER trg_invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- stripe_event_id UNIQUE gives webhook idempotency: replaying the same
-- Stripe event can never record a payment twice.
CREATE TABLE payment_transactions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id               uuid REFERENCES invoices(id),
  stripe_payment_intent_id text,
  stripe_event_id          text UNIQUE,
  amount_cents             integer NOT NULL,
  status                   transaction_status_enum NOT NULL,
  occurred_at              timestamptz NOT NULL DEFAULT now(),
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_transactions_invoice ON payment_transactions (invoice_id);
