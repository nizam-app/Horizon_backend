import rateLimit from 'express-rate-limit';
import { ClaimDraft } from '../models/ClaimDraft.js';
import { normalizeIntakeReference } from '../services/claimIntake.js';
import { stripClaimEvidenceDataUrls } from '../services/claimEvidenceStorage.js';

const draftLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.MAX_CLAIM_DRAFT_SAVES_PER_IP_HOUR || 3000),
  standardHeaders: true,
  legacyHeaders: false,
});

function validateSnapshot(body) {
  const snapshot = body?.snapshot ?? body;
  if (!snapshot || typeof snapshot !== 'object') return null;
  if (snapshot.version !== 1 || !snapshot.claim) return null;
  return snapshot;
}

/** GET/PUT/DELETE /v1/claims/drafts/:code */
export function attachClaimDraftRoutes(claimsRouter) {
  claimsRouter.get('/drafts/:code', draftLimiter, async (req, res) => {
    try {
      const code = normalizeIntakeReference(req.params.code);
      if (!code) return res.status(400).json({ error: 'Invalid reference code' });
      const doc = await ClaimDraft.findOne({ intakeReference: code }).lean();
      if (!doc) return res.status(404).json({ error: 'No draft found' });
      return res.json({ snapshot: doc.snapshot });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Could not load draft' });
    }
  });

  claimsRouter.put('/drafts/:code', draftLimiter, async (req, res) => {
    try {
      const code = normalizeIntakeReference(req.params.code);
      if (!code) return res.status(400).json({ error: 'Invalid reference code' });
      const snapshot = validateSnapshot(req.body);
      if (!snapshot) return res.status(400).json({ error: 'Invalid draft payload' });
      const storedSnapshot = stripClaimEvidenceDataUrls(snapshot);

      await ClaimDraft.findOneAndUpdate(
        { intakeReference: code },
        { $set: { intakeReference: code, snapshot: storedSnapshot } },
        { upsert: true, new: true }
      );
      return res.status(204).send();
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Could not save draft' });
    }
  });

  claimsRouter.delete('/drafts/:code', draftLimiter, async (req, res) => {
    try {
      const code = normalizeIntakeReference(req.params.code);
      if (!code) return res.status(400).json({ error: 'Invalid reference code' });
      await ClaimDraft.deleteMany({ intakeReference: code });
      return res.status(204).send();
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Could not delete draft' });
    }
  });
}
