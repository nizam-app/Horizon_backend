import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { CashPartJob } from '../models/CashPartJob.js';
import { UPLOAD_ROOT } from '../config/paths.js';
import { deleteCloudinaryAsset } from './cloudinaryStorage.js';
import { storeEvidenceBuffer } from './claimEvidenceStorage.js';
import { sanitizeParts } from './claimAdmin.js';
import { pickPartPatchBody, validatePartLineBody } from './partsRegistry.js';

function cleanText(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function identityError(customerName, vehicle) {
  const fields = {};
  if (!customerName) fields.customerName = 'Name is required';
  if (!vehicle) fields.vehicle = 'Vehicle is required';
  if (!Object.keys(fields).length) return null;
  return { error: 'Name and vehicle are required', status: 400, fields };
}

export function flattenCashPartRow(job, part) {
  const p = part && typeof part === 'object' ? part : {};
  const amount = typeof p.amount === 'number' && !Number.isNaN(p.amount) ? p.amount : Number(p.amount) || 0;
  const status = String(p.status || 'pending').toLowerCase() === 'completed' ? 'completed' : 'pending';
  const invoices = Array.isArray(p.invoices) ? p.invoices : [];
  return {
    jobType: 'cash',
    jobId: job._id.toString(),
    claimId: '',
    partId: String(p.id || '').trim(),
    claimReference: '',
    intakeReference: '',
    plateNumber: job.vehicle || '',
    customerName: job.customerName || '',
    supplier: String(p.company ?? '').trim(),
    partName: String(p.partName ?? '').trim(),
    amount,
    status,
    hasInvoice: invoices.some((inv) => inv?.fileId) || Boolean(p.invoiceFileId),
    invoiceCount: invoices.length,
    orderDate: String(p.orderDate ?? '').trim(),
    tentativeReceivedDate: String(p.tentativeReceivedDate ?? '').trim(),
    claimStatus: '',
    updatedAt: job.updatedAt ? new Date(job.updatedAt).toISOString() : null,
    part: p,
  };
}

async function loadJob(jobId) {
  if (!mongoose.Types.ObjectId.isValid(jobId)) return { error: 'Invalid cash job id', status: 400 };
  const job = await CashPartJob.findById(jobId);
  if (!job) return { error: 'Cash job not found', status: 404 };
  return { job };
}

function fileIdsOnPart(part) {
  const ids = new Set();
  for (const inv of part?.invoices || []) {
    if (inv?.fileId) ids.add(String(inv.fileId));
  }
  if (part?.invoiceFileId) ids.add(String(part.invoiceFileId));
  return ids;
}

async function discardStoredFile(file) {
  if (!file) return;
  if (file.cloudinaryPublicId) {
    try {
      await deleteCloudinaryAsset(file.cloudinaryPublicId, file.cloudinaryResourceType || 'image');
    } catch (err) {
      console.error(err);
    }
  }
  const rel = file.storageKey
    ? String(file.storageKey)
    : String(file.url || file.fileUrl || '').replace(/^\/uploads\/?/, '');
  if (!rel || rel.includes('..')) return;
  const abs = path.join(UPLOAD_ROOT, ...rel.split(/[/\\]/));
  try {
    fs.unlinkSync(abs);
  } catch {
    /* already gone */
  }
}

export async function createCashPartJob(body) {
  const customerName = cleanText(body?.customerName, 200);
  const vehicle = cleanText(body?.vehicle, 80);
  const invalid = identityError(customerName, vehicle);
  if (invalid) return invalid;
  const validation = validatePartLineBody(body?.part || {});
  if (validation.error) return validation;
  const job = await CashPartJob.create({
    customerName,
    vehicle,
    parts: sanitizeParts([validation.line]),
    files: [],
  });
  const part = job.parts[job.parts.length - 1];
  return { row: flattenCashPartRow(job, part), status: 201 };
}

export async function addCashPartLine(jobId, body) {
  const loaded = await loadJob(jobId);
  if (loaded.error) return loaded;
  const validation = validatePartLineBody(body?.part || body || {});
  if (validation.error) return validation;
  loaded.job.parts.push(validation.line);
  loaded.job.parts = sanitizeParts(loaded.job.parts);
  loaded.job.markModified('parts');
  await loaded.job.save();
  const part = loaded.job.parts[loaded.job.parts.length - 1];
  return { row: flattenCashPartRow(loaded.job, part), status: 201 };
}

export async function getCashPartLine(jobId, partId) {
  const loaded = await loadJob(jobId);
  if (loaded.error) return loaded;
  const part = loaded.job.parts.find((p) => String(p.id) === String(partId));
  if (!part) return { error: 'Part not found', status: 404 };
  return { row: flattenCashPartRow(loaded.job, part) };
}

export async function patchCashPartLine(jobId, partId, body, actorRole) {
  const loaded = await loadJob(jobId);
  if (loaded.error) return loaded;
  const { job } = loaded;
  const idx = job.parts.findIndex((p) => String(p.id) === String(partId));
  if (idx < 0) return { error: 'Part not found', status: 404 };

  if (body?.customerName !== undefined || body?.vehicle !== undefined) {
    const customerName = body?.customerName !== undefined ? cleanText(body.customerName, 200) : job.customerName;
    const vehicle = body?.vehicle !== undefined ? cleanText(body.vehicle, 80) : job.vehicle;
    const invalid = identityError(customerName, vehicle);
    if (invalid) return invalid;
    job.customerName = customerName;
    job.vehicle = vehicle;
  }

  const patch = pickPartPatchBody(body, actorRole);
  if (Object.keys(patch).length) {
    const current = typeof job.parts[idx].toObject === 'function' ? job.parts[idx].toObject() : job.parts[idx];
    const merged = { ...current, ...patch, id: job.parts[idx].id };
    const validation = validatePartLineBody(merged);
    if (validation.error) return validation;
    job.parts[idx] = validation.line;
    job.parts = sanitizeParts(job.parts);
    job.markModified('parts');
  }
  await job.save();
  const part = job.parts.find((p) => String(p.id) === String(partId));
  return { row: flattenCashPartRow(job, part) };
}

export async function deleteCashPartLine(jobId, partId) {
  const loaded = await loadJob(jobId);
  if (loaded.error) return loaded;
  const { job } = loaded;
  const target = job.parts.find((p) => String(p.id) === String(partId));
  if (!target) return { error: 'Part not found', status: 404 };
  const fileIds = fileIdsOnPart(target);
  const doomed = (job.files || []).filter((file) => fileIds.has(String(file.id)));
  for (const file of doomed) {
    await discardStoredFile(file);
  }
  job.files = (job.files || []).filter((file) => !fileIds.has(String(file.id)));
  job.parts = job.parts.filter((p) => String(p.id) !== String(partId));
  if (!job.parts.length) {
    await job.deleteOne();
    return { ok: true };
  }
  await job.save();
  return { ok: true };
}

export async function addCashJobFile(jobId, { buffer, mimeType, originalName }) {
  const loaded = await loadJob(jobId);
  if (loaded.error) return loaded;
  const stored = await storeEvidenceBuffer({
    buffer,
    mimeType: mimeType || 'application/pdf',
    originalName,
    claimId: `cash-jobs/${loaded.job._id.toString()}`,
  });
  loaded.job.files.push({
    id: stored.id,
    name: stored.name,
    url: stored.url,
    fileUrl: stored.fileUrl || stored.url,
    storageKey: stored.storageKey || '',
    storageProvider: stored.storageProvider || '',
    cloudinaryPublicId: stored.cloudinaryPublicId || '',
    cloudinaryResourceType: stored.cloudinaryResourceType || '',
    mimeType: stored.mimeType || mimeType || 'application/pdf',
    size: stored.size || buffer.length,
  });
  await loaded.job.save();
  const file = loaded.job.files[loaded.job.files.length - 1];
  return { file, status: 201 };
}

export async function deleteCashJobFile(jobId, fileId) {
  const loaded = await loadJob(jobId);
  if (loaded.error) return loaded;
  const file = (loaded.job.files || []).find((item) => String(item.id) === String(fileId));
  if (!file) return { error: 'File not found', status: 404 };
  await discardStoredFile(file);
  loaded.job.files = loaded.job.files.filter((item) => String(item.id) !== String(fileId));
  await loaded.job.save();
  return { ok: true };
}
