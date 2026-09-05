import { Router } from 'express';
import { connectService } from '../../services/ConnectService';
import { requireAuth, requireAccountType, requireCompleteProfile } from '../middleware/auth';

/**
 * M-Connect — Stripe Connect Express onboarding for the walker's payout account.
 *
 * Read routes stay open to any active professional so the Profile card and the
 * onboarding step can always render their state. Only *starting* onboarding
 * requires a complete profile: the Express account is created with the
 * walker's business identity, and creating it from a half-filled profile means
 * an account at Stripe that has to be corrected by hand later.
 */
export const connectRouter = Router();
connectRouter.use(requireAuth, requireAccountType('professional'));

/** GET /api/connect/status — cached; no Stripe round trip. */
connectRouter.get('/status', async (req, res, next) => {
  try {
    const status = await connectService.status(req.account!.id);
    res.json({ ok: true, data: status });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/connect/refresh — re-read from Stripe and persist.
 *
 * The client calls this on return from hosted onboarding, so the walker never
 * lands back on a screen still saying "not set up" seconds after finishing.
 */
connectRouter.post('/refresh', async (req, res, next) => {
  try {
    const status = await connectService.refresh(req.account!.id);
    res.json({ ok: true, data: status });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/connect/onboarding-link — start or resume hosted onboarding.
 *
 * Returns a fresh single-use Stripe URL every time by design: account links
 * expire, and a walker who abandons halfway resumes by asking for another one.
 */
connectRouter.post('/onboarding-link', requireCompleteProfile, async (req, res, next) => {
  try {
    const origin = `${req.protocol}://${req.get('host')}`;
    const link = await connectService.startOnboarding(req.account!.id, origin);
    res.json({ ok: true, data: link });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/connect/disconnect — break the link.
 *
 * The seam requirement from Workstream D / P2-6: the connected account must be
 * changeable and disconnectable, never hardwired. Deliberately does not delete
 * anything at Stripe — the walker's account and its payout history are theirs.
 * Outstanding invoices stay reconcilable because each one records the account
 * its Checkout Session was created on (026).
 */
connectRouter.post('/disconnect', async (req, res, next) => {
  try {
    const status = await connectService.disconnect(req.account!.id);
    res.json({ ok: true, data: status });
  } catch (err) {
    next(err);
  }
});
