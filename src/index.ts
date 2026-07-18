import { env } from './config/env';
import { createServer } from './api/server';
import { startNotificationWorker } from './services/NotificationService';
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
