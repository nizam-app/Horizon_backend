import fs from 'fs/promises';
import path from 'path';
import { claimsUploadDir } from '../config/paths.js';
import { isCloudinaryConfigured, uploadEvidenceToCloudinary } from './cloudinaryStorage.js';

const ATTACHMENT_ARRAY_PATHS = [
  ['driverLicenseFrontAttachments'],
  ['driverLicenseBackAttachments'],
  ['taxiAuthorityAttachments'],
  ['registrationAttachments'],
  ['policeReportAttachments'],
  ['otherDemandAttachments'],
  ['repairQuoteAttachments'],
  ['accidentSketch', 'attachments'],
  ['damage', 'diagram', 'scenePhotos'],
  ['damage', 'diagram', 'detailPhotos'],
];

const MAX_STORED_EVIDENCE_BYTES = Number(process.env.MAX_STORED_EVIDENCE_BYTES || 15 * 1024 * 1024);

const MIME_EXTENSION = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function slugFileName(name) {
  const raw = String(name || 'evidence').trim();
  const base = raw.replace(/\.[^.]+$/, '') || 'evidence';
  return base
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'evidence';
}

function parseDataUrl(dataUrl) {
  const raw = String(dataUrl || '').trim();
  const match = /^data:([^;,]+)?(;base64)?,(.+)$/i.exec(raw);
  if (!match || !match[2]) return null;
  const mimeType = String(match[1] || 'application/octet-stream').toLowerCase();
  try {
    const buffer = Buffer.from(match[3], 'base64');
    if (!buffer.length || buffer.length > MAX_STORED_EVIDENCE_BYTES) return null;
    return { mimeType, buffer };
  } catch {
    return null;
  }
}

function getNestedArray(root, keys) {
  let cursor = root;
  for (const key of keys) {
    if (!cursor || typeof cursor !== 'object') return null;
    cursor = cursor[key];
  }
  return Array.isArray(cursor) ? cursor : null;
}

function stripAttachmentDataUrls(list) {
  if (!Array.isArray(list)) return;
  for (const file of list) {
    if (file && typeof file === 'object') delete file.dataUrl;
  }
}

async function materializeAttachment(file, claimId, index) {
  const row = file && typeof file === 'object' ? { ...file } : {};
  const parsed = parseDataUrl(row.dataUrl);
  delete row.dataUrl;

  if (!parsed) return row;

  const ext = MIME_EXTENSION[parsed.mimeType] || MIME_EXTENSION[row.mimeType] || 'bin';
  const id = String(row.id || `evidence-${Date.now()}-${index}`).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 90);
  const filename = `${id}-${slugFileName(row.name)}.${ext}`;
  const mimeType = row.mimeType || parsed.mimeType;

  if (isCloudinaryConfigured()) {
    try {
      const uploaded = await uploadEvidenceToCloudinary({
        buffer: parsed.buffer,
        mimeType,
        filename,
        claimId,
        id,
        slug: slugFileName(row.name),
      });
      return {
        ...row,
        mimeType,
        size: uploaded.bytes || parsed.buffer.length,
        storageProvider: 'cloudinary',
        storageKey: uploaded.publicId,
        cloudinaryPublicId: uploaded.publicId,
        cloudinaryResourceType: uploaded.resourceType,
        cloudinaryFormat: uploaded.format,
        url: uploaded.url,
        fileUrl: uploaded.url,
      };
    } catch (err) {
      console.error('Cloudinary evidence upload failed; falling back to local storage', err);
    }
  }

  const dir = path.join(claimsUploadDir(claimId), 'evidence');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), parsed.buffer);

  const storageKey = path.posix.join('claims', String(claimId), 'evidence', filename);
  return {
    ...row,
    mimeType,
    size: parsed.buffer.length,
    storageProvider: 'local',
    storageKey,
    url: `/uploads/${storageKey}`,
    fileUrl: `/uploads/${storageKey}`,
  };
}

export async function materializeClaimEvidenceFiles(claim, claimId) {
  const next = clonePlain(claim);
  let fileIndex = 0;

  for (const keys of ATTACHMENT_ARRAY_PATHS) {
    const list = getNestedArray(next, keys);
    if (!list) continue;
    const startIndex = fileIndex;
    fileIndex += list.length;
    const materialized = await Promise.all(
      list.map((file, offset) => materializeAttachment(file, claimId, startIndex + offset)),
    );
    list.splice(0, list.length, ...materialized);
  }

  if (Array.isArray(next.otherParties)) {
    for (const party of next.otherParties) {
      for (const key of ['licenceFrontAttachments', 'licenceBackAttachments']) {
        if (!Array.isArray(party?.[key])) continue;
        const startIndex = fileIndex;
        fileIndex += party[key].length;
        const materialized = await Promise.all(
          party[key].map((file, offset) => materializeAttachment(file, claimId, startIndex + offset)),
        );
        party[key].splice(0, party[key].length, ...materialized);
      }
    }
  }

  return next;
}

export function stripClaimEvidenceDataUrls(claim) {
  const next = clonePlain(claim);
  for (const keys of ATTACHMENT_ARRAY_PATHS) {
    stripAttachmentDataUrls(getNestedArray(next, keys));
  }
  if (Array.isArray(next.otherParties)) {
    for (const party of next.otherParties) {
      stripAttachmentDataUrls(party?.licenceFrontAttachments);
      stripAttachmentDataUrls(party?.licenceBackAttachments);
    }
  }
  return next;
}
