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
  /** Stripe (test mode during build). Optional so the app still boots
   *  without them — payment endpoints return 503 until keys are set. */
  stripeSecretKey: optional('STRIPE_SECRET_KEY'),
  stripeWebhookSecret: optional('STRIPE_WEBHOOK_SECRET'),
  /** Email (Week 7). Optional so the app boots without it — notifications
   *  queue as pending and send once the key is added. */
  resendApiKey: optional('RESEND_API_KEY'),
  /** Sender address. Resend's onboarding sender works without domain setup
   *  but only delivers to the Resend account owner's inbox. */
  emailFrom: optional('EMAIL_FROM') ?? 'PetPro Connect <onboarding@resend.dev>',
  port: Number(process.env.PORT) || 3000,
};
