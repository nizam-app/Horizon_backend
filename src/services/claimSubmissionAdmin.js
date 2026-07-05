import { buildDataFromClaimPayload, deriveQueueFields } from './claimIntake.js';

export const MEMBER_SUBMISSION_SECTIONS = [
  'checklist',
  'memberVehicle',
  'driver',
  'incident',
  'damage',
  'otherParties',
  'witnessDetails',
  'declaration',
];

const MAX_STR = 2000;
const MAX_ATTACHMENT_DATA_URL = 6 * 1024 * 1024;

function cleanStr(v, max = MAX_STR) {
  if (v == null) return '';
  return String(v).trim().slice(0, max);
}

function cleanBool(v) {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 'Yes' || v === 'yes' || v === '1') return true;
  if (v === 'false' || v === 'No' || v === 'no' || v === '0') return false;
  return Boolean(v);
}

function cleanYesNo(v) {
  if (v === true || v === 'true' || v === 1 || v === '1') return 'Yes';
  if (v === false || v === 'false' || v === 0 || v === '0') return 'No';
  const s = cleanStr(v, 40);
  if (s === 'Yes' || s === 'No') return s;
  if (s.toLowerCase() === 'yes') return 'Yes';
  if (s.toLowerCase() === 'no') return 'No';
  return s;
}

function formatIncidentDay(dateStr) {
  const raw = cleanStr(dateStr, 40);
  if (!raw) return '';
  const d = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-AU', { weekday: 'long' });
}

function joinDriverFullName(driver) {
  const explicit = cleanStr(driver?.name, 200);
  if (explicit) return explicit;
  return [cleanStr(driver?.firstName, 120), cleanStr(driver?.lastName, 120)].filter(Boolean).join(' ');
}

function joinDriverPostalAddress(driver) {
  const explicit = cleanStr(driver?.address, MAX_STR);
  if (explicit) return explicit;
  return [
    cleanStr(driver?.streetAddress, 500),
    cleanStr(driver?.suburb, 200),
    cleanStr(driver?.state, 80),
    cleanStr(driver?.postcode, 20),
  ]
    .filter(Boolean)
    .join(', ');
}

function sanitizeAttachments(list, existingList = []) {
  if (!Array.isArray(list)) return [];
  const existingById = new Map();
  for (const f of existingList || []) {
    if (f?.id) existingById.set(String(f.id), f);
  }
  return list
    .filter((f) => f && typeof f === 'object')
    .map((f, index) => {
      const id = cleanStr(f.id || `att-${index}`, 120) || `att-${index}`;
      const prev = existingById.get(String(id)) || {};
      let dataUrl = typeof f.dataUrl === 'string' ? f.dataUrl.trim() : '';
      if (!dataUrl && prev) {
        dataUrl = typeof prev?.dataUrl === 'string' ? prev.dataUrl.trim() : '';
      }
      if (dataUrl && dataUrl.length > MAX_ATTACHMENT_DATA_URL) dataUrl = '';
      const url = cleanStr(f.url || f.fileUrl || prev.url || prev.fileUrl, 2000);
      const storageKey = cleanStr(f.storageKey || prev.storageKey, 500);
      const storageProvider = cleanStr(f.storageProvider || prev.storageProvider, 40);
      const cloudinaryPublicId = cleanStr(f.cloudinaryPublicId || prev.cloudinaryPublicId, 500);
      const cloudinaryResourceType = cleanStr(f.cloudinaryResourceType || prev.cloudinaryResourceType, 40);
      const cloudinaryFormat = cleanStr(f.cloudinaryFormat || prev.cloudinaryFormat, 40);
      const mimeType = cleanStr(f.mimeType || prev.mimeType, 120);
      const size = Number.isFinite(Number(f.size ?? prev.size)) ? Number(f.size ?? prev.size) : undefined;
      const item = {
        id,
        name: cleanStr(f.name || f.originalName || 'file', 260),
        source: cleanStr(f.source, 40) || 'upload',
      };
      if (dataUrl) item.dataUrl = dataUrl;
      if (url) {
        item.url = url;
        item.fileUrl = url;
      }
      if (storageKey) item.storageKey = storageKey;
      if (storageProvider) item.storageProvider = storageProvider;
      if (cloudinaryPublicId) item.cloudinaryPublicId = cloudinaryPublicId;
      if (cloudinaryResourceType) item.cloudinaryResourceType = cloudinaryResourceType;
      if (cloudinaryFormat) item.cloudinaryFormat = cloudinaryFormat;
      if (mimeType) item.mimeType = mimeType;
      if (size !== undefined) item.size = size;
      return item;
    })
    .filter((f) => f.name || f.dataUrl || f.url || f.fileUrl);
}

function sanitizeChecklist(checklist) {
  const keys = [
    'license',
    'taxiAuthority',
    'registration',
    'otherDemand',
    'policeReport',
    'excessPayment',
    'repairQuote',
    'otherParties',
  ];
  const out = {};
  for (const key of keys) {
    if (checklist && Object.prototype.hasOwnProperty.call(checklist, key)) {
      out[key] = cleanBool(checklist[key]);
    }
  }
  return out;
}

function sanitizeMemberVehicle(mv) {
  if (!mv || typeof mv !== 'object') return {};
  return {
    memberNumber: cleanStr(mv.memberNumber, 80),
    claimType: cleanStr(mv.claimType, 80),
    plateNumber: cleanStr(mv.plateNumber, 40),
    kilometers: cleanStr(mv.kilometers, 40),
    make: cleanStr(mv.make, 120),
    model: cleanStr(mv.model, 120),
    monthYear: cleanStr(mv.monthYear, 40),
    ownerName: cleanStr(mv.ownerName, 200),
    address: cleanStr(mv.address, MAX_STR),
    mobile: cleanStr(mv.mobile, 40),
    email: cleanStr(mv.email, 200),
  };
}

function sanitizeDriver(dr) {
  if (!dr || typeof dr !== 'object') return {};
  const out = {
    isOwner: dr.isOwner != null && dr.isOwner !== '' ? cleanYesNo(dr.isOwner) : dr.isOwner,
    claimNumber: cleanStr(dr.claimNumber, 80),
    firstName: cleanStr(dr.firstName, 120),
    lastName: cleanStr(dr.lastName, 120),
    name: cleanStr(dr.name, 200),
    streetAddress: cleanStr(dr.streetAddress, 500),
    suburb: cleanStr(dr.suburb, 200),
    state: cleanStr(dr.state, 80),
    postcode: cleanStr(dr.postcode, 20),
    mobile: cleanStr(dr.mobile, 40),
    email: cleanStr(dr.email, 200),
    licenceNumber: cleanStr(dr.licenceNumber, 80),
    expiryDate: cleanStr(dr.expiryDate, 40),
    dateOfBirth: cleanStr(dr.dateOfBirth, 40),
    yearOfHold: cleanStr(dr.yearOfHold, 20),
    relationship: cleanStr(dr.relationship, 80),
    relationshipOther: cleanStr(dr.relationshipOther, 200),
    alcoholOrDrug: dr.alcoholOrDrug != null && dr.alcoholOrDrug !== '' ? cleanYesNo(dr.alcoholOrDrug) : dr.alcoholOrDrug,
    breathTest: dr.breathTest != null && dr.breathTest !== '' ? cleanYesNo(dr.breathTest) : dr.breathTest,
    policeReported:
      dr.policeReported != null && dr.policeReported !== '' ? cleanYesNo(dr.policeReported) : dr.policeReported,
    policeReportNumber: cleanStr(dr.policeReportNumber, 120),
    atFault: dr.atFault != null && dr.atFault !== '' ? cleanYesNo(dr.atFault) : dr.atFault,
    admittedLiability:
      dr.admittedLiability != null && dr.admittedLiability !== '' ? cleanYesNo(dr.admittedLiability) : dr.admittedLiability,
    otherDriverAdmittedLiability:
      dr.otherDriverAdmittedLiability != null && dr.otherDriverAdmittedLiability !== ''
        ? cleanYesNo(dr.otherDriverAdmittedLiability)
        : dr.otherDriverAdmittedLiability,
  };
  out.name = joinDriverFullName(out);
  out.address = joinDriverPostalAddress(out);
  if (out.atFault !== 'Yes') out.admittedLiability = '';
  if (out.atFault !== 'No') out.otherDriverAdmittedLiability = '';
  if (cleanStr(out.policeReportNumber)) out.policeReported = 'Yes';
  return out;
}

function sanitizeIncident(inc) {
  if (!inc || typeof inc !== 'object') return {};
  const date = cleanStr(inc.date, 40);
  const trafficControls = Array.isArray(inc.trafficControls)
    ? inc.trafficControls.map((x) => cleanStr(x, 120)).filter(Boolean)
    : cleanStr(inc.trafficControls, MAX_STR)
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
  return {
    date,
    day: formatIncidentDay(date) || cleanStr(inc.day, 40),
    time: cleanStr(inc.time, 20),
    addressDetailOptional: cleanStr(inc.addressDetailOptional, MAX_STR),
    streetName: cleanStr(inc.streetName, 500),
    suburb: cleanStr(inc.suburb, 200),
    roadSurface: cleanStr(inc.roadSurface, 120),
    numberOfVehicles: cleanStr(inc.numberOfVehicles, 20),
    coveredVehicleState: cleanStr(inc.coveredVehicleState, 120),
    trafficControls,
    description: cleanStr(inc.description, MAX_STR),
    estimatedSpeed: cleanStr(inc.estimatedSpeed, 40),
    estimatedOtherSpeed: cleanStr(inc.estimatedOtherSpeed, 40),
  };
}

function sanitizeDamage(dmg, existingPayload) {
  if (!dmg || typeof dmg !== 'object') return {};
  const existingDiagram = existingPayload?.damage?.diagram || {};
  const diagramIn = dmg.diagram && typeof dmg.diagram === 'object' ? dmg.diagram : {};
  const towed = dmg.towed != null && dmg.towed !== '' ? cleanYesNo(dmg.towed) : dmg.towed;
  return {
    claimingDamage:
      dmg.claimingDamage != null && dmg.claimingDamage !== '' ? cleanYesNo(dmg.claimingDamage) : dmg.claimingDamage,
    towed,
    towCompany: towed === 'Yes' ? cleanStr(dmg.towCompany, 200) : '',
    towLocation: towed === 'Yes' ? cleanStr(dmg.towLocation, MAX_STR) : '',
    distanceTowed: towed === 'Yes' ? cleanStr(dmg.distanceTowed, 80) : '',
    currentVehicleLocation: cleanStr(dmg.currentVehicleLocation, MAX_STR),
    diagram: {
      markers: Array.isArray(diagramIn.markers) ? diagramIn.markers : existingDiagram.markers || [],
      strokes: Array.isArray(diagramIn.strokes) ? diagramIn.strokes : existingDiagram.strokes || [],
      scenePhotos: sanitizeAttachments(
        diagramIn.scenePhotos !== undefined ? diagramIn.scenePhotos : existingDiagram.scenePhotos,
        existingDiagram.scenePhotos,
      ),
      detailPhotos: sanitizeAttachments(
        diagramIn.detailPhotos !== undefined ? diagramIn.detailPhotos : existingDiagram.detailPhotos,
        existingDiagram.detailPhotos,
      ),
    },
  };
}

function sanitizeOtherParty(p, existingParty = null) {
  if (!p || typeof p !== 'object') return null;
  const plate = cleanStr(p.plateNumber, 40);
  const driver = cleanStr(p.driverName, 200);
  if (!plate && !driver && !cleanStr(p.make) && !cleanStr(p.model)) return null;
  return {
    plateNumber: plate,
    make: cleanStr(p.make, 120),
    model: cleanStr(p.model, 120),
    color: cleanStr(p.color, 80),
    driverName: driver,
    ownerDetails: cleanStr(p.ownerDetails, MAX_STR),
    address: cleanStr(p.address, MAX_STR),
    mobile: cleanStr(p.mobile, 40),
    email: cleanStr(p.email, 200),
    licenceNumber: cleanStr(p.licenceNumber, 80),
    expiryDate: cleanStr(p.expiryDate, 40),
    dateOfBirth: cleanStr(p.dateOfBirth, 40),
    insuranceCompany: cleanStr(p.insuranceCompany, 200),
    claimNumber: cleanStr(p.claimNumber, 120),
    licenceFrontAttachments: sanitizeAttachments(
      p.licenceFrontAttachments,
      existingParty?.licenceFrontAttachments,
    ),
    licenceBackAttachments: sanitizeAttachments(
      p.licenceBackAttachments,
      existingParty?.licenceBackAttachments,
    ),
  };
}

function sanitizeWitnesses(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((w) => ({
      name: cleanStr(w?.name, 200),
      address: cleanStr(w?.address, MAX_STR),
      mobile: cleanStr(w?.mobile, 40),
      email: cleanStr(w?.email, 200),
    }))
    .filter((w) => w.name || w.address || w.mobile || w.email);
}

function sanitizeDeclaration(decl, existingPayload) {
  if (!decl || typeof decl !== 'object') return {};
  const existing = existingPayload?.declaration || {};
  return {
    agreed: decl.agreed !== undefined ? cleanBool(decl.agreed) : existing.agreed,
    signedBy: cleanStr(decl.signedBy ?? existing.signedBy, 120),
    typedName: cleanStr(decl.typedName ?? existing.typedName, 200),
    date: cleanStr(decl.date ?? existing.date, 40),
    signatureDataUrl:
      typeof decl.signatureDataUrl === 'string' && decl.signatureDataUrl.trim()
        ? decl.signatureDataUrl.trim().slice(0, MAX_ATTACHMENT_DATA_URL)
        : existing.signatureDataUrl || '',
  };
}

function validateSectionPayload(section, payload, existingPayload) {
  const errors = [];
  if (section === 'memberVehicle') {
    if (!cleanStr(payload?.plateNumber, 40)) errors.push('Plate number is required');
  }
  if (section === 'driver') {
    const dr = sanitizeDriver({ ...payload, name: payload?.name || existingPayload?.driver?.name });
    const name = joinDriverFullName(dr);
    if (!name) errors.push('Driver name is required (first/last name or full name)');
  }
  if (section === 'incident') {
    if (!cleanStr(payload?.date, 40)) errors.push('Incident date is required');
  }
  if (section === 'declaration') {
    const decl = sanitizeDeclaration(payload || {}, existingPayload);
    if (!decl.typedName) errors.push('Declaration print name is required');
  }
  return errors;
}

/**
 * Merge an admin-edited section into the stored member payload.
 */
export function applyMemberSubmissionSection(existingPayload, section, patch) {
  if (!existingPayload || typeof existingPayload !== 'object') {
    throw new Error('No member submission stored for this claim');
  }
  if (!MEMBER_SUBMISSION_SECTIONS.includes(section)) {
    throw new Error(`Invalid section "${section}"`);
  }
  if (!patch || typeof patch !== 'object') {
    throw new Error('Section data is required');
  }

  const errors = validateSectionPayload(section, patch, existingPayload);
  if (errors.length) {
    const err = new Error(errors.join('; '));
    err.statusCode = 400;
    throw err;
  }

  const next = structuredClone(existingPayload);

  switch (section) {
    case 'checklist': {
      next.checklist = { ...(next.checklist || {}), ...sanitizeChecklist(patch.checklist) };
      if (patch.excessPaymentApplicability !== undefined) {
        next.excessPaymentApplicability = cleanStr(patch.excessPaymentApplicability, 80);
      }
      if (patch.excessPaymentAmount !== undefined) {
        next.excessPaymentAmount = cleanStr(patch.excessPaymentAmount, 80);
      }
      if (patch.repairQuoteRef !== undefined) {
        next.repairQuoteRef = cleanStr(patch.repairQuoteRef, 120);
      }
      if (patch.driverLicenseFrontAttachments !== undefined) {
        next.driverLicenseFrontAttachments = sanitizeAttachments(
          patch.driverLicenseFrontAttachments,
          existingPayload.driverLicenseFrontAttachments,
        );
      }
      if (patch.driverLicenseBackAttachments !== undefined) {
        next.driverLicenseBackAttachments = sanitizeAttachments(
          patch.driverLicenseBackAttachments,
          existingPayload.driverLicenseBackAttachments,
        );
      }
      if (patch.taxiAuthorityAttachments !== undefined) {
        next.taxiAuthorityAttachments = sanitizeAttachments(
          patch.taxiAuthorityAttachments,
          existingPayload.taxiAuthorityAttachments,
        );
      }
      if (patch.registrationAttachments !== undefined) {
        next.registrationAttachments = sanitizeAttachments(
          patch.registrationAttachments,
          existingPayload.registrationAttachments,
        );
      }
      break;
    }
    case 'memberVehicle':
      next.memberVehicle = { ...(next.memberVehicle || {}), ...sanitizeMemberVehicle(patch) };
      break;
    case 'driver':
      next.driver = { ...(next.driver || {}), ...sanitizeDriver(patch) };
      break;
    case 'incident':
      next.incident = { ...(next.incident || {}), ...sanitizeIncident(patch) };
      break;
    case 'damage':
      next.damage = { ...(next.damage || {}), ...sanitizeDamage(patch, existingPayload) };
      break;
    case 'otherParties':
      next.otherParties = (Array.isArray(patch.otherParties) ? patch.otherParties : [])
        .map((p, i) => sanitizeOtherParty(p, existingPayload.otherParties?.[i]))
        .filter(Boolean);
      break;
    case 'witnessDetails':
      next.witnessDetails = sanitizeWitnesses(patch.witnessDetails);
      break;
    case 'declaration':
      next.declaration = { ...(next.declaration || {}), ...sanitizeDeclaration(patch, existingPayload) };
      break;
    default:
      break;
  }

  return next;
}

/** Rebuild admin list/search fields and `data` snapshot after a payload edit. */
export function buildClaimUpdateFromPayload(payload) {
  const queue = deriveQueueFields(payload);
  return {
    payload,
    data: buildDataFromClaimPayload(payload),
    plateNumber: queue.plateNumber,
    driverName: queue.driverName,
    dateOfIncident: queue.dateOfIncident,
    summary: queue.summary,
    priority: queue.priority,
  };
}
