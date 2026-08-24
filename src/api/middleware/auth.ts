import { NextFunction, Request, Response } from 'express';
import { supabaseAdmin } from '../../config/supabase';
import { accountService } from '../../services/AccountService';
import { Account, AccountType } from '../../types';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      account?: Account;
    }
  }
}

/** Verifies the Supabase access token and attaches the PetPro account. */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ ok: false, error: { code: 'unauthorized', message: 'Missing bearer token.' } });
      return;
    }
    const token = header.slice('Bearer '.length);

    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) {
      res.status(401).json({ ok: false, error: { code: 'unauthorized', message: 'Invalid or expired token.' } });
      return;
    }

    const account = await accountService.getAccountByAuthUserId(data.user.id);
    if (!account || account.status !== 'active') {
      res.status(403).json({ ok: false, error: { code: 'forbidden', message: 'No active account for this user.' } });
      return;
    }

    req.account = account;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * M0.5: contracts and payments stay locked until onboarding is complete.
 *
 * Mirrors the client's `setupDone()` (web/src/app.js) — the UI hides these
 * entry points, but this is what actually enforces the gate, so a crafted
 * request can't bypass the front end.
 *
 * Applied per-route on the create/issue paths only. Reads stay open (the
 * client-detail screen fetches contracts + invoices unconditionally), and so
 * do cleanup/reconciliation (void, sync) so nobody gets trapped mid-flow.
 * Service-layer callers never pass through here, so walk-completion
 * auto-invoicing and the billing-cadence worker are unaffected.
 *
 * Usage: router.post('/x', requireCompleteProfile, handler) — after requireAuth.
 */
export async function requireCompleteProfile(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const account = req.account!;
    const profile = await accountService.getProfessionalProfile(account.id);
    const complete = Boolean(
      profile?.full_name &&
        profile?.business_name &&
        account.phone &&
        profile?.profile_photo_url &&
        profile?.offered_service_types?.length,
    );
    if (!complete) {
      res.status(403).json({
        ok: false,
        error: {
          code: 'profile_incomplete',
          message: 'Finish setting up your profile before using contracts and payments.',
        },
      });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Seam 1: permission checks key off account_type, never hardcoded roles.
 * Usage: router.get('/x', requireAuth, requireAccountType('professional'), handler)
 */
export function requireAccountType(...types: AccountType[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.account || !types.includes(req.account.account_type)) {
      res.status(403).json({
        ok: false,
        error: { code: 'forbidden', message: `Requires account type: ${types.join(' or ')}.` },
      });
      return;
    }
    next();
  };
}
