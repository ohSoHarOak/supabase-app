import { supabaseAdmin, supabaseAnon } from '../config/supabase';
import { Account, AuthSession, ProfessionalProfile } from '../types';
import { eventService } from './EventService';

export interface ProfessionalSignupInput {
  email: string;
  password: string;
  fullName: string;
  businessName?: string;
  phone?: string;
}

export class AccountServiceError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus = 400
  ) {
    super(message);
  }
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

    const { data: existing } = await supabaseAdmin
      .from('accounts')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (existing) {
      throw new AccountServiceError('email_taken', 'An account with this email already exists.', 409);
    }

    // email_confirm: true skips the confirmation email — fine for the build
    // phase; revisit before real users.
    const { data: created, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
    });
    if (authError || !created.user) {
      throw new AccountServiceError('auth_failed', authError?.message ?? 'Could not create auth user.', 400);
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
      throw new AccountServiceError('account_failed', accountError.message, 500);
    }

    const { error: profileError } = await supabaseAdmin.from('professional_profiles').insert({
      account_id: account.id,
      full_name: input.fullName,
      business_name: input.businessName ?? null,
    });
    if (profileError) {
      throw new AccountServiceError('profile_failed', profileError.message, 500);
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
      throw new AccountServiceError('invalid_credentials', 'Invalid email or password.', 401);
    }

    const account = await this.getAccountByAuthUserId(data.user.id);
    if (!account) {
      throw new AccountServiceError('no_account', 'Auth user has no PetPro account.', 404);
    }

    return {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at ?? null,
      account,
    };
  }

  async getAccountByAuthUserId(authUserId: string): Promise<Account | null> {
    const { data, error } = await supabaseAdmin
      .from('accounts')
      .select('*')
      .eq('auth_user_id', authUserId)
      .maybeSingle();
    if (error) throw new AccountServiceError('lookup_failed', error.message, 500);
    return (data as Account) ?? null;
  }

  async getProfessionalProfile(accountId: string): Promise<ProfessionalProfile | null> {
    const { data, error } = await supabaseAdmin
      .from('professional_profiles')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle();
    if (error) throw new AccountServiceError('lookup_failed', error.message, 500);
    return (data as ProfessionalProfile) ?? null;
  }
}

export const accountService = new AccountService();
