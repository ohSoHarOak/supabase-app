-- 002: Profile shapes per account type, plus business roles (future tier)
-- and credential documents with expiry tracking.

CREATE TABLE professional_profiles (
  account_id        uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  full_name         text NOT NULL,
  business_name     text,
  bio               text,
  years_experience  integer,
  service_areas     text[] NOT NULL DEFAULT '{}',
  profile_photo_url text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_professional_profiles_updated_at
  BEFORE UPDATE ON professional_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE owner_profiles (
  account_id  uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  full_name   text NOT NULL,
  address     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_owner_profiles_updated_at
  BEFORE UPDATE ON owner_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Business tier (multi-user) — schema seam only in Phase 1, no features built on it yet.
CREATE TYPE business_role_enum AS ENUM ('account_owner', 'manager', 'employee');

CREATE TABLE business_profiles (
  account_id    uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  business_name text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_business_profiles_updated_at
  BEFORE UPDATE ON business_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE business_roles (
  business_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  member_account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role                business_role_enum NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_account_id, member_account_id)
);

-- Licenses, insurance, certifications — expiry drives renewal reminders.
CREATE TABLE credential_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind         text NOT NULL,               -- 'license' | 'insurance' | 'certification'
  title        text NOT NULL,
  document_url text,
  issued_on    date,
  expires_on   date,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_credential_documents_account ON credential_documents (account_id);
CREATE INDEX idx_credential_documents_expiry ON credential_documents (expires_on);
