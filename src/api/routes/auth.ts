import { Router } from 'express';
import { z } from 'zod';
import { accountService } from '../../services/AccountService';
import { requireAuth } from '../middleware/auth';

export const authRouter = Router();

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
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
