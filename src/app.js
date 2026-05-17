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

  const netlifyPreview =
    process.env.CORS_ALLOW_NETLIFY !== 'false'
      ? (origin) => {
          try {
            const u = new URL(origin);
            return u.protocol === 'https:' && u.hostname.endsWith('.netlify.app');
          } catch {
            return false;
          }
        }
      : () => false;

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) {
          callback(null, true);
          return;
        }
        if (corsOrigins.includes(origin) || netlifyPreview(origin)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: '12mb' }));

  app.use('/uploads', express.static(UPLOAD_ROOT, { maxAge: '1d', fallthrough: true }));

  app.get('/', (_req, res) => {
    res.json({
      service: 'horizon-backend',
      ok: true,
      message: 'API is running. Use /health for a readiness check, /v1/claims for intake, /v1/admin for staff.',
      links: {
        health: '/health',
        claims: '/v1/claims',
        admin: '/v1/admin',
      },
    });
  });

  app.use('/health', healthRouter);
  app.use('/v1/claims', claimsRouter);
  app.use('/v1/admin', adminRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}
