/**
 * Admin buyer-PDF intake: OCR parse then create claim (same queue as member submits).
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import mongoose from 'mongoose';
import { Claim } from '../models/Claim.js';
import { requireAdmin } from '../middleware/requireAuth.js';
import { claimsUploadDir } from '../config/paths.js';
import { formatClaimForApi } from '../services/claimAdmin.js';
import { extractClaimDraftFromBuyerPdf } from '../services/buyerPdfOcr.js';
import {
  cleanupExpiredBuyerPdfTemps,
  consumeBuyerPdfTemp,
  storeBuyerPdfTemp,
} from '../services/buyerPdfTemp.js';
import {
  deriveQueueFields,
  generateIntakeReference,
  mergeBuyerDraftIntoPayload,
  nextSystemReference,
  validateAdminCreatedClaim,
} from '../services/claimIntake.js';
import { materializeClaimEvidenceFiles } from '../services/claimEvidenceStorage.js';

const uploadPdfMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 25) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname || '')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF uploads are accepted'));
    }
  },
}).single('pdf');

function newFileRowId() {
  return crypto.randomUUID();
}

function saveCasePdfToClaim(claimId, { buffer, originalName, size }) {
  const dir = claimsUploadDir(claimId);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${crypto.randomUUID()}.pdf`;
  fs.writeFileSync(path.join(dir, filename), buffer);
  const posixRel = path.posix.join('claims', String(claimId), filename);
  return {
    id: newFileRowId(),
    name: String(originalName || filename).slice(0, 512),
    size: typeof size === 'number' ? size : buffer.length,
    uploadedAt: new Date().toISOString().slice(0, 10),
    url: `/uploads/${posixRel}`,
    storedRelativePath: posixRel,
    kind: 'intake',
  };
}

export function attachBuyerPdfClaimRoutes(adminRouter) {
  adminRouter.post('/claims/from-buyer-pdf', requireAdmin, (req, res) => {
    uploadPdfMemory(req, res, async (err) => {
      if (err instanceof multer.MulterError) {
        return res
          .status(400)
          .json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File too large' : err.message });
      }
      if (err) return res.status(400).json({ error: err.message || 'Upload failed' });

      try {
        if (!req.file?.buffer?.length) {
          return res.status(400).json({ error: 'Expected multipart field pdf' });
        }

        cleanupExpiredBuyerPdfTemps();

        const extraction = await extractClaimDraftFromBuyerPdf(req.file.buffer);
        const stored = storeBuyerPdfTemp({
          buffer: req.file.buffer,
          originalName: req.file.originalname,
          staffId: req.user?.sub,
        });

        return res.status(200).json({
          uploadToken: stored.token,
          draft: extraction.draft,
          extractedText: extraction.extractedText,
          warnings: extraction.warnings,
          meta: extraction.meta,
          expiresAt: stored.expiresAt,
        });
      } catch (e) {
        console.error('from-buyer-pdf', e);
        return res.status(500).json({
          error: e?.message ? `OCR failed: ${e.message}` : 'Could not process buyer PDF',
        });
      }
    });
  });

  /**
   * POST /v1/admin/claims
   * Body JSON: { claim: <draft sections or full payload>, uploadToken: string }
   * Builds full payload + staff declaration, creates Claim, attaches temp PDF as caseFile.
   */
  adminRouter.post('/claims', requireAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      const uploadToken = String(body.uploadToken || '').trim();
      if (!uploadToken) {
        return res.status(400).json({ error: 'uploadToken is required (from from-buyer-pdf)' });
      }

      const tempPdf = consumeBuyerPdfTemp(uploadToken, req.user?.sub);
      if (!tempPdf) {
        return res.status(400).json({
          error: 'Invalid or expired uploadToken — re-upload the buyer PDF',
        });
      }

      const draftOrClaim = body.claim;
      if (!draftOrClaim || typeof draftOrClaim !== 'object') {
        return res.status(400).json({ error: 'claim draft is required' });
      }

      const staff = {
        email: req.user?.email,
        displayName: req.user?.displayName,
      };

      let claimPayload = mergeBuyerDraftIntoPayload(draftOrClaim, staff);

      // Ensure driver.name is set from first/last if needed.
      if (!String(claimPayload.driver?.name || '').trim()) {
        const name = [claimPayload.driver?.firstName, claimPayload.driver?.lastName]
          .map((s) => String(s || '').trim())
          .filter(Boolean)
          .join(' ');
        claimPayload = {
          ...claimPayload,
          driver: { ...claimPayload.driver, name },
        };
      }

      const errors = validateAdminCreatedClaim(claimPayload);
      if (errors.length) {
        return res.status(400).json({ error: errors.join('; ') });
      }

      const intakeReference = generateIntakeReference();
      const claimId = new mongoose.Types.ObjectId();
      const storedClaim = await materializeClaimEvidenceFiles(claimPayload, claimId);
      const systemRef = nextSystemReference();
      const { plateNumber, driverName, dateOfIncident, submittedAt, summary, priority, data } =
        deriveQueueFields(storedClaim);

      const caseFile = saveCasePdfToClaim(claimId, tempPdf);

      const doc = await Claim.create({
        _id: claimId,
        intakeReference,
        intakeSource: 'admin-buyer-pdf',
        reference: systemRef,
        status: 'Pending Review',
        priority,
        plateNumber,
        driverName,
        dateOfIncident,
        submittedAt,
        summary,
        data,
        payload: storedClaim,
        paymentStatus: 'pending',
        adminNote: 'Created from buyer PDF (admin OCR intake).',
        parts: [],
        quotePrice: null,
        insuranceApprovedPrice: null,
        quoteOptions: [],
        primaryQuoteId: null,
        finalQuoteId: null,
        caseFiles: [caseFile],
      });

      const api = formatClaimForApi(doc.toObject ? doc.toObject() : doc);
      return res.status(201).json({
        id: doc._id.toString(),
        reference: doc.reference,
        intakeReference: doc.intakeReference,
        intakeSource: doc.intakeSource,
        claim: api,
      });
    } catch (e) {
      if (e?.code === 11000) {
        return res.status(409).json({ error: 'Reference collision; retry submission' });
      }
      console.error('admin create claim', e);
      return res.status(500).json({ error: 'Could not create claim' });
    }
  });
}
