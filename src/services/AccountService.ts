import { supabaseAdmin, supabaseAnon } from '../config/supabase';
import { Account, AuthSession, ProfessionalProfile, ServiceType } from '../types';
import { eventService } from './EventService';
import { validatePasswordStrength } from './passwordPolicy';

export interface ProfessionalSignupInput {
  email: string;
  password: string;
  fullName: string;
  businessName?: string;
  phone?: string;
}

export interface ProfessionalProfileUpdate {
  full_name?: string;
  business_name?: string | null;
  bio?: string | null;
  years_experience?: number | null;
  offered_service_types?: ServiceType[];
  /** R-11: days before a contract's end_date to warn both parties (020). */
  default_renewal_notice_days?: number;
}

import { ServiceError } from './errors';

// Backwards-compatible alias — all services now share ServiceError.
export { ServiceError as AccountServiceError };

/**
 * A unique, non-routable stand-in for a deactivated account's email. `accounts.email`
 * is UNIQUE NOT NULL so it can't be nulled; the account id keeps it unique, and
 * `.invalid` is a reserved TLD that can never be delivered to. Freeing the real
 * address also lets a departed professional sign up fresh later.
 */
function deactivatedEmailTombstone(accountId: string): string {
  return `deactivated+${accountId}@deleted.invalid`;
}

/**
 * Accounts + authentication.
 * Auth is Supabase Auth (NOT custom JWT): professionals use email/password,
 * owners will use magic links (Week 8). Our accounts table adds the
 * account_type seam on top of auth.users.
 */
export class AccountService {
  /** Signup = Supabase Auth user + accounts row + professional profile, then login. */
  async createProfessionalAccount(input: ProfessionalSignupInput): Promise<AuthSession> {
    const email = input.email.trim().toLowerCase();

    const weakness = await validatePasswordStrength(input.password);
    if (weakness) {
      throw new ServiceError('weak_password', weakness, 422);
    }

    const { data: existing } = await supabaseAdmin
      .from('accounts')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (existing) {
      throw new ServiceError('email_taken', 'An account with this email already exists.', 409);
    }

    // email_confirm: true skips the confirmation email — fine for the build
    // phase; revisit before real users.
    const { data: created, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
    });
    let authUserId = created?.user?.id ?? null;
    if (!authUserId) {
      // A requested-but-never-clicked portal magic link leaves an auth user
      // with no accounts row. Since we know no accounts row exists (checked
      // above), adopt that orphan instead of failing with Supabase's raw
      // "already been registered" error.
      const isExisting =
        authError?.code === 'email_exists' || /already.+registered/i.test(authError?.message ?? '');
      const orphan = isExisting ? await this.findAuthUserByEmail(email) : null;
      if (!orphan) {
        throw new ServiceError('auth_failed', authError?.message ?? 'Could not create auth user.', 400);
      }
      const { error: adoptError } = await supabaseAdmin.auth.admin.updateUserById(orphan.id, {
        password: input.password,
        email_confirm: true,
      });
      if (adoptError) {
        throw new ServiceError('auth_failed', adoptError.message, 400);
      }
      authUserId = orphan.id;
    }

    const { data: account, error: accountError } = await supabaseAdmin
      .from('accounts')
      .insert({
        auth_user_id: authUserId,
        account_type: 'professional',
        email,
        phone: input.phone ?? null,
      })
      .select()
      .single();
    if (accountError) {
      // Roll back a freshly created auth user so the email isn't stuck
      // half-registered (an adopted orphan predates this signup — keep it).
      if (created?.user) {
        await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      }
      throw new ServiceError('account_failed', accountError.message, 500);
    }

    const { error: profileError } = await supabaseAdmin.from('professional_profiles').insert({
      account_id: account.id,
      full_name: input.fullName,
      business_name: input.businessName ?? null,
    });
    if (profileError) {
      throw new ServiceError('profile_failed', profileError.message, 500);
    }

    await eventService.publish({
      actorAccountId: account.id,
      eventType: 'account_created',
      subjectType: 'account',
      subjectId: account.id,
      metadata: { account_type: 'professional' },
    });

    return this.authenticateProfessional(email, input.password);
  }

  /** Login via Supabase Auth password grant; returns tokens + our account row. */
  async authenticateProfessional(email: string, password: string): Promise<AuthSession> {
    const { data, error } = await supabaseAnon.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error || !data.session || !data.user) {
      throw new ServiceError('invalid_credentials', 'Invalid email or password.', 401);
    }

    const account = await this.getAccountByAuthUserId(data.user.id);
    if (!account) {
      throw new ServiceError('no_account', 'Auth user has no PetPro account.', 404);
    }
    // A deactivated account must never get a fresh session — even in the edge
    // case where its auth user outlived deactivation (auth-delete is
    // best-effort). Same generic message as a bad password so login can't be
    // used to probe whether an account was deactivated vs. never existed.
    if (account.status !== 'active') {
      throw new ServiceError('invalid_credentials', 'Invalid email or password.', 401);
    }

    return {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at ?? null,
      account,
    };
  }

  /**
   * Kick off Supabase Auth's built-in recovery flow. The email link lands the
   * user back on our app (`redirectTo`) with a recovery token in the URL hash,
   * where the UI shows a "set new password" form. Always resolves — whether
   * the email exists is never revealed to the caller.
   */
  async requestPasswordReset(email: string, redirectTo: string): Promise<void> {
    const { error } = await supabaseAnon.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo,
    });
    // Rate-limit and no-such-user errors are deliberately swallowed; a config
    // error (bad redirect URL) still surfaces in server logs for us.
    if (error) {
      console.error(`[auth] password reset email failed: ${error.message}`);
    }
  }

  /** Complete the recovery flow: the token from the emailed link proves identity. */
  async resetPassword(accessToken: string, newPassword: string): Promise<void> {
    const weakness = await validatePasswordStrength(newPassword);
    if (weakness) {
      throw new ServiceError('weak_password', weakness, 422);
    }
    const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
    if (error || !data.user) {
      throw new ServiceError(
        'invalid_reset_token',
        'This reset link is invalid or has expired — request a new one.',
        401
      );
    }
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(data.user.id, {
      password: newPassword,
    });
    if (updateError) {
      throw new ServiceError('reset_failed', updateError.message, 500);
    }
  }

  /** Logged-in password change — requires the current password as proof. */
  async changePassword(account: Account, currentPassword: string, newPassword: string): Promise<void> {
    const { error: signInError } = await supabaseAnon.auth.signInWithPassword({
      email: account.email,
      password: currentPassword,
    });
    if (signInError) {
      throw new ServiceError('wrong_password', 'Your current password is incorrect.', 401);
    }
    const weakness = await validatePasswordStrength(newPassword);
    if (weakness) {
      throw new ServiceError('weak_password', weakness, 422);
    }
    if (!account.auth_user_id) {
      throw new ServiceError('no_auth_user', 'This account has no password login.', 400);
    }
    const { error } = await supabaseAdmin.auth.admin.updateUserById(account.auth_user_id, {
      password: newPassword,
    });
    if (error) {
      throw new ServiceError('change_failed', error.message, 500);
    }
  }

  /** Confirm an account's password (re-auth gate for destructive actions like
   *  self-deactivation). True when the password is correct. */
  async confirmPassword(account: Account, password: string): Promise<boolean> {
    const { error } = await supabaseAnon.auth.signInWithPassword({
      email: account.email,
      password,
    });
    return !error;
  }

  /** Supabase Admin has no direct email lookup — page through users (fine at this scale). */
  private async findAuthUserByEmail(email: string): Promise<{ id: string } | null> {
    const target = email.toLowerCase();
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw new ServiceError('lookup_failed', error.message, 500);
      const match = data.users.find((u) => (u.email ?? '').toLowerCase() === target);
      if (match) return { id: match.id };
      if (data.users.length < 1000) break;
    }
    return null;
  }

  async getAccountByAuthUserId(authUserId: string): Promise<Account | null> {
    const { data, error } = await supabaseAdmin
      .from('accounts')
      .select('*')
      .eq('auth_user_id', authUserId)
      .maybeSingle();
    if (error) throw new ServiceError('lookup_failed', error.message, 500);
    return (data as Account) ?? null;
  }

  async getAccountById(id: string): Promise<Account | null> {
    const { data, error } = await supabaseAdmin
      .from('accounts')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new ServiceError('lookup_failed', error.message, 500);
    return (data as Account) ?? null;
  }

  /**
   * Deactivate an account (Workstream D / P2-15) — a "close my account" /
   * "delete my data" request. This is deactivation + a contact-PII scrub, NOT
   * a row delete: a hard delete is architecturally impossible by design (four
   * FKs reference accounts(id) with no ON DELETE rule, and the append-only
   * events trigger forbids deleting event rows). The row survives so events,
   * messages, and signed contracts keep referring to it.
   *
   * What it does:
   *   - status -> 'deactivated' + deactivated_at (requireAuth already 403s any
   *     non-active account, so every live session dies the moment this lands;
   *     authenticateProfessional also refuses login for deactivated accounts).
   *   - Contact-PII scrub (founder decision 2026-08-01, "contact-only"): the
   *     LEAVER's own contact identifiers — accounts.email (-> unique tombstone,
   *     since it's UNIQUE NOT NULL and can't be nulled), accounts.phone, and
   *     the professional's bio / the owner's address. Retained clients (real
   *     people with signed agreements + live portal access) are NOT touched.
   *   - stripe_connect_account_id -> NULL (M-Connect seam: the connected
   *     account is a replaceable link, dropped cleanly on relationship end).
   *   - Deletes the Supabase auth.users row, then severs auth_user_id, so the
   *     account can never authenticate again. Best-effort: the status gate is
   *     authoritative, so an auth-delete hiccup can't leave a usable login.
   *
   * What it must NOT touch (retention/legal value + hard constraints): signed
   * contracts (generated_html is immutable once signed), invoices, and
   * transactions. This method never references those tables.
   *
   * Idempotent: re-calling on an already-deactivated account is a safe no-op
   * (it still finishes any auth-user cleanup a prior call may have missed),
   * which also gives the e2e suite a tidy way to retire test accounts.
   */
  async deactivateAccount(accountId: string, opts: { reason?: string } = {}): Promise<void> {
    const account = await this.getAccountById(accountId);
    if (!account) throw new ServiceError('account_not_found', 'Account not found.', 404);

    // Idempotent path: already deactivated. Finish any auth-user cleanup a
    // previous run left behind, then return without re-scrubbing.
    if (account.status === 'deactivated') {
      if (account.auth_user_id) {
        await this.deleteAuthUser(account.auth_user_id);
        await supabaseAdmin.from('accounts').update({ auth_user_id: null }).eq('id', account.id);
      }
      return;
    }

    const authUserId = account.auth_user_id;

    // 1. Flip status + scrub account-level contact PII. Do this FIRST — it is
    //    the authoritative lockout (requireAuth + login both key off status),
    //    so even if auth-user deletion below fails, no session survives.
    const { error: acctError } = await supabaseAdmin
      .from('accounts')
      .update({
        status: 'deactivated',
        deactivated_at: new Date().toISOString(),
        email: deactivatedEmailTombstone(account.id),
        phone: null,
        stripe_connect_account_id: null,
      })
      .eq('id', account.id);
    if (acctError) throw new ServiceError('deactivate_failed', acctError.message, 500);

    // 2. Scrub the leaver's own profile free-text. Keep professional
    //    business_name / full_name so the portal can still render who the
    //    walker was, marked "deactivated" (founder decision 2026-07-19).
    if (account.account_type === 'professional' || account.account_type === 'business') {
      await supabaseAdmin.from('professional_profiles').update({ bio: null }).eq('account_id', account.id);
    } else if (account.account_type === 'owner') {
      await supabaseAdmin.from('owner_profiles').update({ address: null }).eq('account_id', account.id);
    }

    // 3. Delete the Supabase auth user so the credentials themselves are gone,
    //    then sever the link. Best-effort (status gate is authoritative).
    if (authUserId) {
      await this.deleteAuthUser(authUserId);
      await supabaseAdmin.from('accounts').update({ auth_user_id: null }).eq('id', account.id);
    }

    await eventService.publish({
      actorAccountId: account.id,
      eventType: 'account_deactivated',
      subjectType: 'account',
      subjectId: account.id,
      metadata: { account_type: account.account_type, reason: opts.reason ?? 'self_service' },
    });
  }

  /** Delete a Supabase auth user; swallow "already gone" so it stays idempotent. */
  private async deleteAuthUser(authUserId: string): Promise<void> {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(authUserId);
    if (error && !/not.*found|does not exist/i.test(error.message)) {
      // Don't fail the whole deactivation — the status flip already blocks all
      // access. Surface it in logs so a stuck auth user can be cleaned up.
      console.error(`[deactivate] could not delete auth user ${authUserId}: ${error.message}`);
    }
  }

  async getProfessionalProfile(accountId: string): Promise<ProfessionalProfile | null> {
    const { data, error } = await supabaseAdmin
      .from('professional_profiles')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle();
    if (error) throw new ServiceError('lookup_failed', error.message, 500);
    return (data as ProfessionalProfile) ?? null;
  }

  /** Update the professional's own profile — name, business, and which
   *  service types they offer (drives the UI's service-type choices). */
  /**
   * PH-1: update the account's own phone number. Lives on `accounts` rather
   * than `professional_profiles` because every account type has one — the
   * owner portal reads it to show a client their walker's contact details.
   */
  async updateAccountPhone(accountId: string, phone: string | null): Promise<void> {
    const { error } = await supabaseAdmin
      .from('accounts')
      .update({ phone })
      .eq('id', accountId);
    if (error) throw new ServiceError('account_update_failed', error.message, 500);
  }

  async updateProfessionalProfile(
    accountId: string,
    input: ProfessionalProfileUpdate
  ): Promise<ProfessionalProfile> {
    const { data, error } = await supabaseAdmin
      .from('professional_profiles')
      .update(input)
      .eq('account_id', accountId)
      .select()
      .maybeSingle();
    if (error) throw new ServiceError('profile_update_failed', error.message, 500);
    if (!data) throw new ServiceError('profile_not_found', 'Profile not found.', 404);
    return data as ProfessionalProfile;
  }
}

export const accountService = new AccountService();
