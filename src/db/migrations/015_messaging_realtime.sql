-- 015: Week 7 messaging — Supabase Realtime + row security for browser reads.
--
-- The API always talks to Postgres with the service role, which bypasses RLS,
-- so nothing here changes server behavior. These policies exist for exactly
-- one consumer: the browser subscribing to Supabase Realtime with the public
-- anon key + the logged-in user's JWT. Realtime evaluates SELECT policies per
-- subscriber, so without RLS every anon-key holder would receive every
-- message — with these, a professional only ever receives their own threads.

ALTER TABLE message_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Week 8 note: the owner portal adds a second policy here so a client's
-- owner account can read the thread via clients.owner_account_id.
CREATE POLICY message_threads_professional_select ON message_threads
  FOR SELECT TO authenticated
  USING (
    professional_account_id IN (
      SELECT id FROM accounts WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY messages_professional_select ON messages
  FOR SELECT TO authenticated
  USING (
    thread_id IN (
      SELECT t.id
      FROM message_threads t
      JOIN accounts a ON a.id = t.professional_account_id
      WHERE a.auth_user_id = auth.uid()
    )
  );

-- Realtime only broadcasts changes for tables in this publication.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE messages;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
