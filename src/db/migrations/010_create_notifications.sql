-- 010: Notifications — per-category preferences and delivery queue.

CREATE TYPE notification_channel_enum AS ENUM ('push', 'email', 'sms');
CREATE TYPE notification_status_enum AS ENUM ('pending', 'sent', 'failed', 'cancelled');

CREATE TABLE notification_preferences (
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  category          text NOT NULL,     -- 'appointment_reminder', 'payment', 'contract', 'vaccination_expiry', 'message', ...
  channel           notification_channel_enum NOT NULL,
  enabled           boolean NOT NULL DEFAULT true,
  quiet_hours_start time,
  quiet_hours_end   time,
  PRIMARY KEY (account_id, category, channel)
);

CREATE TABLE notification_queue (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  category      text NOT NULL,
  channel       notification_channel_enum NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}',
  status        notification_status_enum NOT NULL DEFAULT 'pending',
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_notification_queue_due ON notification_queue (status, scheduled_for);
CREATE INDEX idx_notification_queue_account ON notification_queue (account_id);
