import { Router } from 'express';
import mongoose from 'mongoose';
import { requirePartsAccess, requirePartsCrud } from '../middleware/requireAuth.js';
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
