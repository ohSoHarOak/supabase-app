import { supabaseAdmin } from '../config/supabase';
import { DomainEvent, EventType } from '../types';

export interface PublishEventInput {
  actorAccountId: string | null;
  eventType: EventType;
  subjectType?: string;
  subjectId?: string;
  location?: { lat: number; lng: number };
  metadata?: Record<string, unknown>;
  /** Accounts allowed to see this event (privacy boundary). Actor is always included. */
  visibleTo?: string[];
}

/**
 * Append-only event log (Marketplace Seam 2).
 * INSERT only — the database trigger rejects UPDATE/DELETE, and this service
 * intentionally exposes no way to attempt either.
 */
export class EventService {
  async publish(input: PublishEventInput): Promise<DomainEvent> {
    const { data, error } = await supabaseAdmin
      .from('events')
      .insert({
        actor_account_id: input.actorAccountId,
        event_type: input.eventType,
        subject_type: input.subjectType ?? null,
        subject_id: input.subjectId ?? null,
        location: input.location ?? null,
        metadata: input.metadata ?? {},
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to publish event: ${error.message}`);
    const event = data as DomainEvent;

    const audience = new Set(input.visibleTo ?? []);
    if (input.actorAccountId) audience.add(input.actorAccountId);
    if (audience.size > 0) {
      const rows = [...audience].map((accountId) => ({
        event_id: event.id,
        visible_to_account_id: accountId,
      }));
      const { error: audienceError } = await supabaseAdmin.from('event_audience').insert(rows);
      if (audienceError) throw new Error(`Failed to record event audience: ${audienceError.message}`);
    }

    return event;
  }

  /** Privacy boundary: only events the account is in the audience of. */
  async getEventsVisibleTo(accountId: string, limit = 50): Promise<DomainEvent[]> {
    const { data, error } = await supabaseAdmin
      .from('event_audience')
      .select('events(*)')
      .eq('visible_to_account_id', accountId)
      .limit(limit);

    if (error) throw new Error(`Failed to fetch events: ${error.message}`);
    return (data ?? []).flatMap((row: Record<string, unknown>) => {
      const e = row.events;
      return e ? [e as DomainEvent] : [];
    });
  }

  async getEventsByActor(actorAccountId: string, limit = 50): Promise<DomainEvent[]> {
    const { data, error } = await supabaseAdmin
      .from('events')
      .select('*')
      .eq('actor_account_id', actorAccountId)
      .order('occurred_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Failed to fetch events: ${error.message}`);
    return (data ?? []) as DomainEvent[];
  }
}

export const eventService = new EventService();
