import { supabaseAdmin } from '../config/supabase';
import { Client, Message, MessageThread } from '../types';
import { ServiceError } from './errors';

export interface SendMessageInput {
  body: string;
  image_url?: string | null;
  /** Device-generated idempotency key — resending the same draft is a no-op. */
  client_draft_id?: string | null;
  is_system?: boolean;
}

export interface DraftSyncItem {
  client_id: string;
  client_draft_id: string;
  body: string;
}

export interface DraftSyncResult {
  client_draft_id: string;
  status: 'created' | 'duplicate' | 'error';
  message?: Message;
  error?: string;
}

export type ThreadWithContext = MessageThread & {
  client: Pick<Client, 'id' | 'full_name' | 'status'>;
  last_message: Message | null;
  unread_count: number;
};

const PG_UNIQUE_VIOLATION = '23505';

/**
 * Messaging — Week 7. One thread per (professional, client), enforced by the
 * schema's UNIQUE constraint. Only the professional side sends for now; the
 * Week 8 owner portal adds the client side onto the same tables (messages
 * already carry sender_account_id, so nothing here needs to change).
 */
export class MessagingService {
  // -------------------------------------------------------------- threads ----

  /** Get the thread for a client, creating it on first contact. Race-safe. */
  async getOrCreateThread(professionalAccountId: string, clientId: string): Promise<MessageThread> {
    // Ownership check — a professional can only open threads with their own clients.
    const { data: client, error: clientError } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .eq('professional_account_id', professionalAccountId)
      .maybeSingle();
    if (clientError) throw new ServiceError('thread_lookup_failed', clientError.message, 500);
    if (!client) throw new ServiceError('client_not_found', 'Client not found.', 404);

    const existing = await this.findThread(professionalAccountId, clientId);
    if (existing) return existing;

    const { data, error } = await supabaseAdmin
      .from('message_threads')
      .insert({ professional_account_id: professionalAccountId, client_id: clientId })
      .select()
      .single();
    if (error) {
      // Concurrent create hit the UNIQUE constraint — the thread now exists.
      if (error.code === PG_UNIQUE_VIOLATION) {
        const raced = await this.findThread(professionalAccountId, clientId);
        if (raced) return raced;
      }
      throw new ServiceError('thread_create_failed', error.message, 500);
    }
    return data as MessageThread;
  }

  private async findThread(
    professionalAccountId: string,
    clientId: string
  ): Promise<MessageThread | null> {
    const { data, error } = await supabaseAdmin
      .from('message_threads')
      .select('*')
      .eq('professional_account_id', professionalAccountId)
      .eq('client_id', clientId)
      .maybeSingle();
    if (error) throw new ServiceError('thread_lookup_failed', error.message, 500);
    return (data as MessageThread) ?? null;
  }

  /** Threads with client name, latest message, and unread count — newest first. */
  async listThreads(professionalAccountId: string): Promise<ThreadWithContext[]> {
    const { data, error } = await supabaseAdmin
      .from('message_threads')
      .select('*, clients!inner(id, full_name, status)')
      .eq('professional_account_id', professionalAccountId)
      .order('last_message_at', { ascending: false, nullsFirst: false });
    if (error) throw new ServiceError('thread_list_failed', error.message, 500);

    const threads = (data ?? []) as (MessageThread & { clients: ThreadWithContext['client'] })[];
    if (threads.length === 0) return [];
    const threadIds = threads.map((t) => t.id);

    // Unread = messages someone else sent that this professional hasn't read.
    const { data: unreadRows, error: unreadError } = await supabaseAdmin
      .from('messages')
      .select('thread_id')
      .in('thread_id', threadIds)
      .is('read_at', null)
      .neq('sender_account_id', professionalAccountId);
    if (unreadError) throw new ServiceError('thread_list_failed', unreadError.message, 500);
    const unreadByThread = new Map<string, number>();
    for (const row of unreadRows ?? []) {
      const id = row.thread_id as string;
      unreadByThread.set(id, (unreadByThread.get(id) ?? 0) + 1);
    }

    // Latest message per thread for the preview line. Thread counts are small
    // in Phase 1, so a per-thread limit-1 query is fine.
    const latest = await Promise.all(
      threadIds.map(async (threadId) => {
        const { data: msg, error: msgError } = await supabaseAdmin
          .from('messages')
          .select('*')
          .eq('thread_id', threadId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (msgError) throw new ServiceError('thread_list_failed', msgError.message, 500);
        return [threadId, (msg as Message) ?? null] as const;
      })
    );
    const latestByThread = new Map(latest);

    return threads.map(({ clients, ...thread }) => ({
      ...thread,
      client: clients,
      last_message: latestByThread.get(thread.id) ?? null,
      unread_count: unreadByThread.get(thread.id) ?? 0,
    }));
  }

  /** Fetch one thread, enforcing ownership. */
  async getThread(professionalAccountId: string, threadId: string): Promise<MessageThread> {
    const { data, error } = await supabaseAdmin
      .from('message_threads')
      .select('*')
      .eq('id', threadId)
      .eq('professional_account_id', professionalAccountId)
      .maybeSingle();
    if (error) throw new ServiceError('thread_lookup_failed', error.message, 500);
    if (!data) throw new ServiceError('thread_not_found', 'Thread not found.', 404);
    return data as MessageThread;
  }

  // ------------------------------------------------------------- messages ----

  /**
   * List messages oldest-first. `after` (ISO timestamp) returns only newer
   * messages — the polling fallback uses it to fetch increments cheaply.
   */
  async listMessages(
    professionalAccountId: string,
    threadId: string,
    options: { after?: string; limit?: number } = {}
  ): Promise<Message[]> {
    await this.getThread(professionalAccountId, threadId); // ownership check
    let builder = supabaseAdmin
      .from('messages')
      .select('*')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
      .limit(options.limit ?? 200);
    if (options.after) builder = builder.gt('created_at', options.after);
    const { data, error } = await builder;
    if (error) throw new ServiceError('message_list_failed', error.message, 500);
    return (data ?? []) as Message[];
  }

  /**
   * Send a message into a thread. Idempotent when client_draft_id is set:
   * the schema's UNIQUE (thread_id, client_draft_id) makes a resend return
   * the already-stored message instead of creating a duplicate.
   */
  async sendMessage(
    senderAccountId: string,
    threadId: string,
    input: SendMessageInput
  ): Promise<{ message: Message; duplicate: boolean }> {
    const thread = await this.getThread(senderAccountId, threadId); // ownership check

    const { data, error } = await supabaseAdmin
      .from('messages')
      .insert({
        thread_id: thread.id,
        sender_account_id: senderAccountId,
        body: input.body,
        image_url: input.image_url ?? null,
        is_system: input.is_system ?? false,
        client_draft_id: input.client_draft_id ?? null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION && input.client_draft_id) {
        const { data: existing, error: lookupError } = await supabaseAdmin
          .from('messages')
          .select('*')
          .eq('thread_id', thread.id)
          .eq('client_draft_id', input.client_draft_id)
          .single();
        if (lookupError) throw new ServiceError('message_lookup_failed', lookupError.message, 500);
        return { message: existing as Message, duplicate: true };
      }
      throw new ServiceError('message_send_failed', error.message, 500);
    }
    const message = data as Message;

    const { error: touchError } = await supabaseAdmin
      .from('message_threads')
      .update({ last_message_at: message.created_at })
      .eq('id', thread.id);
    if (touchError) throw new ServiceError('thread_update_failed', touchError.message, 500);

    return { message, duplicate: false };
  }

  /** Mark everything the other side sent as read. */
  async markThreadRead(professionalAccountId: string, threadId: string): Promise<void> {
    await this.getThread(professionalAccountId, threadId); // ownership check
    const { error } = await supabaseAdmin
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('thread_id', threadId)
      .is('read_at', null)
      .neq('sender_account_id', professionalAccountId);
    if (error) throw new ServiceError('message_read_failed', error.message, 500);
  }

  // ----------------------------------------------------------- draft sync ----

  /**
   * Offline draft sync: a device that queued messages while offline posts
   * them all at once. Each draft is processed independently — one bad draft
   * doesn't block the rest — and client_draft_id makes retries safe.
   */
  async syncDrafts(professionalAccountId: string, drafts: DraftSyncItem[]): Promise<DraftSyncResult[]> {
    const results: DraftSyncResult[] = [];
    for (const draft of drafts) {
      try {
        const thread = await this.getOrCreateThread(professionalAccountId, draft.client_id);
        const { message, duplicate } = await this.sendMessage(professionalAccountId, thread.id, {
          body: draft.body,
          client_draft_id: draft.client_draft_id,
        });
        results.push({
          client_draft_id: draft.client_draft_id,
          status: duplicate ? 'duplicate' : 'created',
          message,
        });
      } catch (err) {
        results.push({
          client_draft_id: draft.client_draft_id,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return results;
  }
}

export const messagingService = new MessagingService();
