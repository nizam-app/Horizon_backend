import { Router } from 'express';
import mongoose from 'mongoose';
import { Claim } from '../models/Claim.js';
import { ClaimDraft } from '../models/ClaimDraft.js';
import {
  deriveQueueFields,
  extractPrefillForWizard,
  generateIntakeReference,
  nextSystemReference,
  normalizeIntakeReference,
  validateIntakeBody,
} from '../services/claimIntake.js';
import { attachClaimDraftRoutes } from './claimDrafts.js';
import { isClaimEmailConfigured, queueClaimSubmissionEmail } from '../services/claimEmail.js';
import { materializeClaimEvidenceFiles } from '../services/claimEvidenceStorage.js';

import rateLimit from 'express-rate-limit';

export const claimsRouter = Router();

attachClaimDraftRoutes(claimsRouter);

async function deleteIntakeDraft(intakeReference) {
  try {
    await ClaimDraft.deleteMany({ intakeReference });
  } catch (e) {
    console.error('deleteIntakeDraft', e);
  }
}

const intakeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.MAX_CLAIM_SUBMITS_PER_IP_HOUR || 120),
  standardHeaders: true,
  legacyHeaders: false,
});

const prefillLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.MAX_CLAIM_PREFILL_LOOKUPS_PER_IP_HOUR || 120),
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * GET /v1/claims/intake/:code/prefill
 * Returns member + driver contact fields from a previously submitted claim (new claim prefill).
 */
claimsRouter.get('/intake/:code/prefill', prefillLimiter, async (req, res) => {
  try {
    const code = normalizeIntakeReference(req.params.code);
    if (!code) return res.status(400).json({ error: 'Invalid reference code' });
    const claim = await Claim.findOne({ intakeReference: code }).lean();
    if (!claim) {
      return res.status(404).json({ error: 'No claim found for this reference code' });
    }
    const prefill = extractPrefillForWizard(claim);
    return res.json({ intakeReference: code, prefill });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not load claim details' });
  }
});

/**
 * POST /v1/claims
 * Body: { intakeReference: "HR-ABCD-EFGH", claim: <buildClaimPayload()> }
 * Idempotent: same intakeReference returns existing claim (200) unless you add ?force=false only 201 for new - actually return 200 with same body for duplicate submit.
 */
claimsRouter.post('/', intakeLimiter, async (req, res) => {
  try {
    const body = req.body;
    const errors = validateIntakeBody(body);
    if (errors.length) {
      return res.status(400).json({ error: errors.join('; ') });
    }
    let intakeReference = normalizeIntakeReference(body.intakeReference);
    if (!intakeReference) intakeReference = generateIntakeReference();
    const claim = body.claim;

    const existing = await Claim.findOne({ intakeReference }).lean();
    if (existing) {
      await deleteIntakeDraft(intakeReference);
      return res.status(200).json({
        id: existing._id.toString(),
        reference: existing.reference,
        intakeReference: existing.intakeReference,
        duplicate: true,
      });
    }

    const claimId = new mongoose.Types.ObjectId();
    const storedClaim = await materializeClaimEvidenceFiles(claim, claimId);
    const systemRef = nextSystemReference();
    const { plateNumber, driverName, dateOfIncident, submittedAt, summary, priority, data } = deriveQueueFields(storedClaim);

    const doc = await Claim.create({
      _id: claimId,
      intakeReference,
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
      adminNote: '',
      parts: [],
      quotePrice: null,
      insuranceApprovedPrice: null,
      quoteOptions: [],
      primaryQuoteId: null,
      finalQuoteId: null,
      caseFiles: [],
    });

    await deleteIntakeDraft(intakeReference);

    const emailQueued = isClaimEmailConfigured();
    if (emailQueued) {
      queueClaimSubmissionEmail({
        claim,
        intakeReference: doc.intakeReference,
        systemReference: doc.reference,
      });
    }

    return res.status(201).json({
      id: doc._id.toString(),
      reference: doc.reference,
      intakeReference: doc.intakeReference,
      duplicate: false,
      emailQueued,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Reference collision; retry submission' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Could not create claim' });
  }
});
