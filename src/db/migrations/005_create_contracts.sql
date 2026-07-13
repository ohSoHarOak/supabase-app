-- 005: Contracts — templates, generated contracts, signing.
-- HARD CONSTRAINT: once a contract is signed, its snapshot is immutable.
-- The trigger below enforces this at the database level.

CREATE TYPE contract_status_enum AS ENUM ('draft', 'sent', 'signed', 'declined', 'voided');
CREATE TYPE signing_method_enum AS ENUM ('in_person', 'electronic');

CREATE TABLE contract_templates (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name                    text NOT NULL,
  body_html               text NOT NULL,   -- contains {{variables}} substituted at generation time
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_contract_templates_updated_at
  BEFORE UPDATE ON contract_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE contracts (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  client_id               uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_id              uuid REFERENCES services(id),
  template_id             uuid REFERENCES contract_templates(id),
  generated_html          text NOT NULL,   -- immutable snapshot once signed
  status                  contract_status_enum NOT NULL DEFAULT 'draft',
  signing_method          signing_method_enum,
  signer_name             text,
  signature_image_url     text,            -- in-person: drawn signature stored in Supabase Storage
  signed_pdf_url          text,            -- electronic (Phase 1.5): signed PDF from eSign provider
  esign_envelope_id       text,            -- eSign provider's reference (Phase 1.5)
  signed_at               timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_contracts_professional ON contracts (professional_account_id);
CREATE INDEX idx_contracts_client ON contracts (client_id);
CREATE INDEX idx_contracts_status ON contracts (status);

CREATE TRIGGER trg_contracts_updated_at
  BEFORE UPDATE ON contracts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Immutability: once signed, the snapshot and signature evidence are locked.
CREATE OR REPLACE FUNCTION enforce_signed_contract_immutability()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'signed' THEN
    IF NEW.generated_html    IS DISTINCT FROM OLD.generated_html
    OR NEW.signer_name       IS DISTINCT FROM OLD.signer_name
    OR NEW.signature_image_url IS DISTINCT FROM OLD.signature_image_url
    OR NEW.signed_pdf_url    IS DISTINCT FROM OLD.signed_pdf_url
    OR NEW.signed_at         IS DISTINCT FROM OLD.signed_at
    OR NEW.signing_method    IS DISTINCT FROM OLD.signing_method THEN
      RAISE EXCEPTION 'Signed contracts are immutable (contract %)', OLD.id;
    END IF;
    -- Only allowed status transition after signing is to voided.
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'voided' THEN
      RAISE EXCEPTION 'A signed contract can only transition to voided (contract %)', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_contracts_immutable_when_signed
  BEFORE UPDATE ON contracts
  FOR EACH ROW EXECUTE FUNCTION enforce_signed_contract_immutability();

CREATE OR REPLACE FUNCTION enforce_no_delete_signed_contract()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'signed' THEN
    RAISE EXCEPTION 'Signed contracts cannot be deleted (contract %)', OLD.id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_contracts_no_delete_when_signed
  BEFORE DELETE ON contracts
  FOR EACH ROW EXECUTE FUNCTION enforce_no_delete_signed_contract();
