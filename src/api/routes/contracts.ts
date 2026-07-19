import { Router } from 'express';
import { z } from 'zod';
import { accountService } from '../../services/AccountService';
import { contractService } from '../../services/ContractService';
import { renderContractDocument } from '../../services/contractDocument';
import { requireAuth, requireAccountType } from '../middleware/auth';
import {
  billingCadenceEnum,
  durationMinutes,
  priceCents,
  serviceNotes,
  serviceTypeEnum,
  sessionCount,
} from '../validation';

// ----------------------------------------------------------- validation ----

const templateSchema = z.object({
  name: z.string().trim().min(1, 'Template name is required.'),
  body_html: z.string().min(1, 'Template body is required.'),
});

// A service block on the contract form (W-5/W-6). No `name` — it's derived
// from service_type + pets. At least one pet: "which dog is this for" is the
// question the old ad-hoc flow never asked.
const contractServiceSchema = z.object({
  service_type: serviceTypeEnum,
  price_cents: priceCents,
  billing_cadence: billingCadenceEnum,
  session_count: sessionCount,
  duration_minutes: durationMinutes,
  description: serviceNotes,
  pet_ids: z.array(z.string().uuid()).min(1, 'Choose which pet each service is for.').max(20),
});

const generateSchema = z.object({
  template_id: z.string().uuid('template_id must be a UUID.'),
  client_id: z.string().uuid('client_id must be a UUID.'),
  // `service_id` deliberately absent: the pre-W-6 single-service link is
  // superseded by `services` below (one contract, many services). See the
  // note in ContractService.generateContract.
  services: z.array(contractServiceSchema).max(20).optional(),
  variables: z.record(z.string(), z.string()).optional(),
  // R-10/R-11: the term, and how far ahead to warn about its end.
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'end_date must be YYYY-MM-DD.').nullish(),
  renewal_notice_days: z.number().int().min(0).max(365).nullish(),
});

// Draft-stage edits only; 'signed' is deliberately absent — signing goes
// through POST /:id/sign so a contract can never be marked signed without
// a captured signature.
const updateContractSchema = z.object({
  generated_html: z.string().min(1).optional(),
  status: z.enum(['draft', 'sent', 'declined', 'voided']).optional(),
  // R-10: the term is a fact ABOUT the agreement, not part of its text, so
  // it stays adjustable after signing — pushing an end date back must not
  // require re-signing, and it never touches the immutable generated_html.
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'end_date must be YYYY-MM-DD.').nullish(),
  renewal_notice_days: z.number().int().min(0).max(365).nullish(),
});

const signSchema = z.object({
  signer_name: z.string().trim().min(1, 'Signer name is required.'),
  signature_image: z.string().min(50, 'signature_image must be a base64 PNG or JPEG.'),
});

function validationError(res: import('express').Response, issues: z.ZodIssue[]): void {
  res.status(422).json({
    ok: false,
    error: { code: 'validation', message: issues.map((i) => i.message).join(' ') },
  });
}

// ------------------------------------------------------------ templates ----

export const contractTemplatesRouter = Router();
contractTemplatesRouter.use(requireAuth, requireAccountType('professional'));

/** GET /api/contract-templates */
contractTemplatesRouter.get('/', async (req, res, next) => {
  try {
    const templates = await contractService.listTemplates(req.account!.id);
    res.json({ ok: true, data: templates });
  } catch (err) {
    next(err);
  }
});

/** POST /api/contract-templates */
contractTemplatesRouter.post('/', async (req, res, next) => {
  try {
    const parsed = templateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    const template = await contractService.createTemplate(req.account!.id, parsed.data);
    res.status(201).json({ ok: true, data: template });
  } catch (err) {
    next(err);
  }
});

/** POST /api/contract-templates/seed — copy the packaged CA dog-walking template. Idempotent. */
contractTemplatesRouter.post('/seed', async (req, res, next) => {
  try {
    const template = await contractService.seedDefaultTemplate(req.account!.id);
    res.status(201).json({ ok: true, data: template });
  } catch (err) {
    next(err);
  }
});

/** GET /api/contract-templates/:id */
contractTemplatesRouter.get('/:id', async (req, res, next) => {
  try {
    const template = await contractService.getTemplate(req.account!.id, req.params.id);
    res.json({ ok: true, data: template });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/contract-templates/:id */
contractTemplatesRouter.patch('/:id', async (req, res, next) => {
  try {
    const parsed = templateSchema.partial().safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    const template = await contractService.updateTemplate(req.account!.id, req.params.id, parsed.data);
    res.json({ ok: true, data: template });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/contract-templates/:id */
contractTemplatesRouter.delete('/:id', async (req, res, next) => {
  try {
    await contractService.deleteTemplate(req.account!.id, req.params.id);
    res.json({ ok: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------ contracts ----

export const contractsRouter = Router();
contractsRouter.use(requireAuth, requireAccountType('professional'));

/** POST /api/contracts — generate from a template + live CRM data. */
contractsRouter.post('/', async (req, res, next) => {
  try {
    const parsed = generateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    const result = await contractService.generateContract(req.account!.id, parsed.data);
    res.status(201).json({ ok: true, data: result });
  } catch (err) {
    next(err);
  }
});

/** GET /api/contracts?client_id=<uuid>&status=<status> */
contractsRouter.get('/', async (req, res, next) => {
  try {
    const status = req.query.status as
      | 'draft'
      | 'sent'
      | 'signed'
      | 'declined'
      | 'voided'
      | undefined;
    const contracts = await contractService.listContracts(req.account!.id, {
      clientId: typeof req.query.client_id === 'string' ? req.query.client_id : undefined,
      status,
    });
    res.json({ ok: true, data: contracts });
  } catch (err) {
    next(err);
  }
});

/** GET /api/contracts/:id */
contractsRouter.get('/:id', async (req, res, next) => {
  try {
    const contract = await contractService.getContract(req.account!.id, req.params.id);
    res.json({ ok: true, data: contract });
  } catch (err) {
    next(err);
  }
});

/** GET /api/contracts/:id/html — the contract as a viewable web page. */
contractsRouter.get('/:id/html', async (req, res, next) => {
  try {
    const contract = await contractService.getContract(req.account!.id, req.params.id);
    res.type('html').send(contract.generated_html);
  } catch (err) {
    next(err);
  }
});

/** GET /api/contracts/:id/document?download=1 — the standalone, print-styled
 *  copy the client keeps (W-1). Same rendering the contract-signed email
 *  attaches; the browser's Print → Save as PDF turns it into a PDF. */
contractsRouter.get('/:id/document', async (req, res, next) => {
  try {
    const contract = await contractService.getContract(req.account!.id, req.params.id);
    const profile = await accountService.getProfessionalProfile(req.account!.id);
    const document = renderContractDocument(contract, {
      businessName: profile?.business_name ?? profile?.full_name ?? null,
    });
    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', `attachment; filename="agreement-${contract.id.slice(0, 8)}.html"`);
    }
    res.type('html').send(document);
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/contracts/:id — draft-stage edits; 409 once signed (DB trigger). */
contractsRouter.patch('/:id', async (req, res, next) => {
  try {
    const parsed = updateContractSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    const contract = await contractService.updateContract(req.account!.id, req.params.id, parsed.data);
    res.json({ ok: true, data: contract });
  } catch (err) {
    next(err);
  }
});

/** POST /api/contracts/:id/sign — in-person signing; locks the contract. */
contractsRouter.post('/:id/sign', async (req, res, next) => {
  try {
    const parsed = signSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    const contract = await contractService.signInPerson(req.account!.id, req.params.id, parsed.data);
    res.json({ ok: true, data: contract });
  } catch (err) {
    next(err);
  }
});
