/**
 * Scanned buyer PDF → page images → OpenAI vision → claim draft fields.
 * Does not create a claim. Attachments and signature stay empty.
 */
import { renderPdfPagesToPngBuffers } from './buyerPdfOcr.js';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 90_000;

function strField() {
  return { type: 'string' };
}

function objectSchema(properties) {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  };
}

const partySchema = objectSchema({
  plateNumber: strField(),
  make: strField(),
  model: strField(),
  color: strField(),
  driverName: strField(),
  ownerDetails: strField(),
  address: strField(),
  mobile: strField(),
  email: strField(),
  licenceNumber: strField(),
  expiryDate: strField(),
  dateOfBirth: strField(),
  insuranceCompany: strField(),
  claimNumber: strField(),
});

const witnessSchema = objectSchema({
  name: strField(),
  address: strField(),
  mobile: strField(),
  email: strField(),
});

const claimDraftSchema = objectSchema({
  memberVehicle: objectSchema({
    memberNumber: strField(),
    claimType: strField(),
    plateNumber: strField(),
    kilometers: strField(),
    make: strField(),
    model: strField(),
    monthYear: strField(),
    ownerName: strField(),
    address: strField(),
    mobile: strField(),
    email: strField(),
  }),
  driver: objectSchema({
    isOwner: strField(),
    claimNumber: strField(),
    firstName: strField(),
    lastName: strField(),
    name: strField(),
    streetAddress: strField(),
    suburb: strField(),
    state: strField(),
    postcode: strField(),
    mobile: strField(),
    email: strField(),
    licenceNumber: strField(),
    expiryDate: strField(),
    dateOfBirth: strField(),
    yearOfHold: strField(),
    relationship: strField(),
    relationshipOther: strField(),
    alcoholOrDrug: strField(),
    breathTest: strField(),
    policeReported: strField(),
    policeReportNumber: strField(),
    atFault: strField(),
    admittedLiability: strField(),
    otherDriverAdmittedLiability: strField(),
  }),
  incident: objectSchema({
    date: strField(),
    time: strField(),
    addressDetailOptional: strField(),
    streetName: strField(),
    suburb: strField(),
    roadSurface: strField(),
    numberOfVehicles: strField(),
    coveredVehicleState: strField(),
    trafficControls: { type: 'array', items: strField() },
    description: strField(),
    estimatedSpeed: strField(),
    estimatedOtherSpeed: strField(),
  }),
  damage: objectSchema({
    claimingDamage: strField(),
    towed: strField(),
    towCompany: strField(),
    towLocation: strField(),
    distanceTowed: strField(),
    currentVehicleLocation: strField(),
  }),
  otherParties: { type: 'array', items: partySchema },
  witnessDetails: { type: 'array', items: witnessSchema },
});

function clean(value, max = 2000) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function compactPlate(value, max = 40) {
  return clean(String(value ?? '').replace(/\s+/g, ''), max).toUpperCase();
}

function yesNo(value) {
  const s = clean(value, 20).toLowerCase();
  if (['yes', 'y', 'true'].includes(s)) return 'Yes';
  if (['no', 'n', 'false'].includes(s)) return 'No';
  return '';
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function toIsoDate(value) {
  const s = clean(value, 40);
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const written = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{2,4})$/);
  if (written) {
    const month = MONTHS[written[2].slice(0, 3).toLowerCase()];
    let year = written[3];
    if (month && year) {
      if (year.length === 2) year = Number(year) > 50 ? `19${year}` : `20${year}`;
      const day = Number(written[1]);
      if (day >= 1 && day <= 31) {
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }
  }
  const slash = s.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{2,4})$/);
  if (slash) {
    let [, day, month, year] = slash;
    if (year.length === 2) year = Number(year) > 50 ? `19${year}` : `20${year}`;
    const y = Number(year);
    const m = Number(month);
    const d = Number(day);
    if (y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeAiClaimDraft(raw) {
  const src = asObject(raw);
  const mv = asObject(src.memberVehicle);
  const dr = asObject(src.driver);
  const inc = asObject(src.incident);
  const dmg = asObject(src.damage);

  const firstName = clean(dr.firstName, 120);
  const lastName = clean(dr.lastName, 120);
  const explicitName = clean(dr.name, 200);
  const name = explicitName || [firstName, lastName].filter(Boolean).join(' ');

  const draft = {
    memberVehicle: {
      memberNumber: clean(mv.memberNumber, 80),
      claimType: clean(mv.claimType, 80) || 'Claim',
      plateNumber: compactPlate(mv.plateNumber),
      kilometers: clean(mv.kilometers, 40),
      make: clean(mv.make, 120),
      model: clean(mv.model, 120),
      monthYear: clean(mv.monthYear, 40),
      ownerName: clean(mv.ownerName, 200),
      address: clean(mv.address, 2000),
      mobile: clean(mv.mobile, 40),
      email: clean(mv.email, 200),
    },
    driver: {
      isOwner: yesNo(dr.isOwner),
      claimNumber: clean(dr.claimNumber, 80),
      firstName,
      lastName,
      name,
      streetAddress: clean(dr.streetAddress, 500),
      suburb: clean(dr.suburb, 200),
      state: clean(dr.state, 80),
      postcode: clean(dr.postcode, 20),
      mobile: clean(dr.mobile, 40),
      email: clean(dr.email, 200),
      licenceNumber: clean(dr.licenceNumber, 80),
      expiryDate: toIsoDate(dr.expiryDate) || clean(dr.expiryDate, 40),
      dateOfBirth: toIsoDate(dr.dateOfBirth) || clean(dr.dateOfBirth, 40),
      yearOfHold: clean(dr.yearOfHold, 20),
      relationship: clean(dr.relationship, 80),
      relationshipOther: clean(dr.relationshipOther, 200),
      alcoholOrDrug: yesNo(dr.alcoholOrDrug),
      breathTest: yesNo(dr.breathTest),
      policeReported: yesNo(dr.policeReported),
      policeReportNumber: clean(dr.policeReportNumber, 120),
      atFault: yesNo(dr.atFault),
      admittedLiability: yesNo(dr.admittedLiability),
      otherDriverAdmittedLiability: yesNo(dr.otherDriverAdmittedLiability),
    },
    incident: {
      date: toIsoDate(inc.date),
      time: clean(inc.time, 20),
      addressDetailOptional: clean(inc.addressDetailOptional, 2000),
      streetName: clean(inc.streetName, 500),
      suburb: clean(inc.suburb, 200),
      roadSurface: clean(inc.roadSurface, 120),
      numberOfVehicles: clean(inc.numberOfVehicles, 20),
      coveredVehicleState: clean(inc.coveredVehicleState, 120),
      trafficControls: asArray(inc.trafficControls).map((item) => clean(item, 120)).filter(Boolean).slice(0, 12),
      description: clean(inc.description, 2000),
      estimatedSpeed: clean(inc.estimatedSpeed, 40),
      estimatedOtherSpeed: clean(inc.estimatedOtherSpeed, 40),
    },
    damage: {
      claimingDamage: yesNo(dmg.claimingDamage),
      towed: yesNo(dmg.towed),
      towCompany: clean(dmg.towCompany, 200),
      towLocation: clean(dmg.towLocation, 2000),
      distanceTowed: clean(dmg.distanceTowed, 80),
      currentVehicleLocation: clean(dmg.currentVehicleLocation, 2000),
    },
    otherParties: asArray(src.otherParties)
      .slice(0, 6)
      .map((party) => {
        const p = asObject(party);
        return {
          plateNumber: compactPlate(p.plateNumber),
          make: clean(p.make, 120),
          model: clean(p.model, 120),
          color: clean(p.color, 80),
          driverName: clean(p.driverName, 200),
          ownerDetails: clean(p.ownerDetails, 2000),
          address: clean(p.address, 2000),
          mobile: clean(p.mobile, 40),
          email: clean(p.email, 200),
          licenceNumber: clean(p.licenceNumber, 80),
          expiryDate: toIsoDate(p.expiryDate) || clean(p.expiryDate, 40),
          dateOfBirth: toIsoDate(p.dateOfBirth) || clean(p.dateOfBirth, 40),
          insuranceCompany: clean(p.insuranceCompany, 200),
          claimNumber: clean(p.claimNumber, 120),
        };
      })
      .filter((p) => p.plateNumber || p.driverName || p.make || p.model),
    witnessDetails: asArray(src.witnessDetails)
      .slice(0, 4)
      .map((w) => {
        const row = asObject(w);
        return {
          name: clean(row.name, 200),
          address: clean(row.address, 2000),
          mobile: clean(row.mobile, 40),
          email: clean(row.email, 200),
        };
      })
      .filter((w) => w.name || w.address || w.mobile || w.email),
  };

  const warnings = [];
  if (!draft.memberVehicle.plateNumber) warnings.push('Plate number was not found — enter it before creating the claim');
  if (!draft.driver.name) warnings.push('Driver name was not found — enter it before creating the claim');
  if (!draft.incident.date) warnings.push('Incident date was not found — enter it before creating the claim');
  return { draft, warnings };
}

function messageText(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function fail(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

export async function extractClaimDraftFromBuyerPdf(pdfBuffer) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    throw fail(503, 'OPENAI_API_KEY is not set on the API server');
  }

  const model = String(process.env.OPENAI_MODEL || 'gpt-4o').trim() || 'gpt-4o';
  let rendered;
  try {
    rendered = await renderPdfPagesToPngBuffers(pdfBuffer);
  } catch (err) {
    throw fail(400, err?.message ? `Could not read PDF pages: ${err.message}` : 'Could not read PDF pages');
  }

  const { pngBuffers, pageCount, ocrPages } = rendered;
  if (!pngBuffers.length) {
    throw fail(400, 'PDF has no pages to read');
  }

  const imageParts = pngBuffers.map((buf) => ({
    type: 'image_url',
    image_url: {
      url: `data:image/png;base64,${buf.toString('base64')}`,
      detail: 'high',
    },
  }));

  let response;
  try {
    response = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'claim_draft',
            strict: true,
            schema: claimDraftSchema,
          },
        },
        messages: [
          {
            role: 'system',
            content:
              'You extract handwritten fields from Horizon Smash Repairs claim-form page images. ' +
              'Read the handwriting inside each labelled box. Copy the whole value, including every digit and trailing letter. ' +
              'Leave a field empty when its box is blank. Do not invent text and do not move digits from one box into another. ' +
              'Vehicle Plate No. is written with no spaces, so "DK 55 LS" becomes "DK55LS". Mobile is the full number in the Mobile box, usually 10 digits starting with 04. ' +
              'Licence No. keeps spaces and a final letter if one is written. ' +
              'Dates are day/month/year. A written date like "18 Nov 2028" must keep the full year 2028, not 2020. Return dates as YYYY-MM-DD. ' +
              'Split a driver address line into street, suburb, state, and postcode when those parts are written. ' +
              'Was the driver one of the owners is Yes or No only when that box is ticked, otherwise "". ' +
              'Put other vehicles in otherParties and witnesses in witnessDetails.',
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Read these ${pngBuffers.length} claim-form page image(s) and return the claim draft.`,
              },
              ...imageParts,
            ],
          },
        ],
      }),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw fail(504, 'The claim form took too long to read. Try again.');
    }
    throw fail(502, 'Could not reach the AI service');
  }

  let body = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }

  if (!response.ok) {
    const detail = clean(body?.error?.message || '', 300);
    if (response.status === 401) {
      throw fail(502, 'OpenAI rejected the API key. Check OPENAI_API_KEY.');
    }
    if (detail.toLowerCase().includes('model') || response.status === 404) {
      throw fail(502, detail || `OpenAI model "${model}" was rejected. Set OPENAI_MODEL to a vision model such as gpt-4o.`);
    }
    throw fail(502, detail || `OpenAI request failed (${response.status}). Set OPENAI_MODEL if this model does not support image input.`);
  }

  const text = messageText(body?.choices?.[0]?.message);
  if (!text.trim()) {
    throw fail(502, 'AI returned an empty claim draft');
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw fail(502, 'AI returned a claim draft that was not valid JSON');
  }

  const { draft, warnings } = normalizeAiClaimDraft(parsed);
  return {
    draft,
    extractedText: '',
    warnings,
    meta: { pageCount, ocrPages, model, reader: 'openai' },
  };
}
