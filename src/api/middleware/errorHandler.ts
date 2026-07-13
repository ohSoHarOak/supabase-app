import { NextFunction, Request, Response } from 'express';
import { ServiceError } from '../../services/errors';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ServiceError) {
    res.status(err.httpStatus).json({ ok: false, error: { code: err.code, message: err.message } });
    return;
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ ok: false, error: { code: 'internal', message: 'Something went wrong.' } });
}
