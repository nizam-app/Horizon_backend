/**
 * Scanned buyer PDF → page images → Tesseract OCR → heuristic claim draft fields.
 */
import '../polyfills.js';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import Tesseract from 'tesseract.js';

const require = createRequire(import.meta.url);
const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

const MAX_PAGES = Number(process.env.BUYER_PDF_OCR_MAX_PAGES || 5);
const MAX_DIM = Number(process.env.BUYER_PDF_OCR_MAX_DIM || 1600);
const RENDER_SCALE = Number(process.env.BUYER_PDF_OCR_SCALE || 2);

class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height);
    return {
      canvas,
      context: canvas.getContext('2d'),
    };
  }

  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

async function renderPdfPagesToPngBuffers(pdfBuffer) {
  const data = new Uint8Array(pdfBuffer);
  const loadingTask = getDocument({
    data,
    disableWorker: true,
    useSystemFonts: true,
    canvasFactory: new NodeCanvasFactory(),
  });
  const pdf = await loadingTask.promise;
  const pageCount = Math.min(pdf.numPages, MAX_PAGES);
  const pngBuffers = [];

  for (let pageNum = 1; pageNum <= pageCount; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    let viewport = page.getViewport({ scale: RENDER_SCALE });
    const longest = Math.max(viewport.width, viewport.height);
    if (longest > MAX_DIM) {
      const fit = MAX_DIM / longest;
      viewport = page.getViewport({ scale: RENDER_SCALE * fit });
    }
    const canvasFactory = new NodeCanvasFactory();
    const canvasAndContext = canvasFactory.create(viewport.width, viewport.height);
    await page.render({
      canvasContext: canvasAndContext.context,
      viewport,
      canvas: canvasAndContext.canvas,
    }).promise;
    pngBuffers.push(canvasAndContext.canvas.toBuffer('image/png'));
    canvasFactory.destroy(canvasAndContext);
  }

  return { pngBuffers, pageCount: pdf.numPages, ocrPages: pageCount };
}

function cleanLine(s) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Known form labels used to stop field values mid-line. */
const STOP_LABELS = [
  'Plate number',
  'Plate',
  'Rego',
  'Registration',
  'Driver name',
  'Driver',
  'Owner name',
  'Owner',
  'Member number',
  'Member',
  'Date of incident',
  'Incident date',
  'Accident date',
  'Date of loss',
  'Mobile',
  'Phone',
  'Email',
  'E-mail',
  'Make',
  'Model',
  'Address',
  'Suburb',
  'Street',
  'Licence number',
  'License number',
  'Licence',
  'License',
  'Time',
  'Description',
];

const STOP_LABEL_RE = new RegExp(
  `\\b(?:${STOP_LABELS.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
  'i'
);

function clipAtNextLabel(value) {
  const v = cleanLine(value);
  if (!v) return '';
  // If another label appears later on the same line, cut before it.
  const m = v.match(STOP_LABEL_RE);
  if (m && m.index != null && m.index > 0) {
    return cleanLine(v.slice(0, m.index));
  }
  // Also cut on " Label:" patterns
  const colon = v.search(/\s+[A-Za-z][A-Za-z ]{1,24}:/);
  if (colon > 0) return cleanLine(v.slice(0, colon));
  return v.slice(0, 120);
}

function labeledValue(text, labels) {
  const normalized = String(text).replace(/\r\n/g, '\n');
  // Prefer line-oriented matches first.
  const lines = normalized.split(/\n/).map(cleanLine).filter(Boolean);
  for (const label of labels) {
    const re = new RegExp(`(?:^|\\b)${label}\\s*[:\\-–]?\\s*(.+)$`, 'i');
    for (const line of lines) {
      const m = line.match(re);
      if (m?.[1]) {
        const val = clipAtNextLabel(m[1]);
        if (val) return val;
      }
    }
  }
  // Fall back to whole-text search (OCR often collapses lines).
  const flat = cleanLine(normalized);
  for (const label of labels) {
    const re = new RegExp(`(?:^|\\b)${label}\\s*[:\\-–]?\\s*(.+?)(?=\\s+(?:${STOP_LABELS.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b|$)`, 'i');
    const m = flat.match(re);
    if (m?.[1]) {
      const val = clipAtNextLabel(m[1]);
      if (val) return val;
    }
  }
  return '';
}

function findEmail(text) {
  const m = String(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0] : '';
}

function findMobile(text) {
  const m = String(text).match(/(?:\+?61|0)\s?\d(?:[\s-]?\d){8,9}/);
  return m ? cleanLine(m[0]) : '';
}

function findAuPlate(text) {
  const patterns = [
    /\b([A-Z]{1,3}\s?\d{2,3}\s?[A-Z]{0,3})\b/gi,
    /\b(\d{1,3}\s?[A-Z]{2,3}\s?\d{0,3})\b/gi,
  ];
  for (const re of patterns) {
    const matches = String(text).toUpperCase().match(re);
    if (matches?.length) {
      const candidate = cleanLine(matches[0]).replace(/\s+/g, ' ');
      if (candidate.length >= 5 && candidate.length <= 9) return candidate;
    }
  }
  return '';
}

function findDate(text) {
  const patterns = [
    /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/,
    /\b(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/,
    /\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})\b/i,
  ];
  for (const re of patterns) {
    const m = String(text).match(re);
    if (m?.[1]) return normalizeDateToIso(m[1]);
  }
  return '';
}

function normalizeDateToIso(raw) {
  const s = cleanLine(raw);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const slash = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slash) {
    let [, d, m, y] = slash;
    if (y.length === 2) y = Number(y) > 50 ? `19${y}` : `20${y}`;
    const day = d.padStart(2, '0');
    const month = m.padStart(2, '0');
    // AU often DD/MM/YYYY
    return `${y}-${month}-${day}`;
  }
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return s;
}

function splitName(full) {
  const parts = cleanLine(full).split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: '', lastName: '', name: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '', name: parts[0] };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
    name: parts.join(' '),
  };
}

/**
 * Map OCR text into a partial claim draft (memberVehicle / driver / incident).
 */
export function mapOcrTextToClaimDraft(extractedText) {
  const text = String(extractedText || '');
  const warnings = [];

  const plateLabeled = labeledValue(text, [
    'Plate(?:\\s*number)?',
    'Rego',
    'Registration(?:\\s*(?:number|no\\.?)?)?',
    'Vehicle\\s*plate',
  ]);
  const plateNumber = (plateLabeled && findAuPlate(plateLabeled)) || findAuPlate(text) || clipAtNextLabel(plateLabeled);
  if (!plateNumber) warnings.push('plate not found');

  const ownerName = clipAtNextLabel(
    labeledValue(text, ['Owner(?:\\s*name)?', 'Member(?:\\s*name)?', 'Insured'])
  );
  const driverFull = clipAtNextLabel(
    labeledValue(text, ['Driver(?:\\s*name)?', 'Name\\s*of\\s*driver']) || ownerName
  );
  const nameParts = splitName(driverFull);
  if (!nameParts.name) warnings.push('driver name not found');

  const incidentDateRaw =
    labeledValue(text, [
      'Date\\s*of\\s*incident',
      'Incident\\s*date',
      'Accident\\s*date',
      'Date\\s*of\\s*loss',
    ]) || '';
  const dateFromLabel = incidentDateRaw ? findDate(incidentDateRaw) : '';
  const incidentDateNorm = dateFromLabel || findDate(text) || '';
  if (!incidentDateNorm) warnings.push('incident date not found');

  const mobileRaw =
    labeledValue(text, ['Mobile', 'Phone', 'Contact(?:\\s*number)?', 'Tel']) || findMobile(text);
  const mobile = findMobile(mobileRaw) || clipAtNextLabel(mobileRaw);
  const email = labeledValue(text, ['Email', 'E-mail']) || findEmail(text);
  const make = labeledValue(text, ['Make', 'Vehicle\\s*make']);
  const model = labeledValue(text, ['Model', 'Vehicle\\s*model']);
  const memberNumber = labeledValue(text, ['Member(?:\\s*(?:number|no\\.?)?)?', 'Membership']);
  const address = labeledValue(text, ['Address', 'Residential\\s*address', 'Postal\\s*address']);
  const licenceNumber = labeledValue(text, [
    'Licence(?:\\s*(?:number|no\\.?)?)',
    'License(?:\\s*(?:number|no\\.?)?)',
    'Driver\\s*licence(?:\\s*(?:number|no\\.?)?)?',
    'Driver\\s*license(?:\\s*(?:number|no\\.?)?)?',
  ]);
  const streetName = labeledValue(text, ['Street(?:\\s*name)?', 'Incident\\s*street', 'Location']);
  const suburb = labeledValue(text, ['Suburb', 'Town', 'City']);
  const time = labeledValue(text, ['Time(?:\\s*of\\s*incident)?', 'Incident\\s*time']);
  const description = labeledValue(text, [
    'Description',
    'Incident\\s*description',
    'What\\s*happened',
    'Circumstances',
  ]);

  const draft = {
    memberVehicle: {
      memberNumber,
      plateNumber,
      make,
      model,
      ownerName: ownerName || nameParts.name,
      address,
      mobile,
      email,
    },
    driver: {
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
      name: nameParts.name,
      mobile,
      email,
      licenceNumber,
      streetAddress: address,
      suburb,
    },
    incident: {
      date: incidentDateNorm,
      time,
      streetName,
      suburb,
      description,
    },
    otherParties: [],
  };

  return { draft, warnings };
}

/**
 * Full pipeline: PDF buffer → OCR text → mapped draft.
 */
export async function extractClaimDraftFromBuyerPdf(pdfBuffer) {
  const { pngBuffers, pageCount, ocrPages } = await renderPdfPagesToPngBuffers(pdfBuffer);
  const pageTexts = [];

  for (let i = 0; i < pngBuffers.length; i += 1) {
    const result = await Tesseract.recognize(pngBuffers[i], 'eng', {
      logger: () => {},
    });
    pageTexts.push(cleanLine(result?.data?.text || ''));
  }

  const extractedText = pageTexts.filter(Boolean).join('\n\n--- page break ---\n\n');
  const { draft, warnings } = mapOcrTextToClaimDraft(extractedText);

  if (!extractedText.trim()) {
    warnings.push('OCR returned no text — check scan quality');
  }

  return {
    draft,
    extractedText,
    warnings,
    meta: { pageCount, ocrPages },
  };
}
