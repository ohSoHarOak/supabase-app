import { env } from '../../config/env';
import { IEmailProvider } from './IEmailProvider';
import { NullEmailProvider, ResendEmailProvider } from './ResendEmailProvider';

export type { EmailAttachment, EmailMessage, IEmailProvider } from './IEmailProvider';

let provider: IEmailProvider | null = null;

/**
 * Provider selection happens here and nowhere else. The founder picked
 * Resend/SendGrid as interchangeable options — if SendGrid wins, add a
 * SendGridEmailProvider and switch this factory; no service code changes.
 */
export function getEmailProvider(): IEmailProvider {
  if (!provider) {
    provider = env.resendApiKey
      ? new ResendEmailProvider(env.resendApiKey, env.emailFrom)
      : new NullEmailProvider();
  }
  return provider;
}
