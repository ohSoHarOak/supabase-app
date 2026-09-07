/**
 * Delete stray TEST-MODE connected accounts.
 *
 * The e2e suite leaves one connected account per run, and config probing left
 * more. They are harmless but they make the Stripe dashboard unreadable.
 *
 * Lists by default. Deletes only with --delete, and only ever in test mode:
 * the live-key guard is a hard refusal, not a prompt.
 *
 *   npx tsx scripts/cleanup-test-connect-accounts.ts
 *   npx tsx scripts/cleanup-test-connect-accounts.ts --delete
 *
 * ⚠️ Skips any account id still referenced by `accounts.stripe_connect_account_id`
 * in the database — deleting one of those would strand a walker with a dead link
 * that only clears on their next onboarding attempt.
 */
import 'dotenv/config';
import Stripe from 'stripe';
import { supabaseAdmin } from '../src/config/supabase';

const key = process.env.STRIPE_SECRET_KEY;
if (!key) throw new Error('STRIPE_SECRET_KEY not set');
if (!key.startsWith('sk_test')) {
  throw new Error('REFUSING: this script only runs against a test key.');
}

const stripe = new Stripe(key) as any;
const doDelete = process.argv.includes('--delete');
const first = (e: any) => String(e?.message ?? e).split(/\r?\n/)[0];

/**
 * Which configurations are actually applied to an account.
 *
 * ⚠️ Stripe refuses `close()` unless EVERY applied configuration is named, and
 * the error ("You must correctly specify the applied configurations") does not
 * say which one is wrong. Two traps here, both hit while writing this:
 *   - Hardcoding ['merchant'] works only for accounts this codebase creates.
 *     Older hand-made test accounts also carry 'customer'.
 *   - `Object.keys(configuration)` is NOT the answer: the object includes
 *     un-applied configurations with a null value, so 'recipient' sneaks in
 *     and the close is rejected for naming one it does not have.
 * The account exposes `applied_configurations` directly. Use that.
 */
async function appliedConfigurations(id: string): Promise<string[]> {
  const acct = await stripe.v2.core.accounts.retrieve(id, {
    include: ['configuration.customer', 'configuration.merchant', 'configuration.recipient'],
  });
  if (Array.isArray(acct.applied_configurations) && acct.applied_configurations.length) {
    return acct.applied_configurations;
  }
  // Fallback: keys whose configuration is actually populated, never the nulls.
  const applied = Object.entries(acct.configuration ?? {})
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k]) => k);
  return applied.length ? applied : ['merchant'];
}

async function main() {
  const { data: linked, error } = await supabaseAdmin
    .from('accounts')
    .select('id, stripe_connect_account_id')
    .not('stripe_connect_account_id', 'is', null);
  if (error) throw new Error(`could not read linked accounts: ${error.message}`);

  const inUse = new Map<string, string>(
    (linked ?? []).map((r: any) => [r.stripe_connect_account_id, r.id])
  );
  console.log(`${inUse.size} connected account(s) referenced by the database — these are protected.\n`);

  // v2 caps page size at 20, so this pages rather than assuming one request
  // covers everything — under-listing here would silently leave strays behind.
  const all: any[] = [];
  let params: any = { limit: 20 };
  for (;;) {
    const page = await stripe.v2.core.accounts.list(params);
    all.push(...(page.data ?? []));
    if (!page.next_page_token) break;
    params = { limit: 20, page: page.next_page_token };
  }

  const strays = all.filter((a) => !inUse.has(a.id));
  console.log(`${all.length} account(s) on the platform, ${strays.length} unreferenced:\n`);
  for (const a of strays) {
    console.log(`  ${a.id}  ${(a.display_name ?? '(no name)').padEnd(24)} created ${a.created ?? '?'}`);
  }

  if (!strays.length) return;
  if (!doDelete) {
    console.log(`\nNothing deleted. Re-run with --delete to remove these ${strays.length}.`);
    return;
  }

  console.log(`\nDeleting ${strays.length}...`);
  let ok = 0;
  for (const a of strays) {
    try {
      await stripe.v2.core.accounts.close(a.id, {
        applied_configurations: await appliedConfigurations(a.id),
      });
      ok++;
      console.log(`  closed ${a.id}`);
    } catch (e: any) {
      console.log(`  FAILED ${a.id} — ${first(e)}`);
    }
  }
  console.log(`\n${ok}/${strays.length} closed.`);
}

main().catch((e) => {
  console.error(first(e));
  process.exit(1);
});
