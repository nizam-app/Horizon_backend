import express from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health.js';
import { claimsRouter } from './routes/claims.js';
import { adminRouter } from './routes/admin.js';

export function createApp() {
  const app = express();
  app.use(
    cors({
      origin: ['http://127.0.0.1:5173', 'http://127.0.0.1:5174', 'http://localhost:5173', 'http://localhost:5174'],
      credentials: true,
    })
  );
  app.use(express.json({ limit: '12mb' }));

  app.use('/health', healthRouter);
  app.use('/v1/claims', claimsRouter);
  app.use('/v1/admin', adminRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}
