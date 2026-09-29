import jwt from 'jsonwebtoken';
import { StaffUser } from '../models/StaffUser.js';
import {
  canManageAttendance,
  canManageClaims,
  canManageHr,
  canManagePartsCrud,
  canViewParts,
} from '../auth/roles.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ error: 'Server JWT_SECRET is not configured' });
    }
    req.user = jwt.verify(token, secret);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/** Claims workspace, staff CRUD, uploads — admin or super_admin. */
export function requireAdmin(req, res, next) {
  if (!req.user || !canManageClaims(req.user.role)) {
    return res.status(403).json({ error: 'Administrator role required' });
  }
  next();
}

async function refreshStaffRole(req, res) {
  if (!req.user?.sub) {
    res.status(403).json({ error: 'Access denied' });
    return null;
  }
  try {
    const user = await StaffUser.findById(req.user.sub).select('role active').lean();
    if (!user || !user.active) {
      res.status(401).json({ error: 'Account is disabled or no longer exists' });
      return null;
    }
    req.user.role = user.role;
    return user;
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Authorization check failed' });
    return null;
  }
}

/** Employees and salaries — super_admin; re-checks role from DB when possible. */
export async function requireSuperAdmin(req, res, next) {
  const user = await refreshStaffRole(req, res);
  if (!user) return;
  if (!canManageHr(user.role)) {
    return res.status(403).json({ error: 'Super administrator access required' });
  }
  next();
}

/** Attendance (and read-only employee list for attendance UI) — admin or super_admin. */
export async function requireAttendanceAccess(req, res, next) {
  const user = await refreshStaffRole(req, res);
  if (!user) return;
  if (!canManageAttendance(user.role)) {
    return res.status(403).json({ error: 'Attendance access required' });
  }
  next();
}

/** Parts registry — admin or super_admin. */
export async function requirePartsAccess(req, res, next) {
  const user = await refreshStaffRole(req, res);
  if (!user) return;
  if (!canViewParts(user.role)) {
    return res.status(403).json({ error: 'Parts access required' });
  }
  next();
}

/** Create/delete part lines and full-field part edits — super_admin. */
export async function requirePartsCrud(req, res, next) {
  const user = await refreshStaffRole(req, res);
  if (!user) return;
  if (!canManagePartsCrud(user.role)) {
    return res.status(403).json({ error: 'Super administrator access required' });
  }
  next();
}

