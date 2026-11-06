import mongoose from 'mongoose';
import { Claim } from '../models/Claim.js';
import { CashPartJob } from '../models/CashPartJob.js';
import { canViewParts } from '../auth/roles.js';
import { sanitizeParts, normalizePartInvoices } from './claimAdmin.js';
import { resolveClaimMongoId } from './claimResolve.js';

function mongoIdString(id) {
  if (!id) return '';
  return id.toString?.() ?? String(id);
}

export function customerNameFromClaim(claim) {
  const data = claim?.data && typeof claim.data === 'object' ? claim.data : {};
  const owner = String(data?.memberVehicle?.ownerName ?? '').trim();
  if (owner) return owner;
  return String(claim?.driverName ?? '').trim();
}

export function partHasInvoice(part) {
  const p = part && typeof part === 'object' ? part : {};
  const invoices = normalizePartInvoices(p);
  if (invoices.some((inv) => inv.fileId)) return true;
  return Boolean(p.invoiceFileId);
}

export function invoiceCountForPart(part) {
  const p = part && typeof part === 'object' ? part : {};
  const invoices = normalizePartInvoices(p);
  return invoices.length;
}

export function flattenPartRow(claim, part) {
  const claimId = mongoIdString(claim._id);
  const p = part && typeof part === 'object' ? part : {};
  const partId = String(p.id || '').trim();
  const amount = typeof p.amount === 'number' && !Number.isNaN(p.amount) ? p.amount : Number(p.amount) || 0;
  const status = String(p.status || 'pending').toLowerCase() === 'completed' ? 'completed' : 'pending';
  return {
    jobType: 'claim',
    jobId: '',
    claimId,
    partId,
    claimReference: claim.reference || '',
    intakeReference: claim.intakeReference || '',
    plateNumber: claim.plateNumber || '',
    customerName: customerNameFromClaim(claim),
    supplier: String(p.company ?? '').trim(),
    partName: String(p.partName ?? '').trim(),
    amount,
    status,
    hasInvoice: partHasInvoice(p),
    invoiceCount: invoiceCountForPart(p),
    orderDate: String(p.orderDate ?? '').trim(),
    tentativeReceivedDate: String(p.tentativeReceivedDate ?? '').trim(),
    claimStatus: claim.status || '',
    updatedAt: claim.updatedAt ? new Date(claim.updatedAt).toISOString() : null,
    part: p,
  };
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildClaimMatch({ q, claimId }) {
  const match = { 'parts.0': { $exists: true } };
  if (claimId) {
    if (!mongoose.Types.ObjectId.isValid(claimId)) {
      return { error: 'Invalid claimId' };
    }
    match._id = new mongoose.Types.ObjectId(claimId);
  }
  const term = String(q || '').trim();
  if (term) {
    const rx = new RegExp(escapeRegex(term), 'i');
    match.$or = [
      { reference: rx },
      { intakeReference: rx },
      { plateNumber: rx },
      { driverName: rx },
      { 'data.memberVehicle.ownerName': rx },
      { 'parts.company': rx },
      { 'parts.partName': rx },
    ];
  }
  return { match };
}

function parseIsoDateParam(raw) {
  const s = String(raw ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function buildPartMatch({ status, supplier, hasInvoice, receivedFrom, receivedTo }) {
  const partMatch = {};
  const st = String(status || '').trim().toLowerCase();
  if (st === 'pending' || st === 'completed') partMatch['parts.status'] = st;
  const from = parseIsoDateParam(receivedFrom);
  const to = parseIsoDateParam(receivedTo);
  if (from && to) partMatch['parts.tentativeReceivedDate'] = { $gte: from, $lte: to };
  else if (from) partMatch['parts.tentativeReceivedDate'] = { $gte: from };
  else if (to) partMatch['parts.tentativeReceivedDate'] = { $lte: to };
  const sup = String(supplier || '').trim();
  if (sup) partMatch['parts.company'] = new RegExp(escapeRegex(sup), 'i');
  if (hasInvoice === 'true' || hasInvoice === '1') {
    partMatch.$or = [
      { 'parts.invoices': { $elemMatch: { fileId: { $nin: [null, ''] } } } },
      { 'parts.invoiceFileId': { $nin: [null, ''] } },
    ];
  } else if (hasInvoice === 'false' || hasInvoice === '0') {
    partMatch.$and = [
      {
        $or: [
          { 'parts.invoices': { $exists: false } },
          { 'parts.invoices': { $size: 0 } },
          { 'parts.invoices': { $not: { $elemMatch: { fileId: { $nin: [null, ''] } } } } },
        ],
      },
      { $or: [{ 'parts.invoiceFileId': null }, { 'parts.invoiceFileId': '' }, { 'parts.invoiceFileId': { $exists: false } }] },
    ];
  }
  return partMatch;
}

function buildCashJobMatch(q) {
  const match = { 'parts.0': { $exists: true } };
  const term = String(q || '').trim();
  if (term) {
    const rx = new RegExp(escapeRegex(term), 'i');
    match.$or = [
      { customerName: rx },
      { vehicle: rx },
      { 'parts.company': rx },
      { 'parts.partName': rx },
    ];
  }
  return match;
}

const hasInvoiceExpr = {
  $or: [
    {
      $gt: [
        {
          $size: {
            $filter: {
              input: { $ifNull: ['$parts.invoices', []] },
              as: 'inv',
              cond: {
                $and: [{ $ne: ['$$inv.fileId', null] }, { $ne: ['$$inv.fileId', ''] }],
              },
            },
          },
        },
        0,
      ],
    },
    { $ne: [{ $ifNull: ['$parts.invoiceFileId', ''] }, ''] },
  ],
};

function listRowProject(row) {
  return {
    _sort: { $ifNull: ['$updatedAt', new Date(0)] },
    _tie: { $ifNull: ['$parts.id', ''] },
    row,
  };
}

function claimListProject() {
  return listRowProject({
    jobType: 'claim',
    jobId: '',
    claimId: { $toString: '$_id' },
    partId: { $ifNull: ['$parts.id', ''] },
    claimReference: { $ifNull: ['$reference', ''] },
    intakeReference: { $ifNull: ['$intakeReference', ''] },
    plateNumber: { $ifNull: ['$plateNumber', ''] },
    customerName: {
      $let: {
        vars: { owner: { $trim: { input: { $ifNull: ['$data.memberVehicle.ownerName', ''] } } } },
        in: {
          $cond: [{ $gt: [{ $strLenCP: '$$owner' }, 0] }, '$$owner', { $ifNull: ['$driverName', ''] }],
        },
      },
    },
    supplier: { $ifNull: ['$parts.company', ''] },
    partName: { $ifNull: ['$parts.partName', ''] },
    amount: { $ifNull: ['$parts.amount', 0] },
    status: {
      $cond: [
        { $eq: [{ $toLower: { $ifNull: ['$parts.status', 'pending'] } }, 'completed'] },
        'completed',
        'pending',
      ],
    },
    hasInvoice: hasInvoiceExpr,
    invoiceCount: { $size: { $ifNull: ['$parts.invoices', []] } },
    orderDate: { $ifNull: ['$parts.orderDate', ''] },
    tentativeReceivedDate: { $ifNull: ['$parts.tentativeReceivedDate', ''] },
    claimStatus: { $ifNull: ['$status', ''] },
    updatedAt: {
      $cond: [
        { $ifNull: ['$updatedAt', false] },
        { $dateToString: { date: '$updatedAt', format: '%Y-%m-%dT%H:%M:%S.%LZ' } },
        null,
      ],
    },
    part: '$parts',
  });
}

function cashListProject() {
  return listRowProject({
    jobType: 'cash',
    jobId: { $toString: '$_id' },
    claimId: '',
    partId: { $ifNull: ['$parts.id', ''] },
    claimReference: '',
    intakeReference: '',
    plateNumber: { $ifNull: ['$vehicle', ''] },
    customerName: { $ifNull: ['$customerName', ''] },
    supplier: { $ifNull: ['$parts.company', ''] },
    partName: { $ifNull: ['$parts.partName', ''] },
    amount: { $ifNull: ['$parts.amount', 0] },
    status: {
      $cond: [
        { $eq: [{ $toLower: { $ifNull: ['$parts.status', 'pending'] } }, 'completed'] },
        'completed',
        'pending',
      ],
    },
    hasInvoice: hasInvoiceExpr,
    invoiceCount: { $size: { $ifNull: ['$parts.invoices', []] } },
    orderDate: { $ifNull: ['$parts.orderDate', ''] },
    tentativeReceivedDate: { $ifNull: ['$parts.tentativeReceivedDate', ''] },
    claimStatus: '',
    updatedAt: {
      $cond: [
        { $ifNull: ['$updatedAt', false] },
        { $dateToString: { date: '$updatedAt', format: '%Y-%m-%dT%H:%M:%S.%LZ' } },
        null,
      ],
    },
    part: '$parts',
  });
}

export async function listParts({
  q,
  status,
  supplier,
  hasInvoice,
  claimId,
  receivedFrom,
  receivedTo,
  page = 1,
  limit = 50,
}) {
  let resolvedClaimId = claimId;
  if (claimId) {
    const mongo = await resolveClaimMongoId(claimId);
    if (!mongo) return { error: 'Invalid claimId' };
    resolvedClaimId = mongo;
  }
  const built = buildClaimMatch({ q, claimId: resolvedClaimId });
  if (built.error) return { error: built.error };
  const partMatch = buildPartMatch({ status, supplier, hasInvoice, receivedFrom, receivedTo });
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  const skip = (safePage - 1) * safeLimit;

  const pipeline = [
    { $match: built.match },
    { $unwind: '$parts' },
  ];
  if (Object.keys(partMatch).length > 0) pipeline.push({ $match: partMatch });
  pipeline.push({ $project: claimListProject() });

  if (!resolvedClaimId) {
    const cashPipeline = [
      { $match: buildCashJobMatch(q) },
      { $unwind: '$parts' },
    ];
    if (Object.keys(partMatch).length > 0) cashPipeline.push({ $match: partMatch });
    cashPipeline.push({ $project: cashListProject() });
    pipeline.push({ $unionWith: { coll: CashPartJob.collection.name, pipeline: cashPipeline } });
  }

  pipeline.push({ $sort: { _sort: -1, _tie: 1 } });
  pipeline.push({
    $facet: {
      meta: [{ $count: 'total' }],
      items: [{ $skip: skip }, { $limit: safeLimit }, { $replaceRoot: { newRoot: '$row' } }],
    },
  });

  const [result] = await Claim.aggregate(pipeline);
  const total = result?.meta?.[0]?.total ?? 0;
  const items = result?.items ?? [];
  return { items, total, page: safePage, limit: safeLimit, totalPages: Math.max(1, Math.ceil(total / safeLimit)) };
}

async function loadClaimByIdentifier(claimIdOrRef) {
  const claimId = await resolveClaimMongoId(claimIdOrRef);
  if (!claimId) return { error: 'Invalid claim id', status: 400 };
  const claim = await Claim.findById(claimId).lean();
  if (!claim) return { error: 'Not found', status: 404 };
  return { claimId, claim };
}

export async function getPart(claimId, partId) {
  const loaded = await loadClaimByIdentifier(claimId);
  if (loaded.error) return loaded;
  const { claim } = loaded;
  const part = (claim.parts || []).find((p) => String(p?.id) === String(partId));
  if (!part) return { error: 'Part not found', status: 404 };
  return { row: flattenPartRow(claim, part), claim };
}

function collectInvoiceFileIds(part) {
  const ids = new Set();
  for (const inv of normalizePartInvoices(part)) {
    if (inv.fileId) ids.add(String(inv.fileId));
  }
  return ids;
}

async function saveClaimParts(claimId, parts) {
  const sanitized = sanitizeParts(parts);
  const updated = await Claim.findByIdAndUpdate(claimId, { $set: { parts: sanitized } }, { new: true }).lean();
  if (!updated) return null;
  return updated;
}

const PART_LINE_PATCH_KEYS = new Set([
  'company',
  'partName',
  'amount',
  'quotePrice',
  'orderDate',
  'tentativeReceivedDate',
  'receivedBy',
  'status',
  'notes',
  'invoices',
  'invoiceNumber',
  'invoiceFileId',
  'invoiceFileName',
  'invoiceFileUrl',
  'listPriceSnapshot',
  'supplierId',
  'supplierPartId',
]);

export function validatePartLineBody(body) {
  const [line] = sanitizeParts([body || {}]);
  if (!line) {
    return { error: 'Invalid part data', status: 400, fields: {} };
  }
  const fields = {};
  if (!String(line.company ?? '').trim()) fields.company = 'Supplier name is required';
  if (!String(line.partName ?? '').trim()) fields.partName = 'Part name is required';
  const amount = typeof line.amount === 'number' ? line.amount : Number(line.amount);
  if (!Number.isFinite(amount) || amount < 0) fields.amount = 'Amount is required';
  if (!String(line.orderDate ?? '').trim()) fields.orderDate = 'Order date is required';
  if (!String(line.tentativeReceivedDate ?? '').trim()) {
    fields.tentativeReceivedDate = 'Tentative received date is required';
  }
  const st = String(line.status || 'pending').toLowerCase();
  if (st !== 'pending' && st !== 'completed') fields.status = 'Line status is required';
  if (Object.keys(fields).length > 0) {
    return { error: 'Validation failed', status: 400, fields };
  }
  return { line };
}

export function pickPartPatchBody(body, actorRole) {
  const src = body && typeof body === 'object' ? body : {};
  if (!canViewParts(actorRole)) return {};
  const out = {};
  for (const key of Object.keys(src)) {
    if (PART_LINE_PATCH_KEYS.has(key)) out[key] = src[key];
  }
  return out;
}

export async function patchPart(claimId, partId, body, actorRole) {
  const loaded = await loadClaimByIdentifier(claimId);
  if (loaded.error) return loaded;
  const { claimId: mongoId, claim } = loaded;
  const parts = Array.isArray(claim.parts) ? claim.parts.map((p) => ({ ...p })) : [];
  const idx = parts.findIndex((p) => String(p?.id) === String(partId));
  if (idx < 0) return { error: 'Part not found', status: 404 };

  const patch = pickPartPatchBody(body, actorRole);
  if (Object.keys(patch).length === 0) {
    return { error: 'No allowed fields to update', status: 400 };
  }

  const merged = { ...parts[idx], ...patch, id: parts[idx].id };
  if (patch.invoices !== undefined) {
    merged.invoices = patch.invoices;
  }
  const validation = validatePartLineBody(merged);
  if (validation.error) {
    return { error: validation.error, status: validation.status || 400, fields: validation.fields };
  }
  parts[idx] = validation.line;

  const updated = await saveClaimParts(mongoId, parts);
  if (!updated) return { error: 'Not found', status: 404 };
  const part = updated.parts.find((p) => String(p.id) === String(partId));
  return { row: flattenPartRow(updated, part), claim: updated };
}

export async function createPartLine(claimId, body) {
  const loaded = await loadClaimByIdentifier(claimId);
  if (loaded.error) return loaded;
  const { claimId: mongoId, claim } = loaded;
  const parts = Array.isArray(claim.parts) ? [...claim.parts] : [];
  const validation = validatePartLineBody(body || {});
  if (validation.error) {
    return { error: validation.error, status: validation.status || 400, fields: validation.fields };
  }
  parts.push(validation.line);
  const updated = await saveClaimParts(mongoId, parts);
  if (!updated) return { error: 'Not found', status: 404 };
  const part = updated.parts[updated.parts.length - 1];
  return { row: flattenPartRow(updated, part), claim: updated, status: 201 };
}

export async function deletePartLine(claimId, partId) {
  const loaded = await loadClaimByIdentifier(claimId);
  if (loaded.error) return loaded;
  const { claimId: mongoId, claim } = loaded;
  const parts = Array.isArray(claim.parts) ? claim.parts : [];
  const target = parts.find((p) => String(p?.id) === String(partId));
  if (!target) return { error: 'Part not found', status: 404 };

  const fileIds = collectInvoiceFileIds(target);
  let caseFiles = Array.isArray(claim.caseFiles) ? claim.caseFiles : [];
  if (fileIds.size > 0) {
    caseFiles = caseFiles.filter((f) => !fileIds.has(String(f?.id)));
  }
  const nextParts = parts.filter((p) => String(p?.id) !== String(partId));
  const updated = await Claim.findByIdAndUpdate(
    mongoId,
    { $set: { parts: sanitizeParts(nextParts), caseFiles } },
    { new: true }
  ).lean();
  return { ok: true, claim: updated };
}

async function partLineStats(model) {
  const rows = await model.aggregate([
    { $match: { 'parts.0': { $exists: true } } },
    { $unwind: '$parts' },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        pending: {
          $sum: {
            $cond: [{ $eq: [{ $toLower: { $ifNull: ['$parts.status', 'pending'] } }, 'completed'] }, 0, 1],
          },
        },
        completed: {
          $sum: {
            $cond: [{ $eq: [{ $toLower: { $ifNull: ['$parts.status', 'pending'] } }, 'completed'] }, 1, 0],
          },
        },
        totalAmount: { $sum: { $ifNull: ['$parts.amount', 0] } },
        missingInvoice: {
          $sum: {
            $cond: [hasInvoiceExpr, 0, 1],
          },
        },
      },
    },
  ]);
  return rows[0] || { total: 0, pending: 0, completed: 0, totalAmount: 0, missingInvoice: 0 };
}

export async function partsSummaryStats() {
  const [claims, cash] = await Promise.all([partLineStats(Claim), partLineStats(CashPartJob)]);
  return {
    total: claims.total + cash.total,
    pending: claims.pending + cash.pending,
    completed: claims.completed + cash.completed,
    totalAmount: claims.totalAmount + cash.totalAmount,
    missingInvoice: claims.missingInvoice + cash.missingInvoice,
  };
}
