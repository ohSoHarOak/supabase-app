import { EmailMessage, IEmailProvider } from './IEmailProvider';

const RESEND_API_URL = 'https://api.resend.com/emails';

/**
 * Resend implementation — plain HTTP (Node 20 global fetch), no SDK
 * dependency. Note: until the founder verifies a sending domain in Resend,
 * the default `onboarding@resend.dev` sender can only deliver to the Resend
 * account owner's own email address — enough to test every Week 7 flow.
 */
export class ResendEmailProvider implements IEmailProvider {
  readonly configured = true;
  readonly name = 'resend';

  constructor(
    private apiKey: string,
    private from: string
  ) {}

  async send(message: EmailMessage): Promise<{ providerMessageId: string | null }> {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        attachments: message.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          content_type: a.contentType,
        })),
      }),
    });

    const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!response.ok) {
      throw new Error(`Resend rejected the email (${response.status}): ${body.message ?? 'unknown error'}`);
    }
    return { providerMessageId: body.id ?? null };
  }
}

/** Stand-in while no email API key is configured — nothing sends. */
export class NullEmailProvider implements IEmailProvider {
  readonly configured = false;
  readonly name = 'none';

  async send(): Promise<{ providerMessageId: string | null }> {
    throw new Error('No email provider configured (set RESEND_API_KEY).');
  }
}
