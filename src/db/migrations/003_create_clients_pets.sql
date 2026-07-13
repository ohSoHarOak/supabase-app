-- 003: CRM — clients, pets, vaccination records.

CREATE TYPE client_status_enum AS ENUM ('prospect', 'active', 'inactive');

CREATE TABLE clients (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  owner_account_id          uuid REFERENCES accounts(id),  -- linked when the owner activates their portal account
  full_name                 text NOT NULL,
  email                     text,
  phone                     text,
  address                   text,
  emergency_contact_name    text,
  emergency_contact_phone   text,
  -- Policies
  cancellation_window_hours integer,
  no_show_fee_cents         integer,
  entry_instructions        text,
  general_notes             text,
  status                    client_status_enum NOT NULL DEFAULT 'prospect',
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_clients_professional ON clients (professional_account_id);
CREATE INDEX idx_clients_email ON clients (lower(email));

CREATE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE pets (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name               text NOT NULL,
  photo_url          text,
  breed              text,
  date_of_birth      date,
  weight_kg          numeric(5,2),
  color              text,
  microchip_number   text,
  medical_conditions text,
  behavior_notes     text,
  feeding_notes      text,
  emergency_vet      text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pets_client ON pets (client_id);
CREATE INDEX idx_pets_name ON pets (lower(name));

CREATE TRIGGER trg_pets_updated_at
  BEFORE UPDATE ON pets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Expiry dates drive automatic reminders (Notifications module).
CREATE TABLE vaccination_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pet_id          uuid NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  vaccine_name    text NOT NULL,
  administered_on date,
  expires_on      date,
  document_url    text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_vaccinations_pet ON vaccination_records (pet_id);
CREATE INDEX idx_vaccinations_expiry ON vaccination_records (expires_on);
