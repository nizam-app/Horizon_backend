import bcrypt from 'bcryptjs';
import { StaffUser } from '../models/StaffUser.js';
import { requireAdmin } from '../middleware/requireAuth.js';

function staffPublicFields(doc) {
  return {
    id: doc._id.toString(),
    email: doc.email,
    role: doc.role,
    displayName: doc.displayName,
    active: doc.active,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * @param {import('express').Router} router — already uses requireAuth
 */
export function attachStaffRoutes(router) {
  router.get('/me', async (req, res) => {
    try {
      const user = await StaffUser.findById(req.user.sub)
        .select('email role displayName active createdAt updatedAt')
        .lean();
      if (!user) {
        return res.status(401).json({ error: 'User no longer exists' });
      }
      if (!user.active) {
        return res.status(401).json({ error: 'Account is disabled' });
      }
      return res.json({
        user: {
          id: user._id.toString(),
          email: user.email,
          role: user.role,
          displayName: user.displayName,
        },
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Could not load profile' });
    }
  });

  router.get('/staff', requireAdmin, async (_req, res) => {
    try {
      const users = await StaffUser.find().sort({ email: 1 }).lean();
      res.json({
        staff: users.map((u) => staffPublicFields(u)),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not list staff' });
    }
  });

  router.post('/staff', requireAdmin, async (req, res) => {
    try {
      const { email, password, role, displayName } = req.body || {};
      const normalizedEmail = String(email || '')
        .trim()
        .toLowerCase();
      if (!normalizedEmail || !password || !displayName) {
        return res.status(400).json({ error: 'email, password, and displayName are required' });
      }
      if (!['admin', 'moderator'].includes(role)) {
        return res.status(400).json({ error: 'role must be admin or moderator' });
      }
      if (String(password).length < 6) {
        return res.status(400).json({ error: 'password must be at least 6 characters' });
      }
      const passwordHash = await bcrypt.hash(String(password), 10);
      const doc = await StaffUser.create({
        email: normalizedEmail,
        passwordHash,
        role,
        displayName: String(displayName).trim(),
        active: true,
      });
      res.status(201).json({ staff: staffPublicFields(doc) });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ error: 'Email already in use' });
      }
      console.error(err);
      res.status(500).json({ error: 'Could not create staff user' });
    }
  });

  router.patch('/staff/:id', requireAdmin, async (req, res) => {
    try {
      const id = req.params.id;
      if (id === req.user.sub) {
        const { role, active } = req.body || {};
        if (role !== undefined && role !== req.user.role) {
          return res.status(400).json({ error: 'You cannot change your own role' });
        }
        if (active === false) {
          return res.status(400).json({ error: 'You cannot disable your own account' });
        }
      }

      const patch = {};
      const { displayName, role, active, password } = req.body || {};
      if (displayName !== undefined) patch.displayName = String(displayName).trim();
      if (role !== undefined) {
        if (!['admin', 'moderator'].includes(role)) {
          return res.status(400).json({ error: 'role must be admin or moderator' });
        }
        patch.role = role;
      }
      if (active !== undefined) patch.active = Boolean(active);
      if (password !== undefined) {
        if (String(password).length < 6) {
          return res.status(400).json({ error: 'password must be at least 6 characters' });
        }
        patch.passwordHash = await bcrypt.hash(String(password), 10);
      }

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      const updated = await StaffUser.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean();
      if (!updated) return res.status(404).json({ error: 'Not found' });
      res.json({ staff: staffPublicFields(updated) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not update staff user' });
    }
  });

  router.delete('/staff/:id', requireAdmin, async (req, res) => {
    try {
      const id = req.params.id;
      if (id === req.user.sub) {
        return res.status(400).json({ error: 'You cannot delete your own account' });
      }
      const deleted = await StaffUser.findByIdAndDelete(id);
      if (!deleted) return res.status(404).json({ error: 'Not found' });
      res.status(204).send();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not delete staff user' });
    }
  });
}
