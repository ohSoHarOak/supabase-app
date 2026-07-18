import { supabaseAdmin, supabaseAnon } from '../config/supabase';
import {
  Account,
  Appointment,
  Client,
  Contract,
  Invoice,
  MessageThread,
} from '../types';
import { eventService } from './EventService';
import { messagingService } from './MessagingService';
import { paymentService } from './PaymentService';
import { contractService } from './ContractService';
import { ServiceError } from './errors';

/**
 * Week 8 owner portal. Owners authenticate with a Supabase magic link sent to
 * the email their professional has on file; the first session auto-creates
 * their `owner` account and links every matching client record via
 * `clients.owner_account_id` (the seam laid in migration 003).
 *
 * Everything here is scoped through that link: an owner can only ever see
 * appointments, contracts, invoices, and threads belonging to client records
 * linked to their account.
 */
export class PortalService {
  /**
   * Send the magic-link email — but only when the address matches a client
   * some professional actually has on file. Always resolves either way, so
   * the endpoint can't be used to probe which emails exist.
   */
  async requestLoginLink(email: string, redirectTo: string): Promise<void> {
    const normalized = email.trim().toLowerCase();

    // An email that's already a professional/business login can't be an owner
    // too (accounts.email is unique) — say so NOW, not as a dead-end 403 after
    // they click the emailed link. No probing risk: it's their own login email.
    const { data: existingAccount, error: accountError } = await supabaseAdmin
      .from('accounts')
      .select('account_type')
      .ilike('email', normalized)
      .maybeSingle();
    if (accountError) throw new ServiceError('portal_lookup_failed', accountError.message, 500);
    if (existingAccount && existingAccount.account_type !== 'owner') {
      throw new ServiceError(
        'professional_email',
        'That email is a professional login, so it can\'t also be an owner portal login. Use a different email for the portal — a Gmail "+" alias (you+pup@gmail.com) works and still lands in your inbox.',
        409
      );
    }

    const { data: client, error } = await supabaseAdmin
      .from('clients')
      .select('id')
      .ilike('email', normalized)
      .limit(1)
      .maybeSingle();
    if (error) throw new ServiceError('portal_lookup_failed', error.message, 500);
    if (!client) return; // unknown email — silently do nothing (no probing)

    const { error: otpError } = await supabaseAnon.auth.signInWithOtp({
      email: normalized,
      options: { emailRedirectTo: redirectTo },
    });
    if (otpError) {
      // A real failure must not masquerade as "link sent" — that's how the
      // founder lost an hour to a silent Supabase refusal. Rate limits and
      // invalid addresses get actionable messages.
      console.error(`[portal] magic link failed: [${otpError.status}] ${otpError.code ?? ''} ${otpError.message}`);
      if (otpError.code === 'over_email_send_rate_limit' || otpError.status === 429) {
        throw new ServiceError('rate_limited', 'Too many login emails just now — wait a couple of minutes and try again.', 429);
      }
      if (otpError.code === 'email_address_invalid') {
        throw new ServiceError('email_invalid', 'That email address was refused by the mail service — double-check it.', 422);
      }
      throw new ServiceError('otp_failed', 'The login email could not be sent right now — try again shortly.', 502);
    }
  }

  /**
   * Exchange the magic-link token for a portal session: verify it, create the
   * owner account + profile on first login, and (re-)link every client record
   * whose email matches. Returns the account and its linked clients.
   */
  async establishSession(accessToken: string): Promise<{ account: Account; clients: Client[] }> {
    const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
    if (error || !data.user?.email) {
      throw new ServiceError('invalid_token', 'This login link is invalid or has expired — request a new one.', 401);
    }
    const email = data.user.email.toLowerCase();

    let account = await this.getAccountByAuthUserId(data.user.id);
    if (account && account.account_type !== 'owner') {
      // A professional clicked an owner magic link with their own email —
      // don't silently convert their account.
      throw new ServiceError('not_an_owner', 'This email belongs to a professional account — log in to the app instead.', 403);
    }
    if (!account) {
      const { data: created, error: accountError } = await supabaseAdmin
        .from('accounts')
        .insert({ auth_user_id: data.user.id, account_type: 'owner', email })
        .select()
        .single();
      if (accountError) {
        if (accountError.code === '23505') {
          // accounts.email is unique — some other account already owns this
          // address. Friendlier than the raw Postgres duplicate-key error.
          throw new ServiceError(
            'email_in_use',
            'This email already belongs to another PetPro account, so it can\'t open an owner portal. Use a different email for the portal.',
            409
          );
        }
        throw new ServiceError('account_failed', accountError.message, 500);
      }
      account = created as Account;

      // Profile name comes from whatever the professional recorded.
      const { data: client } = await supabaseAdmin
        .from('clients')
        .select('full_name')
        .ilike('email', email)
        .limit(1)
        .maybeSingle();
      const { error: profileError } = await supabaseAdmin
        .from('owner_profiles')
        .insert({ account_id: account.id, full_name: client?.full_name ?? email });
      if (profileError) throw new ServiceError('profile_failed', profileError.message, 500);

      await eventService.publish({
        actorAccountId: account.id,
        eventType: 'owner_portal_activated',
        subjectType: 'account',
        subjectId: account.id,
        metadata: { email },
      });
    }

    // Link every matching, not-yet-linked client — re-run each session so
    // clients added after the first login get picked up too.
    const { error: linkError } = await supabaseAdmin
      .from('clients')
      .update({ owner_account_id: account.id })
      .ilike('email', email)
      .is('owner_account_id', null);
    if (linkError) throw new ServiceError('link_failed', linkError.message, 500);

    return { account, clients: await this.listClients(account.id) };
  }

  private async getAccountByAuthUserId(authUserId: string): Promise<Account | null> {
    const { data, error } = await supabaseAdmin
      .from('accounts')
      .select('*')
      .eq('auth_user_id', authUserId)
      .maybeSingle();
    if (error) throw new ServiceError('lookup_failed', error.message, 500);
    return (data as Account) ?? null;
  }

  /** The owner's linked client records, each with pets. */
  async listClients(ownerAccountId: string): Promise<Client[]> {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('*, pets(*)')
      .eq('owner_account_id', ownerAccountId)
      .order('created_at', { ascending: true });
    if (error) throw new ServiceError('portal_clients_failed', error.message, 500);
    return (data ?? []) as Client[];
  }

  private async clientIds(ownerAccountId: string): Promise<string[]> {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('owner_account_id', ownerAccountId);
    if (error) throw new ServiceError('portal_clients_failed', error.message, 500);
    return (data ?? []).map((c) => c.id as string);
  }

  /**
   * Everything the portal home screen needs in one call: linked clients (with
   * pets and the professional's name), upcoming appointments, contracts, and
   * invoices.
   */
  async overview(ownerAccountId: string): Promise<{
    clients: (Client & {
      professional:
        | { business_name: string | null; full_name: string; phone: string | null; email: string }
        | null;
    })[];
    appointments: (Appointment & { services: { name: string } | null })[];
    contracts: Contract[];
    invoices: Invoice[];
    /** Messages the professional sent that this owner hasn't read (O-2). */
    unread_messages: number;
  }> {
    const clients = await this.listClients(ownerAccountId);
    const ids = clients.map((c) => c.id);
    if (ids.length === 0) {
      return { clients: [], appointments: [], contracts: [], invoices: [], unread_messages: 0 };
    }

    const professionalIds = [...new Set(clients.map((c) => c.professional_account_id))];
    const [profilesRes, accountsRes, apptsRes, contractsRes, invoicesRes, unreadRes] = await Promise.all([
      supabaseAdmin
        .from('professional_profiles')
        .select('account_id, business_name, full_name')
        .in('account_id', professionalIds),
      // C-3/PH-1: the walker's phone and email live on `accounts`, not on
      // professional_profiles — the owner portal shows them as a contact card.
      supabaseAdmin
        .from('accounts')
        .select('id, phone, email')
        .in('id', professionalIds),
      supabaseAdmin
        .from('appointments')
        .select('*, services(name, duration_minutes)')
        .in('client_id', ids)
        .eq('status', 'scheduled')
        .gte('starts_at', new Date().toISOString())
        .order('starts_at', { ascending: true })
        .limit(20),
      supabaseAdmin
        .from('contracts')
        .select('id, client_id, status, created_at, signed_at, signer_name')
        .in('client_id', ids)
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('invoices')
        .select('*')
        .in('client_id', ids)
        .order('created_at', { ascending: false }),
      // O-2: unread = anything in this owner's threads that they didn't send
      // and haven't read. Without this the owner has no way to learn the
      // professional replied — which is what makes the read-only portal (D2)
      // workable, since "message your walker" is the only correction path.
      supabaseAdmin
        .from('messages')
        .select('id, message_threads!inner(client_id)', { count: 'exact', head: true })
        .in('message_threads.client_id', ids)
        .is('read_at', null)
        .neq('sender_account_id', ownerAccountId),
    ]);
    for (const r of [profilesRes, accountsRes, apptsRes, contractsRes, invoicesRes, unreadRes]) {
      if (r.error) throw new ServiceError('portal_overview_failed', r.error.message, 500);
    }
    const contactByAccount = new Map(
      (accountsRes.data ?? []).map((a) => [a.id, { phone: a.phone as string | null, email: a.email as string }])
    );
    const profileByAccount = new Map(
      (profilesRes.data ?? []).map((p) => [
        p.account_id,
        {
          business_name: p.business_name,
          full_name: p.full_name,
          phone: contactByAccount.get(p.account_id)?.phone ?? null,
          email: contactByAccount.get(p.account_id)?.email ?? '',
        },
      ])
    );
    return {
      clients: clients.map((c) => ({
        ...c,
        professional: profileByAccount.get(c.professional_account_id) ?? null,
      })),
      appointments: (apptsRes.data ?? []) as (Appointment & { services: { name: string } | null })[],
      contracts: (contractsRes.data ?? []) as Contract[],
      invoices: (invoicesRes.data ?? []) as Invoice[],
      unread_messages: unreadRes.count ?? 0,
    };
  }

  // ------------------------------------------------------------ contracts ----

  /** Fetch a contract, enforcing owner scope. */
  async getContract(ownerAccountId: string, contractId: string): Promise<Contract> {
    const { data, error } = await supabaseAdmin
      .from('contracts')
      .select('*, clients!inner(owner_account_id)')
      .eq('id', contractId)
      .eq('clients.owner_account_id', ownerAccountId)
      .maybeSingle();
    if (error) throw new ServiceError('contract_lookup_failed', error.message, 500);
    if (!data) throw new ServiceError('contract_not_found', 'Contract not found.', 404);
    const { clients: _clients, ...contract } = data as Contract & { clients: unknown };
    return contract as Contract;
  }

  /**
   * Owner signs their own contract through the portal. Same signature-capture
   * flow as Week 3's in-person signing (Nitro Sign stays deferred) — the
   * portal login is what proves who is holding the pen.
   */
  async signContract(
    ownerAccountId: string,
    contractId: string,
    input: { signer_name: string; signature_image: string }
  ): Promise<Contract> {
    const contract = await this.getContract(ownerAccountId, contractId);
    const signed = await contractService.signInPerson(contract.professional_account_id, contractId, input);

    // Same rule the professional UI applies: a first signed contract turns a
    // pending (prospect) client active. Non-fatal — the signature is what matters.
    const { error } = await supabaseAdmin
      .from('clients')
      .update({ status: 'active' })
      .eq('id', signed.client_id)
      .eq('status', 'prospect');
    if (error) console.error(`[portal] could not activate client after signing: ${error.message}`);

    return signed;
  }

  // ------------------------------------------------------------- invoices ----

  /** Fetch an invoice, enforcing owner scope. */
  async getInvoice(ownerAccountId: string, invoiceId: string): Promise<Invoice> {
    const { data, error } = await supabaseAdmin
      .from('invoices')
      .select('*, clients!inner(owner_account_id)')
      .eq('id', invoiceId)
      .eq('clients.owner_account_id', ownerAccountId)
      .maybeSingle();
    if (error) throw new ServiceError('invoice_lookup_failed', error.message, 500);
    if (!data) throw new ServiceError('invoice_not_found', 'Invoice not found.', 404);
    const { clients: _clients, ...invoice } = data as Invoice & { clients: unknown };
    return invoice as Invoice;
  }

  /** Start a Stripe Checkout for one of the owner's invoices. */
  async createCheckout(
    ownerAccountId: string,
    invoiceId: string,
    origin: string
  ): Promise<{ invoice: Invoice; checkout_url: string }> {
    const invoice = await this.getInvoice(ownerAccountId, invoiceId);
    return paymentService.createCheckoutSession(invoice.professional_account_id, invoiceId, origin, {
      portal: true,
    });
  }

  /** Reconcile payment status from Stripe (the portal's return screen calls this). */
  async syncInvoice(ownerAccountId: string, invoiceId: string): Promise<Invoice> {
    const invoice = await this.getInvoice(ownerAccountId, invoiceId);
    return paymentService.syncInvoicePayment(invoice.professional_account_id, invoiceId);
  }

  // ------------------------------------------------------------ messaging ----

  /** Get-or-create the thread between one of the owner's client records and its professional. */
  async getOrCreateThread(ownerAccountId: string, clientId: string): Promise<MessageThread> {
    const { data: client, error } = await supabaseAdmin
      .from('clients')
      .select('id, professional_account_id')
      .eq('id', clientId)
      .eq('owner_account_id', ownerAccountId)
      .maybeSingle();
    if (error) throw new ServiceError('thread_lookup_failed', error.message, 500);
    if (!client) throw new ServiceError('client_not_found', 'Client not found.', 404);
    return messagingService.getOrCreateThread(client.professional_account_id, clientId);
  }
}

export const portalService = new PortalService();
