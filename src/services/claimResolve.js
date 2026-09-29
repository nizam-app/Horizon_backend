import { Claim } from '../models/Claim.js';

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Strip invisible chars / extra spaces from pasted queue IDs. */
export function normalizeClaimLookupKey(raw) {
  return String(raw ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

/**
 * Resolve Mongo claim id from 24-char hex, system reference (HRZ-…), or member intake code.
 */
export async function resolveClaimMongoId(identifier) {
  const raw = normalizeClaimLookupKey(identifier);
  if (!raw) return null;

  if (/^[a-f\d]{24}$/i.test(raw)) {
    const byId = await Claim.findById(raw).select('_id').lean();
    return byId ? byId._id.toString() : null;
  }

  const rx = new RegExp(`^${escapeRegex(raw)}$`, 'i');
  const byRef = await Claim.findOne({
    $or: [{ reference: rx }, { intakeReference: rx }],
  })
    .select('_id')
    .lean();
  return byRef ? byRef._id.toString() : null;
}
