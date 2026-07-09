import http from 'node:http';
import https from 'node:https';
import PDFDocument from 'pdfkit';

const PAGE = {
  left: 50,
  right: 545,
  width: 495,
  bottom: 60,
};

function str(value) {
  if (value == null || value === '') return 'Not supplied';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.filter((item) => item != null && item !== '').join(', ') || 'Not supplied';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function hasPrintableValue(value) {
  if (value == null || value === '') return false;
  if (typeof value === 'boolean' || typeof value === 'number') return true;
  if (Array.isArray(value)) return value.some(hasPrintableValue);
  return String(value).trim() !== '';
}

function parseDataUrlImage(dataUrl) {
  const raw = String(dataUrl ?? '').trim();
  const match = /^data:image\/(png|jpe?g|gif|webp|avif);base64,(.+)$/i.exec(raw);
  if (!match) return null;
  try {
    return Buffer.from(match[2], 'base64');
  } catch {
    return null;
  }
}

function fetchBuffer(url, redirectCount = 0) {
  return new Promise((resolve) => {
    if (!url || redirectCount > 3) {
      resolve(null);
      return;
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      resolve(null);
      return;
    }
    const client = parsed.protocol === 'http:' ? http : https;
    const req = client.get(parsed, { timeout: 10000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        resolve(fetchBuffer(new URL(res.headers.location, parsed).toString(), redirectCount + 1));
        return;
      }
      const contentType = String(res.headers['content-type'] || '').toLowerCase();
      if (res.statusCode !== 200 || !contentType.startsWith('image/')) {
        res.resume();
        resolve(null);
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size <= 8 * 1024 * 1024) chunks.push(chunk);
      });
      res.on('end', () => resolve(size > 8 * 1024 * 1024 ? null : Buffer.concat(chunks)));
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
  });
}

async function imageBufferFromFile(file) {
  const dataUrl = typeof file?.dataUrl === 'string' ? file.dataUrl.trim() : '';
  const parsed = parseDataUrlImage(dataUrl);
  if (parsed) return parsed;
  const url = typeof file?.url === 'string' ? file.url.trim() : typeof file?.fileUrl === 'string' ? file.fileUrl.trim() : '';
  if (/^https?:\/\//i.test(url)) return fetchBuffer(url);
  return null;
}

function ensureSpace(doc, y, needed = 80) {
  if (y + needed > doc.page.height - PAGE.bottom) {
    doc.addPage();
    return PAGE.left;
  }
  return y;
}

function drawCover(doc, { intakeReference, systemReference, claim }) {
  let y = 50;
  doc
    .roundedRect(PAGE.left, y, PAGE.width, 118, 8)
    .lineWidth(0.8)
    .strokeColor('#dbe7e4')
    .stroke();
  doc.rect(PAGE.left, y, PAGE.width, 4).fill('#0f766e');
  y += 22;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f766e').text('MEMBER CLAIM REPORT', PAGE.left, y, {
    width: PAGE.width,
    align: 'center',
  });
  y += 17;
  doc.font('Helvetica-Bold').fontSize(21).fillColor('#0f172a').text('Horizon Smash Repairs', PAGE.left, y, {
    width: PAGE.width,
    align: 'center',
  });
  y += 28;
  doc.font('Helvetica').fontSize(8).fillColor('#64748b').text(`Member reference: ${str(intakeReference)}`, PAGE.left, y, {
    width: PAGE.width,
    align: 'center',
  });
  y += 12;
  doc.text(`System reference: ${str(systemReference)}`, PAGE.left, y, { width: PAGE.width, align: 'center' });
  y += 24;

  const mv = claim.memberVehicle || {};
  const dr = claim.driver || {};
  const inc = claim.incident || {};
  const cards = [
    ['Plate', mv.plateNumber],
    ['Driver', dr.name || [dr.firstName, dr.lastName].filter(Boolean).join(' ')],
    ['Incident', inc.date],
    ['Generated', new Date().toLocaleString()],
  ];
  const gap = 8;
  const cardWidth = (PAGE.width - gap * 3) / 4;
  cards.forEach(([label, value], index) => {
    const x = PAGE.left + index * (cardWidth + gap);
    doc.roundedRect(x, y, cardWidth, 42, 6).fillAndStroke('#f8fafc', '#e2e8f0');
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#64748b').text(label.toUpperCase(), x + 8, y + 8, {
      width: cardWidth - 16,
    });
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827').text(str(value), x + 8, y + 21, {
      width: cardWidth - 16,
      height: 14,
    });
  });
  return y + 62;
}

function sectionTitle(doc, title, y) {
  y = ensureSpace(doc, y, 38);
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f766e').text(title, PAGE.left, y);
  doc.moveTo(PAGE.left, y + 18).lineTo(PAGE.right, y + 18).strokeColor('#dbe7e4').lineWidth(0.6).stroke();
  return y + 28;
}

function subsectionTitle(doc, title, y) {
  y = ensureSpace(doc, y, 28);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(title, PAGE.left, y);
  return y + 16;
}

function fieldLine(doc, label, value, y) {
  y = ensureSpace(doc, y, 34);
  const text = str(value);
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748b').text(label.toUpperCase(), PAGE.left, y, { width: 150 });
  doc.font('Helvetica').fontSize(9).fillColor('#111827');
  const h = doc.heightOfString(text, { width: 330 });
  doc.text(text, 215, y, { width: 330 });
  doc.moveTo(PAGE.left, y + Math.max(h, 12) + 4).lineTo(PAGE.right, y + Math.max(h, 12) + 4).strokeColor('#edf2f7').lineWidth(0.4).stroke();
  return y + Math.max(h, 12) + 10;
}

function fieldsBlock(doc, pairs, y, keepEmptyLabels = []) {
  const required = new Set(keepEmptyLabels);
  const rows = pairs.filter(([label, value]) => required.has(label) || hasPrintableValue(value));
  if (!rows.length) return fieldLine(doc, 'Details', 'No details supplied', y);
  for (const [label, value] of rows) y = fieldLine(doc, label, value, y);
  return y;
}

function countFiles(list) {
  return Array.isArray(list) ? list.length : 0;
}

function evidenceIndex(doc, items, y) {
  y = sectionTitle(doc, '2. Evidence index', y);
  const gap = 8;
  const cardWidth = (PAGE.width - gap * 2) / 3;
  items.forEach((item, index) => {
    y = ensureSpace(doc, y, 48);
    const col = index % 3;
    const rowY = y + Math.floor(index / 3) * 46;
    const x = PAGE.left + col * (cardWidth + gap);
    const complete = item.count > 0;
    doc.roundedRect(x, rowY, cardWidth, 38, 6).fillAndStroke(complete ? '#ecfdf5' : '#fff7ed', complete ? '#a7f3d0' : '#fed7aa');
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#64748b').text(item.label.toUpperCase(), x + 8, rowY + 7, {
      width: cardWidth - 16,
    });
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827').text(
      complete ? `${item.count} file${item.count === 1 ? '' : 's'}` : 'Not supplied',
      x + 8,
      rowY + 20,
      { width: cardWidth - 16 },
    );
    if (col === 2 || index === items.length - 1) y = rowY + 46;
  });
  return y + 4;
}

async function embedImage(doc, label, file, y, fit = [PAGE.width, 220]) {
  const buffer = await imageBufferFromFile(file);
  if (!buffer) return fieldLine(doc, label, file?.name || file?.originalName || 'File recorded; preview unavailable', y);
  y = ensureSpace(doc, y, fit[1] + 38);
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#475569').text(label, PAGE.left, y, { width: PAGE.width });
  y += 14;
  try {
    doc.roundedRect(PAGE.left, y, PAGE.width, fit[1] + 12, 6).strokeColor('#e2e8f0').lineWidth(0.6).stroke();
    doc.image(buffer, PAGE.left + 8, y + 6, { fit: [PAGE.width - 16, fit[1]] });
    return y + fit[1] + 22;
  } catch {
    return fieldLine(doc, label, 'Image could not be embedded', y);
  }
}

async function embedAttachmentsGallery(doc, title, files, y, fit = [PAGE.width, 220]) {
  const list = Array.isArray(files) ? files : [];
  if (!list.length) return y;
  y = sectionTitle(doc, title, y);
  for (let i = 0; i < list.length; i += 1) {
    const file = list[i];
    const name = file?.name || file?.originalName || `${title} ${i + 1}`;
    y = await embedImage(doc, name, file, y, fit);
  }
  return y;
}

function normalizeWitnesses(claim) {
  if (Array.isArray(claim.witnessDetails)) return claim.witnessDetails;
  const w = claim.witnessDetails || {};
  if (!w || typeof w !== 'object') return [];
  return [
    { name: w.witness1Name, address: w.witness1Address, mobile: w.witness1Mobile, email: w.witness1Email },
    { name: w.witness2Name, address: w.witness2Address, mobile: w.witness2Mobile, email: w.witness2Email },
  ].filter((item) => item.name || item.address || item.mobile || item.email);
}

function formatSketchModel(sketchModel) {
  if (!sketchModel || typeof sketchModel !== 'object') return '';
  const lines = Array.isArray(sketchModel.lines) ? sketchModel.lines.length : 0;
  const vehicles = Array.isArray(sketchModel.vehicles) ? sketchModel.vehicles.length : 0;
  const labels = Array.isArray(sketchModel.labels) ? sketchModel.labels.length : 0;
  return `Road lines: ${lines}; vehicles: ${vehicles}; labels: ${labels}`;
}

function formatDamageMarkers(markers) {
  const list = Array.isArray(markers) ? markers : [];
  if (!list.length) return '';
  return list.map((point, index) => `${index + 1}. x=${Math.round(point?.x ?? 0)}, y=${Math.round(point?.y ?? 0)}`).join('; ');
}

function formatDamageStrokes(strokes) {
  const list = Array.isArray(strokes) ? strokes : [];
  if (!list.length) return '';
  return list.map((stroke, index) => `${index + 1}. ${(stroke?.points || []).length} points`).join('; ');
}

export async function generateClaimPdfBuffer({ claim, intakeReference, systemReference }) {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE.left });
  const chunks = [];
  const pdfDone = new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const mv = claim.memberVehicle || {};
  const dr = claim.driver || {};
  const inc = claim.incident || {};
  const sketch = claim.accidentSketch || {};
  const dmg = claim.damage || {};
  const diagram = dmg.diagram || {};
  const declaration = claim.declaration || {};
  const parties = Array.isArray(claim.otherParties) ? claim.otherParties : [];
  const witnesses = normalizeWitnesses(claim);
  const signatureFiles = declaration.signatureDataUrl ? [{ name: 'Declaration signature', dataUrl: declaration.signatureDataUrl }] : [];

  let y = drawCover(doc, { intakeReference, systemReference, claim });

  y = sectionTitle(doc, '1. Claim summary', y);
  y = fieldsBlock(
    doc,
    [
      ['Member reference', intakeReference],
      ['System reference', systemReference],
      ['Plate', mv.plateNumber],
      ['Driver', dr.name || [dr.firstName, dr.lastName].filter(Boolean).join(' ')],
      ['Incident date', inc.date],
    ],
    y,
    ['Member reference', 'Plate', 'Driver', 'Incident date'],
  );

  y = evidenceIndex(
    doc,
    [
      { label: 'Driver licence front', count: countFiles(claim.driverLicenseFrontAttachments) },
      { label: 'Driver licence back', count: countFiles(claim.driverLicenseBackAttachments) },
      { label: 'Registration', count: countFiles(claim.registrationAttachments) },
      { label: 'Taxi authority', count: countFiles(claim.taxiAuthorityAttachments) },
      { label: 'Accident sketch', count: (sketch.diagramDataUrl ? 1 : 0) + countFiles(sketch.attachments) },
      { label: 'Damage photos', count: countFiles(diagram.scenePhotos) + countFiles(diagram.detailPhotos) },
      { label: 'Declaration signature', count: signatureFiles.length },
    ],
    y,
  );

  y = sectionTitle(doc, '3. Member and vehicle', y);
  y = fieldsBlock(
    doc,
    [
      ['Member number', mv.memberNumber],
      ['Claim type', mv.claimType],
      ['Plate', mv.plateNumber],
      ['Make', mv.make],
      ['Model', mv.model],
      ['Kilometers', mv.kilometers],
      ['Month / year', mv.monthYear],
      ['Owner', mv.ownerName],
      ['Address', mv.address],
      ['Mobile', mv.mobile],
      ['Email', mv.email],
    ],
    y,
    ['Plate', 'Owner'],
  );
  y = await embedAttachmentsGallery(doc, 'Registration evidence', claim.registrationAttachments, y);

  y = sectionTitle(doc, '4. Driver', y);
  y = fieldsBlock(
    doc,
    [
      ['Name', dr.name || [dr.firstName, dr.lastName].filter(Boolean).join(' ')],
      ['Is owner', dr.isOwner],
      ['Address', dr.address || [dr.streetAddress, dr.suburb, dr.state, dr.postcode].filter(Boolean).join(', ')],
      ['Mobile', dr.mobile],
      ['Email', dr.email],
      ['Licence no.', dr.licenceNumber],
      ['Licence expiry', dr.expiryDate],
      ['Date of birth', dr.dateOfBirth],
      ['Years held', dr.yearOfHold],
      ['Relationship', dr.relationship],
      ['Alcohol / drugs', dr.alcoholOrDrug],
      ['Breath test', dr.breathTest],
      ['Police reported', dr.policeReported],
      ['Police report no.', dr.policeReportNumber],
      ['At fault', dr.atFault],
      ['Admitted liability', dr.admittedLiability],
      ['Other driver liability', dr.otherDriverAdmittedLiability],
    ],
    y,
    ['Name', 'Licence no.'],
  );
  y = await embedAttachmentsGallery(doc, 'Driver licence - front', claim.driverLicenseFrontAttachments, y);
  y = await embedAttachmentsGallery(doc, 'Driver licence - back', claim.driverLicenseBackAttachments, y);
  y = await embedAttachmentsGallery(doc, 'Taxi authority', claim.taxiAuthorityAttachments, y);

  y = sectionTitle(doc, '5. Incident', y);
  y = fieldsBlock(
    doc,
    [
      ['Date', inc.date],
      ['Day', inc.day],
      ['Time', inc.time],
      ['Street', inc.streetName],
      ['Suburb', inc.suburb],
      ['Address detail', inc.addressDetailOptional],
      ['Road surface', inc.roadSurface],
      ['Vehicle state', inc.coveredVehicleState],
      ['Traffic controls', inc.trafficControls],
      ['Other vehicles', inc.numberOfVehicles],
      ['Your speed', inc.estimatedSpeed],
      ['Other speed', inc.estimatedOtherSpeed],
      ['Description', inc.description],
    ],
    y,
    ['Date', 'Description'],
  );

  y = sectionTitle(doc, '6. Accident sketch', y);
  y = fieldsBlock(doc, [['Canvas diagram', sketch.diagramDataUrl ? 'Yes' : 'No'], ['Sketch details', formatSketchModel(sketch.sketchModel)]], y);
  if (sketch.diagramDataUrl) y = await embedImage(doc, 'Sketch canvas', { dataUrl: sketch.diagramDataUrl }, y, [PAGE.width, 210]);
  y = await embedAttachmentsGallery(doc, 'Sketch uploads', sketch.attachments, y);

  y = sectionTitle(doc, '7. Damage and towing', y);
  y = fieldsBlock(
    doc,
    [
      ['Claiming damage', dmg.claimingDamage],
      ['Towed', dmg.towed],
      ['Tow company', dmg.towCompany],
      ['Tow location', dmg.towLocation],
      ['Distance towed', dmg.distanceTowed],
      ['Vehicle location', dmg.currentVehicleLocation],
      ['Damage markers', formatDamageMarkers(diagram.markers)],
      ['Damage drawings', formatDamageStrokes(diagram.strokes)],
    ],
    y,
  );
  y = await embedAttachmentsGallery(doc, 'Damage - scene photos', diagram.scenePhotos, y);
  y = await embedAttachmentsGallery(doc, 'Damage - close-up photos', diagram.detailPhotos, y);

  y = sectionTitle(doc, '8. Other parties', y);
  if (!parties.length) {
    y = fieldLine(doc, 'Other parties', 'None recorded', y);
  } else {
    for (let i = 0; i < parties.length; i += 1) {
      const party = parties[i];
      y = subsectionTitle(doc, `Other party ${i + 1}`, y);
      y = fieldsBlock(doc, [
        ['Plate', party.plateNumber],
        ['Make / model / colour', [party.make, party.model, party.color].filter(Boolean).join(' / ')],
        ['Driver', party.driverName],
        ['Owner', party.ownerDetails],
        ['Address', party.address],
        ['Contact', [party.mobile, party.email].filter(Boolean).join(' / ')],
        ['Licence', party.licenceNumber],
        ['Insurance', party.insuranceCompany],
        ['Claim no.', party.claimNumber],
      ], y);
      y = await embedAttachmentsGallery(doc, `Other party ${i + 1} licence front`, party.licenceFrontAttachments, y);
      y = await embedAttachmentsGallery(doc, `Other party ${i + 1} licence back`, party.licenceBackAttachments, y);
    }
  }

  y = sectionTitle(doc, '9. Witnesses', y);
  if (!witnesses.length) {
    y = fieldLine(doc, 'Witnesses', 'None recorded', y);
  } else {
    witnesses.forEach((witness, index) => {
      y = subsectionTitle(doc, `Witness ${index + 1}`, y);
      y = fieldsBlock(doc, [
        ['Name', witness.name],
        ['Address', witness.address],
        ['Mobile', witness.mobile],
        ['Email', witness.email],
      ], y);
    });
  }

  y = sectionTitle(doc, '10. Declaration', y);
  y = fieldsBlock(
    doc,
    [
      ['Agreed', declaration.agreed],
      ['Signed by', declaration.signedBy],
      ['Print name', declaration.typedName],
      ['Date', declaration.date],
    ],
    y,
    ['Agreed', 'Print name'],
  );
  if (declaration.signatureDataUrl) y = await embedImage(doc, 'Declaration signature', { dataUrl: declaration.signatureDataUrl }, y, [240, 90]);

  y = ensureSpace(doc, y, 36);
  doc.font('Helvetica').fontSize(8).fillColor('#94a3b8').text(
    'This report contains member-submitted claim information and evidence available at export time.',
    PAGE.left,
    y,
    { width: PAGE.width, align: 'center' },
  );

  doc.end();
  return pdfDone;
}
