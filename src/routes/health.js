import { Router } from 'express';
import mongoose from 'mongoose';
import { isClaimEmailConfigured } from '../services/claimEmail.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  const emailConfigured = isClaimEmailConfigured();
  res.json({
    ok: true,
    service: 'horizon-backend',
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    apiVersion: 2,
    features: ['claimIntake', 'claimPrefill', 'admin'],
    claimEmail: {
      configured: emailConfigured,
      recipient: process.env.CLAIM_SUBMISSION_EMAIL_TO?.trim() || null,
    },
  });
});
