import Stripe from 'stripe';
import { env } from '../config/env';
import { ServiceError } from './errors';

/**
 * One shared Stripe client and one shared error-translation wrapper.
 *
 * Extracted from PaymentService when M-Connect arrived: ConnectService needs
 * the same client, and two lazily-constructed clients in one process is waste
 * with no upside. The behaviour is unchanged from the original — same lazy
 * construction, same 503 when unconfigured, same 502 translation.
 */
let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (!env.stripeSecretKey) {
    throw new ServiceError(
      'stripe_not_configured',
      'Stripe is not configured — set STRIPE_SECRET_KEY in the environment.',
      503
    );
  }
  if (!client) client = new Stripe(env.stripeSecretKey);
  return client;
}

/** Surface Stripe failures as readable API errors instead of a bare 500 —
 *  "Invalid API key" vs "amount too small" matters to whoever is debugging. */
export async function stripeCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError) {
      throw new ServiceError('stripe_error', `Stripe: ${err.message}`, 502);
    }
    throw err;
  }
}

/**
 * The platform's cut of a walker's transaction, in cents.
 *
 * DECIDED 2026-09-04: zero. 100% passes to the walker; revenue is intended to
 * come from account tiers (Workstream S), not from a slice of the walker's
 * money. This function exists rather than the constant being inlined so the
 * seam is real and named — introducing a fee later is a change here plus the
 * call site below it, not a payment-architecture change.
 *
 * ⚠️ Returning 0 deliberately means `application_fee_amount` is OMITTED from
 * the charge rather than sent as 0 — Stripe rejects a zero application fee on
 * some paths, and "no fee" and "a fee of nothing" are not the same request.
 *
 * ⚠️ Raising this is a pricing change to walkers onboarded on a 0% promise,
 * not a config tweak. The code cost is trivial; that is the trap.
 */
export function platformFeeCents(_amountCents: number): number {
  return 0;
}
