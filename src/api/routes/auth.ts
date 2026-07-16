import { Router } from 'express';
import { z } from 'zod';
import { accountService } from '../../services/AccountService';
import { requireAuth } from '../middleware/auth';

export const authRouter = Router();

const signupSchema = z.object({
  email: z.string().email(),
  // Length is checked here for a fast error; the full policy (character
  // classes, common/breached passwords) runs in AccountService via
  // validatePasswordStrength on every password-setting path.
  password: z.string().min(12, 'Password must be at least 12 characters.'),
  fullName: z.string().min(1),
  businessName: z.string().optional(),
  phone: z.string().optional(),
});

/** POST /api/auth/signup — professional signup (email/password). */
authRouter.post('/signup', async (req, res, next) => {
  try {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        ok: false,
        error: { code: 'validation', message: parsed.error.issues.map((i) => i.message).join(' ') },
      });
      return;
    }
    const session = await accountService.createProfessionalAccount(parsed.data);
    res.status(201).json({ ok: true, data: session });
  } catch (err) {
    next(err);
  }
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/** POST /api/auth/login — professional login. */
authRouter.post('/login', async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        ok: false,
        error: { code: 'validation', message: 'Email and password are required.' },
      });
      return;
    }
    const session = await accountService.authenticateProfessional(parsed.data.email, parsed.data.password);
    res.json({ ok: true, data: session });
  } catch (err) {
    next(err);
  }
});

/** POST /api/auth/forgot-password — sends a Supabase recovery email.
 *  Always answers ok so the endpoint can't be used to probe which emails exist. */
authRouter.post('/forgot-password', async (req, res, next) => {
  try {
    const parsed = z.object({ email: z.string().email() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ ok: false, error: { code: 'validation', message: 'A valid email is required.' } });
      return;
    }
    // The emailed link returns the user to the app root with the recovery
    // token in the URL fragment (Supabase appends `#access_token=…&type=recovery`
    // itself — a path-only redirectTo keeps that fragment parseable). Works for
    // localhost and Render alike; trust proxy makes req.protocol correct.
    const redirectTo = `${req.protocol}://${req.get('host')}/`;
    await accountService.requestPasswordReset(parsed.data.email, redirectTo);
    res.json({ ok: true, data: { sent: true } });
  } catch (err) {
    next(err);
  }
});

/** POST /api/auth/reset-password — completes recovery using the emailed token. */
authRouter.post('/reset-password', async (req, res, next) => {
  try {
    const parsed = z
      .object({ access_token: z.string().min(1), new_password: z.string().min(1) })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ ok: false, error: { code: 'validation', message: 'Token and new password are required.' } });
      return;
    }
    await accountService.resetPassword(parsed.data.access_token, parsed.data.new_password);
    res.json({ ok: true, data: { reset: true } });
  } catch (err) {
    next(err);
  }
});

/** POST /api/auth/change-password — logged-in change, current password required. */
authRouter.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const parsed = z
      .object({ current_password: z.string().min(1), new_password: z.string().min(1) })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ ok: false, error: { code: 'validation', message: 'Current and new password are required.' } });
      return;
    }
    await accountService.changePassword(req.account!, parsed.data.current_password, parsed.data.new_password);
    res.json({ ok: true, data: { changed: true } });
  } catch (err) {
    next(err);
  }
});

const profileUpdateSchema = z.object({
  full_name: z.string().trim().min(1).max(120).optional(),
  business_name: z.string().trim().max(120).nullish(),
  bio: z.string().trim().max(2000).nullish(),
  years_experience: z.number().int().min(0).max(80).nullish(),
  offered_service_types: z
    .array(
      z.enum(['group_walk', 'private_walk', 'training_session', 'grooming', 'sitting', 'boarding', 'other'])
    )
    .max(7)
    .optional(),
});

/** PATCH /api/auth/profile — the professional edits their own profile. */
authRouter.patch('/profile', requireAuth, async (req, res, next) => {
  try {
    if (req.account!.account_type !== 'professional') {
      res.status(403).json({
        ok: false,
        error: { code: 'forbidden', message: 'Only professional accounts have this profile.' },
      });
      return;
    }
    const parsed = profileUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        ok: false,
        error: { code: 'validation', message: parsed.error.issues.map((i) => i.message).join(' ') },
      });
      return;
    }
    const profile = await accountService.updateProfessionalProfile(req.account!.id, parsed.data);
    res.json({ ok: true, data: profile });
  } catch (err) {
    next(err);
  }
});

/** GET /api/auth/me — current account + profile (verifies the session works). */
authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const account = req.account!;
    const profile =
      account.account_type === 'professional'
        ? await accountService.getProfessionalProfile(account.id)
        : null;
    res.json({ ok: true, data: { account, profile } });
  } catch (err) {
    next(err);
  }
});
