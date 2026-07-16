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
  | 'appointment_reminder';

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

  private async contractContext(contractId: string): Promise<
    | { contract: Contract; client: Client; businessName: string }
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
    if (!clients.email) return { cancel: 'client has no email on file' };
    const businessName = await this.businessName(contract.professional_account_id);
    return { contract: contract as Contract, client: clients, businessName };
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
export function startNotificationWorker(intervalMs = 30_000): NodeJS.Timeout {
  const timer = setInterval(() => {
    void notificationService.processDue().catch((err) => {
      console.error('[notifications] worker pass failed:', err);
    });
  }, intervalMs);
  timer.unref();
  return timer;
}
