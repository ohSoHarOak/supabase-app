import { supabaseAdmin } from '../config/supabase';
import {
  Appointment,
  AppointmentStatus,
  BillingCadence,
  Invoice,
  Pet,
  Service,
  SERVICE_TYPE_LABELS,
  ServiceStatus,
  ServiceWithBalance,
  ServiceType,
} from '../types';
import { clientService } from './ClientService';
import { ServiceError } from './errors';
import { eventService } from './EventService';
import { notificationService } from './NotificationService';
import { initialInvoiceDate, isRecurringCadence, paymentService, ymdToday } from './PaymentService';

export interface ServiceInput {
  client_id: string;
  service_type: ServiceType;
  /** Optional since W-5: omit it and the name is built as "Type — Pet" from
   *  service_type + pet_ids. Callers that still pass one (Week 6 scripts,
   *  seeded data) keep working. */
  name?: string;
  description?: string | null;
  duration_minutes?: number | null;
  price_cents: number;
  billing_cadence: BillingCadence;
  session_count?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: ServiceStatus;
  /** The contract that created this service (016, W-7). */
  contract_id?: string | null;
  /** Pets covered — written to the service_pets join (W-6). One walk covering
   *  two dogs is one service at one price, not two services. */
  pet_ids?: string[];
}

export interface AppointmentInput {
  service_id: string;
  starts_at: string;
  /** Defaults to starts_at + the service's duration (or 30 minutes). */
  ends_at?: string | null;
  notes?: string | null;
  /** 1 = one-off (default). N > 1 = weekly, N weeks of occurrences. */
  repeat_weeks?: number;
  /** Additional weekly slots in the same series — the Wed and Fri of a
   *  Mon/Wed/Fri walk. Each repeats weekly for repeat_weeks, same duration
   *  and notes as starts_at, and the whole set books (or 409s) as one. */
  extra_starts?: string[];
}

export interface CompletionInput {
  actual_start_at?: string | null;
  actual_end_at?: string | null;
  completion_notes?: string | null;
  good_dog?: boolean | null;
  got_a_treat?: boolean | null;
}

/** Appointment joined with the names the UI needs to render a schedule row. */
export type AppointmentWithDetails = Appointment & {
  services: Pick<Service, 'name' | 'service_type' | 'price_cents' | 'billing_cadence' | 'duration_minutes'> | null;
  clients: { full_name: string } | null;
};

const MAX_REPEAT_WEEKS = 26;
const DEFAULT_DURATION_MINUTES = 30;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * W-5: the service name is derived, not typed. "Private walk — Pepper" reads
 * the way a walker talks about the job, and it keeps invoice descriptions
 * (see generateInvoice) legible without a naming convention nobody follows.
 *
 * Written to the existing NOT NULL services.name, so no migration and every
 * existing reader keeps working. Falls back to the bare type label when a
 * service covers no pets — pre-W-6 rows and "other" services both hit this.
 */
export function buildServiceName(type: ServiceType, petNames: string[]): string {
  const label = SERVICE_TYPE_LABELS[type] ?? 'Service';
  if (petNames.length === 0) return label;
  // "Pepper", "Pepper & Biscuit", "Pepper, Biscuit & Moose"
  const pets =
    petNames.length === 1
      ? petNames[0]
      : `${petNames.slice(0, -1).join(', ')} & ${petNames[petNames.length - 1]}`;
  return `${label} — ${pets}`;
}

function fmtSlot(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Scheduling — Week 6.
 *
 * Services are the product a client is buying (per-client, service-type
 * abstraction so trainers/groomers plug in later). Appointments are booked
 * against a service; weekly recurrence is materialized as real rows (the
 * first occurrence is the parent carrying the RRULE, the rest point at it
 * via recurrence_parent_id) so conflict detection, completion, and the
 * calendar all work on plain rows instead of expanding rules at read time.
 *
 * Completing an appointment captures the structured walk-report data
 * (P2-2 seam), publishes walk_completed, and — for per_visit services —
 * generates the invoice automatically via PaymentService.
 */
export class SchedulingService {
  // ------------------------------------------------------------ services ----

  async createService(professionalAccountId: string, input: ServiceInput): Promise<Service> {
    const client = await clientService.getClient(professionalAccountId, input.client_id);

    // pet_ids lives on the join table, not the row — keep it out of the insert.
    const { pet_ids: petIds, ...columns } = input;
    const pets = this.resolvePets(client.pets, petIds);

    const status = input.status ?? 'active';
    const { data, error } = await supabaseAdmin
      .from('services')
      .insert({
        ...columns,
        name: input.name?.trim() || buildServiceName(input.service_type, pets.map((p) => p.name)),
        client_id: client.id,
        professional_account_id: professionalAccountId,
        // DB default is 'draft', but a walker creating "Private walk — $30"
        // means to use it now; drafts would just be a surprise dead end.
        // Contract-created services are the exception — they pass 'draft'
        // explicitly and only go active when the client signs (W-7).
        status,
        // Period-end billing starts its clock the moment a recurring service
        // is live; drafts wait for signing (activateServicesForContract).
        next_invoice_date:
          status === 'active' && isRecurringCadence(input.billing_cadence)
            ? initialInvoiceDate(input.start_date, input.billing_cadence)
            : null,
      })
      .select()
      .single();
    if (error) throw new ServiceError('service_create_failed', error.message, 500);
    const service = data as Service;

    await this.setServicePets(service.id, pets.map((p) => p.id));
    return service;
  }

  /**
   * Validate pet_ids against the client's own pets, so a service can't be
   * pointed at someone else's dog. Empty/absent = no pets on the join, which
   * is how every pre-W-6 service looks.
   */
  private resolvePets(clientPets: Pet[], petIds?: string[]): Pet[] {
    if (!petIds?.length) return [];
    const byId = new Map(clientPets.map((p) => [p.id, p]));
    return petIds.map((id) => {
      const pet = byId.get(id);
      if (!pet) {
        throw new ServiceError('pet_not_on_client', 'That pet is not on this client.', 422);
      }
      return pet;
    });
  }

  /** Replace a service's pet coverage. Delete-then-insert: the join is a tiny
   *  set with no history worth preserving, and the PK makes upserts fiddlier
   *  than they're worth. */
  private async setServicePets(serviceId: string, petIds: string[]): Promise<void> {
    const { error: clearError } = await supabaseAdmin
      .from('service_pets')
      .delete()
      .eq('service_id', serviceId);
    if (clearError) throw new ServiceError('service_pets_failed', clearError.message, 500);
    if (petIds.length === 0) return;

    const { error } = await supabaseAdmin
      .from('service_pets')
      .insert(petIds.map((pet_id) => ({ service_id: serviceId, pet_id })));
    if (error) throw new ServiceError('service_pets_failed', error.message, 500);
  }

  /** Pets covered by each of the given services, keyed by service id (W-6). */
  async getPetsForServices(serviceIds: string[]): Promise<Map<string, Pet[]>> {
    const byService = new Map<string, Pet[]>();
    if (serviceIds.length === 0) return byService;

    const { data, error } = await supabaseAdmin
      .from('service_pets')
      .select('service_id, pets(*)')
      .in('service_id', serviceIds);
    if (error) throw new ServiceError('service_pets_lookup_failed', error.message, 500);

    // The embedded row comes back as an object for a to-one FK, but the client's
    // generated types widen it to an array — normalize rather than trust either.
    type JoinRow = { service_id: string; pets: Pet | Pet[] | null };
    for (const row of (data ?? []) as unknown as JoinRow[]) {
      if (!row.pets) continue;
      const pets = Array.isArray(row.pets) ? row.pets : [row.pets];
      const list = byService.get(row.service_id) ?? [];
      list.push(...pets);
      byService.set(row.service_id, list);
    }
    return byService;
  }

  /** Services a contract created, draft or otherwise (W-7). */
  async listServicesForContract(
    professionalAccountId: string,
    contractId: string
  ): Promise<Service[]> {
    const { data, error } = await supabaseAdmin
      .from('services')
      .select('*')
      .eq('professional_account_id', professionalAccountId)
      .eq('contract_id', contractId)
      .order('created_at', { ascending: true });
    if (error) throw new ServiceError('service_list_failed', error.message, 500);
    return (data ?? []) as Service[];
  }

  /**
   * W-7: a contract's services come alive when it's signed, not when it's
   * generated — a draft can still be edited or voided, and a service that
   * exists before the client agreed to the price is exactly the drift W-5…W-7
   * removes.
   *
   * Scoped to draft: re-running this on an already-signed contract is a no-op
   * rather than resurrecting services the walker has since paused or ended.
   */
  async activateServicesForContract(
    professionalAccountId: string,
    contractId: string
  ): Promise<Service[]> {
    const { data, error } = await supabaseAdmin
      .from('services')
      .update({ status: 'active' })
      .eq('professional_account_id', professionalAccountId)
      .eq('contract_id', contractId)
      .eq('status', 'draft')
      .select();
    if (error) throw new ServiceError('service_activate_failed', error.message, 500);
    const activated = (data ?? []) as Service[];

    // Signing is when a recurring service's billing clock starts (founder
    // decision 2026-07-17: invoice at period end). Cadences differ per
    // service, so this can't ride the bulk UPDATE above.
    for (const service of activated) {
      if (!isRecurringCadence(service.billing_cadence)) continue;
      const next = initialInvoiceDate(service.start_date, service.billing_cadence);
      const { error: dateError } = await supabaseAdmin
        .from('services')
        .update({ next_invoice_date: next })
        .eq('id', service.id);
      if (dateError) {
        // Same philosophy as the signing race: the service is validly active;
        // a missing billing date is recoverable (the worker initializes it).
        console.error(`[billing] could not schedule first invoice for service ${service.id}:`, dateError.message);
      } else {
        service.next_invoice_date = next;
      }
    }
    return activated;
  }

  /** Services, each carrying its prepaid balance (R-2/R-3) so the UI can say
   *  "7 of 10 left" without a request per service. */
  async listServices(
    professionalAccountId: string,
    options: { clientId?: string; status?: ServiceStatus } = {}
  ): Promise<ServiceWithBalance[]> {
    let builder = supabaseAdmin
      .from('services')
      .select('*')
      .eq('professional_account_id', professionalAccountId)
      .order('created_at', { ascending: false });
    if (options.clientId) builder = builder.eq('client_id', options.clientId);
    if (options.status) builder = builder.eq('status', options.status);

    const { data, error } = await builder;
    if (error) throw new ServiceError('service_list_failed', error.message, 500);
    const services = (data ?? []) as Service[];

    const balances = await paymentService.sessionBalances(
      professionalAccountId,
      services.map((s) => s.id)
    );
    return services.map((s) => ({ ...s, session_balance: balances.get(s.id) ?? null }));
  }

  async getService(professionalAccountId: string, serviceId: string): Promise<Service> {
    const { data, error } = await supabaseAdmin
      .from('services')
      .select('*')
      .eq('id', serviceId)
      .eq('professional_account_id', professionalAccountId)
      .maybeSingle();
    if (error) throw new ServiceError('service_lookup_failed', error.message, 500);
    if (!data) throw new ServiceError('service_not_found', 'Service not found.', 404);
    return data as Service;
  }

  /** Update terms or status. No hard delete — a service with appointment
   *  history gets status 'ended' instead, so past walks keep their context. */
  async updateService(
    professionalAccountId: string,
    serviceId: string,
    input: Partial<Omit<ServiceInput, 'client_id'>>
  ): Promise<Service> {
    const current = await this.getService(professionalAccountId, serviceId); // ownership check

    // Resuming a paused recurring service re-anchors its billing cycle at
    // today: paused time was unserved and unbilled, so the next invoice is
    // one full period from the resume — never a catch-up for the pause.
    const patch: Record<string, unknown> = { ...input };
    const cadence = input.billing_cadence ?? current.billing_cadence;
    if (input.status === 'active' && current.status === 'paused' && isRecurringCadence(cadence)) {
      patch.next_invoice_date = initialInvoiceDate(ymdToday(), cadence);
    }

    const { data, error } = await supabaseAdmin
      .from('services')
      .update(patch)
      .eq('id', serviceId)
      .select()
      .single();
    if (error) throw new ServiceError('service_update_failed', error.message, 500);
    return data as Service;
  }

  // -------------------------------------------------------- appointments ----

  /**
   * Book an appointment, optionally repeating weekly. All occurrences are
   * conflict-checked up front; any overlap rejects the whole request with a
   * 409 listing the clashing slots, so a recurring booking never half-lands.
   */
  async createAppointment(
    professionalAccountId: string,
    input: AppointmentInput
  ): Promise<Appointment[]> {
    const service = await this.getService(professionalAccountId, input.service_id);
    if (service.status !== 'active') {
      throw new ServiceError(
        'service_not_active',
        `Appointments can only be booked on an active service (this one is ${service.status}).`,
        409
      );
    }

    const startMs = Date.parse(input.starts_at);
    const durationMs = input.ends_at
      ? Date.parse(input.ends_at) - startMs
      : (service.duration_minutes ?? DEFAULT_DURATION_MINUTES) * 60 * 1000;
    if (!Number.isFinite(startMs)) {
      throw new ServiceError('invalid_time', 'starts_at is not a valid timestamp.', 422);
    }
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new ServiceError('invalid_time', 'ends_at must be after starts_at.', 422);
    }

    const repeat = Math.min(Math.max(input.repeat_weeks ?? 1, 1), MAX_REPEAT_WEEKS);

    // Multi-day series: each slot (the base + every extra) repeats weekly.
    // Deduped so a stray extra equal to the base can't double-book itself.
    const slotStarts = [...new Set([startMs, ...(input.extra_starts ?? []).map((s) => Date.parse(s))])];
    if (slotStarts.some((ms) => !Number.isFinite(ms))) {
      throw new ServiceError('invalid_time', 'extra_starts must be valid ISO timestamps.', 422);
    }
    const occurrences = slotStarts
      .flatMap((slotMs) =>
        Array.from({ length: repeat }, (_, i) => ({
          starts_at: new Date(slotMs + i * WEEK_MS).toISOString(),
          ends_at: new Date(slotMs + i * WEEK_MS + durationMs).toISOString(),
        }))
      )
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

    // Boarding is not exclusive time (founder decision 2026-07-15): a boarder
    // doesn't stop the professional from walking other dogs, and multiple
    // dogs can board at once — so boarding stays neither get conflict-checked
    // nor block other bookings (see findConflicts). That includes the series'
    // own slots overlapping each other: two multi-day stays may well overlap.
    if (service.service_type !== 'boarding') {
      // The slots must not overlap each other either (two 3pm walks on the
      // same day arrive as one deduped slot, but a 2-hour session at 3pm and
      // another at 4pm the same day would collide).
      for (let i = 1; i < occurrences.length; i++) {
        if (occurrences[i].starts_at < occurrences[i - 1].ends_at) {
          throw new ServiceError(
            'appointment_conflict',
            `These slots overlap each other: ${fmtSlot(occurrences[i - 1].starts_at)} and ${fmtSlot(occurrences[i].starts_at)}. Pick different times.`,
            409
          );
        }
      }
      const conflicts = await this.findConflicts(professionalAccountId, occurrences);
      if (conflicts.length > 0) {
        throw new ServiceError(
          'appointment_conflict',
          `This would double-book: ${conflicts.join('; ')}. Pick a different time.`,
          409
        );
      }
    }

    // First occurrence is the series parent and carries the recurrence rule.
    const { data: parent, error: parentError } = await supabaseAdmin
      .from('appointments')
      .insert({
        service_id: service.id,
        client_id: service.client_id,
        professional_account_id: professionalAccountId,
        starts_at: occurrences[0].starts_at,
        ends_at: occurrences[0].ends_at,
        notes: input.notes ?? null,
        // COUNT is weeks; a multi-day series just has more children per week.
        recurrence_rule: occurrences.length > 1 ? `FREQ=WEEKLY;COUNT=${repeat}` : null,
      })
      .select()
      .single();
    if (parentError) throw new ServiceError('appointment_create_failed', parentError.message, 500);

    let created: Appointment[] = [parent as Appointment];
    if (occurrences.length > 1) {
      const { data: children, error: childError } = await supabaseAdmin
        .from('appointments')
        .insert(
          occurrences.slice(1).map((occ) => ({
            service_id: service.id,
            client_id: service.client_id,
            professional_account_id: professionalAccountId,
            starts_at: occ.starts_at,
            ends_at: occ.ends_at,
            notes: input.notes ?? null,
            recurrence_parent_id: (parent as Appointment).id,
          }))
        )
        .select();
      if (childError) {
        // Don't leave a half-created series behind the walker's back.
        await supabaseAdmin.from('appointments').delete().eq('id', (parent as Appointment).id);
        throw new ServiceError('appointment_create_failed', childError.message, 500);
      }
      created = created.concat((children ?? []) as Appointment[]);
    }

    await eventService.publish({
      actorAccountId: professionalAccountId,
      eventType: 'appointment_scheduled',
      subjectType: 'appointment',
      subjectId: created[0].id,
      metadata: {
        client_id: service.client_id,
        service_id: service.id,
        service_name: service.name,
        starts_at: created[0].starts_at,
        occurrences: created.length,
        recurrence_rule: created[0].recurrence_rule,
      },
    });

    // Week 7: queue a 24h-before email reminder for each occurrence far
    // enough out. Reminders re-check the appointment at send time, so a
    // later cancel/complete/reschedule can't send a stale email.
    await notificationService.scheduleAppointmentReminders(professionalAccountId, created);

    return created;
  }

  /** Overlap check against this professional's scheduled appointments.
   *  Boarding stays are excluded — they don't occupy the calendar. */
  private async findConflicts(
    professionalAccountId: string,
    occurrences: { starts_at: string; ends_at: string }[]
  ): Promise<string[]> {
    const windowStart = occurrences[0].starts_at;
    const windowEnd = occurrences[occurrences.length - 1].ends_at;

    const { data, error } = await supabaseAdmin
      .from('appointments')
      .select('starts_at, ends_at, clients(full_name), services!inner(service_type)')
      .eq('professional_account_id', professionalAccountId)
      .eq('status', 'scheduled')
      .neq('services.service_type', 'boarding')
      .lt('starts_at', windowEnd)
      .gt('ends_at', windowStart);
    if (error) throw new ServiceError('conflict_check_failed', error.message, 500);

    const existing = (data ?? []) as unknown as {
      starts_at: string;
      ends_at: string;
      clients: { full_name: string } | null;
    }[];

    const conflicts: string[] = [];
    for (const occ of occurrences) {
      const hit = existing.find((e) => e.starts_at < occ.ends_at && e.ends_at > occ.starts_at);
      if (hit) {
        conflicts.push(
          `${fmtSlot(occ.starts_at)} overlaps ${hit.clients?.full_name ?? 'another client'}'s ${fmtSlot(hit.starts_at)} appointment`
        );
      }
    }
    return conflicts;
  }

  async listAppointments(
    professionalAccountId: string,
    options: { from?: string; to?: string; clientId?: string; status?: AppointmentStatus } = {}
  ): Promise<AppointmentWithDetails[]> {
    let builder = supabaseAdmin
      .from('appointments')
      .select('*, services(name, service_type, price_cents, billing_cadence, duration_minutes), clients(full_name)')
      .eq('professional_account_id', professionalAccountId)
      .order('starts_at', { ascending: true });
    if (options.from) builder = builder.gte('starts_at', options.from);
    if (options.to) builder = builder.lt('starts_at', options.to);
    if (options.clientId) builder = builder.eq('client_id', options.clientId);
    if (options.status) builder = builder.eq('status', options.status);

    const { data, error } = await builder;
    if (error) throw new ServiceError('appointment_list_failed', error.message, 500);
    return (data ?? []) as unknown as AppointmentWithDetails[];
  }

  async getAppointment(
    professionalAccountId: string,
    appointmentId: string
  ): Promise<AppointmentWithDetails> {
    const { data, error } = await supabaseAdmin
      .from('appointments')
      .select('*, services(name, service_type, price_cents, billing_cadence, duration_minutes), clients(full_name)')
      .eq('id', appointmentId)
      .eq('professional_account_id', professionalAccountId)
      .maybeSingle();
    if (error) throw new ServiceError('appointment_lookup_failed', error.message, 500);
    if (!data) throw new ServiceError('appointment_not_found', 'Appointment not found.', 404);
    return data as unknown as AppointmentWithDetails;
  }

  /** Reschedule one occurrence (or edit its notes). Times are re-checked
   *  for conflicts, ignoring the appointment's own current slot. */
  async updateAppointment(
    professionalAccountId: string,
    appointmentId: string,
    input: { starts_at?: string; ends_at?: string; notes?: string | null }
  ): Promise<Appointment> {
    const current = await this.getAppointment(professionalAccountId, appointmentId);
    if (current.status !== 'scheduled' && (input.starts_at || input.ends_at)) {
      throw new ServiceError(
        'appointment_not_reschedulable',
        `A ${current.status} appointment cannot be rescheduled.`,
        409
      );
    }

    if (input.starts_at || input.ends_at) {
      const starts_at = input.starts_at ?? current.starts_at;
      const ends_at =
        input.ends_at ??
        (input.starts_at
          ? // keep the original duration when only the start moves
            new Date(
              Date.parse(input.starts_at) + (Date.parse(current.ends_at) - Date.parse(current.starts_at))
            ).toISOString()
          : current.ends_at);
      if (Date.parse(ends_at) <= Date.parse(starts_at)) {
        throw new ServiceError('invalid_time', 'ends_at must be after starts_at.', 422);
      }
      // Boarding stays aren't exclusive time — no conflict check on reschedule.
      if (current.services?.service_type !== 'boarding') {
        const conflicts = await this.findConflictsExcluding(professionalAccountId, appointmentId, starts_at, ends_at);
        if (conflicts.length > 0) {
          throw new ServiceError(
            'appointment_conflict',
            `This would double-book: ${conflicts.join('; ')}. Pick a different time.`,
            409
          );
        }
      }
      input = { ...input, starts_at, ends_at };
    }

    const { data, error } = await supabaseAdmin
      .from('appointments')
      .update(input)
      .eq('id', appointmentId)
      .select()
      .single();
    if (error) throw new ServiceError('appointment_update_failed', error.message, 500);
    const appointment = data as Appointment;

    // Keep the pending reminder aligned with the new time.
    if (input.starts_at) {
      await notificationService.rescheduleAppointmentReminder(appointment.id, appointment.starts_at);
    }
    return appointment;
  }

  private async findConflictsExcluding(
    professionalAccountId: string,
    appointmentId: string,
    starts_at: string,
    ends_at: string
  ): Promise<string[]> {
    const { data, error } = await supabaseAdmin
      .from('appointments')
      .select('starts_at, ends_at, clients(full_name), services!inner(service_type)')
      .eq('professional_account_id', professionalAccountId)
      .eq('status', 'scheduled')
      .neq('services.service_type', 'boarding')
      .neq('id', appointmentId)
      .lt('starts_at', ends_at)
      .gt('ends_at', starts_at);
    if (error) throw new ServiceError('conflict_check_failed', error.message, 500);
    return ((data ?? []) as unknown as { starts_at: string; clients: { full_name: string } | null }[]).map(
      (hit) =>
        `${fmtSlot(starts_at)} overlaps ${hit.clients?.full_name ?? 'another client'}'s ${fmtSlot(hit.starts_at)} appointment`
    );
  }

  /**
   * Cancel one occurrence, or this-and-all-later occurrences of its series
   * (scope 'following') — the escape hatch when a recurring booking was set
   * up wrong or a client pauses service.
   */
  async cancelAppointment(
    professionalAccountId: string,
    appointmentId: string,
    scope: 'one' | 'following' = 'one'
  ): Promise<Appointment[]> {
    const appt = await this.getAppointment(professionalAccountId, appointmentId);
    if (appt.status !== 'scheduled') {
      throw new ServiceError(
        'appointment_not_cancellable',
        `A ${appt.status} appointment cannot be cancelled.`,
        409
      );
    }

    let builder = supabaseAdmin
      .from('appointments')
      .update({ status: 'cancelled' })
      .eq('professional_account_id', professionalAccountId)
      .eq('status', 'scheduled');

    if (scope === 'following') {
      const seriesParentId = appt.recurrence_parent_id ?? appt.id;
      builder = builder
        .or(`id.eq.${seriesParentId},recurrence_parent_id.eq.${seriesParentId}`)
        .gte('starts_at', appt.starts_at);
    } else {
      builder = builder.eq('id', appointmentId);
    }

    const { data, error } = await builder.select();
    if (error) throw new ServiceError('appointment_cancel_failed', error.message, 500);
    const cancelled = (data ?? []) as Appointment[];

    await notificationService.cancelAppointmentReminders(cancelled.map((a) => a.id));
    return cancelled;
  }

  // ----------------------------------------------------------- complete ----

  /**
   * Mark a walk done. Captures the structured walk report (P2-2 seam),
   * publishes walk_completed with the full payload + the next occurrence in
   * the series, and auto-invoices per_visit services. The status guard makes
   * a double-tap of "Mark complete" record (and bill) exactly once.
   */
  async completeAppointment(
    professionalAccountId: string,
    appointmentId: string,
    input: CompletionInput = {}
  ): Promise<{
    appointment: Appointment;
    invoice: Invoice | null;
    /** Prepaid visits left after this one, or null if it wasn't prepaid. */
    prepaid_remaining: number | null;
  }> {
    const appt = await this.getAppointment(professionalAccountId, appointmentId);
    if (appt.status !== 'scheduled') {
      throw new ServiceError(
        'appointment_not_completable',
        `This appointment is already ${appt.status}.`,
        409
      );
    }
    const service = await this.getService(professionalAccountId, appt.service_id);

    // R-2/R-3: is this walk already paid for? Measured BEFORE the status flip,
    // so this appointment isn't counted as consumed against its own balance.
    //
    // Race note: two different appointments completing at the same instant can
    // both see the last remaining visit and both skip invoicing. That errs by
    // one visit in the CLIENT's favour, which is the right way to be wrong —
    // the alternative is billing someone for a walk they prepaid. A repeated
    // tap on the same appointment is still exact, guarded by the UPDATE below.
    const balancesBefore = await paymentService.sessionBalances(professionalAccountId, [service.id]);
    const prepaidRemaining = balancesBefore.get(service.id)?.remaining ?? 0;

    // scheduled → completed exactly once, even under a double-submit race.
    const { data: updated, error } = await supabaseAdmin
      .from('appointments')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        actual_start_at: input.actual_start_at ?? appt.starts_at,
        actual_end_at: input.actual_end_at ?? appt.ends_at,
        completion_notes: input.completion_notes ?? null,
        good_dog: input.good_dog ?? null,
        got_a_treat: input.got_a_treat ?? null,
      })
      .eq('id', appointmentId)
      .eq('status', 'scheduled')
      .select()
      .maybeSingle();
    if (error) throw new ServiceError('appointment_complete_failed', error.message, 500);
    if (!updated) {
      throw new ServiceError('appointment_not_completable', 'This appointment was already completed.', 409);
    }
    const appointment = updated as Appointment;

    // Next walk in the same series — P2-2's auto-message wants to say
    // "see you next Tuesday", so it rides along in the event payload.
    const seriesParentId = appointment.recurrence_parent_id ?? appointment.id;
    const { data: nextRows } = await supabaseAdmin
      .from('appointments')
      .select('starts_at')
      .or(`id.eq.${seriesParentId},recurrence_parent_id.eq.${seriesParentId}`)
      .eq('status', 'scheduled')
      .gt('starts_at', appointment.starts_at)
      .order('starts_at', { ascending: true })
      .limit(1);
    const nextStartsAt = nextRows?.[0]?.starts_at ?? null;

    // Visit- and day-priced billing: the work is done, the invoice exists —
    // no manual step. per_day bills price × days of the stay (a 2-night
    // boarding spanning 44 hours is 2 days). Other cadences (weekly/monthly/
    // package) stay manual until the founder decides their timing (ROADMAP).
    //
    // R-2/R-3: a prepaid visit bills nothing — it draws down the package the
    // client already paid for. This is the whole point: "walks are pre-paid
    // unless otherwise noted", and completing one used to bill them twice.
    let invoice: Invoice | null = null;
    if (prepaidRemaining > 0) {
      // Nothing to do. The drawdown is implicit: this appointment is now
      // `completed`, so the next balance read counts it as used.
    } else if (service.billing_cadence === 'per_visit' || service.billing_cadence === 'per_day') {
      let amountCents = service.price_cents;
      let description = `${service.name} — ${fmtSlot(appointment.starts_at)}`;
      if (service.billing_cadence === 'per_day') {
        const start = Date.parse(appointment.actual_start_at ?? appointment.starts_at);
        const end = Date.parse(appointment.actual_end_at ?? appointment.ends_at);
        const days = Math.max(1, Math.ceil((end - start) / (24 * 60 * 60 * 1000)));
        amountCents = service.price_cents * days;
        description = `${service.name} — ${days} day${days === 1 ? '' : 's'}, from ${fmtSlot(appointment.starts_at)}`;
      }
      invoice = await paymentService.createInvoice(professionalAccountId, {
        client_id: appointment.client_id,
        amount_cents: amountCents,
        description,
        service_id: service.id,
      });
    }

    await eventService.publish({
      actorAccountId: professionalAccountId,
      eventType: 'walk_completed',
      subjectType: 'appointment',
      subjectId: appointment.id,
      metadata: {
        client_id: appointment.client_id,
        service_id: service.id,
        service_name: service.name,
        scheduled_starts_at: appointment.starts_at,
        scheduled_ends_at: appointment.ends_at,
        actual_start_at: appointment.actual_start_at,
        actual_end_at: appointment.actual_end_at,
        completion_notes: appointment.completion_notes,
        good_dog: appointment.good_dog,
        got_a_treat: appointment.got_a_treat,
        next_appointment_starts_at: nextStartsAt,
        invoice_id: invoice?.id ?? null,
        // R-2/R-3: how the walk was paid for, and what's left on the package.
        // P2-2's walk-report message wants to say "3 walks left on your plan".
        prepaid: prepaidRemaining > 0,
        prepaid_remaining: prepaidRemaining > 0 ? prepaidRemaining - 1 : null,
      },
    });

    // A completed walk needs no reminder (covers early completes).
    await notificationService.cancelAppointmentReminders([appointment.id]);

    return {
      appointment,
      invoice,
      prepaid_remaining: prepaidRemaining > 0 ? prepaidRemaining - 1 : null,
    };
  }
}

export const schedulingService = new SchedulingService();
