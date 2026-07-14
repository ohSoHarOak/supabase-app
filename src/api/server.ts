import path from 'path';
import express from 'express';
import { authRouter } from './routes/auth';
import { clientsRouter, petsRouter } from './routes/clients';
import { contractTemplatesRouter, contractsRouter } from './routes/contracts';
import { errorHandler } from './middleware/errorHandler';

export function createServer(): express.Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Week 4 web UI — static files, no build step. Served from the repo's
  // public/ directory (process.cwd() is the repo root locally and on Render).
  app.use(express.static(path.join(process.cwd(), 'public')));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, data: { service: 'petpro-connect', status: 'healthy' } });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/clients', clientsRouter);
  app.use('/api/pets', petsRouter);
  app.use('/api/contract-templates', contractTemplatesRouter);
  app.use('/api/contracts', contractsRouter);

  app.use((_req, res) => {
    res.status(404).json({ ok: false, error: { code: 'not_found', message: 'Route not found.' } });
  });
  app.use(errorHandler);

  return app;
}
