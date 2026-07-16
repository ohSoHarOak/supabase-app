import fs from 'fs';
import path from 'path';
import { supabaseAdmin } from '../config/supabase';
import { getESignProvider, IeSignProvider } from '../integrations/esign';
import { Contract, ContractStatus, ContractTemplate, Pet } from '../types';
import { accountService } from './AccountService';
import { clientService } from './ClientService';
import { ServiceError } from './errors';
import { eventService } from './EventService';
import { notificationService } from './NotificationService';

export interface TemplateInput {
  name: string;
  body_html: string;
}

export interface GenerateContractInput {
  template_id: string;
  client_id: string;
  service_id?: string | null;
  /** Manual values for template variables (walk_type, service_price, ...).
   *  Merged over the computed CRM values, so an explicit value always wins. */
  variables?: Record<string, string>;
}

export interface SignInPersonInput {
  signer_name: string;
  /** PNG or JPEG, as a data URL or raw base64. */
  signature_image: string;
}

export interface GeneratedContract {
  contract: Contract;
  /** Placeholders left untouched because no value was available. The three
   *  signing placeholders are never reported — they resolve at signing time. */
  unresolved_placeholders: string[];
}

/** Placeholders that must survive generation for the signing flow to fill. */
const SIGNING_PLACEHOLDERS = ['client_signature_image', 'provider_signature_image', 'signed_date'];

const SEED_TEMPLATE_NAME = 'Dog Walking Service Agreement (California)';
const SEED_TEMPLATE_FILE = path.join(
  process.cwd(),
  'templates',
  'contracts',
  'dog-walking-agreement-ca.html'
);

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

/** Minimal HTML-escape for CRM values interpolated into the template. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
   * Copy the packaged CA dog-walking template into this professional's
   * account. Idempotent: returns the existing copy if one is already there.
   */
  async seedDefaultTemplate(professionalAccountId: string): Promise<ContractTemplate> {
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from('contract_templates')
      .select('*')
      .eq('professional_account_id', professionalAccountId)
      .eq('name', SEED_TEMPLATE_NAME)
      .maybeSingle();
    if (lookupError) throw new ServiceError('template_lookup_failed', lookupError.message, 500);
    if (existing) return existing as ContractTemplate;

    let body: string;
    try {
      body = fs.readFileSync(SEED_TEMPLATE_FILE, 'utf8');
    } catch {
      throw new ServiceError(
        'seed_template_missing',
        `Packaged template not found at ${SEED_TEMPLATE_FILE}.`,
        500
      );
    }
    return this.createTemplate(professionalAccountId, { name: SEED_TEMPLATE_NAME, body_html: body });
  }

  // ---------------------------------------------------------- generation ----

  async generateContract(
    professionalAccountId: string,
    input: GenerateContractInput
  ): Promise<GeneratedContract> {
    const template = await this.getTemplate(professionalAccountId, input.template_id);
    const client = await clientService.getClient(professionalAccountId, input.client_id);
    const profile = await accountService.getProfessionalProfile(professionalAccountId);

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
      pet_list: petList(client.pets) || '—',
      cancellation_window_hours: String(client.cancellation_window_hours ?? 24),
      no_show_fee: client.no_show_fee_cents != null ? formatCents(client.no_show_fee_cents) : 'None',
      emergency_contact: client.emergency_contact_name
        ? [client.emergency_contact_name, client.emergency_contact_phone].filter(Boolean).join(', ')
        : '—',
      preferred_vet: client.pets.find((p) => p.emergency_vet)?.emergency_vet ?? '—',
    };

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

    await eventService.publish({
      actorAccountId: professionalAccountId,
      eventType: 'contract_generated',
      subjectType: 'contract',
      subjectId: contract.id,
      metadata: { template_id: template.id, client_id: client.id },
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
  ): Promise<Contract[]> {
    let builder = supabaseAdmin
      .from('contracts')
      .select('*')
      .eq('professional_account_id', professionalAccountId)
      .order('created_at', { ascending: false });
    if (options.clientId) builder = builder.eq('client_id', options.clientId);
    if (options.status) builder = builder.eq('status', options.status);

    const { data, error } = await builder;
    if (error) throw new ServiceError('contract_list_failed', error.message, 500);
    return (data ?? []) as Contract[];
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

    await eventService.publish({
      actorAccountId: professionalAccountId,
      eventType: 'contract_signed',
      subjectType: 'contract',
      subjectId: contract.id,
      metadata: { signer_name: input.signer_name, signing_method: 'in_person' },
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
