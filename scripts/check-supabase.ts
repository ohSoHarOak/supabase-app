/**
 * Diagnostic: verifies the Supabase credentials in .env actually work.
 * Usage: npx tsx scripts/check-supabase.ts
 */
import { supabaseAdmin } from '../src/config/supabase';
import { env } from '../src/config/env';

async function main() {
  console.log(`Project URL: ${env.supabaseUrl}`);

  // Service key check: only the service role may list auth users.
  const { error: authError } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });
  console.log(authError ? `SERVICE KEY: FAILED — ${authError.message}` : 'SERVICE KEY: OK (auth admin reachable)');

  // Schema check: does the accounts table exist yet (i.e. have migrations run)?
  const { error: tableError } = await supabaseAdmin.from('accounts').select('id').limit(1);
  if (tableError) {
    console.log(`SCHEMA: accounts table not reachable — ${tableError.message}`);
    console.log('        (expected before migrations have been run)');
  } else {
    console.log('SCHEMA: OK — accounts table exists, migrations have been applied');
  }

  process.exit(authError ? 1 : 0);
}

main().catch((err) => {
  console.error(`Connection check failed: ${err.message}`);
  process.exit(1);
});
