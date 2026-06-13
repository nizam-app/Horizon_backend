import fs from 'fs';
import path from 'path';

import { Claim } from '../models/Claim.js';
import { ClaimDraft } from '../models/ClaimDraft.js';
import { claimsUploadDir, UPLOAD_ROOT } from '../config/paths.js';

function unlinkSafe(absPath) {
  if (!absPath) return;
  try {
    fs.unlinkSync(absPath);
  } catch {
    /* file may already be gone */
  }
}

function rmDirSafe(dir) {
  if (!dir) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* directory may already be gone */
  }
}

function absFromUploadRelative(rel) {
  const raw = String(rel || '').trim();
  if (!raw || raw.includes('..')) return null;
  return path.join(UPLOAD_ROOT, ...raw.split(/[/\\]/));
}

function collectUploadPathsFromClaim(claim) {
  const paths = new Set();

  for (const file of claim.caseFiles || []) {
    const abs = absFromUploadRelative(file?.storedRelativePath);
    if (abs) paths.add(abs);
    if (file?.url && String(file.url).startsWith('/uploads/')) {
      const rel = String(file.url).replace(/^\/uploads\/?/, '');
      const fromUrl = absFromUploadRelative(rel);
      if (fromUrl) paths.add(fromUrl);
    }
  }

  for (const part of claim.parts || []) {
    if (part?.invoiceFileUrl && String(part.invoiceFileUrl).startsWith('/uploads/')) {
      const rel = String(part.invoiceFileUrl).replace(/^\/uploads\/?/, '');
      const abs = absFromUploadRelative(rel);
      if (abs) paths.add(abs);
    }
    for (const inv of part.invoices || []) {
      if (inv?.fileUrl && String(inv.fileUrl).startsWith('/uploads/')) {
        const rel = String(inv.fileUrl).replace(/^\/uploads\/?/, '');
        const abs = absFromUploadRelative(rel);
        if (abs) paths.add(abs);
      }
    }
  }

  for (const file of claim.files || []) {
    if (file?.storageKey && !String(file.storageKey).includes('..')) {
      paths.add(path.join(UPLOAD_ROOT, ...String(file.storageKey).split(/[/\\]/)));
    }
  }

  return paths;
}

/**
 * Permanently delete a claim, its upload folder, linked PDF files, and intake draft.
 * @returns {Promise<object|null>} Deleted claim document, or null if not found.
 */
export async function deleteClaimById(claimId) {
  const claim = await Claim.findById(claimId).lean();
  if (!claim) return null;

  const uploadPaths = collectUploadPathsFromClaim(claim);
  for (const abs of uploadPaths) unlinkSafe(abs);

  rmDirSafe(claimsUploadDir(claimId));

  if (claim.intakeReference) {
    try {
      await ClaimDraft.deleteMany({ intakeReference: claim.intakeReference });
    } catch (err) {
      console.error('deleteClaimById: draft cleanup failed', err);
    }
  }

  await Claim.findByIdAndDelete(claimId);
  return claim;
}
