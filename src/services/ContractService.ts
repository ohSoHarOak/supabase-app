import fs from 'fs';
import path from 'path';
import { supabaseAdmin } from '../config/supabase';
import { getESignProvider, IeSignProvider } from '../integrations/esign';
import {
  BillingCadence,
  BILLING_CADENCE_LABELS,
  Contract,
  ContractStatus,
  ContractTemplate,
  Pet,
  SERVICE_TYPE_LABELS,
  ServiceType,
} from '../types';
import { accountService } from './AccountService';
import { clientService } from './ClientService';
import { ServiceError } from './errors';
import { eventService } from './EventService';
import { notificationService } from './NotificationService';
import { buildServiceName, schedulingService } from './SchedulingService';

export interface TemplateInput {
  name: string;
  body_html: string;
}

/** One service block on the contract form (W-5/W-6). Mirrors ServiceInput,
 *  minus the fields the contract supplies itself (client, contract, status)
 *  and minus `name`, which is derived from service_type + pets. */
export interface ContractServiceInput {
  service_type: ServiceType;
  price_cents: number;
  billing_cadence: BillingCadence;
  session_count?: number | null;
  duration_minutes?: number | null;
  /** Surfaced as "Notes" on the form; stored in services.description. */
  description?: string | null;
  /** Pets this service covers. One walk over two dogs = one service (W-6). */
  pet_ids: string[];
}

export interface GenerateContractInput {
  template_id: string;
  client_id: string;
  service_id?: string | null;
  /** The services this contract sells (W-5/W-6). Created as drafts and only
   *  activated when the client signs (W-7). */
  services?: ContractServiceInput[];
  /** Manual values for template variables (walk_type, service_price, ...).
   *  Merged over the computed CRM values, so an explicit value always wins. */
  variables?: Record<string, string>;
}

export interface SignInPersonInput {
  signer_name: string;
  /** PNG or JPEG, as a data URL or raw base64. */
  signature_image: string;
}

/** Contract joined with the name of the template it was generated from,
 *  mirroring SchedulingService's AppointmentWithDetails pattern. */
export type ContractWithTemplate = Contract & {
  contract_templates: { name: string } | null;
};

export interface GeneratedContract {
  contract: Contract;
  /** Placeholders left untouched because no value was available. The three
   *  signing placeholders are never reported — they resolve at signing time. */
  unresolved_placeholders: string[];
}

/** Placeholders that must survive generation for the signing flow to fill. */
const SIGNING_PLACEHOLDERS = ['client_signature_image', 'provider_signature_image', 'signed_date'];

/** Packaged templates copied into each professional's account by /seed.
 *  First entry is the default (and what the seed endpoint returns, so
 *  existing callers keep their shape). Founder decision 2026-07-17: the
 *  Pet Services Agreement is the only seeded template — the CA agreement
 *  file is retained unseeded for history (accounts that copied it keep
 *  their copy, and signed contracts are immutable snapshots regardless). */
const SEED_TEMPLATES = [
  { name: 'Pet Services Agreement', file: 'pet-services-agreement.html' },
];
const seedTemplatePath = (file: string) =>
  path.join(process.cwd(), 'templates', 'contracts', file);

const SIGNATURE_BUCKET = 'contracts';
const MAX_SIGNATURE_BYTES = 500 * 1024;

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function petList(pets: Pet[]): string {
  return pets.map((p) => (p.breed ? `${p.name} (${p.breed})` : p.name)).join(', ');
}

/** Every pet across a contract's services, de-duplicated — Biscuit on both a
 *  walk and a training package is still one dog on the agreement (W-6). */
function unionPets(services: ResolvedService[]): Pet[] {
  const byId = new Map<string, Pet>();
  for (const service of services) {
    for (const pet of service.pets) byId.set(pet.id, pet);
  }
  return [...byId.values()];
}

/** Minimal HTML-escape for CRM values interpolated into the template. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A service block plus the resolved pets it covers, ready to render. */
interface ResolvedService {
  input: ContractServiceInput;
  pets: Pet[];
  name: string;
}

/** "$30.00 per visit", "$400.00 per package (10 sessions)", "$30.00 per visit (30 min)" */
function serviceTerms(input: ContractServiceInput): string {
  let terms = `${formatCents(input.price_cents)} ${BILLING_CADENCE_LABELS[input.billing_cadence]}`;
  const qualifiers: string[] = [];
  if (input.session_count) qualifiers.push(`${input.session_count} sessions`);
  if (input.duration_minutes) qualifiers.push(`${input.duration_minutes} min`);
  if (qualifiers.length) terms += ` (${qualifiers.join(', ')})`;
  return terms;
}

/**
 * The W-9 services table.
 *
 * This is the ONE place markup is generated rather than escaped, so it needs
 * saying plainly: the tags below are ours — a fixed shape this function
 * controls — while every value that comes from the walker or the client still
 * goes through escapeHtml on its way into a cell. That keeps the property the
 * rest of generation relies on (template markup trusted, interpolated data
 * never) rather than punching a hole in it for convenience.
 *
 * Styling stays inline because the signed HTML is a standalone immutable
 * snapshot — it has to render years later with no stylesheet to reach for.
 */
function servicesTableHtml(services: ResolvedService[]): string {
  const rows = services
    .map((s) => {
      const pets = s.pets.map((p) => p.name).join(', ') || '—';
      const notes = s.input.description?.trim();
      return `<tr>
      <td style="padding:6px 10px;border:1px solid #999;vertical-align:top">${escapeHtml(s.name)}</td>
      <td style="padding:6px 10px;border:1px solid #999;vertical-align:top">${escapeHtml(pets)}</td>
      <td style="padding:6px 10px;border:1px solid #999;vertical-align:top">${escapeHtml(serviceTerms(s.input))}</td>
      <td style="padding:6px 10px;border:1px solid #999;vertical-align:top">${notes ? escapeHtml(notes) : '—'}</td>
    </tr>`;
    })
    .join('\n');

  return `<table style="border-collapse:collapse;width:100%;margin:8px 0">
  <thead><tr>
    <th style="padding:6px 10px;border:1px solid #999;text-align:left">Service</th>
    <th style="padding:6px 10px;border:1px solid #999;text-align:left">Pet(s)</th>
    <th style="padding:6px 10px;border:1px solid #999;text-align:left">Fee</th>
    <th style="padding:6px 10px;border:1px solid #999;text-align:left">Notes</th>
  </tr></thead>
  <tbody>
${rows}
  </tbody>
</table>`;
}

/** Decode a data URL or raw base64 image; validate type and size by magic bytes. */
function decodeSignatureImage(input: string): { buffer: Buffer; contentType: string; extension: string } {
  const dataUrlMatch = input.match(/^data:(image\/(?:png|jpeg));base64,(.+)$/s);
  const base64 = dataUrlMatch ? dataUrlMatch[2] : input;

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64.replace(/\s/g, ''), 'base64');
  } catch {
    throw new ServiceError('invalid_signature', 'Signature image is not valid base64.', 422);
  }

  const isPng = buffer.length > 8 && buffer.readUInt32BE(0) === 0x89504e47;
  const isJpeg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (!isPng && !isJpeg) {
    throw new ServiceError('invalid_signature', 'Signature image must be a PNG or JPEG.', 422);
  }
  if (buffer.length > MAX_SIGNATURE_BYTES) {
    throw new ServiceError('invalid_signature', 'Signature image is too large (max 500 KB).', 422);
  }

  return isPng
    ? { buffer, contentType: 'image/png', extension: 'png' }
    : { buffer, contentType: 'image/jpeg', extension: 'jpg' };
}

/**
 * Contract lifecycle — Week 3: templates, generation, in-person signing.
 *
 * HARD CONSTRAINTS:
 * - Electronic signing goes through IeSignProvider only (never a vendor API
 *   directly). It is deferred to Phase 1.5.
 * - Once status = 'signed', generated_html never changes; the database
 *   trigger in 005_create_contracts.sql enforces it, and this service
 *   performs the sign transition in a single UPDATE so the snapshot is
 *   complete at the moment it locks.
 */
export class ContractService {
  private esign: IeSignProvider = getESignProvider();

  // ---------------------------------------------------------- templates ----

  async createTemplate(professionalAccountId: string, input: TemplateInput): Promise<ContractTemplate> {
    const { data, error } = await supabaseAdmin
      .from('contract_templates')
      .insert({ ...input, professional_account_id: professionalAccountId })
      .select()
      .single();
    if (error) throw new ServiceError('template_create_failed', error.message, 500);
    return data as ContractTemplate;
  }

  async listTemplates(professionalAccountId: string): Promise<ContractTemplate[]> {
    const { data, error } = await supabaseAdmin
      .from('contract_templates')
      .select('*')
      .eq('professional_account_id', professionalAccountId)
      .order('name');
    if (error) throw new ServiceError('template_list_failed', error.message, 500);
    return (data ?? []) as ContractTemplate[];
  }

  async getTemplate(professionalAccountId: string, templateId: string): Promise<ContractTemplate> {
    const { data, error } = await supabaseAdmin
      .from('contract_templates')
      .select('*')
      .eq('id', templateId)
      .eq('professional_account_id', professionalAccountId)
      .maybeSingle();
    if (error) throw new ServiceError('template_lookup_failed', error.message, 500);
    if (!data) throw new ServiceError('template_not_found', 'Template not found.', 404);
    return data as ContractTemplate;
  }

  async updateTemplate(
    professionalAccountId: string,
    templateId: string,
    input: Partial<TemplateInput>
  ): Promise<ContractTemplate> {
    await this.getTemplate(professionalAccountId, templateId); // ownership check
    const { data, error } = await supabaseAdmin
      .from('contract_templates')
      .update(input)
      .eq('id', templateId)
      .select()
      .single();
    if (error) throw new ServiceError('template_update_failed', error.message, 500);
    return data as ContractTemplate;
  }

  async deleteTemplate(professionalAccountId: string, templateId: string): Promise<void> {
    await this.getTemplate(professionalAccountId, templateId); // ownership check
    const { error } = await supabaseAdmin.from('contract_templates').delete().eq('id', templateId);
    if (error) throw new ServiceError('template_delete_failed', error.message, 500);
  }

  /**
   * Copy every packaged template into this professional's account.
   * Idempotent per template (matched by name), so accounts that predate a
   * newly packaged template pick it up on their next seed call. Returns the
   * default (first packaged) template — the shape existing callers expect.
   */
  async seedDefaultTemplate(professionalAccountId: string): Promise<ContractTemplate> {
    let defaultTemplate: ContractTemplate | null = null;
    for (const seed of SEED_TEMPLATES) {
      const { data: existing, error: lookupError } = await supabaseAdmin
        .from('contract_templates')
        .select('*')
        .eq('professional_account_id', professionalAccountId)
        .eq('name', seed.name)
        .maybeSingle();
      if (lookupError) throw new ServiceError('template_lookup_failed', lookupError.message, 500);

      let template = existing as ContractTemplate | null;
      if (!template) {
        let body: string;
        try {
          body = fs.readFileSync(seedTemplatePath(seed.file), 'utf8');
        } catch {
          throw new ServiceError(
            'seed_template_missing',
            `Packaged template not found at ${seedTemplatePath(seed.file)}.`,
            500
          );
        }
        template = await this.createTemplate(professionalAccountId, {
          name: seed.name,
          body_html: body,
        });
      }
      defaultTemplate ??= template;
    }
    return defaultTemplate!;
  }

  // ---------------------------------------------------------- generation ----

  /**
   * Resolve each service block's pets against the client's own, and derive the
   * name. Rejects an empty pet selection: W-5 puts Pet first on the form
   * precisely because "which dog is this for" is the question the old flow
   * never asked, and a service covering nobody can't be scheduled or invoiced
   * against anything.
   */
  private resolveServices(clientPets: Pet[], inputs: ContractServiceInput[]): ResolvedService[] {
    const byId = new Map(clientPets.map((p) => [p.id, p]));
    return inputs.map((input) => {
      if (!input.pet_ids?.length) {
        throw new ServiceError('service_needs_pet', 'Choose which pet each service is for.', 422);
      }
      const pets = input.pet_ids.map((id) => {
        const pet = byId.get(id);
        if (!pet) {
          throw new ServiceError('pet_not_on_client', 'That pet is not on this client.', 422);
        }
        return pet;
      });
      return { input, pets, name: buildServiceName(input.service_type, pets.map((p) => p.name)) };
    });
  }

  async generateContract(
    professionalAccountId: string,
    input: GenerateContractInput
  ): Promise<GeneratedContract> {
    const template = await this.getTemplate(professionalAccountId, input.template_id);
    const client = await clientService.getClient(professionalAccountId, input.client_id);
    const profile = await accountService.getProfessionalProfile(professionalAccountId);
    const services = this.resolveServices(client.pets, input.services ?? []);
    const supportsServicesTable = /\{\{\s*services_table\s*\}\}/i.test(template.body_html);

    // W-6 + W-9 interlock. A contract carrying two services can only say so
    // in a template that has the services table; the pre-W-9 template has
    // fixed single-service Key Terms rows, so rendering two services into it
    // would produce a document that silently describes one of them and binds
    // the client to both. Refuse instead — a wrong contract is worse than a
    // blocked one, and this is the exact drift W-5…W-7 exist to remove.
    if (services.length > 1 && !supportsServicesTable) {
      throw new ServiceError(
        'template_single_service_only',
        'This contract template can only describe one service. Generate with the Pet Services Agreement template to put multiple services on one contract.',
        422
      );
    }

    // Values computed from CRM data. Every value is HTML-escaped; template
    // markup is trusted (the professional owns it), interpolated data is not.
    const computed: Record<string, string> = {
      effective_date: formatDate(new Date()),
      provider_business_name: profile?.business_name ?? profile?.full_name ?? '',
      provider_name: profile?.full_name ?? '',
      client_name: client.full_name,
      client_address: client.address ?? '—',
      client_phone: client.phone ?? '—',
      client_email: client.email ?? '—',
      // W-6: a contract covers the pets its services cover, not every pet on
      // the client. With no services (pre-W-5 callers, tests) the old
      // every-pet behaviour still applies — otherwise their contracts would
      // silently start covering no pets at all.
      pet_list: (services.length ? petList(unionPets(services)) : petList(client.pets)) || '—',
      cancellation_window_hours: String(client.cancellation_window_hours ?? 24),
      no_show_fee: client.no_show_fee_cents != null ? formatCents(client.no_show_fee_cents) : 'None',
      emergency_contact: client.emergency_contact_name
        ? [client.emergency_contact_name, client.emergency_contact_phone].filter(Boolean).join(', ')
        : '—',
      preferred_vet: client.pets.find((p) => p.emergency_vet)?.emergency_vet ?? '—',
    };

    // Pre-W-9 templates describe the single service through fixed Key Terms
    // rows. Derive those from the structured service rather than asking the
    // walker to retype what they just entered — W-5 took those free-text
    // fields off the form. When W-9's services table lands these become dead
    // and the template stops asking for them.
    const single = services.length === 1 ? services[0] : null;
    if (single) {
      computed.walk_type = SERVICE_TYPE_LABELS[single.input.service_type] ?? 'Service';
      computed.service_price = serviceTerms(single.input);
    }

    // Manual variables win over computed ones — but never the signing
    // placeholders, which must survive until the signing flow fills them.
    const variables: Record<string, string> = { ...computed };
    for (const [key, value] of Object.entries(input.variables ?? {})) {
      if (!SIGNING_PLACEHOLDERS.includes(key)) variables[key] = value;
    }

    const unresolved = new Set<string>();
    const generatedHtml = template.body_html.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (match, name: string) => {
      const key = name.toLowerCase();
      if (SIGNING_PLACEHOLDERS.includes(key)) return match; // left for signing
      // The only trusted-markup variable: markup is ours, cells are escaped.
      // See servicesTableHtml.
      if (key === 'services_table') return servicesTableHtml(services);
      if (key in variables) return escapeHtml(variables[key]);
      unresolved.add(key);
      return match;
    });

    const { data, error } = await supabaseAdmin
      .from('contracts')
      .insert({
        professional_account_id: professionalAccountId,
        client_id: client.id,
        service_id: input.service_id ?? null,
        template_id: template.id,
        generated_html: generatedHtml,
        status: 'draft',
      })
      .select()
      .single();
    if (error) throw new ServiceError('contract_create_failed', error.message, 500);
    const contract = data as Contract;

    // W-7: the services exist from generation, but as drafts — they don't
    // reach the client profile or the scheduler until the client signs. The
    // contract row has to exist first to link them to it.
    for (const service of services) {
      await schedulingService.createService(professionalAccountId, {
        client_id: client.id,
        contract_id: contract.id,
        service_type: service.input.service_type,
        price_cents: service.input.price_cents,
        billing_cadence: service.input.billing_cadence,
        session_count: service.input.session_count ?? null,
        duration_minutes: service.input.duration_minutes ?? null,
        description: service.input.description ?? null,
        pet_ids: service.pets.map((p) => p.id),
        status: 'draft',
      });
    }

    await eventService.publish({
      actorAccountId: professionalAccountId,
      eventType: 'contract_generated',
      subjectType: 'contract',
      subjectId: contract.id,
      metadata: { template_id: template.id, client_id: client.id, service_count: services.length },
    });

    // "Contract ready" email to the client (Week 7). enqueue never throws,
    // so a notification problem can never fail contract generation.
    await notificationService.enqueue({
      accountId: professionalAccountId,
      category: 'contract',
      template: 'contract_ready',
      data: { contract_id: contract.id },
    });

    return { contract, unresolved_placeholders: [...unresolved] };
  }

  // ------------------------------------------------------------- reading ----

  async listContracts(
    professionalAccountId: string,
    options: { clientId?: string; status?: ContractStatus } = {}
  ): Promise<ContractWithTemplate[]> {
    // Template name rides along so the UI can title each row — with two
    // packaged agreements, "Dog Walking Service Agreement" can't be assumed.
    let builder = supabaseAdmin
      .from('contracts')
      .select('*, contract_templates(name)')
      .eq('professional_account_id', professionalAccountId)
      .order('created_at', { ascending: false });
    if (options.clientId) builder = builder.eq('client_id', options.clientId);
    if (options.status) builder = builder.eq('status', options.status);

    const { data, error } = await builder;
    if (error) throw new ServiceError('contract_list_failed', error.message, 500);
    return (data ?? []) as unknown as ContractWithTemplate[];
  }

  async getContract(professionalAccountId: string, contractId: string): Promise<Contract> {
    const { data, error } = await supabaseAdmin
      .from('contracts')
      .select('*')
      .eq('id', contractId)
      .eq('professional_account_id', professionalAccountId)
      .maybeSingle();
    if (error) throw new ServiceError('contract_lookup_failed', error.message, 500);
    if (!data) throw new ServiceError('contract_not_found', 'Contract not found.', 404);
    return data as Contract;
  }

  // ------------------------------------------------------------- editing ----

  /**
   * Draft-stage edits (tweak the generated HTML, move draft -> sent, void).
   * Signing is NOT allowed here — only signInPerson() can set status='signed'.
   * On a signed contract the database trigger rejects the update; we surface
   * that as 409 so the API proves the immutability constraint end-to-end.
   */
  async updateContract(
    professionalAccountId: string,
    contractId: string,
    input: { generated_html?: string; status?: Exclude<ContractStatus, 'signed'> }
  ): Promise<Contract> {
    await this.getContract(professionalAccountId, contractId); // ownership check

    const { data, error } = await supabaseAdmin
      .from('contracts')
      .update(input)
      .eq('id', contractId)
      .select()
      .single();
    if (error) {
      if (/immutable|can only transition/i.test(error.message)) {
        throw new ServiceError('contract_locked', 'Signed contracts are immutable.', 409);
      }
      throw new ServiceError('contract_update_failed', error.message, 500);
    }
    return data as Contract;
  }

  // ------------------------------------------------------------- signing ----

  /**
   * In-person signing: the client signs on the professional's device.
   * The drawn signature is stored in Supabase Storage as evidence, embedded
   * into the HTML as a self-contained data URI (no expiring links inside an
   * immutable document), and the contract locks in a single UPDATE.
   */
  async signInPerson(
    professionalAccountId: string,
    contractId: string,
    input: SignInPersonInput
  ): Promise<Contract> {
    const contract = await this.getContract(professionalAccountId, contractId);
    if (contract.status === 'signed') {
      throw new ServiceError('already_signed', 'This contract is already signed.', 409);
    }
    if (contract.status !== 'draft' && contract.status !== 'sent') {
      throw new ServiceError(
        'not_signable',
        `A ${contract.status} contract cannot be signed.`,
        409
      );
    }

    const image = decodeSignatureImage(input.signature_image);
    const profile = await accountService.getProfessionalProfile(professionalAccountId);
    const signedAt = new Date();

    // Evidence copy in private storage (bucket is created on first use).
    const storagePath = `signatures/${contractId}.${image.extension}`;
    await this.ensureSignatureBucket();
    const { error: uploadError } = await supabaseAdmin.storage
      .from(SIGNATURE_BUCKET)
      .upload(storagePath, image.buffer, { contentType: image.contentType, upsert: true });
    if (uploadError) {
      throw new ServiceError('signature_upload_failed', uploadError.message, 500);
    }

    const signatureImg = `<img alt="Client signature" style="max-height:80px" src="data:${image.contentType};base64,${image.buffer.toString('base64')}" />`;
    const finalHtml = contract.generated_html
      .replace(/\{\{\s*client_signature_image\s*\}\}/gi, signatureImg)
      .replace(
        /\{\{\s*provider_signature_image\s*\}\}/gi,
        `<span style="font-style:italic">${escapeHtml(profile?.full_name ?? '')}</span>`
      )
      .replace(/\{\{\s*signed_date\s*\}\}/gi, formatDate(signedAt));

    // Single UPDATE: snapshot + signature evidence + lock, all at once.
    const { data, error } = await supabaseAdmin
      .from('contracts')
      .update({
        generated_html: finalHtml,
        status: 'signed',
        signing_method: 'in_person',
        signer_name: input.signer_name,
        signature_image_url: `${SIGNATURE_BUCKET}/${storagePath}`,
        signed_at: signedAt.toISOString(),
      })
      .eq('id', contractId)
      // Guard against a concurrent sign: only transition from a signable state.
      .in('status', ['draft', 'sent'])
      .select()
      .maybeSingle();
    if (error) throw new ServiceError('contract_sign_failed', error.message, 500);
    if (!data) throw new ServiceError('already_signed', 'This contract was just signed elsewhere.', 409);
    const signed = data as Contract;

    // W-7: services are born on signing. This runs after the status UPDATE
    // won its race above, so exactly one signer activates them — and if it
    // throws, the contract is already validly signed, which is the safer half
    // to keep. A service that failed to activate is recoverable; a signature
    // rolled back because a service insert failed is not.
    const activated = await schedulingService.activateServicesForContract(
      professionalAccountId,
      contract.id
    );

    await eventService.publish({
      actorAccountId: professionalAccountId,
      eventType: 'contract_signed',
      subjectType: 'contract',
      subjectId: contract.id,
      metadata: {
        signer_name: input.signer_name,
        signing_method: 'in_person',
        services_activated: activated.length,
      },
    });

    // Founder requirement: the signed-contract email goes to the client WITH
    // their copy of the agreement attached (rendered at send time).
    await notificationService.enqueue({
      accountId: professionalAccountId,
      category: 'contract',
      template: 'contract_signed',
      data: { contract_id: contract.id },
    });

    return signed;
  }

  private bucketReady = false;

  private async ensureSignatureBucket(): Promise<void> {
    if (this.bucketReady) return;
    const { error } = await supabaseAdmin.storage.createBucket(SIGNATURE_BUCKET, { public: false });
    // "already exists" is the normal case after first run.
    if (error && !/already exists/i.test(error.message)) {
      throw new ServiceError('storage_bucket_failed', error.message, 500);
    }
    this.bucketReady = true;
  }

  // Phase 1.5: initiateElectronicSigning(contractId) via this.esign.
}

export const contractService = new ContractService();
