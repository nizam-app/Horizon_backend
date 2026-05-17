import { Router } from 'express';
import mongoose from 'mongoose';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'horizon-backend',
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    apiVersion: 2,
    features: ['claimIntake', 'claimPrefill', 'admin'],
  });
});
