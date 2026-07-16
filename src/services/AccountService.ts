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
}

import { ServiceError } from './errors';

// Backwards-compatible alias — all services now share ServiceError.
export { ServiceError as AccountServiceError };

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
    if (authError || !created.user) {
      throw new ServiceError('auth_failed', authError?.message ?? 'Could not create auth user.', 400);
    }

    const { data: account, error: accountError } = await supabaseAdmin
      .from('accounts')
      .insert({
        auth_user_id: created.user.id,
        account_type: 'professional',
        email,
        phone: input.phone ?? null,
      })
      .select()
      .single();
    if (accountError) {
      // Roll back the orphaned auth user so the email isn't stuck half-registered.
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
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

  async getAccountByAuthUserId(authUserId: string): Promise<Account | null> {
    const { data, error } = await supabaseAdmin
      .from('accounts')
      .select('*')
      .eq('auth_user_id', authUserId)
      .maybeSingle();
    if (error) throw new ServiceError('lookup_failed', error.message, 500);
    return (data as Account) ?? null;
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
