import { Router } from 'express';
import mongoose from 'mongoose';
import {
  getClaimEmailProvider,
  isClaimEmailConfigured,
  verifySmtpConnection,
} from '../services/claimEmail.js';

export const healthRouter = Router();

healthRouter.get('/', async (req, res) => {
  const emailConfigured = isClaimEmailConfigured();
  const claimEmail = {
    configured: emailConfigured,
    provider: getClaimEmailProvider(),
    recipient: process.env.CLAIM_SUBMISSION_EMAIL_TO?.trim() || null,
    from: process.env.CLAIM_SUBMISSION_EMAIL_FROM?.trim() || null,
    smtpUser: process.env.SMTP_USER?.trim() || null,
    resendConfigured: Boolean(process.env.RESEND_API_KEY?.trim()),
  };

  if (req.query.verifyEmail === '1' && getClaimEmailProvider() === 'smtp') {
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
