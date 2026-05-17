/**
 * Aligns horizon-user-app `buildClaimPayload` with stored claim + admin `data` shape.
 */


const INTAKE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateIntakeReference() {
  const seg = (n) =>
    Array.from({ length: n }, () => INTAKE_CHARS[Math.floor(Math.random() * INTAKE_CHARS.length)]).join('');
  return `HR-${seg(4)}-${seg(4)}`;
}

export function normalizeIntakeReference(raw) {
  let alnum = String(raw ?? '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
  if (alnum.startsWith('HR') && alnum.length === 10) {
    alnum = alnum.slice(2);
  }
  if (alnum.length !== 8 || !/^[A-Z0-9]{8}$/.test(alnum)) return null;
  return `HR-${alnum.slice(0, 4)}-${alnum.slice(4)}`;
}

export function validateIntakeBody(body) {
  const errors = [];
  if (!body || typeof body !== 'object') {
    errors.push('Expected JSON object');
    return errors;
  }
  const intake = normalizeIntakeReference(body.intakeReference);
  if (!intake) {
    errors.push('intakeReference must be HR-XXXX-XXXX (8 letters/digits; hyphens optional)');
  }
  const claim = body.claim;
  if (!claim || typeof claim !== 'object') {
    errors.push('claim is required (object from buildClaimPayload)');
    return errors;
  }
  if (!claim.memberVehicle || typeof claim.memberVehicle !== 'object') {
    errors.push('claim.memberVehicle is required');
  } else if (!String(claim.memberVehicle.plateNumber || '').trim()) {
    errors.push('claim.memberVehicle.plateNumber is required');
  }
  if (!claim.driver || typeof claim.driver !== 'object') {
    errors.push('claim.driver is required');
  } else if (!String(claim.driver.name || '').trim()) {
    errors.push('claim.driver.name is required');
  }
  if (!claim.incident || typeof claim.incident !== 'object') {
    errors.push('claim.incident is required');
  } else if (!String(claim.incident.date || '').trim()) {
    errors.push('claim.incident.date is required');
  }
  if (!claim.declaration || typeof claim.declaration !== 'object') {
    errors.push('claim.declaration is required');
  } else {
    if (!claim.declaration.agreed) errors.push('claim.declaration.agreed must be true');
    if (!String(claim.declaration.typedName || '').trim()) errors.push('claim.declaration.typedName is required');
    if (!String(claim.declaration.signatureDataUrl || '').trim()) {
      errors.push('claim.declaration.signatureDataUrl is required');
    }
  }
  return errors;
}

function witnessArrayToAdminObject(witnessDetails) {
  const list = Array.isArray(witnessDetails) ? witnessDetails : [];
  const w1 = list[0] || {};
  const w2 = list[1] || {};
  return {
    witness1Name: w1.name || '',
    witness1Address: w1.address || '',
    witness1Mobile: w1.mobile || '',
    witness1Email: w1.email || '',
    witness2Name: w2.name || '',
    witness2Address: w2.address || '',
    witness2Mobile: w2.mobile || '',
    witness2Email: w2.email || '',
  };
}

/** Admin UI counts `data.damage.points` via Object.values(...).length — use one bucket of markers. */
function buildDamageForAdmin(damage) {
  if (!damage || typeof damage !== 'object') return {};
  const markers = damage.diagram?.markers ?? [];
  const { diagram, ...rest } = damage;
  return {
    ...rest,
    diagram,
    points: markers.length ? { markers } : {},
  };
}

export function buildDataFromClaimPayload(claim) {
  return {
    memberVehicle: claim.memberVehicle,
    incident: claim.incident,
    otherParties: claim.otherParties || [],
    driver: claim.driver,
    witnessDetails: witnessArrayToAdminObject(claim.witnessDetails),
    damage: buildDamageForAdmin(claim.damage),
  };
}

export function deriveQueueFields(claim) {
  const plate = claim?.memberVehicle?.plateNumber || '';
  const driver = claim?.driver?.name || '';
  const dateOfIncident = claim?.incident?.date || '';
  const summary = (claim?.incident?.description || '').slice(0, 280);
  const submittedAt = new Date().toISOString().slice(0, 10);
  const priority = derivePriority(claim);
  const data = buildDataFromClaimPayload(claim);
  return { plateNumber: plate, driverName: driver, dateOfIncident, submittedAt, summary, priority, data };
}

function derivePriority(_claim) {
  return 'Normal';
}

export function nextSystemReference() {
  return `HRZ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

function splitPersonName(full) {
  const parts = String(full ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/** Public wizard prefill from a submitted claim (contact + licence fields only). */
export function extractPrefillForWizard(claimDoc) {
  const payload =
    claimDoc?.payload && typeof claimDoc.payload === 'object' ? claimDoc.payload : null;
  const data = claimDoc?.data && typeof claimDoc.data === 'object' ? claimDoc.data : {};

  const mvSrc = payload?.memberVehicle || data.memberVehicle || {};
  const memberVehicle = {
    memberNumber: String(mvSrc.memberNumber ?? '').trim(),
    claimType: mvSrc.claimType || 'Claim',
    plateNumber: String(mvSrc.plateNumber ?? '').trim(),
    kilometers: String(mvSrc.kilometers ?? '').trim(),
    make: String(mvSrc.make ?? '').trim(),
    model: String(mvSrc.model ?? '').trim(),
    monthYear: String(mvSrc.monthYear ?? '').trim(),
    ownerName: String(mvSrc.ownerName ?? '').trim(),
    address: String(mvSrc.address ?? '').trim(),
    mobile: String(mvSrc.mobile ?? '').trim(),
    email: String(mvSrc.email ?? '').trim(),
  };

  const drSrc = payload?.driver || data.driver || {};
  const nameParts = splitPersonName(drSrc.name || claimDoc?.driverName || '');
  const driver = {
    isOwner: drSrc.isOwner !== false && drSrc.isOwner !== 'No',
    claimNumber: String(drSrc.claimNumber ?? '').trim(),
    firstName: String(drSrc.firstName ?? nameParts.firstName).trim(),
    lastName: String(drSrc.lastName ?? nameParts.lastName).trim(),
    streetAddress: String(drSrc.streetAddress ?? '').trim(),
    suburb: String(drSrc.suburb ?? '').trim(),
    state: String(drSrc.state ?? '').trim(),
    postcode: String(drSrc.postcode ?? '').trim(),
    mobile: String(drSrc.mobile ?? '').trim(),
    email: String(drSrc.email ?? '').trim(),
    licenceNumber: String(drSrc.licenceNumber ?? '').trim(),
    expiryDate: drSrc.expiryDate || '',
    dateOfBirth: drSrc.dateOfBirth || '',
    yearOfHold: String(drSrc.yearOfHold ?? '').trim(),
    relationship: drSrc.relationship || 'Owner',
    relationshipOther: String(drSrc.relationshipOther ?? '').trim(),
  };

  return { memberVehicle, driver, intakeReference: claimDoc.intakeReference || null };
}
