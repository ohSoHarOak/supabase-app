-- 009: Messaging — threads, messages, offline-first draft sync.

CREATE TABLE message_threads (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  client_id               uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  last_message_at         timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (professional_account_id, client_id)
);

CREATE TABLE messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id         uuid NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  sender_account_id uuid NOT NULL REFERENCES accounts(id),
  body              text,
  image_url         text,
  is_system         boolean NOT NULL DEFAULT false,  -- system-generated service updates
  client_draft_id   text,                            -- offline sync idempotency key (device-generated)
  read_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thread_id, client_draft_id)
);

CREATE INDEX idx_messages_thread_time ON messages (thread_id, created_at);
