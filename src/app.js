import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { healthRouter } from './routes/health.js';
import { claimsRouter } from './routes/claims.js';
import { adminRouter } from './routes/admin.js';
import { attachClaimFileRoutes } from './routes/claimUploads.js';
import { UPLOAD_ROOT } from './config/paths.js';

attachClaimFileRoutes(adminRouter);

export function createApp() {
  const app = express();
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );
  const corsOrigins = [
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'http://localhost:5173',
    'http://localhost:5174',
    ...(process.env.CORS_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  ];
  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
    })
  );
  app.use(express.json({ limit: '12mb' }));

  app.use('/uploads', express.static(UPLOAD_ROOT, { maxAge: '1d', fallthrough: true }));

  app.use('/health', healthRouter);
  app.use('/v1/claims', claimsRouter);
  app.use('/v1/admin', adminRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}
