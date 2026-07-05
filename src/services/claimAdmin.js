export const CLAIM_DISPOSITION_STATUSES = [
  'Pending Review',
  'Approved',
  'Rejected',
  'Litigation',
  'Recovery',
];

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

function sanitizePartDate(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function newPartInvoiceId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `inv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Normalize invoice rows on a purchase line (supports legacy single-file fields). */
export function normalizePartInvoices(o) {
  const part = o && typeof o === 'object' ? o : {};
  if (Array.isArray(part.invoices) && part.invoices.length > 0) {
    return part.invoices.slice(0, 30).map((inv) => {
      const row = inv && typeof inv === 'object' ? inv : {};
      const fileId = row.fileId == null || row.fileId === '' ? null : String(row.fileId).trim().slice(0, 80);
      return {
        id: String(row.id || '').trim() || newPartInvoiceId(),
        invoiceNumber: String(row.invoiceNumber ?? '').trim().slice(0, 120),
        fileId,
        fileName: String(row.fileName ?? '').trim().slice(0, 512),
        fileUrl: String(row.fileUrl ?? '').trim().slice(0, 2000),
      };
    });
  }
  if (part.invoiceFileId || part.invoiceNumber || part.invoiceFileName) {
    const fileId =
      part.invoiceFileId == null || part.invoiceFileId === '' ? null : String(part.invoiceFileId).trim().slice(0, 80);
    return [
      {
        id: newPartInvoiceId(),
        invoiceNumber: String(part.invoiceNumber ?? '').trim().slice(0, 120),
        fileId,
        fileName: String(part.invoiceFileName ?? '').trim().slice(0, 512),
        fileUrl: String(part.invoiceFileUrl ?? '').trim().slice(0, 2000),
      },
    ];
  }
  return [];
}

function mirrorLegacyInvoiceFields(invoices) {
  const first = invoices[0];
  return {
    invoiceNumber: first?.invoiceNumber ?? '',
    invoiceFileId: first?.fileId ?? null,
    invoiceFileName: first?.fileName ?? '',
    invoiceFileUrl: first?.fileUrl ?? '',
  };
}

/** Aligns admin UI `parts` lines (Purchase tab). */
export function sanitizeParts(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 200).map((p) => {
    const o = p && typeof p === 'object' ? p : {};
    const amount = typeof o.amount === 'number' && !Number.isNaN(o.amount) ? o.amount : Number(o.amount) || 0;
    const quotePrice = sanitizeMoneyAmount(o.quotePrice);
    const status = String(o.status || 'pending').toLowerCase() === 'completed' ? 'completed' : 'pending';
    const invoices = normalizePartInvoices(o);
    return {
      id: String(o.id || '').trim() || newPartId(),
      company: String(o.company ?? '').trim().slice(0, 300),
      partName: String(o.partName ?? '').trim().slice(0, 300),
      amount,
      quotePrice,
      orderDate: sanitizePartDate(o.orderDate),
      tentativeReceivedDate: sanitizePartDate(o.tentativeReceivedDate),
      receivedBy: String(o.receivedBy ?? '').trim().slice(0, 200),
      invoices,
      ...mirrorLegacyInvoiceFields(invoices),
      status,
      notes: String(o.notes ?? '').trim().slice(0, 4000),
    };
  });
}

function newQuoteRowId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `quote-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function sanitizeMoneyAmount(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function sanitizeQuoteOptions(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 50).map((row) => {
    const q = row && typeof row === 'object' ? row : {};
    const amount = typeof q.amount === 'number' && !Number.isNaN(q.amount) ? q.amount : Number(q.amount);
    const supplier = String(q.supplier ?? '').trim().slice(0, 300);
    const legacyId = q._id?.toString?.() || (typeof q._id === 'string' ? q._id : '');
    const id = String(q.id || legacyId || '').trim() || newQuoteRowId();
    return {
      id,
      supplier: supplier || 'Unnamed supplier',
      amount: Number.isFinite(amount) ? amount : 0,
      reference: String(q.reference ?? '').trim().slice(0, 120),
      notes: String(q.notes ?? '').trim().slice(0, 4000),
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

export function mongoIdString(raw) {
  if (raw == null) return '';
  if (typeof raw === 'string') {
    const s = raw.trim();
    return /^[a-f\d]{24}$/i.test(s) ? s : '';
  }
  if (typeof raw === 'object') {
    if (typeof raw.toHexString === 'function') {
      const hex = raw.toHexString();
      if (/^[a-f\d]{24}$/i.test(hex)) return hex;
    }
    if (typeof raw.toString === 'function') {
      const s = raw.toString();
      if (/^[a-f\d]{24}$/i.test(s)) return s;
    }
  }
  return '';
}

function arrayOrEmpty(raw) {
  return Array.isArray(raw) ? raw : [];
}

/**
 * Normalize a claim document for API JSON (matches admin app shapes: string ids on quote rows).
 */
export function formatClaimForApi(c) {
  if (!c) return null;
  const quoteOptions = arrayOrEmpty(c.quoteOptions).map((q) => {
    const row = q && typeof q === 'object' ? q : {};
    return {
      id: row.id || row._id?.toString?.() || '',
      supplier: row.supplier || '',
      amount: typeof row.amount === 'number' && Number.isFinite(row.amount) ? row.amount : Number(row.amount) || 0,
      reference: row.reference || '',
      notes: row.notes ?? '',
    };
  });
  const claimId = mongoIdString(c._id);
  return {
    ...c,
    _id: claimId || c._id,
    id: claimId,
    quotePrice: c.quotePrice ?? null,
    insuranceApprovedPrice: c.insuranceApprovedPrice ?? null,
    quoteOptions,
    primaryQuoteId: c.primaryQuoteId ? String(c.primaryQuoteId) : null,
    finalQuoteId: c.finalQuoteId ? String(c.finalQuoteId) : null,
    paymentStatus: normalizePaymentStatus(c.paymentStatus),
    adminNote: c.adminNote ?? '',
    parts: arrayOrEmpty(c.parts),
    caseFiles: arrayOrEmpty(c.caseFiles).map((f) => {
      const row = f && typeof f === 'object' ? f : {};
      return {
        id: row.id || row._id?.toString?.() || '',
        name: row.name || row.originalName || '',
        size: typeof row.size === 'number' ? row.size : 0,
        uploadedAt: row.uploadedAt || row.createdAt || '',
        url: row.url || '',
        dataUrl: row.dataUrl,
      };
    }),
  };
}

export function formatClaimListItem(c) {
  const full = formatClaimForApi(c);
  if (!full) return null;
  const partsArr = Array.isArray(full.parts) ? full.parts : [];
  return {
    id: full.id || mongoIdString(full._id),
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
    quotePrice: full.quotePrice,
    insuranceApprovedPrice: full.insuranceApprovedPrice,
    quoteOptions: full.quoteOptions,
    primaryQuoteId: full.primaryQuoteId,
    finalQuoteId: full.finalQuoteId,
    adminNote: full.adminNote,
    parts: full.parts,
    caseFiles: full.caseFiles,
    data: full.data,
    payload: full.payload,
    createdAt: full.createdAt,
    updatedAt: full.updatedAt,
  };
}
