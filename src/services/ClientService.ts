import { supabaseAdmin } from '../config/supabase';
import { Client, ClientStatus, Pet, VaccinationRecord } from '../types';
import { ServiceError } from './errors';
import { eventService } from './EventService';

export interface ClientInput {
  full_name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  cancellation_window_hours?: number | null;
  no_show_fee_cents?: number | null;
  entry_instructions?: string | null;
  general_notes?: string | null;
  status?: ClientStatus;
}

export interface PetInput {
  name: string;
  photo_url?: string | null;
  species?: string;
  breed?: string | null;
  date_of_birth?: string | null;
  weight_lb?: number | null;
  color?: string | null;
  microchip_number?: string | null;
  medical_conditions?: string | null;
  behavior_notes?: string | null;
  feeding_notes?: string | null;
  /** @deprecated superseded by emergency_vet_name + emergency_vet_phone (022);
   *  still accepted so older callers and the e2e suite don't break. */
  emergency_vet?: string | null;
  emergency_vet_name?: string | null;
  emergency_vet_phone?: string | null;
}

export interface VaccinationInput {
  vaccine_name: string;
  administered_on?: string | null;
  expires_on?: string | null;
  document_url?: string | null;
}

export type ClientWithPets = Client & { pets: Pet[] };

/** Escape %/_ so user input can't act as wildcards in ilike patterns. */
function likePattern(term: string): string {
  return `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
}

/**
 * CRM: clients + pets + vaccination records.
 * Every operation is scoped to the calling professional's account id —
 * a professional can never read or touch another professional's clients.
 */
export class ClientService {
  // ------------------------------------------------------------ clients ----

  async createClient(professionalAccountId: string, input: ClientInput): Promise<Client> {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .insert({ ...input, professional_account_id: professionalAccountId })
      .select()
      .single();
    if (error) throw new ServiceError('client_create_failed', error.message, 500);

    await eventService.publish({
      actorAccountId: professionalAccountId,
      eventType: 'client_created',
      subjectType: 'client',
      subjectId: (data as Client).id,
      metadata: { full_name: input.full_name },
    });

    return data as Client;
  }

  /**
   * List/search. `query` matches client name, email, phone, address — and
   * also pet name/breed (a hit on a pet surfaces its client).
   */
  async listClients(
    professionalAccountId: string,
    options: { query?: string; status?: ClientStatus } = {}
  ): Promise<ClientWithPets[]> {
    let matchedClientIds: string[] | null = null;

    if (options.query?.trim()) {
      const pattern = likePattern(options.query.trim());

      // Pets whose name/breed match — via inner join so the scope filter
      // on the owning professional applies.
      const { data: petHits, error: petError } = await supabaseAdmin
        .from('pets')
        .select('client_id, clients!inner(professional_account_id)')
        .eq('clients.professional_account_id', professionalAccountId)
        .or(`name.ilike.${pattern},breed.ilike.${pattern}`);
      if (petError) throw new ServiceError('search_failed', petError.message, 500);

      // Clients whose own fields match.
      const { data: clientHits, error: clientError } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('professional_account_id', professionalAccountId)
        .or(
          `full_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern},address.ilike.${pattern}`
        );
      if (clientError) throw new ServiceError('search_failed', clientError.message, 500);

      matchedClientIds = [
        ...new Set([
          ...(petHits ?? []).map((p) => p.client_id as string),
          ...(clientHits ?? []).map((c) => c.id as string),
        ]),
      ];
      if (matchedClientIds.length === 0) return [];
    }

    let builder = supabaseAdmin
      .from('clients')
      .select('*, pets(*)')
      .eq('professional_account_id', professionalAccountId)
      .order('full_name');
    if (options.status) builder = builder.eq('status', options.status);
    if (matchedClientIds) builder = builder.in('id', matchedClientIds);

    const { data, error } = await builder;
    if (error) throw new ServiceError('client_list_failed', error.message, 500);
    return (data ?? []) as ClientWithPets[];
  }

  /** Fetch one client (with pets), enforcing ownership. 404 if not yours. */
  async getClient(professionalAccountId: string, clientId: string): Promise<ClientWithPets> {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('*, pets(*)')
      .eq('id', clientId)
      .eq('professional_account_id', professionalAccountId)
      .maybeSingle();
    if (error) throw new ServiceError('client_lookup_failed', error.message, 500);
    if (!data) throw new ServiceError('client_not_found', 'Client not found.', 404);
    return data as ClientWithPets;
  }

  async updateClient(
    professionalAccountId: string,
    clientId: string,
    input: Partial<ClientInput>
  ): Promise<Client> {
    await this.getClient(professionalAccountId, clientId); // ownership check
    const { data, error } = await supabaseAdmin
      .from('clients')
      .update(input)
      .eq('id', clientId)
      .select()
      .single();
    if (error) throw new ServiceError('client_update_failed', error.message, 500);
    return data as Client;
  }

  async deleteClient(professionalAccountId: string, clientId: string): Promise<void> {
    await this.getClient(professionalAccountId, clientId); // ownership check
    const { error } = await supabaseAdmin.from('clients').delete().eq('id', clientId);
    if (error) throw new ServiceError('client_delete_failed', error.message, 500);
  }

  // --------------------------------------------------------------- pets ----

  async addPet(professionalAccountId: string, clientId: string, input: PetInput): Promise<Pet> {
    await this.getClient(professionalAccountId, clientId); // ownership check
    const { data, error } = await supabaseAdmin
      .from('pets')
      .insert({ ...input, client_id: clientId })
      .select()
      .single();
    if (error) throw new ServiceError('pet_create_failed', error.message, 500);
    return data as Pet;
  }

  /** Fetch one pet, enforcing that its client belongs to the professional. */
  async getPet(professionalAccountId: string, petId: string): Promise<Pet> {
    const { data, error } = await supabaseAdmin
      .from('pets')
      .select('*, clients!inner(professional_account_id)')
      .eq('id', petId)
      .eq('clients.professional_account_id', professionalAccountId)
      .maybeSingle();
    if (error) throw new ServiceError('pet_lookup_failed', error.message, 500);
    if (!data) throw new ServiceError('pet_not_found', 'Pet not found.', 404);
    const { clients: _ignored, ...pet } = data as Pet & { clients: unknown };
    return pet as Pet;
  }

  async updatePet(professionalAccountId: string, petId: string, input: Partial<PetInput>): Promise<Pet> {
    await this.getPet(professionalAccountId, petId); // ownership check
    const { data, error } = await supabaseAdmin
      .from('pets')
      .update(input)
      .eq('id', petId)
      .select()
      .single();
    if (error) throw new ServiceError('pet_update_failed', error.message, 500);
    return data as Pet;
  }

  async deletePet(professionalAccountId: string, petId: string): Promise<void> {
    await this.getPet(professionalAccountId, petId); // ownership check
    const { error } = await supabaseAdmin.from('pets').delete().eq('id', petId);
    if (error) throw new ServiceError('pet_delete_failed', error.message, 500);
  }

  // ------------------------------------------------------- vaccinations ----

  async addVaccination(
    professionalAccountId: string,
    petId: string,
    input: VaccinationInput
  ): Promise<VaccinationRecord> {
    await this.getPet(professionalAccountId, petId); // ownership check
    const { data, error } = await supabaseAdmin
      .from('vaccination_records')
      .insert({ ...input, pet_id: petId })
      .select()
      .single();
    if (error) throw new ServiceError('vaccination_create_failed', error.message, 500);
    return data as VaccinationRecord;
  }

  async listVaccinations(professionalAccountId: string, petId: string): Promise<VaccinationRecord[]> {
    await this.getPet(professionalAccountId, petId); // ownership check
    const { data, error } = await supabaseAdmin
      .from('vaccination_records')
      .select('*')
      .eq('pet_id', petId)
      .order('expires_on', { ascending: true, nullsFirst: false });
    if (error) throw new ServiceError('vaccination_list_failed', error.message, 500);
    return (data ?? []) as VaccinationRecord[];
  }

  async deleteVaccination(professionalAccountId: string, petId: string, vaccinationId: string): Promise<void> {
    await this.getPet(professionalAccountId, petId); // ownership check
    const { error, count } = await supabaseAdmin
      .from('vaccination_records')
      .delete({ count: 'exact' })
      .eq('id', vaccinationId)
      .eq('pet_id', petId);
    if (error) throw new ServiceError('vaccination_delete_failed', error.message, 500);
    if (count === 0) throw new ServiceError('vaccination_not_found', 'Vaccination record not found.', 404);
  }
}

export const clientService = new ClientService();
