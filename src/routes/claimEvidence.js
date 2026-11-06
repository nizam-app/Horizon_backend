import crypto from 'crypto';
import multer from 'multer';
import mongoose from 'mongoose';
import { Claim } from '../models/Claim.js';
import { requireAdmin } from '../middleware/requireAuth.js';
import { formatClaimForApi } from '../services/claimAdmin.js';
import { buildClaimUpdateFromPayload } from '../services/claimSubmissionAdmin.js';
import { storeEvidenceBuffer } from '../services/claimEvidenceStorage.js';

const IMAGE_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']);
const SIGNATURE_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const DOC_MIME = new Set([...IMAGE_MIME, 'application/pdf']);

const KIND_RULES = {
  'license-front': { accept: IMAGE_MIME, target: 'license-front' },
  'license-back': { accept: IMAGE_MIME, target: 'license-back' },
  registration: { accept: DOC_MIME, target: 'registration' },
  'damage-photo': { accept: IMAGE_MIME, target: 'damage-photo' },
  'damage-diagram': { accept: IMAGE_MIME, target: 'damage-diagram' },
  signature: { accept: SIGNATURE_MIME, target: 'signature' },
  'police-report': { accept: DOC_MIME, target: 'police-report' },
  'taxi-authority': { accept: DOC_MIME, target: 'taxi-authority' },
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Math.min(Number(process.env.MAX_UPLOAD_MB || 15), 15) * 1024 * 1024 },
}).single('file');

function ensureArray(parent, key) {
  if (!Array.isArray(parent[key])) parent[key] = [];
  return parent[key];
}

function applyStoredFile(payload, kind, stored) {
  const next = structuredClone(payload && typeof payload === 'object' ? payload : {});
  if (kind === 'license-front') ensureArray(next, 'driverLicenseFrontAttachments').push(stored);
  else if (kind === 'license-back') ensureArray(next, 'driverLicenseBackAttachments').push(stored);
  else if (kind === 'registration') ensureArray(next, 'registrationAttachments').push(stored);
  else if (kind === 'police-report') ensureArray(next, 'policeReportAttachments').push(stored);
  else if (kind === 'taxi-authority') ensureArray(next, 'taxiAuthorityAttachments').push(stored);
  else if (kind === 'damage-photo') {
    next.damage = next.damage && typeof next.damage === 'object' ? next.damage : {};
    next.damage.diagram = next.damage.diagram && typeof next.damage.diagram === 'object' ? next.damage.diagram : {};
    ensureArray(next.damage.diagram, 'scenePhotos').push(stored);
  } else if (kind === 'damage-diagram') {
    next.damage = next.damage && typeof next.damage === 'object' ? next.damage : {};
    next.damage.diagram = next.damage.diagram && typeof next.damage.diagram === 'object' ? next.damage.diagram : {};
    next.damage.diagram.diagramPhoto = stored;
  } else if (kind === 'signature') {
    next.declaration = next.declaration && typeof next.declaration === 'object' ? next.declaration : {};
    next.declaration.signatureUrl = stored.url || stored.fileUrl || '';
    const existing = String(next.declaration.signatureDataUrl || '');
    if (existing.startsWith('data:image/svg')) next.declaration.signatureDataUrl = '';
  }
  return next;
}

export function attachClaimEvidenceRoutes(adminRouter) {
  adminRouter.post('/claims/:id/evidence', requireAdmin, (req, res) => {
    upload(req, res, async (err) => {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File too large' : err.message });
      }
      if (err) return res.status(400).json({ error: err.message || 'Upload failed' });

      try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
          return res.status(400).json({ error: 'Invalid claim id' });
        }
        const kind = String(req.body?.kind || req.query?.kind || '').trim();
        const rule = KIND_RULES[kind];
        if (!rule) return res.status(400).json({ error: 'Unknown evidence kind' });
        if (!req.file?.buffer?.length) return res.status(400).json({ error: 'Expected multipart field file' });

        const mime = String(req.file.mimetype || '').toLowerCase();
        if (!rule.accept.has(mime)) {
          return res.status(400).json({ error: 'This file type is not allowed for that document' });
        }

        const existing = await Claim.findById(req.params.id).lean();
        if (!existing) return res.status(404).json({ error: 'Not found' });
        if (!existing.payload || typeof existing.payload !== 'object') {
          return res.status(400).json({ error: 'No claim form is stored for this claim' });
        }

        const stored = await storeEvidenceBuffer({
          buffer: req.file.buffer,
          mimeType: mime,
          originalName: req.file.originalname,
          claimId: existing._id,
          id: crypto.randomUUID(),
        });
        const nextPayload = applyStoredFile(existing.payload, kind, stored);
        const claimFields = buildClaimUpdateFromPayload(nextPayload);
        const updated = await Claim.findByIdAndUpdate(existing._id, { $set: claimFields }, { new: true }).lean();
        return res.json({ claim: formatClaimForApi(updated), kind });
      } catch (e) {
        const status = e?.statusCode === 400 ? 400 : 500;
        if (status === 500) console.error('claim evidence', e);
        return res.status(status).json({ error: e?.message || 'Could not save evidence' });
      }
    });
  });
}
