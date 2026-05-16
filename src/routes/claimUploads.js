import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import mongoose from 'mongoose';
import { claimsUploadDir, UPLOAD_ROOT } from '../config/paths.js';
import { Claim } from '../models/Claim.js';
import { formatClaimForApi } from '../services/claimAdmin.js';
import { requireAdmin } from '../middleware/requireAuth.js';

function newFileRowId() {
  return crypto.randomUUID();
}

const uploadPdfMiddleware = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = claimsUploadDir(req.params.id);
      try {
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      } catch (e) {
        cb(e);
      }
    },
    filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.pdf`),
  }),
  limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 25) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname || '')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF uploads are accepted'));
    }
  },
}).single('pdf');

/** Attach POST upload + DELETE (admin JWT). */
export function attachClaimFileRoutes(adminRouter) {
  adminRouter.post('/claims/:id/files', requireAdmin, (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid claim id' });
    }
    uploadPdfMiddleware(req, res, async (err) => {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File too large' : err.message });
      }
      if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
      try {
        if (!req.file) return res.status(400).json({ error: 'Expected multipart field pdf' });

        const claimId = req.params.id;
        const filename = req.file.filename;
        const posixRel = path.posix.join('claims', claimId, filename);
        const entry = {
          id: newFileRowId(),
          name: String(req.file.originalname || filename).slice(0, 512),
          size: req.file.size,
          uploadedAt: new Date().toISOString().slice(0, 10),
          url: `/uploads/${posixRel}`,
          storedRelativePath: posixRel,
        };

        const updated = await Claim.findByIdAndUpdate(claimId, { $push: { caseFiles: entry } }, { new: true }).lean();
        if (!updated) return res.status(404).json({ error: 'Claim not found' });

        const api = formatClaimForApi(updated);
        return res.status(201).json({ claim: api, caseFiles: api.caseFiles });
      } catch (e) {
        console.error(e);
        return res.status(500).json({ error: 'Could not save upload' });
      }
    });
  });

  adminRouter.delete('/claims/:id/files/:fileId', requireAdmin, async (req, res) => {
    try {
      const claimId = req.params.id;
      const fileId = req.params.fileId;
      if (!mongoose.Types.ObjectId.isValid(claimId)) {
        return res.status(400).json({ error: 'Invalid claim id' });
      }
      const claim = await Claim.findById(claimId).lean();
      if (!claim) return res.status(404).json({ error: 'Not found' });

      const list = Array.isArray(claim.caseFiles) ? claim.caseFiles : [];
      const target = list.find((f) => String(f?.id) === String(fileId));
      if (!target) return res.status(404).json({ error: 'File not found' });

      const rel = target.storedRelativePath ? String(target.storedRelativePath) : '';
      if (rel && !rel.includes('..')) {
        const abs = path.join(UPLOAD_ROOT, ...rel.split(/[/\\]/));
        try {
          fs.unlinkSync(abs);
        } catch {
          /* ignore missing file */
        }
      }

      await Claim.updateOne({ _id: claimId }, { $pull: { caseFiles: { id: target.id } } });
      const fresh = await Claim.findById(claimId).lean();
      const api = formatClaimForApi(fresh);
      res.json({ claim: api, caseFiles: api.caseFiles });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Could not delete file' });
    }
  });
}
