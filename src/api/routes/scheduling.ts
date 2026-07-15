import { Router } from 'express';
import { z } from 'zod';
import { schedulingService } from '../../services/SchedulingService';
import { requireAuth, requireAccountType } from '../middleware/auth';

// ----------------------------------------------------------- validation ----

const isoDateTime = z.string().datetime({ offset: true, message: 'Must be an ISO timestamp.' });

const serviceSchema = z.object({
  client_id: z.string().uuid('client_id must be a UUID.'),
  service_type: z.enum([
    'group_walk',
    'private_walk',
    'training_session',
    'grooming',
    'sitting',
    'boarding',
    'other',
  ]),
  name: z.string().trim().min(1, 'Service name is required.').max(120),
  description: z.string().trim().max(1000).nullish(),
  duration_minutes: z.number().int().min(5).max(24 * 60).nullish(),
  price_cents: z
    .number()
    .int('Price must be whole cents.')
    .positive('Price must be positive.')
    .max(100_000_000, 'Price is unreasonably large.'),
  billing_cadence: z.enum(['weekly', 'biweekly', 'monthly', 'per_visit', 'per_package', 'one_time']),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'start_date must be YYYY-MM-DD.').nullish(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'end_date must be YYYY-MM-DD.').nullish(),
  status: z.enum(['draft', 'active', 'paused', 'ended']).optional(),
});

const serviceUpdateSchema = serviceSchema.omit({ client_id: true }).partial();

const appointmentSchema = z.object({
  service_id: z.string().uuid('service_id must be a UUID.'),
  starts_at: isoDateTime,
  ends_at: isoDateTime.nullish(),
  notes: z.string().trim().max(1000).nullish(),
  repeat_weeks: z.number().int().min(1).max(26).optional(),
});

const appointmentUpdateSchema = z.object({
  starts_at: isoDateTime.optional(),
  ends_at: isoDateTime.optional(),
  notes: z.string().trim().max(1000).nullish(),
});

const cancelSchema = z.object({
  scope: z.enum(['one', 'following']).default('one'),
});

const completeSchema = z.object({
  actual_start_at: isoDateTime.nullish(),
  actual_end_at: isoDateTime.nullish(),
  completion_notes: z.string().trim().max(2000).nullish(),
  good_dog: z.boolean().nullish(),
  got_a_treat: z.boolean().nullish(),
});

function validationError(res: import('express').Response, issues: z.ZodIssue[]): void {
  res.status(422).json({
    ok: false,
    error: { code: 'validation', message: issues.map((i) => i.message).join(' ') },
  });
}

// ------------------------------------------------------------- services ----

export const servicesRouter = Router();
servicesRouter.use(requireAuth, requireAccountType('professional'));

/** GET /api/services?client_id=<uuid>&status=<status> */
servicesRouter.get('/', async (req, res, next) => {
  try {
    const services = await schedulingService.listServices(req.account!.id, {
      clientId: typeof req.query.client_id === 'string' ? req.query.client_id : undefined,
      status: req.query.status as 'draft' | 'active' | 'paused' | 'ended' | undefined,
    });
    res.json({ ok: true, data: services });
  } catch (err) {
    next(err);
  }
});

/** POST /api/services */
servicesRouter.post('/', async (req, res, next) => {
  try {
    const parsed = serviceSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    const service = await schedulingService.createService(req.account!.id, parsed.data);
    res.status(201).json({ ok: true, data: service });
  } catch (err) {
    next(err);
  }
});

/** GET /api/services/:id */
servicesRouter.get('/:id', async (req, res, next) => {
  try {
    const service = await schedulingService.getService(req.account!.id, req.params.id);
    res.json({ ok: true, data: service });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/services/:id — edit terms, or retire with status: 'ended'. */
servicesRouter.patch('/:id', async (req, res, next) => {
  try {
    const parsed = serviceUpdateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    const service = await schedulingService.updateService(req.account!.id, req.params.id, parsed.data);
    res.json({ ok: true, data: service });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------- appointments ----

export const appointmentsRouter = Router();
appointmentsRouter.use(requireAuth, requireAccountType('professional'));

/** GET /api/appointments?from=<iso>&to=<iso>&client_id=<uuid>&status=<status> */
appointmentsRouter.get('/', async (req, res, next) => {
  try {
    const appointments = await schedulingService.listAppointments(req.account!.id, {
      from: typeof req.query.from === 'string' ? req.query.from : undefined,
      to: typeof req.query.to === 'string' ? req.query.to : undefined,
      clientId: typeof req.query.client_id === 'string' ? req.query.client_id : undefined,
      status: req.query.status as 'scheduled' | 'completed' | 'cancelled' | 'no_show' | undefined,
    });
    res.json({ ok: true, data: appointments });
  } catch (err) {
    next(err);
  }
});

/** POST /api/appointments — repeat_weeks > 1 books a weekly series.
 *  Returns every created occurrence; 409 lists conflicts if any slot clashes. */
appointmentsRouter.post('/', async (req, res, next) => {
  try {
    const parsed = appointmentSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    const appointments = await schedulingService.createAppointment(req.account!.id, parsed.data);
    res.status(201).json({ ok: true, data: appointments });
  } catch (err) {
    next(err);
  }
});

/** GET /api/appointments/:id */
appointmentsRouter.get('/:id', async (req, res, next) => {
  try {
    const appointment = await schedulingService.getAppointment(req.account!.id, req.params.id);
    res.json({ ok: true, data: appointment });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/appointments/:id — reschedule one occurrence or edit notes. */
appointmentsRouter.patch('/:id', async (req, res, next) => {
  try {
    const parsed = appointmentUpdateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    const appointment = await schedulingService.updateAppointment(
      req.account!.id,
      req.params.id,
      parsed.data
    );
    res.json({ ok: true, data: appointment });
  } catch (err) {
    next(err);
  }
});

/** POST /api/appointments/:id/cancel — { scope: 'one' | 'following' } */
appointmentsRouter.post('/:id/cancel', async (req, res, next) => {
  try {
    const parsed = cancelSchema.safeParse(req.body ?? {});
    if (!parsed.success) return validationError(res, parsed.error.issues);
    const cancelled = await schedulingService.cancelAppointment(
      req.account!.id,
      req.params.id,
      parsed.data.scope
    );
    res.json({ ok: true, data: cancelled });
  } catch (err) {
    next(err);
  }
});

/** POST /api/appointments/:id/complete — walk report data optional.
 *  Fires walk_completed; per_visit services get their invoice automatically. */
appointmentsRouter.post('/:id/complete', async (req, res, next) => {
  try {
    const parsed = completeSchema.safeParse(req.body ?? {});
    if (!parsed.success) return validationError(res, parsed.error.issues);
    const result = await schedulingService.completeAppointment(
      req.account!.id,
      req.params.id,
      parsed.data
    );
    res.json({ ok: true, data: result });
  } catch (err) {
    next(err);
  }
});
