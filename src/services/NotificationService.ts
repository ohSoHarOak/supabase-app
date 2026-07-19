import { supabaseAdmin } from '../config/supabase';
import { getEmailProvider } from '../integrations/email';
import { EmailMessage } from '../integrations/email';
import {
  Appointment,
  Client,
  Contract,
  Invoice,
  NotificationStatus,
  ProfessionalProfile,
  QueuedNotification,
  Service,
} from '../types';
import { renderContractDocument } from './contractDocument';
import { ServiceError } from './errors';

/** Templates render at SEND time from ids, never from data frozen at enqueue
 *  time — a rescheduled walk reminds with the new time, a cancelled one
 *  cancels itself, and a fixed email typo is picked up automatically. */
export type NotificationTemplate =
  | 'test'
  | 'contract_ready'
  | 'contract_signed'
  | 'payment_receipt'
  | 'payment_received'
  | 'appointment_reminder'
  | 'portal_invite'
  | 'message_received'
  // R-11/R-16: a term is ending. Two recipients, mirroring how payment
  // emails already go both ways — the walker needs to act, the client
  // needs to not be surprised.
  | 'contract_renewal_due'
  | 'contract_renewal_due_professional';

export interface EnqueueInput {
  /** The professional account this notification belongs to (recipients are
   *  often clients, who don't have accounts until the Week 8 owner portal —
   *  the actual recipient email is resolved at send time). */
  accountId: string;
  /** Preference key: 'contract' | 'payment' | 'appointment_reminder' | 'test' */
  category: string;
  template: NotificationTemplate;
  /** Ids the template needs (contract_id / invoice_id / appointment_id / to). */
  data: Record<string, unknown>;
  /** Defaults to now (send on the next processing pass). */
  scheduledFor?: string;
}

type RenderResult =
  | { kind: 'send'; email: EmailMessage }
  | { kind: 'cancel'; reason: string };

export interface ProcessSummary {
  configured: boolean;
  sent: number;
  failed: number;
  cancelled: number;
}

const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD → "September 30, 2026". Parsed as parts, not via new Date(str),
 *  which reads a date-only string as UTC midnight and shows the day before
 *  west of Greenwich — the same trap W-13 hit in the UI. */
function fmtDateOnly(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function fmtMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Shared email shell so every notification looks like the same product. */
function emailLayout(businessName: string, bodyHtml: string): string {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:36rem;margin:0 auto;color:#1e293b">
  <div style="padding:14px 18px;border-bottom:3px solid #2f6f4f">
    <strong style="font-size:1.05rem">${escapeHtml(businessName)}</strong>
  </div>
  <div style="padding:18px;line-height:1.55">${bodyHtml}</div>
  <div style="padding:10px 18px;border-top:1px solid #e2e8f0;font-size:0.78rem;color:#64748b">
    Sent by PetPro Connect on behalf of ${escapeHtml(businessName)}.
  </div>
</div>`;
}

/**
 * Notifications — Week 7 (channel-agnostic by design).
 *
 * Everything is a queue row: template + recipient + channel. Email is the
 * only channel implemented; when P2-2 adds SMS, it becomes a second channel
 * adapter and a `channel: 'sms'` on the row — no caller changes. Callers
 * never await delivery: enqueue() never throws, so a broken email setup can
 * never break signing a contract or completing a walk.
 *
 * Delivery: a worker pass (interval in index.ts + a nudge after enqueue)
 * sends due pending rows. With no email key configured, rows simply stay
 * pending and send once the founder adds RESEND_API_KEY.
 */
export class NotificationService {
  /** Serializes processing passes: the worker tick, post-enqueue nudges, and
   *  the /process route all run one at a time, and every caller's pass really
   *  runs (instead of silently skipping while another is mid-flight — which
   *  made the /test route report "pending" before its send had happened). */
  private chain: Promise<unknown> = Promise.resolve();

  // -------------------------------------------------------------- enqueue ----

  /** Queue a notification. Never throws — logs and returns null on failure. */
  async enqueue(input: EnqueueInput): Promise<QueuedNotification | null> {
    try {
      if (!(await this.categoryEnabled(input.accountId, input.category))) return null;

      const { data, error } = await supabaseAdmin
        .from('notification_queue')
        .insert({
          account_id: input.accountId,
          category: input.category,
          channel: 'email',
          payload: { template: input.template, ...input.data },
          scheduled_for: input.scheduledFor ?? new Date().toISOString(),
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      const row = data as QueuedNotification;

      // Nudge: immediate notifications go out now, not on the next tick.
      if (!input.scheduledFor) {
        void this.processDue().catch((err) => console.error('[notifications] nudge failed:', err));
      }
      return row;
    } catch (err) {
      console.error(`[notifications] enqueue ${input.template} failed:`, err);
      return null;
    }
  }

  /** Per-account, per-category opt-out (notification_preferences). Default: enabled. */
  private async categoryEnabled(accountId: string, category: string): Promise<boolean> {
    const { data, error } = await supabaseAdmin
      .from('notification_preferences')
      .select('enabled')
      .eq('account_id', accountId)
      .eq('category', category)
      .eq('channel', 'email')
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? Boolean(data.enabled) : true;
  }

  // ------------------------------------------------- appointment reminders ----

  /** Queue a 24h-before reminder for each occurrence that's far enough out. */
  async scheduleAppointmentReminders(accountId: string, appointments: Appointment[]): Promise<void> {
    for (const appt of appointments) {
      const remindAt = Date.parse(appt.starts_at) - REMINDER_LEAD_MS;
      if (remindAt <= Date.now()) continue; // booked inside 24h — no reminder
      await this.enqueue({
        accountId,
        category: 'appointment_reminder',
        template: 'appointment_reminder',
        data: { appointment_id: appt.id },
        scheduledFor: new Date(remindAt).toISOString(),
      });
    }
  }

  /** Keep a pending reminder aligned with a rescheduled appointment. */
  async rescheduleAppointmentReminder(appointmentId: string, newStartsAt: string): Promise<void> {
    try {
      const remindAt = new Date(Date.parse(newStartsAt) - REMINDER_LEAD_MS).toISOString();
      const { error } = await supabaseAdmin
        .from('notification_queue')
        .update({ scheduled_for: remindAt })
        .eq('status', 'pending')
        .eq('category', 'appointment_reminder')
        .contains('payload', { appointment_id: appointmentId });
      if (error) throw new Error(error.message);
    } catch (err) {
      console.error('[notifications] reminder reschedule failed:', err);
    }
  }

  /** Cancel pending reminders for cancelled/completed appointments. */
  async cancelAppointmentReminders(appointmentIds: string[]): Promise<void> {
    for (const id of appointmentIds) {
      try {
        const { error } = await supabaseAdmin
          .from('notification_queue')
          .update({ status: 'cancelled' satisfies NotificationStatus, error: 'appointment no longer scheduled' })
          .eq('status', 'pending')
          .eq('category', 'appointment_reminder')
          .contains('payload', { appointment_id: id });
        if (error) throw new Error(error.message);
      } catch (err) {
        console.error('[notifications] reminder cancel failed:', err);
      }
    }
  }

  // ------------------------------------------------------------ processing ----

  /**
   * Send everything due. Passes are serialized (never concurrent), so the
   * interval worker and post-enqueue nudges can't double-send — the app runs
   * as one Render instance, so in-process serialization is a real guarantee.
   */
  async processDue(options: { accountId?: string } = {}): Promise<ProcessSummary> {
    const run = this.chain.then(() => this.processPass(options));
    this.chain = run.catch(() => {}); // a failed pass must not poison the chain
    return run;
  }

  private async processPass(options: { accountId?: string }): Promise<ProcessSummary> {
    const provider = getEmailProvider();
    const summary: ProcessSummary = { configured: provider.configured, sent: 0, failed: 0, cancelled: 0 };
    if (!provider.configured) return summary; // rows stay pending until a key exists

    {
      let builder = supabaseAdmin
        .from('notification_queue')
        .select('*')
        .eq('status', 'pending')
        .lte('scheduled_for', new Date().toISOString())
        .order('scheduled_for', { ascending: true })
        .limit(25);
      if (options.accountId) builder = builder.eq('account_id', options.accountId);
      const { data, error } = await builder;
      if (error) throw new ServiceError('notification_list_failed', error.message, 500);

      for (const row of (data ?? []) as QueuedNotification[]) {
        try {
          const rendered = await this.render(row);
          if (rendered.kind === 'cancel') {
            await this.markRow(row.id, 'cancelled', rendered.reason);
            summary.cancelled += 1;
            continue;
          }
          await provider.send(rendered.email);
          await this.markRow(row.id, 'sent');
          summary.sent += 1;
        } catch (err) {
          await this.markRow(row.id, 'failed', err instanceof Error ? err.message : String(err));
          summary.failed += 1;
        }
      }
      return summary;
    }
  }

  private async markRow(id: string, status: NotificationStatus, errorNote?: string): Promise<void> {
    const { error } = await supabaseAdmin
      .from('notification_queue')
      .update({
        status,
        error: errorNote ?? null,
        sent_at: status === 'sent' ? new Date().toISOString() : null,
      })
      .eq('id', id);
    if (error) console.error('[notifications] failed to update queue row:', error.message);
  }

  /** Queue rows for one professional — the founder-facing audit view. */
  async listForAccount(
    accountId: string,
    options: { status?: NotificationStatus } = {}
  ): Promise<QueuedNotification[]> {
    let builder = supabaseAdmin
      .from('notification_queue')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (options.status) builder = builder.eq('status', options.status);
    const { data, error } = await builder;
    if (error) throw new ServiceError('notification_list_failed', error.message, 500);
    return (data ?? []) as QueuedNotification[];
  }

  // ------------------------------------------------------------- rendering ----

  private async render(row: QueuedNotification): Promise<RenderResult> {
    const payload = row.payload as { template?: NotificationTemplate } & Record<string, unknown>;
    switch (payload.template) {
      case 'test':
        return this.renderTest(row.account_id, payload.to as string | undefined);
      case 'contract_ready':
        return this.renderContractReady(payload.contract_id as string);
      case 'contract_signed':
        return this.renderContractSigned(payload.contract_id as string);
      case 'payment_receipt':
        return this.renderPaymentReceipt(payload.invoice_id as string);
      case 'payment_received':
        return this.renderPaymentReceived(payload.invoice_id as string);
      case 'appointment_reminder':
        return this.renderAppointmentReminder(payload.appointment_id as string);
      case 'portal_invite':
        return this.renderPortalInvite(payload.client_id as string, payload.origin as string);
      case 'message_received':
        return this.renderMessageReceived(payload.message_id as string, payload.origin as string);
      case 'contract_renewal_due':
        return this.renderContractRenewalDue(payload.contract_id as string, 'client');
      case 'contract_renewal_due_professional':
        return this.renderContractRenewalDue(payload.contract_id as string, 'professional');
      default:
        return { kind: 'cancel', reason: `unknown template: ${String(payload.template)}` };
    }
  }

  private async renderTest(accountId: string, to?: string): Promise<RenderResult> {
    let recipient = to ?? null;
    if (!recipient) {
      const { data } = await supabaseAdmin.from('accounts').select('email').eq('id', accountId).maybeSingle();
      recipient = (data?.email as string) ?? null;
    }
    if (!recipient) return { kind: 'cancel', reason: 'no recipient email' };
    return {
      kind: 'send',
      email: {
        to: recipient,
        subject: 'PetPro Connect — test email',
        html: emailLayout(
          'PetPro Connect',
          '<p>Email notifications are working. 🎉</p><p>This test was sent from your PetPro Connect account.</p>'
        ),
      },
    };
  }

  private async renderContractReady(contractId: string): Promise<RenderResult> {
    const ctx = await this.contractContext(contractId);
    if ('cancel' in ctx) return { kind: 'cancel', reason: ctx.cancel };
    const { contract, client, businessName } = ctx;
    if (!client.email) return { kind: 'cancel', reason: 'client has no email on file' };
    if (contract.status !== 'draft' && contract.status !== 'sent') {
      return { kind: 'cancel', reason: `contract is ${contract.status}, no longer awaiting signature` };
    }
    return {
      kind: 'send',
      email: {
        to: client.email!,
        subject: `Your service agreement with ${businessName} is ready`,
        html: emailLayout(
          businessName,
          `<p>Hi ${escapeHtml(client.full_name)},</p>
           <p>Your service agreement with ${escapeHtml(businessName)} is ready. You'll review and sign it together at your next visit — no action needed right now.</p>
           <p>Questions before then? Just reply to this email.</p>`
        ),
      },
    };
  }

  private async renderContractSigned(contractId: string): Promise<RenderResult> {
    const ctx = await this.contractContext(contractId);
    if ('cancel' in ctx) return { kind: 'cancel', reason: ctx.cancel };
    const { contract, client, businessName } = ctx;
    if (!client.email) return { kind: 'cancel', reason: 'client has no email on file' };
    if (contract.status !== 'signed') {
      return { kind: 'cancel', reason: `contract is ${contract.status}, not signed` };
    }
    const document = renderContractDocument(contract, { businessName });
    return {
      kind: 'send',
      email: {
        to: client.email!,
        subject: `Your signed agreement with ${businessName}`,
        html: emailLayout(
          businessName,
          `<p>Hi ${escapeHtml(client.full_name)},</p>
           <p>Thanks for signing! Your copy of the agreement is attached to this email — keep it for your records.</p>
           <p>To get a paper or PDF copy, open the attachment and use your browser's <strong>Print</strong> (or "Save as PDF").</p>`
        ),
        attachments: [
          {
            filename: 'signed-agreement.html',
            content: Buffer.from(document, 'utf8').toString('base64'),
            contentType: 'text/html',
          },
        ],
      },
    };
  }

  /**
   * R-11/R-16: the agreement's term is running out.
   *
   * Rendered at send time like every other template, so a contract that gets
   * voided, superseded, or has its end date pushed back between queueing and
   * sending **cancels itself** rather than telling a client their agreement
   * is expiring when it isn't.
   */
  private async renderContractRenewalDue(
    contractId: string,
    audience: 'client' | 'professional'
  ): Promise<RenderResult> {
    const ctx = await this.contractContext(contractId);
    if ('cancel' in ctx) return { kind: 'cancel', reason: ctx.cancel };
    const { contract, client, businessName, professionalEmail } = ctx;

    if (contract.status !== 'signed') {
      return { kind: 'cancel', reason: `contract is ${contract.status}, not an active agreement` };
    }
    if (!contract.end_date) {
      return { kind: 'cancel', reason: 'contract term is now open-ended' };
    }
    if (Date.parse(`${contract.end_date}T23:59:59Z`) < Date.now()) {
      return { kind: 'cancel', reason: 'term already ended — a renewal warning would be stale' };
    }
    // The term must still be inside the notice window AT SEND TIME. Without
    // this, extending an expiring agreement between queueing and sending
    // still fires the warning — accurate about the new date, but announcing
    // an expiry a year out for no reason. Recomputed rather than trusted
    // from enqueue time, which is the whole point of send-time rendering.
    const noticeDays = contract.renewal_notice_days ?? (await this.defaultNoticeDays(contract.professional_account_id));
    const windowOpens = Date.parse(`${contract.end_date}T00:00:00Z`) - noticeDays * 24 * 60 * 60 * 1000;
    if (Date.now() < windowOpens) {
      return { kind: 'cancel', reason: 'term was extended — no longer within the renewal notice window' };
    }

    const ends = fmtDateOnly(contract.end_date);
    if (audience === 'professional') {
      if (!professionalEmail) return { kind: 'cancel', reason: 'professional has no email' };
      return {
        kind: 'send',
        email: {
          to: professionalEmail,
          subject: `Agreement with ${client.full_name} ends ${ends}`,
          html: emailLayout(
            businessName,
            `<p>Your service agreement with <strong>${escapeHtml(client.full_name)}</strong> ends on <strong>${escapeHtml(ends)}</strong>.</p>
             <p>To keep them on the books, generate a new agreement from their client page — the signed one stays on file exactly as it is.</p>`
          ),
        },
      };
    }

    if (!client.email) return { kind: 'cancel', reason: 'client has no email on file' };
    return {
      kind: 'send',
      email: {
        to: client.email,
        subject: `Your agreement with ${businessName} ends ${ends}`,
        html: emailLayout(
          businessName,
          `<p>Hi ${escapeHtml(client.full_name)},</p>
           <p>A quick heads-up: your service agreement with ${escapeHtml(businessName)} runs until <strong>${escapeHtml(ends)}</strong>.</p>
           <p>Nothing changes before then, and there's nothing you need to do right now — ${escapeHtml(businessName)} will be in touch about continuing. Questions? Just reply to this email.</p>`
        ),
      },
    };
  }

  /** The professional's default notice window (020), or 30 if unset. */
  private async defaultNoticeDays(professionalAccountId: string): Promise<number> {
    const { data } = await supabaseAdmin
      .from('professional_profiles')
      .select('default_renewal_notice_days')
      .eq('account_id', professionalAccountId)
      .maybeSingle();
    return (data?.default_renewal_notice_days as number) ?? 30;
  }

  private async renderPaymentReceipt(invoiceId: string): Promise<RenderResult> {
    const ctx = await this.invoiceContext(invoiceId);
    if ('cancel' in ctx) return { kind: 'cancel', reason: ctx.cancel };
    const { invoice, client, businessName } = ctx;
    if (invoice.status !== 'paid') return { kind: 'cancel', reason: `invoice is ${invoice.status}, not paid` };
    if (!client.email) return { kind: 'cancel', reason: 'client has no email on file' };
    return {
      kind: 'send',
      email: {
        to: client.email,
        subject: `Receipt: ${fmtMoney(invoice.amount_cents)} — ${businessName}`,
        html: emailLayout(
          businessName,
          `<p>Hi ${escapeHtml(client.full_name)},</p>
           <p>We received your payment. Thank you!</p>
           <table style="border-collapse:collapse;width:100%;font-size:0.95rem">
             <tr><td style="padding:6px 0;color:#64748b">For</td><td style="padding:6px 0">${escapeHtml(invoice.description ?? 'Services')}</td></tr>
             <tr><td style="padding:6px 0;color:#64748b">Amount</td><td style="padding:6px 0"><strong>${fmtMoney(invoice.amount_cents)}</strong></td></tr>
             <tr><td style="padding:6px 0;color:#64748b">Paid</td><td style="padding:6px 0">${invoice.paid_at ? fmtWhen(invoice.paid_at) : '—'}</td></tr>
           </table>`
        ),
      },
    };
  }

  private async renderPaymentReceived(invoiceId: string): Promise<RenderResult> {
    const ctx = await this.invoiceContext(invoiceId);
    if ('cancel' in ctx) return { kind: 'cancel', reason: ctx.cancel };
    const { invoice, client, businessName, professionalEmail } = ctx;
    if (invoice.status !== 'paid') return { kind: 'cancel', reason: `invoice is ${invoice.status}, not paid` };
    if (!professionalEmail) return { kind: 'cancel', reason: 'professional has no email' };
    return {
      kind: 'send',
      email: {
        to: professionalEmail,
        subject: `You got paid: ${fmtMoney(invoice.amount_cents)} from ${client.full_name}`,
        html: emailLayout(
          businessName,
          `<p><strong>${escapeHtml(client.full_name)}</strong> paid <strong>${fmtMoney(invoice.amount_cents)}</strong>${invoice.description ? ` for ${escapeHtml(invoice.description)}` : ''}.</p>
           <p style="color:#64748b;font-size:0.85rem">Recorded ${invoice.paid_at ? fmtWhen(invoice.paid_at) : 'just now'}.</p>`
        ),
      },
    };
  }

  private async renderAppointmentReminder(appointmentId: string): Promise<RenderResult> {
    const { data, error } = await supabaseAdmin
      .from('appointments')
      .select('*, services(name, service_type), clients(full_name, email), accounts:professional_account_id(id)')
      .eq('id', appointmentId)
      .maybeSingle();
    if (error) return { kind: 'cancel', reason: error.message };
    if (!data) return { kind: 'cancel', reason: 'appointment no longer exists' };
    const appt = data as Appointment & {
      services: Pick<Service, 'name' | 'service_type'> | null;
      clients: Pick<Client, 'full_name' | 'email'> | null;
    };
    if (appt.status !== 'scheduled') {
      return { kind: 'cancel', reason: `appointment is ${appt.status}` };
    }
    if (Date.parse(appt.starts_at) < Date.now()) {
      return { kind: 'cancel', reason: 'appointment start time already passed' };
    }
    if (!appt.clients?.email) return { kind: 'cancel', reason: 'client has no email on file' };
    const businessName = await this.businessName(appt.professional_account_id);
    const serviceName = appt.services?.name ?? 'Appointment';
    return {
      kind: 'send',
      email: {
        to: appt.clients.email,
        subject: `Reminder: ${serviceName} — ${fmtWhen(appt.starts_at)}`,
        html: emailLayout(
          businessName,
          `<p>Hi ${escapeHtml(appt.clients.full_name)},</p>
           <p>A reminder that <strong>${escapeHtml(serviceName)}</strong> with ${escapeHtml(businessName)} is coming up:</p>
           <p style="font-size:1.05rem"><strong>${fmtWhen(appt.starts_at)}</strong></p>
           ${appt.notes ? `<p style="color:#64748b">Notes: ${escapeHtml(appt.notes)}</p>` : ''}
           <p>Need to reschedule? Reply to this email.</p>`
        ),
      },
    };
  }

  // ------------------------------------------------------- render helpers ----

  /**
   * P2-13: the welcome a client gets when their professional adds them.
   * Deliberately links to /portal rather than emailing a magic link —
   * Supabase's built-in mailer allows only a couple of link emails per hour,
   * so auto-sending one here would burn that budget on people who aren't
   * ready to log in. They request their own link when they arrive.
   */
  private async renderPortalInvite(clientId: string, origin: string): Promise<RenderResult> {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .maybeSingle();
    if (error) return { kind: 'cancel', reason: error.message };
    const client = data as Client | null;
    if (!client) return { kind: 'cancel', reason: 'client no longer exists' };
    if (!client.email) return { kind: 'cancel', reason: 'client has no email on file' };
    const businessName = await this.businessName(client.professional_account_id);
    return {
      kind: 'send',
      email: {
        to: client.email,
        subject: `${businessName} set up your pet care portal`,
        html: emailLayout(
          businessName,
          `<p>Hi ${escapeHtml(client.full_name)},</p>
           <p>${escapeHtml(businessName)} has added you to PetPro Connect. Your portal is where you can review and sign agreements, pay invoices, see upcoming visits, and message ${escapeHtml(businessName)} directly.</p>
           <p><a href="${escapeHtml(origin)}/portal">Open your portal</a></p>
           <p>There's no account to create and no password to remember — enter this email address and we'll send you a secure link.</p>`
        ),
      },
    };
  }

  /**
   * O-2: tells an owner their professional replied. Without it the portal is
   * a place you have to remember to check — which breaks the read-only
   * design, where messaging is the only way a client corrects their details.
   */
  private async renderMessageReceived(messageId: string, origin: string): Promise<RenderResult> {
    const { data, error } = await supabaseAdmin
      .from('messages')
      .select('id, body, read_at, sender_account_id, message_threads(client_id, professional_account_id)')
      .eq('id', messageId)
      .maybeSingle();
    if (error) return { kind: 'cancel', reason: error.message };
    const row = data as {
      body: string;
      read_at: string | null;
      message_threads: { client_id: string; professional_account_id: string } | null;
    } | null;
    if (!row?.message_threads) return { kind: 'cancel', reason: 'message or thread no longer exists' };
    // Already read in-app — the email would be noise.
    if (row.read_at) return { kind: 'cancel', reason: 'message was read before the email went out' };

    const { data: clientRow } = await supabaseAdmin
      .from('clients')
      .select('full_name, email')
      .eq('id', row.message_threads.client_id)
      .maybeSingle();
    const client = clientRow as { full_name: string; email: string | null } | null;
    if (!client?.email) return { kind: 'cancel', reason: 'client has no email on file' };
    const businessName = await this.businessName(row.message_threads.professional_account_id);
    const preview = row.body.length > 160 ? `${row.body.slice(0, 160)}…` : row.body;
    return {
      kind: 'send',
      email: {
        to: client.email,
        subject: `New message from ${businessName}`,
        html: emailLayout(
          businessName,
          `<p>Hi ${escapeHtml(client.full_name)},</p>
           <p>${escapeHtml(businessName)} sent you a message:</p>
           <blockquote style="margin:0;padding:10px 14px;border-left:3px solid #2f6f4f;color:#334155">${escapeHtml(preview)}</blockquote>
           <p><a href="${escapeHtml(origin)}/portal#/messages">Read and reply in your portal</a></p>`
        ),
      },
    };
  }

  private async contractContext(contractId: string): Promise<
    | { contract: Contract; client: Client; businessName: string; professionalEmail: string | null }
    | { cancel: string }
  > {
    const { data, error } = await supabaseAdmin
      .from('contracts')
      .select('*, clients(*)')
      .eq('id', contractId)
      .maybeSingle();
    if (error) return { cancel: error.message };
    if (!data) return { cancel: 'contract no longer exists' };
    const { clients, ...contract } = data as Contract & { clients: Client | null };
    if (!clients) return { cancel: 'client no longer exists' };
    // NOTE: the "client has no email" check deliberately lives in the
    // client-facing renderers, not here. R-11 sends a renewal warning to the
    // PROFESSIONAL, and a client with no email on file must not suppress the
    // walker's own reminder about their own business.
    const businessName = await this.businessName(contract.professional_account_id);
    const { data: account } = await supabaseAdmin
      .from('accounts')
      .select('email')
      .eq('id', contract.professional_account_id)
      .maybeSingle();
    return {
      contract: contract as Contract,
      client: clients,
      businessName,
      professionalEmail: (account?.email as string) ?? null,
    };
  }

  private async invoiceContext(invoiceId: string): Promise<
    | { invoice: Invoice; client: Client; businessName: string; professionalEmail: string | null }
    | { cancel: string }
  > {
    const { data, error } = await supabaseAdmin
      .from('invoices')
      .select('*, clients(*)')
      .eq('id', invoiceId)
      .maybeSingle();
    if (error) return { cancel: error.message };
    if (!data) return { cancel: 'invoice no longer exists' };
    const { clients, ...invoice } = data as Invoice & { clients: Client | null };
    if (!clients) return { cancel: 'client no longer exists' };
    const businessName = await this.businessName(invoice.professional_account_id);
    const { data: account } = await supabaseAdmin
      .from('accounts')
      .select('email')
      .eq('id', invoice.professional_account_id)
      .maybeSingle();
    return {
      invoice: invoice as Invoice,
      client: clients,
      businessName,
      professionalEmail: (account?.email as string) ?? null,
    };
  }

  private async businessName(professionalAccountId: string): Promise<string> {
    const { data } = await supabaseAdmin
      .from('professional_profiles')
      .select('business_name, full_name')
      .eq('account_id', professionalAccountId)
      .maybeSingle();
    const profile = data as Pick<ProfessionalProfile, 'business_name' | 'full_name'> | null;
    return profile?.business_name ?? profile?.full_name ?? 'Your pet care professional';
  }
}

export const notificationService = new NotificationService();

/** Started once from index.ts — not in createServer(), so tests that build
 *  the app never spawn background timers. */
/**
 * R-11/R-16: queue renewal warnings for agreements whose term is closing in.
 *
 * A contract is due when `end_date - notice_days <= today <= end_date`, where
 * notice_days is the contract's own override or the professional's default
 * (30 per D5).
 *
 * **Exactly-once without a "notice sent" column:** the queue itself is the
 * record. A contract that already has a `contract_renewal_due` row is skipped,
 * so repeated passes — and a host that boots several times a day, like
 * Render's free tier — can't spam a client. A second source of truth for
 * "did we send it" is how double-sends and silent misses both happen.
 */
export async function queueDueRenewalNotices(): Promise<number> {
  const today = new Date();
  const todayYmd = today.toISOString().slice(0, 10);
  // Widest possible window: no professional can warn more than 365 days out
  // (the 020 CHECK), so nothing outside it can be due today.
  const horizon = new Date(today.getTime() + 365 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { data: contracts, error } = await supabaseAdmin
    .from('contracts')
    .select('id, professional_account_id, end_date, renewal_notice_days')
    .eq('status', 'signed')
    .not('end_date', 'is', null)
    .gte('end_date', todayYmd)
    .lte('end_date', horizon);
  if (error) throw new ServiceError('renewal_scan_failed', error.message, 500);
  if (!contracts?.length) return 0;

  // One defaults lookup per professional, not per contract.
  const proIds = [...new Set(contracts.map((c) => c.professional_account_id as string))];
  const { data: profiles } = await supabaseAdmin
    .from('professional_profiles')
    .select('account_id, default_renewal_notice_days')
    .in('account_id', proIds);
  const defaults = new Map(
    (profiles ?? []).map((p) => [p.account_id as string, (p.default_renewal_notice_days as number) ?? 30])
  );

  let queued = 0;
  for (const contract of contracts) {
    try {
      const noticeDays =
        (contract.renewal_notice_days as number | null) ??
        defaults.get(contract.professional_account_id as string) ??
        30;
      const endMs = Date.parse(`${contract.end_date}T00:00:00Z`);
      const windowOpensMs = endMs - noticeDays * 24 * 60 * 60 * 1000;
      if (Date.parse(`${todayYmd}T00:00:00Z`) < windowOpensMs) continue; // not yet

      // Already warned? The queue is the record — see the note above.
      const { data: existing } = await supabaseAdmin
        .from('notification_queue')
        .select('id')
        .eq('account_id', contract.professional_account_id)
        .contains('payload', { contract_id: contract.id, template: 'contract_renewal_due' })
        .limit(1);
      if (existing?.length) continue;

      await notificationService.enqueue({
        accountId: contract.professional_account_id as string,
        category: 'contract',
        template: 'contract_renewal_due',
        data: { contract_id: contract.id },
      });
      await notificationService.enqueue({
        accountId: contract.professional_account_id as string,
        category: 'contract',
        template: 'contract_renewal_due_professional',
        data: { contract_id: contract.id },
      });
      queued++;
    } catch (err) {
      // One contract's failure must not starve the rest of the pass.
      console.error(`[renewals] failed for contract ${contract.id}:`, err);
    }
  }
  return queued;
}

/** Interval driver for renewal notices, mirroring the recurring-invoice
 *  worker: a pass at boot (the one moment a sleeping host is awake), then
 *  hourly — a date-based check has no reason to run more often. */
export function startRenewalNoticeWorker(intervalMs = 60 * 60_000): NodeJS.Timeout {
  const pass = () =>
    void queueDueRenewalNotices().then(
      (n) => {
        if (n > 0) console.log(`[renewals] queued renewal notices for ${n} agreement(s)`);
      },
      (err) => console.error('[renewals] pass failed:', err)
    );
  pass();
  const timer = setInterval(pass, intervalMs);
  timer.unref();
  return timer;
}

export function startNotificationWorker(intervalMs = 30_000): NodeJS.Timeout {
  const timer = setInterval(() => {
    void notificationService.processDue().catch((err) => {
      console.error('[notifications] worker pass failed:', err);
    });
  }, intervalMs);
  timer.unref();
  return timer;
}
