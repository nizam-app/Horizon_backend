import { Router } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { requirePartsAccess, requirePartsCrud } from '../middleware/requireAuth.js';
import {
  addCashJobFile,
  addCashPartLine,
  createCashPartJob,
  deleteCashJobFile,
  deleteCashPartLine,
  getCashPartLine,
  patchCashPartLine,
} from '../services/cashPartJobs.js';
import {
  createPartLine,
  deletePartLine,
  getPart,
  listParts,
  patchPart,
  partsSummaryStats,
} from '../services/partsRegistry.js';
import { listPartSuggestionsForSupplier, listSupplierSuggestions } from '../services/partSuggestions.js';
import { formatClaimForApi } from '../services/claimAdmin.js';
import { resolveClaimMongoId } from '../services/claimResolve.js';
import { Claim } from '../models/Claim.js';
import { customerNameFromClaim } from '../services/partsRegistry.js';

/**
 * @param {import('express').Router} adminRouter — already uses requireAuth
 */
const uploadCashPdf = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname || '')) cb(null, true);
    else cb(new Error('Only PDF uploads are accepted'));
  },
}).single('pdf');

function sendPartError(res, result, fallback) {
  return res.status(result.status || 400).json({
    error: result.error || fallback,
    ...(result.fields ? { fields: result.fields } : {}),
  });
}

export function attachPartsRoutes(adminRouter) {
  const router = Router();

  router.get('/parts/suggestions/suppliers', requirePartsAccess, async (req, res) => {
    try {
      const result = await listSupplierSuggestions({ q: req.query.q, limit: req.query.limit });
      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not load supplier suggestions' });
    }
  });

  router.get('/parts/suggestions/parts', requirePartsAccess, async (req, res) => {
    try {
      const result = await listPartSuggestionsForSupplier({
        supplier: req.query.supplier,
        limit: req.query.limit,
      });
      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not load part suggestions' });
    }
  });

  router.get('/parts/summary', requirePartsAccess, async (_req, res) => {
    try {
      const summary = await partsSummaryStats();
      res.json({ summary });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not load parts summary' });
    }
  });

  router.get('/parts/claim-lookup', requirePartsAccess, async (req, res) => {
    try {
      const key = String(req.query.key ?? req.query.q ?? '').trim();
      if (!key) return res.status(400).json({ error: 'key required' });
      const mongoId = await resolveClaimMongoId(key);
      if (!mongoId) return res.status(404).json({ error: 'Claim not found' });
      const claim = await Claim.findById(mongoId).lean();
      if (!claim) return res.status(404).json({ error: 'Claim not found' });
      res.json({
        claimId: mongoId,
        reference: claim.reference || '',
        intakeReference: claim.intakeReference || '',
        plateNumber: claim.plateNumber || '',
        customerName: customerNameFromClaim(claim),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not look up claim' });
    }
  });

  router.get('/parts', requirePartsAccess, async (req, res) => {
    try {
      const result = await listParts({
        q: req.query.q,
        status: req.query.status,
        supplier: req.query.supplier,
        hasInvoice: req.query.hasInvoice,
        claimId: req.query.claimId,
        receivedFrom: req.query.receivedFrom,
        receivedTo: req.query.receivedTo,
        page: req.query.page,
        limit: req.query.limit,
      });
      if (result.error) return res.status(400).json({ error: result.error });
      res.json({
        parts: result.items,
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not list parts' });
    }
  });

  router.post('/parts/cash-jobs', requirePartsAccess, async (req, res) => {
    try {
      const result = await createCashPartJob(req.body || {});
      if (result.error) return sendPartError(res, result, 'Could not create cash job');
      return res.status(result.status || 201).json({ part: result.row });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Could not create cash job' });
    }
  });

  router.post('/parts/cash-jobs/:jobId/lines', requirePartsAccess, async (req, res) => {
    try {
      const result = await addCashPartLine(req.params.jobId, req.body || {});
      if (result.error) return sendPartError(res, result, 'Could not add cash part');
      return res.status(result.status || 201).json({ part: result.row });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Could not add cash part' });
    }
  });

  router.get('/parts/cash-jobs/:jobId/lines/:partId', requirePartsAccess, async (req, res) => {
    try {
      const result = await getCashPartLine(req.params.jobId, req.params.partId);
      if (result.error) return sendPartError(res, result, 'Could not load cash part');
      return res.json({ part: result.row });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Could not load cash part' });
    }
  });

  router.patch('/parts/cash-jobs/:jobId/lines/:partId', requirePartsAccess, async (req, res) => {
    try {
      const result = await patchCashPartLine(req.params.jobId, req.params.partId, req.body || {}, req.user?.role);
      if (result.error) return sendPartError(res, result, 'Could not update cash part');
      return res.json({ part: result.row });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Could not update cash part' });
    }
  });

  router.delete('/parts/cash-jobs/:jobId/lines/:partId', requirePartsCrud, async (req, res) => {
    try {
      const result = await deleteCashPartLine(req.params.jobId, req.params.partId);
      if (result.error) return sendPartError(res, result, 'Could not delete cash part');
      return res.json({ ok: true });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Could not delete cash part' });
    }
  });

  router.post('/parts/cash-jobs/:jobId/files', requirePartsAccess, (req, res) => {
    uploadCashPdf(req, res, async (err) => {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File too large' : err.message });
      }
      if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
      try {
        if (!req.file) return res.status(400).json({ error: 'Expected multipart field pdf' });
        const result = await addCashJobFile(req.params.jobId, {
          buffer: req.file.buffer,
          mimeType: req.file.mimetype,
          originalName: req.file.originalname,
        });
        if (result.error) return sendPartError(res, result, 'Could not upload invoice');
        return res.status(201).json({ file: result.file });
      } catch (e) {
        console.error(e);
        const status = e.statusCode === 400 ? 400 : 500;
        return res.status(status).json({ error: e.message || 'Could not upload invoice' });
      }
    });
  });

  router.delete('/parts/cash-jobs/:jobId/files/:fileId', requirePartsAccess, async (req, res) => {
    try {
      const result = await deleteCashJobFile(req.params.jobId, req.params.fileId);
      if (result.error) return sendPartError(res, result, 'Could not delete invoice');
      return res.json({ ok: true });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Could not delete invoice' });
    }
  });

  router.get('/parts/:claimId/:partId', requirePartsAccess, async (req, res) => {
    try {
      const result = await getPart(req.params.claimId, req.params.partId);
      if (result.error) return res.status(result.status || 400).json({ error: result.error });
      res.json({ part: result.row, claim: formatClaimForApi(result.claim) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not load part' });
    }
  });

  router.patch('/parts/:claimId/:partId', requirePartsAccess, async (req, res) => {
    try {
      const result = await patchPart(req.params.claimId, req.params.partId, req.body || {}, req.user?.role);
      if (result.error) return res.status(result.status || 400).json({ error: result.error });
      res.json({ part: result.row, claim: formatClaimForApi(result.claim) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not update part' });
    }
  });

  router.post('/parts/:claimId', requirePartsAccess, async (req, res) => {
    try {
      const result = await createPartLine(req.params.claimId, req.body || {});
      if (result.error) return res.status(result.status || 400).json({ error: result.error });
      res.status(result.status || 201).json({ part: result.row, claim: formatClaimForApi(result.claim) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not create part line' });
    }
  });

  router.delete('/parts/:claimId/:partId', requirePartsCrud, async (req, res) => {
    try {
      const result = await deletePartLine(req.params.claimId, req.params.partId);
      if (result.error) return res.status(result.status || 400).json({ error: result.error });
      res.json({ claim: formatClaimForApi(result.claim) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not delete part line' });
    }
  });

  adminRouter.use(router);
}
