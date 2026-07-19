/**
 * PetPro Connect — source of truth for all data shapes.
 * These mirror the SQL schema in src/db/migrations/ (001–013).
 * If a field isn't here, it isn't in the database — add it deliberately.
 */

// ---------------------------------------------------------------------------
// Accounts (Seam 1: typed accounts)
// ---------------------------------------------------------------------------

export type AccountType = 'professional' | 'business' | 'owner';
export type AccountStatus = 'active' | 'suspended' | 'deactivated';

export interface Account {
  id: string;
  auth_user_id: string | null; // Supabase Auth user id
  account_type: AccountType;
  email: string;
  phone: string | null;
  status: AccountStatus;
  created_at: string;
  updated_at: string;
}

export interface ProfessionalProfile {
  account_id: string;
  full_name: string;
  business_name: string | null;
  bio: string | null;
  years_experience: number | null;
  service_areas: string[];
  profile_photo_url: string | null;
  // Which service types this professional offers (014). Empty = no
  // preference yet — the UI shows every type until they choose.
  offered_service_types: ServiceType[];
  /** Days before a contract's end_date to warn both parties (020). The
   *  general default D5 asked for; each contract can override it. */
  default_renewal_notice_days: number;
  created_at: string;
  updated_at: string;
}

export interface OwnerProfile {
  account_id: string;
  full_name: string;
  address: string | null;
  created_at: string;
  updated_at: string;
}

export type BusinessRole = 'account_owner' | 'manager' | 'employee';

export interface CredentialDocument {
  id: string;
  account_id: string;
  kind: 'license' | 'insurance' | 'certification';
  title: string;
  document_url: string | null;
  issued_on: string | null;
  expires_on: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// CRM — clients & pets
// ---------------------------------------------------------------------------

export type ClientStatus = 'prospect' | 'active' | 'inactive';

export interface Client {
  id: string;
  professional_account_id: string;
  owner_account_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  cancellation_window_hours: number | null;
  no_show_fee_cents: number | null;
  entry_instructions: string | null;
  general_notes: string | null;
  status: ClientStatus;
  created_at: string;
  updated_at: string;
}

export interface Pet {
  id: string;
  client_id: string;
  name: string;
  photo_url: string | null;
  /** dog | cat | other — free text, not an enum, so a new species never
   *  costs a migration (018). Defaults to 'dog' server-side. */
  species: string;
  breed: string | null;
  date_of_birth: string | null;
  weight_lb: number | null;
  color: string | null;
  microchip_number: string | null;
  medical_conditions: string | null;
  behavior_notes: string | null;
  feeding_notes: string | null;
  emergency_vet: string | null;
  created_at: string;
  updated_at: string;
}

export interface VaccinationRecord {
  id: string;
  pet_id: string;
  vaccine_name: string;
  administered_on: string | null;
  expires_on: string | null;
  document_url: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Services (service-type abstraction — future professions plug in here)
// ---------------------------------------------------------------------------

export type ServiceType =
  | 'group_walk'
  | 'private_walk'
  | 'drop_in' // short check-in, not a walk (018)
  | 'training_session'
  | 'grooming'
  | 'sitting'
  | 'boarding'
  | 'other';

/** Human labels for service types. The server needs these because it builds
 *  service names itself now (W-5) rather than taking a typed-in name.
 *  Mirrored by SERVICE_TYPES in public/app.js, which needs them for the Type
 *  dropdown — keep the two in step when adding a profession. */
export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  group_walk: 'Group walk',
  private_walk: 'Private walk',
  drop_in: 'Drop-in visit',
  training_session: 'Training session',
  grooming: 'Grooming',
  sitting: 'Sitting',
  boarding: 'Boarding',
  other: 'Service',
};

export type BillingCadence =
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'per_visit'
  | 'per_day' // boarding/sitting are day-priced (014)
  | 'per_package'
  | 'one_time';

/** Mirrored by CADENCES in public/app.js — keep the two in step. */
export const BILLING_CADENCE_LABELS: Record<BillingCadence, string> = {
  per_visit: 'per visit',
  per_day: 'per day',
  weekly: 'weekly',
  biweekly: 'every 2 weeks',
  monthly: 'monthly',
  per_package: 'per package',
  one_time: 'one-time',
};

export type ServiceStatus = 'draft' | 'active' | 'paused' | 'ended';

export interface Service {
  id: string;
  client_id: string;
  professional_account_id: string;
  /** The contract that created this service (016). Null = predates W-5, when
   *  services were still set up ad-hoc on the client profile. */
  contract_id: string | null;
  service_type: ServiceType;
  /** Auto-built as "Type — Pet" at creation (W-5); no longer typed by hand. */
  name: string;
  /** Surfaced in the UI as "Notes" (W-5). */
  description: string | null;
  duration_minutes: number | null;
  price_cents: number;
  billing_cadence: BillingCadence;
  session_count: number | null; // sessions included in a package (014)
  start_date: string | null;
  end_date: string | null;
  /** End of the current billing period for weekly/biweekly/monthly services
   *  (017). The recurring-invoice worker invoices when it arrives and
   *  advances it one period. Null = not scheduled (other cadences, or
   *  awaiting the worker's first pass). */
  next_invoice_date: string | null;
  status: ServiceStatus;
  created_at: string;
  updated_at: string;
}

/** Pets covered by a service — the service_pets join (004), written from W-6
 *  onward. One walk covering two dogs is one service at one price. */
export interface ServicePet {
  service_id: string;
  pet_id: string;
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export type ContractStatus = 'draft' | 'sent' | 'signed' | 'declined' | 'voided';
export type SigningMethod = 'in_person' | 'electronic';

export interface ContractTemplate {
  id: string;
  professional_account_id: string;
  name: string;
  body_html: string;
  created_at: string;
  updated_at: string;
}

export interface Contract {
  id: string;
  professional_account_id: string;
  client_id: string;
  service_id: string | null;
  template_id: string | null;
  generated_html: string; // immutable snapshot once status = 'signed'
  status: ContractStatus;
  signing_method: SigningMethod | null;
  signer_name: string | null;
  signature_image_url: string | null;
  signed_pdf_url: string | null;
  esign_envelope_id: string | null;
  signed_at: string | null;
  /** Day the term ends (020). NULL = open-ended. A scheduling fact ABOUT the
   *  agreement — never part of the immutable signed HTML. */
  end_date: string | null;
  /** Days before end_date to warn. NULL = the professional's default. */
  renewal_notice_days: number | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

export type AppointmentStatus = 'scheduled' | 'completed' | 'cancelled' | 'no_show';

export interface Appointment {
  id: string;
  service_id: string;
  client_id: string;
  professional_account_id: string;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  recurrence_rule: string | null;
  recurrence_parent_id: string | null;
  notes: string | null;
  completed_at: string | null;
  // Structured completion data (013) — the P2-2 walk-report seam. Captured on
  // "mark complete" and mirrored into the walk_completed event payload.
  actual_start_at: string | null;
  actual_end_at: string | null;
  completion_notes: string | null;
  good_dog: boolean | null;
  got_a_treat: boolean | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Payments (Seam 4: generic billing)
// ---------------------------------------------------------------------------

export type BillingPeriod = 'one_time' | 'week' | 'month';
export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
export type TransactionStatus = 'pending' | 'succeeded' | 'failed' | 'refunded';

export interface StripeProduct {
  id: string;
  account_id: string; // billable item attached to an account — not "walker subscription"
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  name: string;
  unit_amount_cents: number;
  billing_period: BillingPeriod;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Invoice {
  id: string;
  professional_account_id: string;
  client_id: string;
  service_id: string | null;
  stripe_invoice_id: string | null;
  stripe_checkout_session_id: string | null; // Checkout Session collecting this invoice (012)
  description: string | null; // line item shown in the UI and on Stripe Checkout (012)
  amount_cents: number;
  currency: string;
  status: InvoiceStatus;
  due_date: string | null;
  paid_at: string | null;
  /** Visits this invoice prepays for `service_id` (019). NULL = not a
   *  prepaid package — which is every ordinary one-off invoice. */
  sessions_purchased: number | null;
  /** Bearer token for the public pay page (021). Grants view + pay on THIS
   *  invoice only. NULL until the invoice is first sent. Never expose it
   *  anywhere except the emailed link. */
  pay_token: string | null;
  /** When the invoice was last emailed to the client (021). */
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

/** R-2/R-3 prepaid drawdown. `used` is derived from completed appointments,
 *  never stored, so it can't drift from the schedule. */
export interface SessionBalance {
  purchased: number;
  used: number;
  remaining: number;
}

/** A service plus its prepaid balance. `session_balance` is null when the
 *  service has no prepaid package at all — distinct from a package that has
 *  run out, which is `remaining: 0`. */
export type ServiceWithBalance = Service & { session_balance: SessionBalance | null };

export interface PaymentTransaction {
  id: string;
  invoice_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_event_id: string | null; // idempotency key
  amount_cents: number;
  status: TransactionStatus;
  occurred_at: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Events (Seam 2: append-only event log)
// ---------------------------------------------------------------------------

export type EventType =
  | 'account_created'
  | 'client_created'
  | 'contract_generated'
  | 'contract_signed'
  | 'appointment_scheduled'
  | 'walk_completed'
  | 'payment_received'
  | 'qr_scan'
  | (string & {}); // open set — new event types are added, never migrated

export interface DomainEvent {
  id: string;
  actor_account_id: string | null;
  event_type: EventType;
  subject_type: string | null;
  subject_id: string | null;
  location: { lat: number; lng: number } | null;
  metadata: Record<string, unknown>;
  occurred_at: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

export interface MessageThread {
  id: string;
  professional_account_id: string;
  client_id: string;
  last_message_at: string | null;
  created_at: string;
}

export interface Message {
  id: string;
  thread_id: string;
  sender_account_id: string;
  body: string | null;
  image_url: string | null;
  is_system: boolean;
  client_draft_id: string | null;
  read_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export type NotificationChannel = 'push' | 'email' | 'sms';
export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'cancelled';

export interface NotificationPreference {
  account_id: string;
  category: string;
  channel: NotificationChannel;
  enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
}

export interface QueuedNotification {
  id: string;
  account_id: string;
  category: string;
  channel: NotificationChannel;
  payload: Record<string, unknown>;
  status: NotificationStatus;
  scheduled_for: string;
  sent_at: string | null;
  error: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// API envelope
// ---------------------------------------------------------------------------

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: { code: string; message: string };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** Session returned to clients after signup/login (Supabase Auth tokens). */
export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_at: number | null;
  account: Account;
}
