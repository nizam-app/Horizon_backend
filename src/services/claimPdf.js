import PDFDocument from 'pdfkit';

const CHECKLIST_LABELS = {
  license: 'Driver License',
  taxiAuthority: 'Taxi Authority',
  registration: 'Copy of Registration',
  otherDemand: 'Other Party Demand (if applicable)',
  policeReport: 'Police Report (if applicable)',
  excessPayment: 'Excess Payment',
  repairQuote: 'Repair Quote',
  otherParties: 'Full Details of Other Parties Involved',
};

function parseDataUrlImage(dataUrl) {
  const raw = String(dataUrl ?? '').trim();
  const m = /^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/i.exec(raw);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  const format = ext === 'jpg' || ext === 'jpeg' ? 'JPEG' : ext === 'png' ? 'PNG' : ext.toUpperCase();
  try {
    return { format, buffer: Buffer.from(m[2], 'base64') };
  } catch {
    return null;
  }
}

function str(v) {
  if (v == null || v === '') return '—';
  if (Array.isArray(v)) return v.filter(Boolean).join(', ') || '—';
  return String(v);
}

function ensureSpace(doc, y, needed = 80) {
  if (y + needed > doc.page.height - 60) {
    doc.addPage();
    return 50;
  }
  return y;
}

function sectionTitle(doc, title, y) {
  y = ensureSpace(doc, y, 36);
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f766e').text(title, 50, y);
  doc.moveTo(50, y + 18).lineTo(545, y + 18).strokeColor('#d6d3d1').lineWidth(0.5).stroke();
  return y + 28;
}

function fieldLine(doc, label, value, y) {
  y = ensureSpace(doc, y, 40);
  const text = str(value);
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#44403c').text(label, 50, y, { width: 150 });
  doc.font('Helvetica').fontSize(9).fillColor('#1c1917');
  const h = doc.heightOfString(text, { width: 335 });
  doc.text(text, 205, y, { width: 335 });
  return y + Math.max(h, 12) + 6;
}

function attachmentList(doc, items, y) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return fieldLine(doc, 'Attachments', 'None listed', y);
  const names = list.map((f) => f?.name || f?.originalName || 'file').join(', ');
  return fieldLine(doc, 'Attachments', names, y);
}

/**
 * Build a PDF summary of a submitted claim (text fields + signature/sketch images when present).
 */
export function generateClaimPdfBuffer({ claim, intakeReference, systemReference }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    let y = 50;
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#0f172a').text('Horizon Smash Repairs', 50, y);
    y += 24;
    doc.font('Helvetica').fontSize(11).fillColor('#57534e').text('Accident claim submission', 50, y);
    y += 22;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f766e').text(`Member reference: ${intakeReference}`, 50, y);
    doc.text(`File reference: ${systemReference}`, 300, y);
    y += 16;
    doc.font('Helvetica').fontSize(9).fillColor('#78716c').text(`Generated: ${new Date().toISOString()}`, 50, y);
    y += 24;

    y = sectionTitle(doc, 'Checklist', y);
    const checklist = claim.checklist || {};
    for (const [key, label] of Object.entries(CHECKLIST_LABELS)) {
      const tick = checklist[key] ? 'Yes' : 'No';
      y = fieldLine(doc, label, tick, y);
    }
    if (checklist.excessPayment) {
      y = fieldLine(doc, 'Excess applicability', claim.excessPaymentApplicability, y);
      y = fieldLine(doc, 'Excess amount', claim.excessPaymentAmount, y);
    }
    if (checklist.repairQuote) {
      y = fieldLine(doc, 'Repair quote ref.', claim.repairQuoteRef, y);
    }

    const mv = claim.memberVehicle || {};
    y = sectionTitle(doc, 'Member & vehicle', y);
    y = fieldLine(doc, 'Member number', mv.memberNumber, y);
    y = fieldLine(doc, 'Claim type', mv.claimType, y);
    y = fieldLine(doc, 'Plate', mv.plateNumber, y);
    y = fieldLine(doc, 'Make / model', [mv.make, mv.model].filter(Boolean).join(' '), y);
    y = fieldLine(doc, 'Kilometers', mv.kilometers, y);
    y = fieldLine(doc, 'Month / year', mv.monthYear, y);
    y = fieldLine(doc, 'Owner', mv.ownerName, y);
    y = fieldLine(doc, 'Address', mv.address, y);
    y = fieldLine(doc, 'Mobile', mv.mobile, y);
    y = fieldLine(doc, 'Email', mv.email, y);

    const dr = claim.driver || {};
    y = sectionTitle(doc, 'Driver', y);
    y = fieldLine(doc, 'Name', dr.name || [dr.firstName, dr.lastName].filter(Boolean).join(' '), y);
    y = fieldLine(doc, 'Address', dr.address || [dr.streetAddress, dr.suburb, dr.state, dr.postcode].filter(Boolean).join(', '), y);
    y = fieldLine(doc, 'Mobile / email', [dr.mobile, dr.email].filter(Boolean).join(' · '), y);
    y = fieldLine(doc, 'Licence no.', dr.licenceNumber, y);
    y = fieldLine(doc, 'Licence expiry', dr.expiryDate, y);
    y = fieldLine(doc, 'Date of birth', dr.dateOfBirth, y);
    y = fieldLine(doc, 'Relationship', dr.relationship, y);
    y = fieldLine(doc, 'Police report no.', dr.policeReportNumber, y);
    y = fieldLine(doc, 'At fault', dr.atFault, y);
    y = attachmentList(doc, claim.driverLicenseFrontAttachments, y);
    y = attachmentList(doc, claim.driverLicenseBackAttachments, y);
    y = attachmentList(doc, claim.taxiAuthorityAttachments, y);
    y = attachmentList(doc, claim.registrationAttachments, y);

    const inc = claim.incident || {};
    y = sectionTitle(doc, 'Incident', y);
    y = fieldLine(doc, 'Date / time', [inc.date, inc.time].filter(Boolean).join(' '), y);
    y = fieldLine(doc, 'Location', [inc.addressDetailOptional, inc.streetName, inc.suburb].filter(Boolean).join(', '), y);
    y = fieldLine(doc, 'Road surface', inc.roadSurface, y);
    y = fieldLine(doc, 'Traffic controls', inc.trafficControls, y);
    y = fieldLine(doc, 'Vehicles involved', inc.numberOfVehicles, y);
    y = fieldLine(doc, 'Description', inc.description, y);

    const dmg = claim.damage || {};
    const diagram = dmg.diagram || {};
    y = sectionTitle(doc, 'Damage & towing', y);
    y = fieldLine(doc, 'Claiming damage', dmg.claimingDamage, y);
    y = fieldLine(doc, 'Towed', dmg.towed, y);
    y = fieldLine(doc, 'Tow company', dmg.towCompany, y);
    y = fieldLine(doc, 'Vehicle location', dmg.currentVehicleLocation, y);
    y = fieldLine(doc, 'Damage markers', (diagram.markers || []).length, y);
    y = fieldLine(doc, 'Damage sketches', (diagram.strokes || []).length, y);
    y = attachmentList(doc, diagram.scenePhotos, y);
    y = attachmentList(doc, diagram.detailPhotos, y);

    const parties = claim.otherParties || [];
    if (parties.length) {
      y = sectionTitle(doc, 'Other parties', y);
      parties.forEach((p, i) => {
        y = fieldLine(doc, `Party ${i + 1} plate`, p.plateNumber, y);
        y = fieldLine(doc, `Party ${i + 1} driver`, p.driverName, y);
        y = fieldLine(doc, `Party ${i + 1} contact`, [p.mobile, p.email].filter(Boolean).join(' · '), y);
      });
    }

    const witnesses = claim.witnessDetails || [];
    if (witnesses.length) {
      y = sectionTitle(doc, 'Witnesses', y);
      witnesses.forEach((w, i) => {
        y = fieldLine(doc, `Witness ${i + 1}`, [w.name, w.mobile, w.email].filter(Boolean).join(' · '), y);
      });
    }

    const decl = claim.declaration || {};
    y = sectionTitle(doc, 'Declaration', y);
    y = fieldLine(doc, 'Signed by', decl.signedBy, y);
    y = fieldLine(doc, 'Print name', decl.typedName, y);
    y = fieldLine(doc, 'Date', decl.date, y);

    const sig = parseDataUrlImage(decl.signatureDataUrl);
    if (sig) {
      y = ensureSpace(doc, y, 120);
      doc.font('Helvetica-Bold').fontSize(9).text('Signature', 50, y);
      y += 14;
      try {
        doc.image(sig.buffer, 50, y, { fit: [220, 80] });
        y += 90;
      } catch {
        y = fieldLine(doc, 'Signature', '(could not embed image)', y);
      }
    }

    const sketchUrl = claim.accidentSketch?.diagramDataUrl;
    const sketchImg = parseDataUrlImage(sketchUrl);
    if (sketchImg) {
      y = sectionTitle(doc, 'Accident sketch', y);
      y = ensureSpace(doc, y, 220);
      try {
        doc.image(sketchImg.buffer, 50, y, { fit: [495, 200] });
        y += 210;
      } catch {
        y = fieldLine(doc, 'Sketch', '(could not embed image)', y);
      }
    }

    doc.font('Helvetica').fontSize(8).fillColor('#a8a29e').text(
      'Checklist files are listed by name only; upload originals separately if required.',
      50,
      ensureSpace(doc, y, 30),
      { width: 495 }
    );

    doc.end();
  });
}
