import { createClient } from '@supabase/supabase-js';
import { env } from './env';

/**
 * Admin client (service role) — bypasses RLS, can create users.
 * Server-side only; the service key must never reach a browser.
 */
export const supabaseAdmin = createClient(env.supabaseUrl, env.supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Anon client — used for auth flows that act "as the user"
 * (password sign-in, magic links).
 */
export const supabaseAnon = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
