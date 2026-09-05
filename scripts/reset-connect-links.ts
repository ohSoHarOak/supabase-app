/**
 * Unlink walker records still pointing at pre-2026-09-05 connected
 * accounts. Those were created Express/full and are permanently PLATFORM-liable
 * — controller properties are fixed at creation — so they cannot exercise the
 * walker-liable config. Unlinking makes the next onboarding mint a fresh one.
 *
 * Lists by default; writes only with --confirm.
 * Does NOT delete anything at Stripe. Only touches rows whose id still resolves
 * on Stripe; a dangling link is left alone (refresh() self-heals those).
 */
import 'dotenv/config';
import Stripe from 'stripe';
import { supabaseAdmin } from '../src/config/supabase';
import { connectService } from '../src/services/ConnectService';

const key = process.env.STRIPE_SECRET_KEY!;
if (!key?.startsWith('sk_test')) throw new Error('REFUSING: not a test key.');
const stripe = new Stripe(key) as any;
const apply = process.argv.includes('--confirm');

async function main() {
  const { data, error } = await supabaseAdmin
    .from('accounts')
    .select('id, email, stripe_connect_account_id')
    .not('stripe_connect_account_id', 'is', null);
  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as any[]) {
    const sid = row.stripe_connect_account_id;
    let info = '';
    try {
      const a = await stripe.v2.core.accounts.retrieve(sid);
      info = `dashboard=${a.dashboard}`;
    } catch {
      console.log(`SKIP    ${row.email}  ${sid} — dangling (no such account at Stripe); refresh() clears it`);
      continue;
    }
    if (!apply) {
      console.log(`WOULD   ${row.email}  ${sid}  ${info}`);
      continue;
    }
    const status = await connectService.disconnect(row.id, 'liability_model_migration_2026_09_05');
    console.log(`UNLINK  ${row.email}  ${sid}  ${info} -> state=${status.state} connected=${status.connected}`);
  }
}
main().then(() => process.exit(0));
