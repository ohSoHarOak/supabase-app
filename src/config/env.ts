import 'dotenv/config';

function required(name: string): string {
  const raw = process.env[name];
  if (!raw || !raw.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return raw.trim();
}

function optional(name: string): string | undefined {
  const raw = process.env[name];
  return raw && raw.trim() ? raw.trim() : undefined;
}

/**
 * Normalize the Supabase URL to the project base URL.
 * The dashboard sometimes hands out the REST endpoint
 * (https://xxx.supabase.co/rest/v1/) — the SDK wants the bare origin.
 */
function normalizeSupabaseUrl(url: string): string {
  return new URL(url).origin;
}

export const env = {
  supabaseUrl: normalizeSupabaseUrl(required('SUPABASE_URL')),
  supabaseAnonKey: required('SUPABASE_ANON_KEY'),
  supabaseServiceKey: required('SUPABASE_SERVICE_KEY'),
  /** Direct Postgres connection — only needed for migrations. */
  databaseUrl: optional('DATABASE_URL'),
  port: Number(process.env.PORT) || 3000,
};
