import { env } from './config/env';
import { createServer } from './api/server';
import { startNotificationWorker, startRenewalNoticeWorker } from './services/NotificationService';
import { startRecurringInvoiceWorker } from './services/PaymentService';

const app = createServer();

app.listen(env.port, () => {
  console.log(`PetPro Connect API listening on port ${env.port}`);
  if (!env.resendApiKey) {
    console.log('[notifications] RESEND_API_KEY not set — emails queue as pending until it is.');
  }
});

// Sends due notifications (appointment reminders and anything that queued
// while email was unconfigured) every 30 seconds.
startNotificationWorker();

// Period-end invoicing for weekly/biweekly/monthly services (founder
// decision 2026-07-17): one pass at boot, then every 5 minutes. Note for a
// sleeping host (Render free tier): passes only run while the app is awake.
startRecurringInvoiceWorker();

// R-11/R-16: warn both parties before an agreement's term runs out. A pass at
// boot, then hourly — a date-based check gains nothing from running more
// often, and the queue itself prevents a repeated boot from re-sending.
startRenewalNoticeWorker();
