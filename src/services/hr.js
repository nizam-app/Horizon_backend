import mongoose from 'mongoose';
import { Employee } from '../models/Employee.js';
import { ATTENDANCE_STATUSES_LIST } from '../models/AttendanceRecord.js';
import { mondayWeekStart, weekStartToUtcDate } from './payroll.js';

export function formatEmployee(doc) {
  return {
    id: doc._id.toString(),
    employeeNumber: doc.employeeNumber,
    displayName: doc.displayName,
    email: doc.email ?? '',
    phone: doc.phone ?? '',
    department: doc.department ?? '',
    jobTitle: doc.jobTitle ?? '',
    hireDate: doc.hireDate ? new Date(doc.hireDate).toISOString() : null,
    status: doc.status ?? 'active',
    hourlyRate: doc.hourlyRate ?? 0,
    payCurrency: doc.payCurrency ?? 'AUD',
    metadata: doc.metadata && typeof doc.metadata === 'object' ? doc.metadata : {},
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export function formatSalary(doc) {
  const ws = doc.weekStart ? new Date(doc.weekStart).toISOString().slice(0, 10) : null;
  return {
    id: doc._id.toString(),
    employeeId: doc.employeeId?.toString?.() ?? String(doc.employeeId),
    weekStart: ws,
    periodYear: doc.periodYear ?? null,
    periodMonth: doc.periodMonth ?? null,
    amount: doc.amount,
    currency: doc.currency ?? 'AUD',
    payDate: doc.payDate ? new Date(doc.payDate).toISOString() : null,
    notes: doc.notes ?? '',
    createdBy: doc.createdBy ?? '',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export function formatAttendance(doc) {
  const d = doc.date ? new Date(doc.date) : null;
  const dateOnly = d ? d.toISOString().slice(0, 10) : null;
  return {
    id: doc._id.toString(),
    employeeId: doc.employeeId?.toString?.() ?? String(doc.employeeId),
    date: dateOnly,
    status: doc.status,
    checkIn: doc.checkIn ?? '',
    checkOut: doc.checkOut ?? '',
    hourlyRateSnapshot:
      doc.hourlyRateSnapshot !== null && doc.hourlyRateSnapshot !== undefined
        ? Number(doc.hourlyRateSnapshot)
        : null,
    notes: doc.notes ?? '',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export function parseEmployeeInput(body) {
  const out = {};
  if (body.employeeNumber !== undefined) {
    out.employeeNumber = String(body.employeeNumber).trim();
    if (!out.employeeNumber) throw new Error('employeeNumber cannot be empty');
  }
  if (body.displayName !== undefined) {
    out.displayName = String(body.displayName).trim();
    if (!out.displayName) throw new Error('displayName cannot be empty');
  }
  if (body.email !== undefined) out.email = String(body.email).trim().toLowerCase();
  if (body.phone !== undefined) out.phone = String(body.phone).trim();
  if (body.department !== undefined) out.department = String(body.department).trim();
  if (body.jobTitle !== undefined) out.jobTitle = String(body.jobTitle).trim();
  if (body.hireDate !== undefined) {
    if (body.hireDate === null || body.hireDate === '') out.hireDate = null;
    else {
      const d = new Date(body.hireDate);
      if (Number.isNaN(d.getTime())) throw new Error('hireDate is invalid');
      out.hireDate = d;
    }
  }
  if (body.status !== undefined) {
    if (!['active', 'inactive'].includes(body.status)) throw new Error('status must be active or inactive');
    out.status = body.status;
  }
  if (body.metadata !== undefined && body.metadata !== null && typeof body.metadata === 'object') {
    out.metadata = body.metadata;
  }
  if (body.hourlyRate !== undefined) {
    out.hourlyRate = Number(body.hourlyRate);
    if (Number.isNaN(out.hourlyRate) || out.hourlyRate < 0) throw new Error('hourlyRate must be a non-negative number');
  }
  if (body.payCurrency !== undefined) out.payCurrency = String(body.payCurrency).trim() || 'AUD';
  return out;
}

export async function assertEmployeeExists(employeeId) {
  if (!mongoose.Types.ObjectId.isValid(employeeId)) return null;
  const emp = await Employee.findById(employeeId).lean();
  return emp;
}

export function parseSalaryInput(body, { partial = false } = {}) {
  const out = {};
  if (body.employeeId !== undefined) {
    if (!mongoose.Types.ObjectId.isValid(body.employeeId)) throw new Error('employeeId is invalid');
    out.employeeId = body.employeeId;
  } else if (!partial) throw new Error('employeeId is required');

  let weekIso = null;
  if (body.weekStart !== undefined && body.weekStart !== null && body.weekStart !== '') {
    weekIso = mondayWeekStart(String(body.weekStart).slice(0, 10));
    out.weekStart = weekStartToUtcDate(weekIso);
    const d = new Date(`${weekIso}T12:00:00.000Z`);
    out.periodYear = d.getUTCFullYear();
    out.periodMonth = d.getUTCMonth() + 1;
  } else if (!partial) {
    if (body.payDate) {
      weekIso = mondayWeekStart(String(body.payDate).slice(0, 10));
      out.weekStart = weekStartToUtcDate(weekIso);
      const d = new Date(`${weekIso}T12:00:00.000Z`);
      out.periodYear = d.getUTCFullYear();
      out.periodMonth = d.getUTCMonth() + 1;
    } else {
      throw new Error('weekStart is required');
    }
  }

  if (body.periodYear !== undefined) {
    out.periodYear = Number(body.periodYear);
    if (!Number.isInteger(out.periodYear)) throw new Error('periodYear must be an integer');
  }
  if (body.periodMonth !== undefined) {
    out.periodMonth = Number(body.periodMonth);
    if (!Number.isInteger(out.periodMonth) || out.periodMonth < 1 || out.periodMonth > 12) {
      throw new Error('periodMonth must be 1–12');
    }
  }

  if (body.amount !== undefined) {
    out.amount = Number(body.amount);
    if (Number.isNaN(out.amount) || out.amount < 0) throw new Error('amount must be a non-negative number');
    if (!partial && out.amount <= 0) throw new Error('amount must be greater than zero');
  } else if (!partial) throw new Error('amount is required');
  if (body.currency !== undefined) out.currency = String(body.currency).trim() || 'AUD';
  if (body.payDate !== undefined) {
    if (body.payDate === null || body.payDate === '') out.payDate = null;
    else {
      const d = new Date(body.payDate);
      if (Number.isNaN(d.getTime())) throw new Error('payDate is invalid');
      out.payDate = d;
    }
  }
  if (body.notes !== undefined) out.notes = String(body.notes).trim();
  return out;
}

export function parseAttendanceInput(body, { partial = false } = {}) {
  const out = {};
  if (body.employeeId !== undefined) {
    if (!mongoose.Types.ObjectId.isValid(body.employeeId)) throw new Error('employeeId is invalid');
    out.employeeId = body.employeeId;
  } else if (!partial) throw new Error('employeeId is required');
  if (body.date !== undefined) {
    const d = new Date(String(body.date).slice(0, 10));
    if (Number.isNaN(d.getTime())) throw new Error('date is invalid');
    d.setUTCHours(0, 0, 0, 0);
    out.date = d;
  } else if (!partial) throw new Error('date is required');
  if (body.status !== undefined) {
    if (!ATTENDANCE_STATUSES_LIST.includes(body.status)) {
      throw new Error(`status must be one of: ${ATTENDANCE_STATUSES_LIST.join(', ')}`);
    }
    out.status = body.status;
  } else if (!partial) throw new Error('status is required');
  if (body.checkIn !== undefined) out.checkIn = String(body.checkIn).trim();
  if (body.checkOut !== undefined) out.checkOut = String(body.checkOut).trim();
  if (body.notes !== undefined) out.notes = String(body.notes).trim();
  return out;
}

export function parseDateRangeQuery(from, to) {
  const range = {};
  if (from) {
    const d = new Date(String(from).slice(0, 10));
    if (Number.isNaN(d.getTime())) throw new Error('from date is invalid');
    d.setUTCHours(0, 0, 0, 0);
    range.$gte = d;
  }
  if (to) {
    const d = new Date(String(to).slice(0, 10));
    if (Number.isNaN(d.getTime())) throw new Error('to date is invalid');
    d.setUTCHours(23, 59, 59, 999);
    range.$lte = d;
  }
  return Object.keys(range).length ? range : null;
}
