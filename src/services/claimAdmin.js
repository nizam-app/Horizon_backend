import mongoose from 'mongoose';

/** Matches horizon-admin-app `normalizePaymentStatus`. */
export function normalizePaymentStatus(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'completed') return 'completed';
  if (s === 'payment' || s === 'received' || s === 'approved') return 'completed';
  return 'pending';
}

function newPartId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Aligns admin UI `parts` lines. */
export function sanitizeParts(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 200).map((p) => {
    const o = p && typeof p === 'object' ? p : {};
    const amount = typeof o.amount === 'number' && !Number.isNaN(o.amount) ? o.amount : Number(o.amount) || 0;
    const status = String(o.status || 'pending').toLowerCase() === 'completed' ? 'completed' : 'pending';
    return {
      id: String(o.id || '').trim() || newPartId(),
      company: String(o.company ?? '').trim().slice(0, 300),
      amount,
      status,
      notes: String(o.notes ?? '').trim().slice(0, 4000),
    };
  });
}

export function sanitizeQuoteOptions(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 50).map((row) => {
    const q = row && typeof row === 'object' ? row : {};
    const amount = typeof q.amount === 'number' && !Number.isNaN(q.amount) ? q.amount : Number(q.amount);
    const supplier = String(q.supplier ?? '').trim().slice(0, 300);
    return {
      _id:
        mongoose.Types.ObjectId.isValid(String(q.id || q._id || ''))
          ? new mongoose.Types.ObjectId(String(q.id || q._id))
          : new mongoose.Types.ObjectId(),
      supplier: supplier || 'Unnamed supplier',
      amount: Number.isFinite(amount) ? amount : 0,
      reference: String(q.reference ?? '').trim().slice(0, 120),
    };
  });
}

/** Admin demo stores lightweight PDF refs in caseFiles — keep permissive but bounded. */
export function sanitizeCaseFiles(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 100).map((row, idx) => {
    const f = row && typeof row === 'object' ? row : {};
    return {
      id: String(f.id || '').trim() || `file-${idx}-${Date.now()}`,
      name: String(f.name ?? '').slice(0, 512),
      size: typeof f.size === 'number' && f.size >= 0 ? Math.min(f.size, 50000000) : 0,
      uploadedAt: String(f.uploadedAt ?? '').slice(0, 32),
      url: String(f.url ?? '').slice(0, 200000),
    };
  });
}

export function sanitizeAdminNote(raw) {
  const s = String(raw ?? '').trim();
  return s.slice(0, 20000);
}

/**
 * Normalize a claim document for API JSON (matches admin app shapes: string ids on quote rows).
 */
export function formatClaimForApi(c) {
  if (!c) return null;
  const quoteOptions = (c.quoteOptions || []).map((q) => ({
    id: q._id?.toString(),
    supplier: q.supplier,
    amount: q.amount,
    reference: q.reference,
  }));
  return {
    ...c,
    id: c._id,
    quoteOptions,
    primaryQuoteId: c.primaryQuoteId?.toString() || null,
    finalQuoteId: c.finalQuoteId?.toString() || null,
    paymentStatus: normalizePaymentStatus(c.paymentStatus),
    adminNote: c.adminNote ?? '',
    parts: Array.isArray(c.parts) ? c.parts : [],
    caseFiles: (c.caseFiles || []).map((f) => ({
      id: f.id,
      name: f.name || '',
      size: typeof f.size === 'number' ? f.size : 0,
      uploadedAt: f.uploadedAt || '',
      url: f.url || '',
      dataUrl: f.dataUrl,
    })),
  };
}

export function formatClaimListItem(c) {
  const full = formatClaimForApi(c);
  if (!full) return null;
  const partsArr = Array.isArray(full.parts) ? full.parts : [];
  return {
    id: full._id,
    reference: full.reference,
    intakeReference: full.intakeReference,
    status: full.status,
    priority: full.priority,
    plateNumber: full.plateNumber,
    driverName: full.driverName,
    dateOfIncident: full.dateOfIncident,
    submittedAt: full.submittedAt,
    summary: full.summary,
    paymentStatus: full.paymentStatus,
    partsCount: partsArr.length,
    quoteOptions: full.quoteOptions,
    primaryQuoteId: full.primaryQuoteId,
    finalQuoteId: full.finalQuoteId,
    createdAt: full.createdAt,
    updatedAt: full.updatedAt,
  };
}
