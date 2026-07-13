-- 008: Append-only event log.
-- Marketplace Seam 2: audit trail now, rewards/analytics backbone later.
-- HARD CONSTRAINT: INSERT only. The trigger below blocks UPDATE and DELETE.

CREATE TABLE events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_account_id uuid REFERENCES accounts(id),
  event_type       text NOT NULL,        -- e.g. 'account_created', 'contract_signed', 'walk_completed', 'payment_received'
  subject_type     text,                 -- e.g. 'contract', 'appointment', 'invoice'
  subject_id       uuid,
  location         jsonb,                -- { lat, lng } when relevant (QR scans, walks)
  metadata         jsonb NOT NULL DEFAULT '{}',
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_actor ON events (actor_account_id, occurred_at);
CREATE INDEX idx_events_type ON events (event_type, occurred_at);
CREATE INDEX idx_events_subject ON events (subject_type, subject_id);

CREATE OR REPLACE FUNCTION enforce_events_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'events table is append-only: % not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_events_append_only
  BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION enforce_events_append_only();

-- Privacy boundary: who is allowed to see each event.
CREATE TABLE event_audience (
  event_id              uuid NOT NULL REFERENCES events(id),
  visible_to_account_id uuid NOT NULL REFERENCES accounts(id),
  PRIMARY KEY (event_id, visible_to_account_id)
);

CREATE INDEX idx_event_audience_account ON event_audience (visible_to_account_id);
