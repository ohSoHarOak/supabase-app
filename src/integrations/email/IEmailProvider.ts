/**
 * Email provider adapter (Marketplace Seam 3 — same pattern as IeSignProvider).
 * Service code only ever talks to this interface; swapping Resend for
 * SendGrid (or adding an SMS provider for P2-2) never touches callers.
 */

export interface EmailAttachment {
  filename: string;
  /** Base64-encoded file content. */
  content: string;
  contentType: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}

export interface IEmailProvider {
  /** False when no API key is set — sends are skipped, queue rows stay pending. */
  readonly configured: boolean;
  readonly name: string;
  send(message: EmailMessage): Promise<{ providerMessageId: string | null }>;
}
