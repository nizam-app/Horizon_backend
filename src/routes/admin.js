import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { Claim } from '../models/Claim.js';
import { StaffUser } from '../models/StaffUser.js';
import { requireAuth, requireAdmin } from '../middleware/requireAuth.js';
import { attachStaffRoutes } from './staff.js';
import {
  formatClaimForApi,
  formatClaimListItem,
  normalizePaymentStatus,
  sanitizeAdminNote,
  sanitizeMoneyAmount,
  sanitizeParts,
  sanitizeQuoteOptions,
} from '../services/claimAdmin.js';

export const adminRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.MAX_LOGIN_ATTEMPTS_IP || 80),
  standardHeaders: true,
  legacyHeaders: false,
});

adminRouter.post('/auth/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password required' });
    }
    const user = await StaffUser.findOne({ email: String(email).trim().toLowerCase() });
    if (!user || !user.active) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ error: 'JWT_SECRET not configured' });
    }
    const token = jwt.sign(
      { sub: user._id.toString(), email: user.email, role: user.role, displayName: user.displayName },
      secret,
      { expiresIn: '8h' }
    );
    return res.json({
      token,
      user: { email: user.email, role: user.role, displayName: user.displayName },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

adminRouter.use(requireAuth);
attachStaffRoutes(adminRouter);

adminRouter.get('/claims', async (req, res) => {
  try {
    const { status, q, paymentStatus } = req.query;
    const filter = {};
    if (status && status !== 'All') filter.status = status;
    const ps = String(paymentStatus || '').trim().toLowerCase();
    if (ps === 'pending' || ps === 'completed') filter.paymentStatus = ps;
    if (q && String(q).trim()) {
      const term = String(q).trim();
      const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { plateNumber: rx },
        { driverName: rx },
        { summary: rx },
        { reference: rx },
        { intakeReference: rx },
        { adminNote: rx },
      ];
    }
    const claims = await Claim.find(filter).sort({ createdAt: -1 }).lean();
    const list = claims.map((c) => formatClaimListItem(c));
    res.json({ claims: list });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not list claims' });
  }
});

adminRouter.get('/claims/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid claim id' });
    }
    const claim = await Claim.findById(req.params.id).lean();
    if (!claim) return res.status(404).json({ error: 'Not found' });
    res.json({ claim: formatClaimForApi(claim) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load claim' });
  }
});

/** Admin workspace + disposition fields persisted for horizon-admin-app. */
adminRouter.patch('/claims/:id', requireAdmin, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid claim id' });
    }

    const patch = {};

    if (req.body.status !== undefined) {
      const allowed = ['Pending Review', 'Approved', 'Rejected'];
      const s = req.body.status;
      if (!allowed.includes(s)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      patch.status = s;
    }

    if (req.body.priority !== undefined) patch.priority = String(req.body.priority).slice(0, 80);

    if (req.body.summary !== undefined) patch.summary = String(req.body.summary).slice(0, 2000);

    if (req.body.paymentStatus !== undefined) {
      patch.paymentStatus = normalizePaymentStatus(req.body.paymentStatus);
    }

    if (req.body.adminNote !== undefined) patch.adminNote = sanitizeAdminNote(req.body.adminNote);

    if (req.body.parts !== undefined) patch.parts = sanitizeParts(req.body.parts);

    if (req.body.quotePrice !== undefined) patch.quotePrice = sanitizeMoneyAmount(req.body.quotePrice);

    if (req.body.insuranceApprovedPrice !== undefined) {
      patch.insuranceApprovedPrice = sanitizeMoneyAmount(req.body.insuranceApprovedPrice);
    }

    if (req.body.quoteOptions !== undefined) patch.quoteOptions = sanitizeQuoteOptions(req.body.quoteOptions);

    if (req.body.primaryQuoteId !== undefined) {
      const v = req.body.primaryQuoteId;
      patch.primaryQuoteId = v === null || v === '' ? null : String(v).trim().slice(0, 80);
    }

    if (req.body.finalQuoteId !== undefined) {
      const v = req.body.finalQuoteId;
      patch.finalQuoteId = v === null || v === '' ? null : String(v).trim().slice(0, 80);
    }

    if (req.body.data !== undefined && req.body.data !== null && typeof req.body.data === 'object') {
      patch.data = req.body.data;
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const updated = await Claim.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: 'Not found' });

    res.json({ claim: formatClaimForApi(updated) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update claim' });
  }
});
