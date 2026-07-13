import express from 'express';
import { authRouter } from './routes/auth';
import { errorHandler } from './middleware/errorHandler';

export function createServer(): express.Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, data: { service: 'petpro-connect', status: 'healthy' } });
  });

  app.use('/api/auth', authRouter);

  app.use((_req, res) => {
    res.status(404).json({ ok: false, error: { code: 'not_found', message: 'Route not found.' } });
  });
  app.use(errorHandler);

  return app;
}
