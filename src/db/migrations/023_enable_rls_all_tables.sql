-- 023: Enable Row-Level Security on every public table (Supabase advisor:
--      rls_disabled_in_public — "Table publicly accessible").
--
-- THE HOLE THIS CLOSES:
--   Supabase auto-publishes every table in the `public` schema as a REST API
--   at https://<ref>.supabase.co/rest/v1/<table>. That API is reachable with
--   the public anon key — which we serve to the browser ourselves at
--   /api/config for Realtime messaging. With RLS OFF, anyone holding that anon
--   key can bypass the Express app entirely and read/insert/update/DELETE every
--   client, pet, contract, and payment row directly. RLS is the ONLY gate on
--   that public API.
--
-- WHY THIS IS SAFE FOR OUR ARCHITECTURE:
--   The API talks to Postgres with the SERVICE ROLE (src/config/supabase.ts →
--   supabaseAdmin), which bypasses RLS. So does this migration runner (a direct
--   owner connection via DATABASE_URL). Enabling RLS with NO policies makes a
--   table deny-all to the anon/authenticated roles while leaving the service
--   role — our only intended data path — completely unaffected. Nothing in the
--   app reads these tables with the anon key: the browser only ever opens a
--   Realtime channel on `messages`/`message_threads`, and those two already got
--   RLS + SELECT policies in 015, so this loop skips them.
--
-- IDEMPOTENT + REVERSIBLE:
--   Only flips tables where rowsecurity = false, so re-runs are no-ops and the
--   already-secured messaging tables keep their policies. Adds no policies and
--   touches no data. To undo a single table:  ALTER TABLE public.<t> DISABLE
--   ROW LEVEL SECURITY;  (but don't — that re-opens the public API).

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND rowsecurity = false
    ORDER BY tablename
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', r.tablename);
    RAISE NOTICE 'RLS enabled on public.%', r.tablename;
  END LOOP;
END $$;
