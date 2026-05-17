import { Router } from 'express';
import mongoose from 'mongoose';
import { isClaimEmailConfigured, verifySmtpConnection } from '../services/claimEmail.js';

export const healthRouter = Router();

healthRouter.get('/', async (req, res) => {
  const emailConfigured = isClaimEmailConfigured();
  const claimEmail = {
    configured: emailConfigured,
    recipient: process.env.CLAIM_SUBMISSION_EMAIL_TO?.trim() || null,
    smtpUser: process.env.SMTP_USER?.trim() || null,
  };

  if (req.query.verifyEmail === '1' && emailConfigured) {
    try {
      await verifySmtpConnection();
      claimEmail.smtpLogin = 'ok';
    } catch (err) {
      claimEmail.smtpLogin = 'failed';
      claimEmail.smtpError = err?.message || String(err);
    }
  }

  res.json({
    ok: true,
    service: 'horizon-backend',
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    apiVersion: 2,
    features: ['claimIntake', 'claimPrefill', 'admin'],
    claimEmail,
  });
});
