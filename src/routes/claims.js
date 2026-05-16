import { Router } from 'express';
import { Claim } from '../models/Claim.js';
import { ClaimDraft } from '../models/ClaimDraft.js';
import {
  deriveQueueFields,
  nextSystemReference,
  normalizeIntakeReference,
  validateIntakeBody,
} from '../services/claimIntake.js';
import { attachClaimDraftRoutes } from './claimDrafts.js';

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
    const intakeReference = normalizeIntakeReference(body.intakeReference);
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

    const systemRef = nextSystemReference();
    const { plateNumber, driverName, dateOfIncident, submittedAt, summary, priority, data } = deriveQueueFields(claim);

    const doc = await Claim.create({
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
      payload: claim,
      paymentStatus: 'pending',
      adminNote: '',
      parts: [],
      quoteOptions: [],
      primaryQuoteId: null,
      finalQuoteId: null,
      caseFiles: [],
    });

    await deleteIntakeDraft(intakeReference);

    return res.status(201).json({
      id: doc._id.toString(),
      reference: doc.reference,
      intakeReference: doc.intakeReference,
      duplicate: false,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Reference collision; retry submission' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Could not create claim' });
  }
});
