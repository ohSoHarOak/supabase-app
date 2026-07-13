-- 006: Scheduling — appointments with weekly recurrence, availability blocks.

CREATE TYPE appointment_status_enum AS ENUM ('scheduled', 'completed', 'cancelled', 'no_show');

CREATE TABLE appointments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id              uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  client_id               uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  professional_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  starts_at               timestamptz NOT NULL,
  ends_at                 timestamptz NOT NULL,
  status                  appointment_status_enum NOT NULL DEFAULT 'scheduled',
  recurrence_rule         text,   -- iCal RRULE string; null for one-off appointments
  recurrence_parent_id    uuid REFERENCES appointments(id) ON DELETE SET NULL,
  notes                   text,
  completed_at            timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX idx_appointments_professional_time ON appointments (professional_account_id, starts_at);
CREATE INDEX idx_appointments_client ON appointments (client_id);
CREATE INDEX idx_appointments_status ON appointments (status);

CREATE TRIGGER trg_appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE appointment_pets (
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  pet_id         uuid NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  PRIMARY KEY (appointment_id, pet_id)
);

-- Blocks of time a professional is unavailable (vacation, personal, etc.).
CREATE TABLE availability_blocks (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  starts_at               timestamptz NOT NULL,
  ends_at                 timestamptz NOT NULL,
  reason                  text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX idx_availability_professional_time ON availability_blocks (professional_account_id, starts_at);
