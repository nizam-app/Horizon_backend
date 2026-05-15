import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { Claim } from '../models/Claim.js';
import { StaffUser } from '../models/StaffUser.js';
import { requireAuth, requireAdmin } from '../middleware/requireAuth.js';
import { attachStaffRoutes } from './staff.js';

export const adminRouter = Router();

adminRouter.post('/auth/login', async (req, res) => {
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
    const { status, q } = req.query;
    const filter = {};
    if (status && status !== 'All') filter.status = status;
    if (q && String(q).trim()) {
      const term = String(q).trim();
      filter.$or = [
        { plateNumber: new RegExp(term, 'i') },
        { driverName: new RegExp(term, 'i') },
        { summary: new RegExp(term, 'i') },
        { reference: new RegExp(term, 'i') },
      ];
    }
    const claims = await Claim.find(filter).sort({ createdAt: -1 }).lean();
    const list = claims.map((c) => ({
      id: c._id,
      reference: c.reference,
      status: c.status,
      priority: c.priority,
      plateNumber: c.plateNumber,
      driverName: c.driverName,
      dateOfIncident: c.dateOfIncident,
      submittedAt: c.submittedAt,
      summary: c.summary,
      quoteOptions: (c.quoteOptions || []).map((q) => ({
        id: q._id?.toString(),
        supplier: q.supplier,
        amount: q.amount,
        reference: q.reference,
      })),
      primaryQuoteId: c.primaryQuoteId?.toString() || null,
      finalQuoteId: c.finalQuoteId?.toString() || null,
    }));
    res.json({ claims: list });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not list claims' });
  }
});

adminRouter.get('/claims/:id', async (req, res) => {
  try {
    const claim = await Claim.findById(req.params.id).lean();
    if (!claim) return res.status(404).json({ error: 'Not found' });
    res.json({
      claim: {
        ...claim,
        id: claim._id,
        quoteOptions: (claim.quoteOptions || []).map((q) => ({
          id: q._id?.toString(),
          supplier: q.supplier,
          amount: q.amount,
          reference: q.reference,
        })),
        primaryQuoteId: claim.primaryQuoteId?.toString() || null,
        finalQuoteId: claim.finalQuoteId?.toString() || null,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load claim' });
  }
});

adminRouter.patch('/claims/:id', requireAdmin, async (req, res) => {
  try {
    const allowed = ['status', 'priority', 'primaryQuoteId', 'finalQuoteId', 'summary'];
    const patch = {};
    for (const key of allowed) {
      if (req.body[key] === undefined) continue;
      if (key === 'primaryQuoteId' || key === 'finalQuoteId') {
        const v = req.body[key];
        if (v === null || v === '') {
          patch[key] = null;
        } else if (mongoose.Types.ObjectId.isValid(v)) {
          patch[key] = new mongoose.Types.ObjectId(v);
        } else {
          return res.status(400).json({ error: `Invalid ${key}` });
        }
      } else {
        patch[key] = req.body[key];
      }
    }
    const updated = await Claim.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json({ claim: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update claim' });
  }
});
