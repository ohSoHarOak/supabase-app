import { z } from 'zod';

/**
 * Field validators shared across routes.
 *
 * Service fields are defined once here because a service is now described in
 * two places — the scheduling route (a service on its own) and the contracts
 * route (services carried by a contract, W-5/W-6). Adding a profession or a
 * billing cadence should be one edit, not a hunt for every route that happens
 * to list the enum.
 */

export const serviceTypeEnum = z.enum([
  'group_walk',
  'private_walk',
  'drop_in', // short check-in, not a walk (018)
  'training_session',
  'grooming',
  'sitting',
  'boarding',
  'other',
]);

export const billingCadenceEnum = z.enum([
  'weekly',
  'biweekly',
  'monthly',
  'per_visit',
  'per_day',
  'per_package',
  'one_time',
]);

export const serviceStatusEnum = z.enum(['draft', 'active', 'paused', 'ended']);

export const priceCents = z
  .number()
  .int('Price must be whole cents.')
  .positive('Price must be positive.')
  .max(100_000_000, 'Price is unreasonably large.');

export const sessionCount = z.number().int().min(1).max(500).nullish();
export const durationMinutes = z.number().int().min(5).max(24 * 60).nullish();
export const serviceNotes = z.string().trim().max(1000).nullish();
export const isoDate = (field: string) =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${field} must be YYYY-MM-DD.`).nullish();
