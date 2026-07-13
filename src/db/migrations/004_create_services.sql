-- 004: Services — the walk/training/grooming product a client is buying.
-- Service-type abstraction is what lets trainers/groomers/etc. use the same
-- tables later without redesign.

CREATE TYPE service_type_enum AS ENUM (
  'group_walk', 'private_walk', 'training_session', 'grooming',
  'sitting', 'boarding', 'other'
);

CREATE TYPE billing_cadence_enum AS ENUM (
  'weekly', 'biweekly', 'monthly', 'per_visit', 'per_package', 'one_time'
);

CREATE TYPE service_status_enum AS ENUM ('draft', 'active', 'paused', 'ended');

CREATE TABLE services (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id               uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  professional_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  service_type            service_type_enum NOT NULL,
  name                    text NOT NULL,
  description             text,
  duration_minutes        integer,
  price_cents             integer NOT NULL,
  billing_cadence         billing_cadence_enum NOT NULL,
  start_date              date,
  end_date                date,
  status                  service_status_enum NOT NULL DEFAULT 'draft',
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_services_client ON services (client_id);
CREATE INDEX idx_services_professional ON services (professional_account_id);

CREATE TRIGGER trg_services_updated_at
  BEFORE UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Which pets are covered by a service.
CREATE TABLE service_pets (
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  pet_id     uuid NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  PRIMARY KEY (service_id, pet_id)
);
