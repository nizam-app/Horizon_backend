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
  CLAIM_DISPOSITION_STATUSES,
  formatClaimForApi,
  formatClaimListItem,
  normalizePaymentStatus,
  sanitizeAdminNote,
  sanitizeMoneyAmount,
  sanitizeParts,
  sanitizeQuoteOptions,
} from '../services/claimAdmin.js';
import { generateClaimPdfBuffer } from '../services/claimPdf.js';
import {
  applyMemberSubmissionSection,
  buildClaimUpdateFromPayload,
  MEMBER_SUBMISSION_SECTIONS,
} from '../services/claimSubmissionAdmin.js';
import { deleteClaimById } from '../services/claimDelete.js';

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

/** Full member submission PDF (all fields + embedded images from payload). */
adminRouter.get('/claims/:id/export-pdf', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid claim id' });
    }
    const claim = await Claim.findById(req.params.id).lean();
    if (!claim) return res.status(404).json({ error: 'Not found' });
    const payload = claim.payload && typeof claim.payload === 'object' ? claim.payload : null;
    if (!payload) {
      return res.status(400).json({ error: 'No member submission payload stored for this claim' });
    }
    const pdfBuffer = await generateClaimPdfBuffer({
      claim: payload,
      intakeReference: claim.intakeReference || 'UNKNOWN',
      systemReference: claim.reference || claim.intakeReference || 'UNKNOWN',
      admin: {
        status: claim.status,
        quotePrice: claim.quotePrice,
        insuranceApprovedPrice: claim.insuranceApprovedPrice,
        quoteOptions: claim.quoteOptions || [],
        primaryQuoteId: claim.primaryQuoteId,
        finalQuoteId: claim.finalQuoteId,
        paymentStatus: claim.paymentStatus,
        adminNote: claim.adminNote,
        parts: claim.parts || [],
        caseFiles: claim.caseFiles || [],
      },
    });
    const safeName = String(claim.intakeReference || claim._id).replace(/[^A-Za-z0-9-]/g, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="claim-${safeName}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not generate PDF' });
  }
});

/** Admin edits to member-submitted claim data (section-by-section). */
adminRouter.patch('/claims/:id/member-submission', requireAdmin, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid claim id' });
    }

    const section = String(req.body?.section || '').trim();
    const data = req.body?.data;

    if (!MEMBER_SUBMISSION_SECTIONS.includes(section)) {
      return res.status(400).json({
        error: `Invalid section. Allowed: ${MEMBER_SUBMISSION_SECTIONS.join(', ')}`,
      });
    }
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'data object is required for this section' });
    }

    const existing = await Claim.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (!existing.payload || typeof existing.payload !== 'object') {
      return res.status(400).json({ error: 'No member submission payload stored for this claim' });
    }

    let nextPayload;
    try {
      nextPayload = applyMemberSubmissionSection(existing.payload, section, data);
    } catch (err) {
      const status = err.statusCode === 400 ? 400 : 500;
      return res.status(status).json({ error: err.message || 'Invalid section data' });
    }

    const claimFields = buildClaimUpdateFromPayload(nextPayload);
    const updated = await Claim.findByIdAndUpdate(
      req.params.id,
      { $set: claimFields },
      { new: true },
    ).lean();

    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json({ claim: formatClaimForApi(updated), section });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update member submission' });
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
      const s = req.body.status;
      if (!CLAIM_DISPOSITION_STATUSES.includes(s)) {
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

/** Permanently delete a claim and all associated uploaded files (admin only). */
adminRouter.delete('/claims/:id', requireAdmin, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid claim id' });
    }

    const deleted = await deleteClaimById(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Claim not found' });

    res.json({
      ok: true,
      id: String(deleted._id),
      intakeReference: deleted.intakeReference || null,
      reference: deleted.reference || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete claim' });
  }
});
