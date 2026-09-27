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
    submission: {
      checklist: claim.checklist || {},
      driverLicenseFrontAttachments: claim.driverLicenseFrontAttachments || [],
      driverLicenseBackAttachments: claim.driverLicenseBackAttachments || [],
      taxiAuthorityAttachments: claim.taxiAuthorityAttachments || [],
      registrationAttachments: claim.registrationAttachments || [],
      excessPaymentApplicability: claim.excessPaymentApplicability ?? '',
      excessPaymentAmount: claim.excessPaymentAmount ?? '',
      repairQuoteRef: claim.repairQuoteRef ?? '',
    },
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

/** Minimal SVG used as staff attestation “signature” for admin-created claims. */
export function staffAttestationSignatureDataUrl() {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="64">' +
    '<rect width="100%" height="100%" fill="#f8fafc"/>' +
    '<text x="12" y="38" font-family="Arial,sans-serif" font-size="16" fill="#334155">Staff submitted</text>' +
    '</svg>';
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Empty payload matching member `buildClaimPayload` shape (no evidence attachments). */
export function buildEmptyClaimPayload() {
  return {
    checklist: {
      license: false,
      taxiAuthority: false,
      registration: false,
      otherDemand: false,
      policeReport: false,
      excessPayment: false,
      repairQuote: false,
      otherParties: false,
    },
    driverLicenseFrontAttachments: [],
    driverLicenseBackAttachments: [],
    taxiAuthorityAttachments: [],
    registrationAttachments: [],
    policeReportAttachments: [],
    otherDemandAttachments: [],
    repairQuoteAttachments: [],
    excessPaymentApplicability: '',
    excessPaymentAmount: '',
    repairQuoteRef: '',
    memberVehicle: {
      memberNumber: '',
      claimType: 'Claim',
      plateNumber: '',
      kilometers: '',
      make: '',
      model: '',
      monthYear: '',
      ownerName: '',
      address: '',
      mobile: '',
      email: '',
    },
    driver: {
      isOwner: true,
      claimNumber: '',
      firstName: '',
      lastName: '',
      name: '',
      streetAddress: '',
      suburb: '',
      state: '',
      postcode: '',
      address: '',
      mobile: '',
      email: '',
      licenceNumber: '',
      expiryDate: '',
      dateOfBirth: '',
      yearOfHold: '',
      relationship: 'Owner',
      relationshipOther: '',
      alcoholOrDrug: 'No',
      breathTest: 'No',
      policeReported: 'No',
      policeReportNumber: '',
      atFault: 'No',
      admittedLiability: 'No',
      otherDriverAdmittedLiability: 'No',
    },
    incident: {
      date: '',
      day: '',
      time: '',
      addressDetailOptional: '',
      streetName: '',
      suburb: '',
      roadSurface: 'Dry',
      numberOfVehicles: '0',
      coveredVehicleState: 'Moving',
      trafficControls: [],
      description: '',
      estimatedSpeed: '',
      estimatedOtherSpeed: '',
    },
    accidentSketch: {
      diagramDataUrl: '',
      sketchModel: null,
      attachments: [],
    },
    damage: {
      claimingDamage: 'Yes',
      towed: 'No',
      towCompany: '',
      towLocation: '',
      distanceTowed: '',
      currentVehicleLocation: '',
      diagram: {
        markers: [],
        strokes: [],
        scenePhotos: [],
        detailPhotos: [],
      },
    },
    otherParties: [],
    witnessDetails: [],
    declaration: {
      agreed: false,
      signedBy: 'admin',
      typedName: '',
      date: '',
      signatureDataUrl: '',
    },
  };
}

function trimStr(v) {
  return String(v ?? '').trim();
}

function joinDriverName(driver) {
  const explicit = trimStr(driver?.name);
  if (explicit) return explicit;
  return [driver?.firstName, driver?.lastName].map(trimStr).filter(Boolean).join(' ');
}

/**
 * Merge OCR / review draft sections into a full claim payload skeleton.
 * `staff` optional: { email, displayName } for declaration attestation.
 */
export function mergeBuyerDraftIntoPayload(draft, staff = null) {
  const base = buildEmptyClaimPayload();
  const d = draft && typeof draft === 'object' ? draft : {};
  const mv = d.memberVehicle && typeof d.memberVehicle === 'object' ? d.memberVehicle : {};
  const dr = d.driver && typeof d.driver === 'object' ? d.driver : {};
  const inc = d.incident && typeof d.incident === 'object' ? d.incident : {};

  base.memberVehicle = {
    ...base.memberVehicle,
    memberNumber: trimStr(mv.memberNumber) || base.memberVehicle.memberNumber,
    claimType: mv.claimType || base.memberVehicle.claimType,
    plateNumber: trimStr(mv.plateNumber),
    kilometers: trimStr(mv.kilometers),
    make: trimStr(mv.make),
    model: trimStr(mv.model),
    monthYear: trimStr(mv.monthYear),
    ownerName: trimStr(mv.ownerName),
    address: trimStr(mv.address),
    mobile: trimStr(mv.mobile),
    email: trimStr(mv.email),
  };

  const firstName = trimStr(dr.firstName);
  const lastName = trimStr(dr.lastName);
  const name = joinDriverName({ ...dr, firstName, lastName });
  base.driver = {
    ...base.driver,
    isOwner: dr.isOwner !== false && dr.isOwner !== 'No',
    claimNumber: trimStr(dr.claimNumber),
    firstName,
    lastName,
    name,
    streetAddress: trimStr(dr.streetAddress),
    suburb: trimStr(dr.suburb),
    state: trimStr(dr.state),
    postcode: trimStr(dr.postcode),
    address:
      trimStr(dr.address) ||
      [dr.streetAddress, dr.suburb, dr.state, dr.postcode].map(trimStr).filter(Boolean).join(', '),
    mobile: trimStr(dr.mobile) || base.memberVehicle.mobile,
    email: trimStr(dr.email) || base.memberVehicle.email,
    licenceNumber: trimStr(dr.licenceNumber),
    expiryDate: dr.expiryDate || '',
    dateOfBirth: dr.dateOfBirth || '',
    yearOfHold: trimStr(dr.yearOfHold),
    relationship: dr.relationship || 'Owner',
    relationshipOther: trimStr(dr.relationshipOther),
  };

  const incidentDate = trimStr(inc.date);
  let incidentDay = '';
  if (incidentDate) {
    const parsed = new Date(incidentDate);
    if (!Number.isNaN(parsed.getTime())) {
      incidentDay = parsed.toLocaleDateString('en-AU', { weekday: 'long' });
    }
  }
  base.incident = {
    ...base.incident,
    date: incidentDate,
    day: incidentDay,
    time: trimStr(inc.time),
    addressDetailOptional: trimStr(inc.addressDetailOptional),
    streetName: trimStr(inc.streetName),
    suburb: trimStr(inc.suburb),
    roadSurface: inc.roadSurface || 'Dry',
    numberOfVehicles: trimStr(inc.numberOfVehicles) || '0',
    coveredVehicleState: inc.coveredVehicleState || 'Moving',
    trafficControls: Array.isArray(inc.trafficControls) ? inc.trafficControls : [],
    description: trimStr(inc.description),
    estimatedSpeed: trimStr(inc.estimatedSpeed),
    estimatedOtherSpeed: trimStr(inc.estimatedOtherSpeed),
  };

  if (Array.isArray(d.otherParties) && d.otherParties.length) {
    base.otherParties = d.otherParties.slice(0, 10).map((party) => {
      const p = party && typeof party === 'object' ? party : {};
      return {
        plateNumber: trimStr(p.plateNumber),
        make: trimStr(p.make),
        model: trimStr(p.model),
        color: trimStr(p.color),
        driverName: trimStr(p.driverName),
        ownerDetails: trimStr(p.ownerDetails),
        address: trimStr(p.address),
        mobile: trimStr(p.mobile),
        email: trimStr(p.email),
        licenceNumber: trimStr(p.licenceNumber),
        expiryDate: p.expiryDate || '',
        dateOfBirth: p.dateOfBirth || '',
        insuranceCompany: trimStr(p.insuranceCompany),
        claimNumber: trimStr(p.claimNumber),
        licenceFrontAttachments: [],
        licenceBackAttachments: [],
      };
    });
    base.checklist.otherParties = base.otherParties.length > 0;
  }

  const staffName =
    trimStr(staff?.displayName) || trimStr(staff?.email) || 'Administrator';
  base.declaration = {
    agreed: true,
    signedBy: 'admin',
    typedName: staffName,
    date: new Date().toISOString().slice(0, 10),
    signatureDataUrl: staffAttestationSignatureDataUrl(),
  };

  return base;
}

/** Validate claim before admin create (declaration already staff-attested). */
export function validateAdminCreatedClaim(claim) {
  const errors = [];
  if (!claim || typeof claim !== 'object') {
    errors.push('claim is required');
    return errors;
  }
  if (!claim.memberVehicle || typeof claim.memberVehicle !== 'object') {
    errors.push('claim.memberVehicle is required');
  } else if (!trimStr(claim.memberVehicle.plateNumber)) {
    errors.push('claim.memberVehicle.plateNumber is required');
  }
  if (!claim.driver || typeof claim.driver !== 'object') {
    errors.push('claim.driver is required');
  } else if (!trimStr(claim.driver.name)) {
    errors.push('claim.driver.name is required');
  }
  if (!claim.incident || typeof claim.incident !== 'object') {
    errors.push('claim.incident is required');
  } else if (!trimStr(claim.incident.date)) {
    errors.push('claim.incident.date is required');
  }
  if (!claim.declaration || typeof claim.declaration !== 'object') {
    errors.push('claim.declaration is required');
  } else {
    if (!claim.declaration.agreed) errors.push('claim.declaration.agreed must be true');
    if (!trimStr(claim.declaration.typedName)) errors.push('claim.declaration.typedName is required');
    if (!trimStr(claim.declaration.signatureDataUrl)) {
      errors.push('claim.declaration.signatureDataUrl is required');
    }
  }
  return errors;
}
