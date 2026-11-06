import { Claim } from '../models/Claim.js';
import { extractPrefillForWizard, normalizeIntakeReference } from './claimIntake.js';

const MIN_MEMBER_NUMBER = 3;
const MAX_MEMBER_NUMBER = 80;

export function normalizeMemberNumberQuery(raw) {
  const memberNumber = String(raw ?? '').trim();
  if (memberNumber.length < MIN_MEMBER_NUMBER || memberNumber.length > MAX_MEMBER_NUMBER) {
    const err = new Error(`Member number must be ${MIN_MEMBER_NUMBER} to ${MAX_MEMBER_NUMBER} characters`);
    err.statusCode = 400;
    throw err;
  }
  return memberNumber;
}

function prefillFromClaim(claim) {
  if (!claim) return null;
  const prefill = extractPrefillForWizard(claim);
  return {
    memberVehicle: prefill.memberVehicle,
    driver: prefill.driver,
  };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Claim reference pasted into the member field.
 * HR-XXXX-XXXX is the member portal code. HRZ-… is the internal file reference.
 */
async function findClaimByReference(raw) {
  const text = String(raw ?? '').trim();
  const compact = text.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

  if (compact.startsWith('HRZ') && compact.length >= 6) {
    const claim = await Claim.findOne({
      reference: new RegExp(`^${escapeRegex(text)}$`, 'i'),
    })
      .sort({ createdAt: -1 })
      .lean();
    if (claim) return claim;
  }

  if (compact.startsWith('HR') && !compact.startsWith('HRZ')) {
    const intake = normalizeIntakeReference(text);
    if (intake) {
      const claim = await Claim.findOne({ intakeReference: intake }).lean();
      if (claim) return claim;
    }
  }

  return null;
}

/**
 * Latest claim for this member number, or the claim matching a pasted reference code.
 * Returns vehicle + driver contact fields only — not the old incident.
 */
export async function findBuyerPrefillByMemberNumber(raw) {
  const memberNumber = normalizeMemberNumberQuery(raw);
  const byReference = await findClaimByReference(memberNumber);
  if (byReference) return prefillFromClaim(byReference);

  const key = memberNumber.toLowerCase();

  let claim = await Claim.findOne({ memberNumberKey: key }).sort({ createdAt: -1 }).lean();
  if (!claim) {
    claim = await Claim.findOne({
      'payload.memberVehicle.memberNumber': new RegExp(`^${escapeRegex(key)}$`, 'i'),
    })
      .sort({ createdAt: -1 })
      .lean();
  }
  return prefillFromClaim(claim);
}
