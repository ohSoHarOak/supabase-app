import { Router } from 'express';
import { z } from 'zod';
import { clientService } from '../../services/ClientService';
import { notificationService } from '../../services/NotificationService';
import { requireAuth, requireAccountType } from '../middleware/auth';

export const clientsRouter = Router();

// Every CRM route requires a logged-in professional.
clientsRouter.use(requireAuth, requireAccountType('professional'));

// ------------------------------------------------------------ validation ----

// Loose on purpose: real phone formats vary wildly; we only reject obvious garbage.
const phoneSchema = z
  .string()
  .regex(/^\+?[\d\s().-]{7,20}$/, 'Phone number looks invalid.')
  .nullish();

const clientSchema = z.object({
  full_name: z.string().trim().min(1, 'Client name is required.'),
  email: z.string().email('Email address looks invalid.').nullish(),
  phone: phoneSchema,
  address: z.string().nullish(),
  emergency_contact_name: z.string().nullish(),
  emergency_contact_phone: phoneSchema,
  cancellation_window_hours: z.number().int().min(0).nullish(),
  no_show_fee_cents: z.number().int().min(0).nullish(),
  entry_instructions: z.string().nullish(),
  general_notes: z.string().nullish(),
  status: z.enum(['prospect', 'active', 'inactive']).optional(),
});

const petSchema = z.object({
  name: z.string().trim().min(1, 'Pet name is required.'),
  photo_url: z.string().url().nullish(),
  // Free text by design (018) — the UI dropdown is authoritative, but a
  // walker whose client keeps a rabbit shouldn't need a deploy.
  species: z.string().trim().min(1).max(40).optional(),
  breed: z.string().nullish(),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date_of_birth must be YYYY-MM-DD.').nullish(),
  weight_lb: z.number().positive().max(500).nullish(),
  color: z.string().nullish(),
  microchip_number: z.string().nullish(),
  medical_conditions: z.string().nullish(),
  behavior_notes: z.string().nullish(),
  feeding_notes: z.string().nullish(),
  emergency_vet: z.string().nullish(),
});

const vaccinationSchema = z.object({
  vaccine_name: z.string().trim().min(1, 'Vaccine name is required.'),
  administered_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  document_url: z.string().url().nullish(),
});

function validationError(res: import('express').Response, issues: z.ZodIssue[]): void {
  res.status(422).json({
    ok: false,
    error: { code: 'validation', message: issues.map((i) => i.message).join(' ') },
  });
}

// --------------------------------------------------------------- clients ----

/** GET /api/clients?q=<search>&status=<status> — list, with search across client + pet fields. */
clientsRouter.get('/', async (req, res, next) => {
  try {
    const status = req.query.status as 'prospect' | 'active' | 'inactive' | undefined;
    const clients = await clientService.listClients(req.account!.id, {
      query: typeof req.query.q === 'string' ? req.query.q : undefined,
      status,
    });
    res.json({ ok: true, data: clients });
  } catch (err) {
    next(err);
  }
});

/** POST /api/clients */
clientsRouter.post('/', async (req, res, next) => {
  try {
    const parsed = clientSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    const client = await clientService.createClient(req.account!.id, parsed.data);
    // P2-13: welcome the client to their portal. Enqueued from the route
    // because the email needs an absolute link and `origin` lives on the
    // request — the same pattern the Stripe and magic-link URLs use.
    if (client.email) {
      await notificationService.enqueue({
        accountId: req.account!.id,
        category: 'portal_invite',
        template: 'portal_invite',
        data: { client_id: client.id, origin: `${req.protocol}://${req.get('host')}` },
      });
    }
    res.status(201).json({ ok: true, data: client });
  } catch (err) {
    next(err);
  }
});

/** GET /api/clients/:id — client with pets. */
clientsRouter.get('/:id', async (req, res, next) => {
  try {
    const client = await clientService.getClient(req.account!.id, req.params.id);
    res.json({ ok: true, data: client });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/clients/:id */
clientsRouter.patch('/:id', async (req, res, next) => {
  try {
    const parsed = clientSchema.partial().safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    const client = await clientService.updateClient(req.account!.id, req.params.id, parsed.data);
    res.json({ ok: true, data: client });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/clients/:id */
clientsRouter.delete('/:id', async (req, res, next) => {
  try {
    await clientService.deleteClient(req.account!.id, req.params.id);
    res.json({ ok: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

/** POST /api/clients/:id/pets */
clientsRouter.post('/:id/pets', async (req, res, next) => {
  try {
    const parsed = petSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    const pet = await clientService.addPet(req.account!.id, req.params.id, parsed.data);
    res.status(201).json({ ok: true, data: pet });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------ pets ----

export const petsRouter = Router();
petsRouter.use(requireAuth, requireAccountType('professional'));

/** GET /api/pets/:id */
petsRouter.get('/:id', async (req, res, next) => {
  try {
    const pet = await clientService.getPet(req.account!.id, req.params.id);
    res.json({ ok: true, data: pet });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/pets/:id */
petsRouter.patch('/:id', async (req, res, next) => {
  try {
    const parsed = petSchema.partial().safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    const pet = await clientService.updatePet(req.account!.id, req.params.id, parsed.data);
    res.json({ ok: true, data: pet });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/pets/:id */
petsRouter.delete('/:id', async (req, res, next) => {
  try {
    await clientService.deletePet(req.account!.id, req.params.id);
    res.json({ ok: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

/** GET /api/pets/:id/vaccinations */
petsRouter.get('/:id/vaccinations', async (req, res, next) => {
  try {
    const records = await clientService.listVaccinations(req.account!.id, req.params.id);
    res.json({ ok: true, data: records });
  } catch (err) {
    next(err);
  }
});

/** POST /api/pets/:id/vaccinations */
petsRouter.post('/:id/vaccinations', async (req, res, next) => {
  try {
    const parsed = vaccinationSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    const record = await clientService.addVaccination(req.account!.id, req.params.id, parsed.data);
    res.status(201).json({ ok: true, data: record });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/pets/:petId/vaccinations/:vaccinationId */
petsRouter.delete('/:petId/vaccinations/:vaccinationId', async (req, res, next) => {
  try {
    await clientService.deleteVaccination(req.account!.id, req.params.petId, req.params.vaccinationId);
    res.json({ ok: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});
