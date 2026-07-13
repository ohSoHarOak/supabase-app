-- 001: Core accounts table.
-- Marketplace Seam 1: account_type drives auth/permissions everywhere.
-- Auth itself lives in Supabase Auth (auth.users); accounts.auth_user_id links to it.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE account_type_enum AS ENUM ('professional', 'business', 'owner');
CREATE TYPE account_status_enum AS ENUM ('active', 'suspended', 'deactivated');

CREATE TABLE accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  uuid UNIQUE,               -- references auth.users(id); null until first login for magic-link owners
  account_type  account_type_enum NOT NULL,
  email         text NOT NULL UNIQUE,
  phone         text,
  status        account_status_enum NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_accounts_type ON accounts (account_type);
CREATE INDEX idx_accounts_email ON accounts (lower(email));

-- Shared updated_at trigger, reused by later migrations.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_accounts_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
