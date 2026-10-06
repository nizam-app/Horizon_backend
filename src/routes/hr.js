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
import {
  aggregateByEmployeePeriod,
  aggregateByEmployeeWeek,
  attendanceStatementCsv,
  attendanceStatementRows,
  buildPaymentPeriodFilter,
  mondayWeekStart,
  payrollStatementCsv,
  weekStartToUtcDate,
} from '../services/payroll.js';

function hrError(res, err, fallback = 'Request failed') {
  const msg = err?.message || fallback;
  if (msg.includes('required') || msg.includes('invalid') || msg.includes('must')) {
    return res.status(400).json({ error: msg });
  }
  return res.status(500).json({ error: fallback });
}

async function buildAttendanceMongoFilter(query) {
  const filter = {};
  const employeeId = query.employeeId;
  if (employeeId) {
    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      throw new Error('Invalid employeeId');
    }
    filter.employeeId = employeeId;
  }
  const q = String(query.q || '').trim();
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const matched = await Employee.find({
      $or: [{ displayName: rx }, { employeeNumber: rx }, { email: rx }],
    })
      .select('_id')
      .lean();
    const ids = matched.map((e) => e._id);
    if (ids.length === 0) return { empty: true, filter };
    if (filter.employeeId) {
      const allowed = ids.some((id) => String(id) === String(filter.employeeId));
      if (!allowed) return { empty: true, filter };
    } else {
      filter.employeeId = { $in: ids };
    }
  }
  const dateRange = parseDateRangeQuery(query.from, query.to);
  if (dateRange) filter.date = dateRange;
  return { empty: false, filter };
}

async function loadPayrollContext({ from, to, employeeId }) {
  const empFilter = {};
  if (employeeId) {
    if (!mongoose.Types.ObjectId.isValid(employeeId)) throw new Error('Invalid employeeId');
    empFilter._id = employeeId;
  }
  const employees = await Employee.find(empFilter).sort({ displayName: 1 }).lean();
  const empIds = employees.map((e) => e._id);

  const attFilter = { employeeId: { $in: empIds } };
  const attDateRange = parseDateRangeQuery(from, to);
  if (attDateRange) attFilter.date = attDateRange;

  const payFilter = { employeeId: { $in: empIds } };
  const periodPayFilter = buildPaymentPeriodFilter(from, to);
  if (periodPayFilter) {
    Object.assign(payFilter, periodPayFilter);
  } else {
    payFilter.weekStart = { $ne: null };
  }

  const [attendanceRows, paymentDocs] = await Promise.all([
    empIds.length ? AttendanceRecord.find(attFilter).lean() : [],
    empIds.length ? SalaryRecord.find(payFilter).lean() : [],
  ]);

  const formattedEmployees = employees.map(formatEmployee);
  const formattedAttendance = attendanceRows.map(formatAttendance);
  const payments = paymentDocs.map((doc) => ({
    employeeId: doc.employeeId?.toString?.() ?? String(doc.employeeId),
    weekStart: doc.weekStart ? new Date(doc.weekStart).toISOString().slice(0, 10) : null,
    amount: doc.amount,
    currency: doc.currency,
  }));

  const byWeek = aggregateByEmployeeWeek({
    employees: formattedEmployees,
    attendanceRows: formattedAttendance,
    payments,
    from: from || undefined,
    to: to || undefined,
  });
  const summary = aggregateByEmployeePeriod(byWeek);

  return { employees: formattedEmployees, payments: paymentDocs, summary, byWeek };
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
      if (patch.hourlyRate === undefined) {
        return res.status(400).json({ error: 'hourlyRate is required' });
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
      const weekStart = req.query.weekStart;
      if (weekStart) {
        const mon = mondayWeekStart(String(weekStart).slice(0, 10));
        filter.weekStart = weekStartToUtcDate(mon);
      } else {
        const periodFilter = buildPaymentPeriodFilter(req.query.from, req.query.to);
        if (periodFilter) Object.assign(filter, periodFilter);
      }
      const year = req.query.year;
      if (year !== undefined && year !== '') {
        filter.periodYear = Number(year);
      }
      const rows = await SalaryRecord.find(filter).sort({ weekStart: -1, createdAt: -1 }).lean();
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
      patch.currency = 'AUD';
      patch.createdBy = req.user?.sub ? String(req.user.sub) : '';
      const doc = await SalaryRecord.create(patch);
      res.status(201).json({ salary: formatSalary(doc) });
    } catch (err) {
      console.error(err);
      return hrError(res, err, 'Could not create salary record');
    }
  });

  router.get('/payroll/summary', requireSuperAdmin, async (req, res) => {
    try {
      const from = req.query.from ? String(req.query.from).slice(0, 10) : '';
      const to = req.query.to ? String(req.query.to).slice(0, 10) : '';
      const employeeId = req.query.employeeId || '';
      const { summary, byWeek } = await loadPayrollContext({ from, to, employeeId });
      res.json({
        summary: summary.rows,
        totals: summary.totals,
        byWeek: byWeek.rows,
      });
    } catch (err) {
      console.error(err);
      return hrError(res, err, 'Could not load payroll summary');
    }
  });

  router.get('/statements/attendance', requireAttendanceAccess, async (req, res) => {
    try {
      const built = await buildAttendanceMongoFilter(req.query);
      if (built.empty) {
        if (req.query.format === 'csv') {
          res.setHeader('Content-Type', 'text/csv; charset=utf-8');
          res.setHeader('Content-Disposition', 'attachment; filename="attendance-statement.csv"');
          return res.send(attendanceStatementCsv([]));
        }
        return res.json({ rows: [], total: 0 });
      }
      const rows = await AttendanceRecord.find(built.filter).sort({ date: -1 }).lean();
      const empIds = [...new Set(rows.map((r) => String(r.employeeId)))];
      const employees = await Employee.find({ _id: { $in: empIds } }).lean();
      const employeeById = new Map(employees.map((e) => [e._id.toString(), formatEmployee(e)]));
      const statementRows = attendanceStatementRows(rows.map(formatAttendance), employeeById);
      if (req.query.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="attendance-statement.csv"');
        return res.send(attendanceStatementCsv(statementRows));
      }
      res.json({ rows: statementRows, total: statementRows.length });
    } catch (err) {
      console.error(err);
      return hrError(res, err, 'Could not build attendance statement');
    }
  });

  router.get('/statements/payroll', requireSuperAdmin, async (req, res) => {
    try {
      const from = req.query.from ? String(req.query.from).slice(0, 10) : '';
      const to = req.query.to ? String(req.query.to).slice(0, 10) : '';
      const employeeId = req.query.employeeId || '';
      const { employees, payments, summary, byWeek } = await loadPayrollContext({ from, to, employeeId });
      const empById = new Map(employees.map((e) => [e.id, e]));
      const paymentLines = payments.map((doc) => {
        const emp = empById.get(doc.employeeId?.toString?.() ?? String(doc.employeeId)) || {};
        return {
          weekStart: doc.weekStart ? new Date(doc.weekStart).toISOString().slice(0, 10) : '',
          employeeNumber: emp.employeeNumber || '',
          displayName: emp.displayName || '',
          payDate: doc.payDate ? new Date(doc.payDate).toISOString().slice(0, 10) : '',
          amount: doc.amount,
          currency: '$',
          notes: doc.notes || '',
        };
      });
      if (req.query.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="payroll-statement.csv"');
        return res.send(payrollStatementCsv(byWeek.rows, paymentLines));
      }
      res.json({ summary: summary.rows, totals: summary.totals, byWeek: byWeek.rows, payments: paymentLines });
    } catch (err) {
      console.error(err);
      return hrError(res, err, 'Could not build payroll statement');
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
      const built = await buildAttendanceMongoFilter(req.query);
      if (built.empty) return res.json({ attendance: [], total: 0 });
      const rows = await AttendanceRecord.find(built.filter).sort({ date: -1 }).lean();
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
      patch.hourlyRateSnapshot = emp.hourlyRate ?? 0;
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
