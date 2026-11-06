import mongoose from 'mongoose';
import { Claim } from '../models/Claim.js';
import { ClaimEditRequest } from '../models/ClaimEditRequest.js';
import { StaffUser } from '../models/StaffUser.js';
import { requireAdmin, requireSuperAdmin } from '../middleware/requireAuth.js';
import { formatClaimForApi } from '../services/claimAdmin.js';
import {
  MEMBER_SUBMISSION_SECTIONS,
  applyMemberSubmissionSection,
  buildClaimUpdateFromPayload,
} from '../services/claimSubmissionAdmin.js';

function actorFrom(user, staff) {
  return {
    staffId: String(user?.sub || staff?._id || ''),
    email: String(staff?.email || user?.email || ''),
    displayName: String(staff?.displayName || user?.displayName || ''),
  };
}

function formatRequest(doc) {
  if (!doc) return null;
  return {
    id: doc._id.toString(),
    claimId: doc.claimId.toString(),
    section: doc.section,
    proposedData: doc.proposedData,
    status: doc.status,
    requestedBy: doc.requestedBy || {},
    reviewedBy: doc.reviewedBy || null,
    reviewedAt: doc.reviewedAt || null,
    reviewNote: doc.reviewNote || '',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function loadActor(req) {
  if (!req.user?.sub) return { role: req.user?.role || '', staff: null };
  const staff = await StaffUser.findById(req.user.sub).select('role active email displayName').lean();
  if (!staff || !staff.active) {
    const err = new Error('Account is disabled or no longer exists');
    err.statusCode = 401;
    throw err;
  }
  return { role: staff.role, staff };
}

async function saveSection(existing, section, data) {
  const nextPayload = applyMemberSubmissionSection(existing.payload, section, data);
  const claimFields = buildClaimUpdateFromPayload(nextPayload);
  const updated = await Claim.findByIdAndUpdate(existing._id, { $set: claimFields }, { new: true }).lean();
  return updated;
}

export function attachClaimEditRoutes(adminRouter) {
  adminRouter.get('/claims/:id/edit-requests', requireAdmin, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ error: 'Invalid claim id' });
      }
      const status = String(req.query.status || 'pending').trim();
      const filter = { claimId: req.params.id };
      if (status && status !== 'all') filter.status = status;
      const rows = await ClaimEditRequest.find(filter).sort({ updatedAt: -1 }).lean();
      return res.json({ requests: rows.map(formatRequest) });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Could not load edit requests' });
    }
  });

  adminRouter.post('/claims/:id/edit-requests/:requestId/approve', requireSuperAdmin, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id) || !mongoose.Types.ObjectId.isValid(req.params.requestId)) {
        return res.status(400).json({ error: 'Invalid id' });
      }
      const request = await ClaimEditRequest.findOne({
        _id: req.params.requestId,
        claimId: req.params.id,
        status: 'pending',
      }).lean();
      if (!request) return res.status(404).json({ error: 'Pending edit not found' });

      const existing = await Claim.findById(req.params.id).lean();
      if (!existing?.payload) return res.status(404).json({ error: 'Claim not found' });

      let updated;
      try {
        updated = await saveSection(existing, request.section, request.proposedData);
      } catch (err) {
        const status = err.statusCode === 400 ? 400 : 500;
        return res.status(status).json({ error: err.message || 'Could not apply edit' });
      }

      const { staff } = await loadActor(req);
      await ClaimEditRequest.updateOne(
        { _id: request._id },
        {
          $set: {
            status: 'approved',
            reviewedBy: actorFrom(req.user, staff),
            reviewedAt: new Date(),
            reviewNote: '',
          },
        },
      );
      return res.json({ claim: formatClaimForApi(updated), requestId: request._id.toString(), section: request.section });
    } catch (err) {
      const status = err?.statusCode === 401 ? 401 : 500;
      if (status === 500) console.error(err);
      return res.status(status).json({ error: err?.message || 'Could not approve edit' });
    }
  });

  adminRouter.post('/claims/:id/edit-requests/:requestId/reject', requireSuperAdmin, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id) || !mongoose.Types.ObjectId.isValid(req.params.requestId)) {
        return res.status(400).json({ error: 'Invalid id' });
      }
      const { staff } = await loadActor(req);
      const updated = await ClaimEditRequest.findOneAndUpdate(
        { _id: req.params.requestId, claimId: req.params.id, status: 'pending' },
        {
          $set: {
            status: 'rejected',
            reviewedBy: actorFrom(req.user, staff),
            reviewedAt: new Date(),
            reviewNote: String(req.body?.note || '').slice(0, 500),
          },
        },
        { new: true },
      ).lean();
      if (!updated) return res.status(404).json({ error: 'Pending edit not found' });
      const claim = await Claim.findById(req.params.id).lean();
      return res.json({ claim: formatClaimForApi(claim), request: formatRequest(updated) });
    } catch (err) {
      const status = err?.statusCode === 401 ? 401 : 500;
      if (status === 500) console.error(err);
      return res.status(status).json({ error: err?.message || 'Could not reject edit' });
    }
  });
}

export async function queueOrApplyMemberSection({ req, existing, section, data }) {
  if (!MEMBER_SUBMISSION_SECTIONS.includes(section)) {
    const err = new Error(`Invalid section. Allowed: ${MEMBER_SUBMISSION_SECTIONS.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }
  const { role, staff } = await loadActor(req);
  // Validate before queueing or writing. Live claim stays unchanged for admin.
  applyMemberSubmissionSection(existing.payload, section, data);

  if (role === 'super_admin') {
    const updated = await saveSection(existing, section, data);
    await ClaimEditRequest.updateMany(
      { claimId: existing._id, section, status: 'pending' },
      {
        $set: {
          status: 'superseded',
          reviewedBy: actorFrom(req.user, staff),
          reviewedAt: new Date(),
          reviewNote: 'Superseded by a direct super admin edit',
        },
      },
    );
    return { pending: false, claim: updated, request: null };
  }

  const requestedBy = actorFrom(req.user, staff);
  const request = await ClaimEditRequest.findOneAndUpdate(
    { claimId: existing._id, section, status: 'pending' },
    { $set: { proposedData: data, requestedBy }, $setOnInsert: { claimId: existing._id, section, status: 'pending' } },
    { new: true, upsert: true },
  ).lean();
  return { pending: true, claim: existing, request };
}
