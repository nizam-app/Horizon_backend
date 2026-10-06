/** @param {string} isoDate YYYY-MM-DD */
export function mondayWeekStart(isoDate) {
  const s = String(isoDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error('weekStart is invalid');
  }
  const d = new Date(`${s}T12:00:00.000Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

export function weekStartToUtcDate(isoMonday) {
  const mon = mondayWeekStart(isoMonday);
  const d = new Date(`${mon}T00:00:00.000Z`);
  return d;
}

function isoDateOnly(s) {
  return String(s || '').slice(0, 10);
}

function payWeekEndIso(weekMondayIso) {
  const mon = mondayWeekStart(weekMondayIso);
  const d = new Date(`${mon}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

/** Whether a Mon–Sun pay week overlaps inclusive calendar range from/to (YYYY-MM-DD). */
export function payWeekOverlapsDateRange(weekMondayIso, from, to) {
  const week = mondayWeekStart(weekMondayIso);
  const weekEnd = payWeekEndIso(week);
  const f = from ? isoDateOnly(from) : null;
  const t = to ? isoDateOnly(to) : null;
  if (f && weekEnd < f) return false;
  if (t && week > t) return false;
  return true;
}

/** MongoDB weekStart bounds for pay weeks that overlap [from, to]. */
export function weekStartRangeOverlappingPeriod(from, to) {
  const f = isoDateOnly(from);
  const t = isoDateOnly(to);
  if (!f && !t) return null;
  const fromIso = f || t;
  const toIso = t || f;
  const minMonday = mondayWeekStart(fromIso);
  const maxMonday = mondayWeekStart(toIso);
  return {
    $gte: weekStartToUtcDate(minMonday),
    $lte: weekStartToUtcDate(maxMonday),
  };
}

function calendarDateRange(from, to) {
  const range = {};
  if (from) {
    const d = new Date(`${isoDateOnly(from)}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) return null;
    range.$gte = d;
  }
  if (to) {
    const d = new Date(`${isoDateOnly(to)}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) return null;
    d.setUTCHours(23, 59, 59, 999);
    range.$lte = d;
  }
  return Object.keys(range).length ? range : null;
}

/**
 * Mongo filter for salary payments visible in a payroll period (overlap pay week or pay date in range).
 */
export function buildPaymentPeriodFilter(from, to) {
  const f = from ? isoDateOnly(from) : '';
  const t = to ? isoDateOnly(to) : '';
  if (!f && !t) return null;
  const fromIso = f || t;
  const toIso = t || f;
  const weekBounds = weekStartRangeOverlappingPeriod(fromIso, toIso);
  const payDateRange = calendarDateRange(fromIso, toIso);
  const clauses = [];
  if (weekBounds) {
    clauses.push({ weekStart: { $ne: null, ...weekBounds } });
  }
  if (payDateRange) {
    clauses.push({ payDate: payDateRange });
  }
  if (clauses.length === 0) return null;
  if (clauses.length === 1) return clauses[0];
  return { $or: clauses };
}

function parseTimeMinutes(raw) {
  const m = String(raw || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** Strict clock: both times required and check-out after check-in (same day). */
export function hoursFromAttendanceRow(row) {
  const inM = parseTimeMinutes(row?.checkIn);
  const outM = parseTimeMinutes(row?.checkOut);
  if (inM === null || outM === null || outM <= inM) return 0;
  return (outM - inM) / 60;
}

export function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

function bucketKey(employeeId, weekStartIso) {
  return `${employeeId}|${weekStartIso}`;
}

function attendanceDateIso(row) {
  if (row.date) return String(row.date).slice(0, 10);
  if (row.date instanceof Date) return row.date.toISOString().slice(0, 10);
  return '';
}

/**
 * @param {{
 *   employees: Array<{ id: string, hourlyRate?: number, payCurrency?: string, displayName?: string, employeeNumber?: string }>,
 *   attendanceRows: Array<{ employeeId: string, date: string, checkIn?: string, checkOut?: string, status?: string, hourlyRateSnapshot?: number | null }>,
 *   payments: Array<{ employeeId: string, weekStart: string | null, amount: number, currency?: string }>,
 *   from?: string,
 *   to?: string,
 * }} input
 */
export function aggregateByEmployeeWeek(input) {
  const empMap = new Map();
  for (const e of input.employees || []) {
    empMap.set(String(e.id), {
      hourlyRate: Number(e.hourlyRate) || 0,
      payCurrency: e.payCurrency || 'AUD',
      displayName: e.displayName || '',
      employeeNumber: e.employeeNumber || '',
    });
  }

  const hoursByBucket = new Map();
  const earnedByBucket = new Map();
  /** @type {Map<string, Map<number, number>>} hours per applied rate (for display, not earned÷hours) */
  const rateHoursByBucket = new Map();
  for (const row of input.attendanceRows || []) {
    const dateIso = attendanceDateIso(row);
    if (!dateIso) continue;
    if (input.from && dateIso < input.from) continue;
    if (input.to && dateIso > input.to) continue;
    const week = mondayWeekStart(dateIso);
    const key = bucketKey(row.employeeId, week);
    const hrs = hoursFromAttendanceRow(row);
    hoursByBucket.set(key, (hoursByBucket.get(key) || 0) + hrs);
    const emp = empMap.get(String(row.employeeId));
    const rate =
      row.hourlyRateSnapshot !== null && row.hourlyRateSnapshot !== undefined
        ? Number(row.hourlyRateSnapshot)
        : Number(emp?.hourlyRate) || 0;
    earnedByBucket.set(key, roundMoney((earnedByBucket.get(key) || 0) + hrs * rate));
    if (hrs > 0) {
      const byRate = rateHoursByBucket.get(key) || new Map();
      byRate.set(rate, roundMoney((byRate.get(rate) || 0) + hrs));
      rateHoursByBucket.set(key, byRate);
    }
  }

  function displayHourlyRateForBucket(key, empHourlyRate) {
    const byRate = rateHoursByBucket.get(key);
    if (!byRate || byRate.size === 0) return empHourlyRate;
    let bestRate = empHourlyRate;
    let bestHrs = -1;
    for (const [rate, hrs] of byRate) {
      if (hrs > bestHrs) {
        bestHrs = hrs;
        bestRate = rate;
      }
    }
    return bestRate;
  }

  const paidByBucket = new Map();
  for (const p of input.payments || []) {
    if (!p.weekStart) continue;
    const week = mondayWeekStart(p.weekStart);
    if (!payWeekOverlapsDateRange(week, input.from, input.to)) continue;
    const key = bucketKey(p.employeeId, week);
    paidByBucket.set(key, roundMoney((paidByBucket.get(key) || 0) + Number(p.amount || 0)));
  }

  const keys = new Set([...earnedByBucket.keys(), ...hoursByBucket.keys(), ...paidByBucket.keys()]);
  const rows = [];
  for (const key of keys) {
    const [employeeId, weekStart] = key.split('|');
    const emp = empMap.get(employeeId) || { hourlyRate: 0, payCurrency: 'AUD', displayName: '', employeeNumber: '' };
    const hours = roundMoney(hoursByBucket.get(key) || 0);
    const earned = earnedByBucket.get(key) || 0;
    const hourlyRate = displayHourlyRateForBucket(key, emp.hourlyRate);
    const paid = paidByBucket.get(key) || 0;
    const pending = roundMoney(Math.max(0, earned - paid));
    rows.push({
      employeeId,
      employeeNumber: emp.employeeNumber,
      displayName: emp.displayName,
      weekStart,
      hours,
      hourlyRate,
      currency: '$',
      earned,
      paid,
      pending,
    });
  }

  rows.sort((a, b) => {
    if (a.weekStart !== b.weekStart) return a.weekStart < b.weekStart ? 1 : -1;
    return (a.displayName || '').localeCompare(b.displayName || '');
  });

  const totals = rows.reduce(
    (acc, r) => {
      acc.hours = roundMoney(acc.hours + r.hours);
      acc.earned = roundMoney(acc.earned + r.earned);
      acc.paid = roundMoney(acc.paid + r.paid);
      acc.pending = roundMoney(acc.pending + r.pending);
      return acc;
    },
    { hours: 0, earned: 0, paid: 0, pending: 0 }
  );

  return { rows, totals };
}

/** Roll up pay-week rows into one line per employee for a filtered date period. */
export function aggregateByEmployeePeriod(weekAgg) {
  const byEmp = new Map();
  for (const row of weekAgg.rows || []) {
    let cur = byEmp.get(row.employeeId);
    if (!cur) {
      cur = {
        employeeId: row.employeeId,
        employeeNumber: row.employeeNumber,
        displayName: row.displayName,
        hours: 0,
        hourlyRate: row.hourlyRate,
        currency: row.currency || '$',
        earned: 0,
        paid: 0,
      };
      byEmp.set(row.employeeId, cur);
    }
    cur.hours = roundMoney(cur.hours + row.hours);
    cur.earned = roundMoney(cur.earned + row.earned);
    cur.paid = roundMoney(cur.paid + row.paid);
    if (row.hours > (cur._bestHrs || 0)) {
      cur._bestHrs = row.hours;
      cur.hourlyRate = row.hourlyRate;
    }
  }
  const rows = [];
  for (const cur of byEmp.values()) {
    cur.pending = roundMoney(Math.max(0, cur.earned - cur.paid));
    delete cur._bestHrs;
    rows.push(cur);
  }
  rows.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
  const totals = rows.reduce(
    (acc, r) => {
      acc.hours = roundMoney(acc.hours + r.hours);
      acc.earned = roundMoney(acc.earned + r.earned);
      acc.paid = roundMoney(acc.paid + r.paid);
      acc.pending = roundMoney(acc.pending + r.pending);
      return acc;
    },
    { hours: 0, earned: 0, paid: 0, pending: 0 }
  );
  return { rows, totals };
}

export function attendanceStatementRows(attendanceRows, employeeById) {
  return (attendanceRows || []).map((row) => {
    const emp = employeeById.get(String(row.employeeId)) || {};
    const hours = roundMoney(hoursFromAttendanceRow(row));
    return {
      date: attendanceDateIso(row),
      employeeNumber: emp.employeeNumber || '',
      displayName: emp.displayName || row.employeeId,
      status: row.status || '',
      checkIn: row.checkIn || '',
      checkOut: row.checkOut || '',
      hours,
    };
  });
}

function csvEscape(val) {
  const s = String(val ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function rowsToCsv(headers, rows) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  return lines.join('\r\n');
}

export function attendanceStatementCsv(statementRows) {
  const headers = ['date', 'employeeNumber', 'displayName', 'status', 'checkIn', 'checkOut', 'hours'];
  return rowsToCsv(headers, statementRows);
}

export function payrollStatementCsv(summaryRows, paymentLines) {
  const summaryHeaders = [
    'weekStart',
    'employeeNumber',
    'displayName',
    'hours',
    'hourlyRate',
    'currency',
    'earned',
    'paid',
    'pending',
  ];
  const summaryForCsv = (summaryRows || []).map((r) => ({ ...r, currency: '$' }));
  const paymentsForCsv = (paymentLines || []).map((r) => ({ ...r, currency: '$' }));
  const parts = ['Summary', rowsToCsv(summaryHeaders, summaryForCsv), '', 'Payments'];
  const payHeaders = ['weekStart', 'employeeNumber', 'displayName', 'payDate', 'amount', 'currency', 'notes'];
  parts.push(rowsToCsv(payHeaders, paymentsForCsv));
  return parts.join('\r\n');
}
