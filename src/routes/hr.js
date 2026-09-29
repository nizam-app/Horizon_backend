import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAttendanceAccess, requireSuperAdmin } from '../middleware/requireAuth.js';
import { Employee } from '../models/Employee.js';
import { SalaryRecord } from '../models/SalaryRecord.js';
import { AttendanceRecord } from '../models/AttendanceRecord.js';
import {
  assertEmployeeExists,
  formatAttendance,
  formatEmployee,
  formatSalary,
  parseAttendanceInput,
  parseDateRangeQuery,
  parseEmployeeInput,
  parseSalaryInput,
} from '../services/hr.js';

function hrError(res, err, fallback = 'Request failed') {
  const msg = err?.message || fallback;
  if (msg.includes('required') || msg.includes('invalid') || msg.includes('must')) {
    return res.status(400).json({ error: msg });
  }
  return res.status(500).json({ error: fallback });
}

/**
 * @param {import('express').Router} router — already uses requireAuth
 */
export function attachHrRoutes(adminRouter) {
  const router = Router();

  // ——— Employees ———
  router.get('/employees', requireAttendanceAccess, async (req, res) => {
    try {
      const status = req.query.status;
      const filter = {};
      if (status === 'active' || status === 'inactive') filter.status = status;
      const q = String(req.query.q || '').trim();
      if (q) {
        const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        filter.$or = [
          { displayName: rx },
          { employeeNumber: rx },
          { email: rx },
          { department: rx },
        ];
      }
      const employees = await Employee.find(filter).sort({ displayName: 1 }).lean();
      res.json({ employees: employees.map(formatEmployee), total: employees.length });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not list employees' });
    }
  });

  router.post('/employees', requireSuperAdmin, async (req, res) => {
    try {
      const patch = parseEmployeeInput(req.body || {});
      if (!patch.employeeNumber || !patch.displayName) {
        return res.status(400).json({ error: 'employeeNumber and displayName are required' });
      }
      const doc = await Employee.create(patch);
      res.status(201).json({ employee: formatEmployee(doc) });
    } catch (err) {
      if (err.code === 11000) return res.status(409).json({ error: 'employeeNumber already in use' });
      console.error(err);
      return hrError(res, err, 'Could not create employee');
    }
  });

  router.get('/employees/:id', requireAttendanceAccess, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ error: 'Invalid employee id' });
      }
      const doc = await Employee.findById(req.params.id).lean();
      if (!doc) return res.status(404).json({ error: 'Not found' });
      res.json({ employee: formatEmployee(doc) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not load employee' });
    }
  });

  router.get('/employees/:id/salaries', requireSuperAdmin, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ error: 'Invalid employee id' });
      }
      const emp = await assertEmployeeExists(req.params.id);
      if (!emp) return res.status(404).json({ error: 'Employee not found' });
      const rows = await SalaryRecord.find({ employeeId: req.params.id })
        .sort({ periodYear: -1, periodMonth: -1 })
        .lean();
      res.json({ salaries: rows.map(formatSalary), total: rows.length });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not list salaries' });
    }
  });

  router.patch('/employees/:id', requireSuperAdmin, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ error: 'Invalid employee id' });
      }
      const patch = parseEmployeeInput(req.body || {});
      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }
      const updated = await Employee.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true }).lean();
      if (!updated) return res.status(404).json({ error: 'Not found' });
      res.json({ employee: formatEmployee(updated) });
    } catch (err) {
      if (err.code === 11000) return res.status(409).json({ error: 'employeeNumber already in use' });
      console.error(err);
      return hrError(res, err, 'Could not update employee');
    }
  });

  router.delete('/employees/:id', requireSuperAdmin, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ error: 'Invalid employee id' });
      }
      const updated = await Employee.findByIdAndUpdate(
        req.params.id,
        { $set: { status: 'inactive' } },
        { new: true }
      ).lean();
      if (!updated) return res.status(404).json({ error: 'Not found' });
      res.json({ employee: formatEmployee(updated) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not deactivate employee' });
    }
  });

  // ——— Salaries ———
  router.get('/salaries', requireSuperAdmin, async (req, res) => {
    try {
      const filter = {};
      const employeeId = req.query.employeeId;
      if (employeeId) {
        if (!mongoose.Types.ObjectId.isValid(employeeId)) {
          return res.status(400).json({ error: 'Invalid employeeId' });
        }
        filter.employeeId = employeeId;
      }
      const year = req.query.year;
      if (year !== undefined && year !== '') {
        filter.periodYear = Number(year);
      }
      const rows = await SalaryRecord.find(filter).sort({ periodYear: -1, periodMonth: -1 }).lean();
      res.json({ salaries: rows.map(formatSalary), total: rows.length });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not list salaries' });
    }
  });

  router.post('/salaries', requireSuperAdmin, async (req, res) => {
    try {
      const patch = parseSalaryInput(req.body || {}, { partial: false });
      const emp = await assertEmployeeExists(patch.employeeId);
      if (!emp) return res.status(404).json({ error: 'Employee not found' });
      patch.createdBy = req.user?.sub ? String(req.user.sub) : '';
      const doc = await SalaryRecord.create(patch);
      res.status(201).json({ salary: formatSalary(doc) });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ error: 'Salary record already exists for this employee and period' });
      }
      console.error(err);
      return hrError(res, err, 'Could not create salary record');
    }
  });

  router.get('/salaries/:id', requireSuperAdmin, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ error: 'Invalid salary id' });
      }
      const doc = await SalaryRecord.findById(req.params.id).lean();
      if (!doc) return res.status(404).json({ error: 'Not found' });
      res.json({ salary: formatSalary(doc) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not load salary record' });
    }
  });

  router.patch('/salaries/:id', requireSuperAdmin, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ error: 'Invalid salary id' });
      }
      const patch = parseSalaryInput(req.body || {}, { partial: true });
      if (patch.employeeId) {
        const emp = await assertEmployeeExists(patch.employeeId);
        if (!emp) return res.status(404).json({ error: 'Employee not found' });
      }
      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }
      const updated = await SalaryRecord.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true }).lean();
      if (!updated) return res.status(404).json({ error: 'Not found' });
      res.json({ salary: formatSalary(updated) });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ error: 'Salary record already exists for this employee and period' });
      }
      console.error(err);
      return hrError(res, err, 'Could not update salary record');
    }
  });

  router.delete('/salaries/:id', requireSuperAdmin, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ error: 'Invalid salary id' });
      }
      const deleted = await SalaryRecord.findByIdAndDelete(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Not found' });
      res.status(204).send();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not delete salary record' });
    }
  });

  // ——— Attendance ———
  router.get('/attendance', requireAttendanceAccess, async (req, res) => {
    try {
      const filter = {};
      const employeeId = req.query.employeeId;
      if (employeeId) {
        if (!mongoose.Types.ObjectId.isValid(employeeId)) {
          return res.status(400).json({ error: 'Invalid employeeId' });
        }
        filter.employeeId = employeeId;
      }
      const q = String(req.query.q || '').trim();
      if (q) {
        const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        const matched = await Employee.find({
          $or: [{ displayName: rx }, { employeeNumber: rx }, { email: rx }],
        })
          .select('_id')
          .lean();
        const ids = matched.map((e) => e._id);
        if (ids.length === 0) {
          return res.json({ attendance: [], total: 0 });
        }
        if (filter.employeeId) {
          const allowed = ids.some((id) => String(id) === String(filter.employeeId));
          if (!allowed) return res.json({ attendance: [], total: 0 });
        } else {
          filter.employeeId = { $in: ids };
        }
      }
      const dateRange = parseDateRangeQuery(req.query.from, req.query.to);
      if (dateRange) filter.date = dateRange;
      const rows = await AttendanceRecord.find(filter).sort({ date: -1 }).lean();
      res.json({ attendance: rows.map(formatAttendance), total: rows.length });
    } catch (err) {
      console.error(err);
      return hrError(res, err, 'Could not list attendance');
    }
  });

  router.post('/attendance', requireAttendanceAccess, async (req, res) => {
    try {
      const patch = parseAttendanceInput(req.body || {}, { partial: false });
      const emp = await assertEmployeeExists(patch.employeeId);
      if (!emp) return res.status(404).json({ error: 'Employee not found' });
      const doc = await AttendanceRecord.create(patch);
      res.status(201).json({ attendance: formatAttendance(doc) });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ error: 'Attendance already recorded for this employee and date' });
      }
      console.error(err);
      return hrError(res, err, 'Could not create attendance record');
    }
  });

  router.get('/attendance/:id', requireAttendanceAccess, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ error: 'Invalid attendance id' });
      }
      const doc = await AttendanceRecord.findById(req.params.id).lean();
      if (!doc) return res.status(404).json({ error: 'Not found' });
      res.json({ attendance: formatAttendance(doc) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not load attendance record' });
    }
  });

  router.patch('/attendance/:id', requireAttendanceAccess, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ error: 'Invalid attendance id' });
      }
      const patch = parseAttendanceInput(req.body || {}, { partial: true });
      if (patch.employeeId) {
        const emp = await assertEmployeeExists(patch.employeeId);
        if (!emp) return res.status(404).json({ error: 'Employee not found' });
      }
      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }
      const updated = await AttendanceRecord.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true }).lean();
      if (!updated) return res.status(404).json({ error: 'Not found' });
      res.json({ attendance: formatAttendance(updated) });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ error: 'Attendance already recorded for this employee and date' });
      }
      console.error(err);
      return hrError(res, err, 'Could not update attendance record');
    }
  });

  router.delete('/attendance/:id', requireAttendanceAccess, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ error: 'Invalid attendance id' });
      }
      const deleted = await AttendanceRecord.findByIdAndDelete(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Not found' });
      res.status(204).send();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not delete attendance record' });
    }
  });

  adminRouter.use(router);
}
