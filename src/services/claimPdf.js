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
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.filter((x) => x != null && x !== '').join(', ') || '—';
  if (typeof v === 'object') return JSON.stringify(v);
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

function subsectionTitle(doc, title, y) {
  y = ensureSpace(doc, y, 28);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#334155').text(title, 50, y);
  return y + 16;
}

function fieldLine(doc, label, value, y) {
  y = ensureSpace(doc, y, 40);
  const text = str(value);
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#44403c').text(label, 50, y, { width: 155 });
  doc.font('Helvetica').fontSize(9).fillColor('#1c1917');
  const h = doc.heightOfString(text, { width: 330 });
  doc.text(text, 210, y, { width: 330 });
  return y + Math.max(h, 12) + 5;
}

function fieldsBlock(doc, pairs, y) {
  for (const [label, value] of pairs) {
    y = fieldLine(doc, label, value, y);
  }
  return y;
}

function attachmentList(doc, label, items, y) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return fieldLine(doc, label, 'None', y);
  list.forEach((f, i) => {
    const name = f?.name || f?.originalName || 'file';
    const source = f?.source === 'camera' ? 'Camera' : f?.source === 'upload' ? 'Upload' : str(f?.source);
    const embedded = f?.dataUrl ? ' (file attached)' : '';
    y = fieldLine(doc, `${label} ${list.length > 1 ? i + 1 : ''}`.trim(), `${name} (${source})${embedded}`, y);
  });
  return y;
}

function embedAttachmentsGallery(doc, sectionLabel, items, y, fit = [495, 260]) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return y;
  y = subsectionTitle(doc, sectionLabel, y);
  for (let i = 0; i < list.length; i += 1) {
    const f = list[i];
    const name = f?.name || `${sectionLabel} ${i + 1}`;
    const dataUrl = typeof f?.dataUrl === 'string' ? f.dataUrl.trim() : '';
    if (parseDataUrlImage(dataUrl)) {
      y = embedImage(doc, name, dataUrl, y, fit);
    } else if (dataUrl.startsWith('data:application/pdf')) {
      y = fieldLine(doc, name, 'PDF attached (download from admin portal)', y);
    } else {
      y = fieldLine(doc, name, 'Filename only — no preview stored', y);
    }
  }
  return y;
}

function embedImage(doc, label, dataUrl, y, fit = [495, 200]) {
  const img = parseDataUrlImage(dataUrl);
  if (!img) return y;
  y = ensureSpace(doc, y, fit[1] + 30);
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#44403c').text(label, 50, y);
  y += 14;
  try {
    doc.image(img.buffer, 50, y, { fit });
    return y + fit[1] + 12;
  } catch {
    return fieldLine(doc, label, '(image could not be embedded)', y);
  }
}

function formatSketchModel(sketchModel) {
  if (!sketchModel || typeof sketchModel !== 'object') return '—';
  const lines = Array.isArray(sketchModel.lines) ? sketchModel.lines.length : 0;
  const vehicles = Array.isArray(sketchModel.vehicles) ? sketchModel.vehicles : [];
  const labels = Array.isArray(sketchModel.labels) ? sketchModel.labels : [];
  const vehicleDesc = vehicles
    .map((v, i) => {
      const role = v?.role === 'self' ? 'Your vehicle' : v?.role === 'other' ? 'Other vehicle' : 'Vehicle';
      return `${i + 1}. ${role} at (${Math.round(v?.x ?? 0)}, ${Math.round(v?.y ?? 0)})`;
    })
    .join('; ');
  const labelDesc = labels
    .map((l, i) => `${i + 1}. "${l?.text ?? ''}" at (${Math.round(l?.x ?? 0)}, ${Math.round(l?.y ?? 0)})`)
    .join('; ');
  return [
    `Road lines drawn: ${lines}`,
    vehicles.length ? `Vehicles: ${vehicleDesc}` : 'Vehicles: none',
    labels.length ? `Labels: ${labelDesc}` : 'Labels: none',
  ].join('\n');
}

function formatDamageMarkers(markers) {
  const list = Array.isArray(markers) ? markers : [];
  if (!list.length) return 'None';
  return list.map((p, i) => `${i + 1}. x=${Math.round(p?.x ?? 0)}, y=${Math.round(p?.y ?? 0)}`).join('; ');
}

function formatDamageStrokes(strokes) {
  const list = Array.isArray(strokes) ? strokes : [];
  if (!list.length) return 'None';
  return list
    .map((s, i) => `${i + 1}. ${(s?.points || []).length} points`)
    .join('; ');
}

/**
 * Full claim PDF — every submitted field from buildClaimPayload.
 * Optional `admin` adds staff workspace (quotes, parts, notes).
 */
export function generateClaimPdfBuffer({ claim, intakeReference, systemReference, admin = null }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    let y = 50;
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#0f172a').text('Horizon Smash Repairs', 50, y);
    y += 22;
    doc.font('Helvetica').fontSize(11).fillColor('#57534e').text('Accident claim — full submission record', 50, y);
    y += 20;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f766e').text(`Member reference: ${intakeReference}`, 50, y);
    doc.text(`File reference: ${systemReference}`, 300, y);
    y += 14;
    doc.font('Helvetica').fontSize(9).fillColor('#78716c').text(`PDF generated: ${new Date().toISOString()}`, 50, y);
    y += 22;

    // —— Checklist ——
    y = sectionTitle(doc, '1. Checklist', y);
    const checklist = claim.checklist || {};
    for (const [key, label] of Object.entries(CHECKLIST_LABELS)) {
      y = fieldLine(doc, label, checklist[key] ? 'Selected' : 'Not selected', y);
    }
    y = fieldsBlock(
      doc,
      [
        ['Excess applicability', claim.excessPaymentApplicability],
        ['Excess amount', claim.excessPaymentAmount],
        ['Repair quote reference', claim.repairQuoteRef],
      ],
      y
    );
    y = attachmentList(doc, 'Driver licence (front)', claim.driverLicenseFrontAttachments, y);
    y = attachmentList(doc, 'Driver licence (back)', claim.driverLicenseBackAttachments, y);
    y = attachmentList(doc, 'Taxi authority', claim.taxiAuthorityAttachments, y);
    y = attachmentList(doc, 'Registration', claim.registrationAttachments, y);
    y = embedAttachmentsGallery(doc, 'Driver licence — front (images)', claim.driverLicenseFrontAttachments, y);
    y = embedAttachmentsGallery(doc, 'Driver licence — back (images)', claim.driverLicenseBackAttachments, y);
    y = embedAttachmentsGallery(doc, 'Taxi authority (images)', claim.taxiAuthorityAttachments, y);
    y = embedAttachmentsGallery(doc, 'Registration (images)', claim.registrationAttachments, y);

    // —— Member & vehicle ——
    const mv = claim.memberVehicle || {};
    y = sectionTitle(doc, '2. Member & vehicle', y);
    y = fieldsBlock(
      doc,
      [
        ['Member number', mv.memberNumber],
        ['Claim type', mv.claimType],
        ['Plate number', mv.plateNumber],
        ['Make', mv.make],
        ['Model', mv.model],
        ['Kilometers', mv.kilometers],
        ['Month / year of manufacture', mv.monthYear],
        ['Owner name', mv.ownerName],
        ['Owner address', mv.address],
        ['Mobile', mv.mobile],
        ['Email', mv.email],
      ],
      y
    );

    // —— Driver ——
    const dr = claim.driver || {};
    y = sectionTitle(doc, '3. Driver details', y);
    y = fieldsBlock(
      doc,
      [
        ['Driver is owner', dr.isOwner],
        ['First name', dr.firstName],
        ['Last name', dr.lastName],
        ['Full name', dr.name || [dr.firstName, dr.lastName].filter(Boolean).join(' ')],
        ['Claim number', dr.claimNumber],
        ['Street address', dr.streetAddress],
        ['Suburb', dr.suburb],
        ['State', dr.state],
        ['Postcode', dr.postcode],
        ['Full address', dr.address],
        ['Mobile', dr.mobile],
        ['Email', dr.email],
        ['Licence number', dr.licenceNumber],
        ['Licence expiry', dr.expiryDate],
        ['Date of birth', dr.dateOfBirth],
        ['Years licence held', dr.yearOfHold],
        ['Relationship to owner', dr.relationship],
        ['Relationship (other)', dr.relationshipOther],
        ['Alcohol or drugs involved', dr.alcoholOrDrug],
        ['Breath test', dr.breathTest],
        ['Police notified', dr.policeReported],
        ['Police report number', dr.policeReportNumber],
        ['At fault', dr.atFault],
        ['Admitted liability (if at fault)', dr.admittedLiability],
        ['Other driver admitted liability', dr.otherDriverAdmittedLiability],
      ],
      y
    );

    // —— Incident ——
    const inc = claim.incident || {};
    y = sectionTitle(doc, '4. Incident', y);
    y = fieldsBlock(
      doc,
      [
        ['Date', inc.date],
        ['Day of week', inc.day],
        ['Time', inc.time],
        ['Address detail (optional)', inc.addressDetailOptional],
        ['Street name', inc.streetName],
        ['Suburb', inc.suburb],
        ['Road surface', inc.roadSurface],
        ['Covered vehicle state', inc.coveredVehicleState],
        ['Traffic controls', inc.trafficControls],
        ['Number of other vehicles', inc.numberOfVehicles],
        ['Estimated speed (your vehicle)', inc.estimatedSpeed],
        ['Estimated speed (other vehicle)', inc.estimatedOtherSpeed],
        ['Accident description', inc.description],
      ],
      y
    );

    // —— Accident sketch ——
    const sketch = claim.accidentSketch || {};
    y = sectionTitle(doc, '5. Accident scene sketch', y);
    y = fieldLine(doc, 'Canvas diagram included', sketch.diagramDataUrl ? 'Yes' : 'No', y);
    y = fieldLine(doc, 'Sketch model details', formatSketchModel(sketch.sketchModel), y);
    y = attachmentList(doc, 'Sketch file', sketch.attachments, y);
    if (sketch.diagramDataUrl) {
      y = embedImage(doc, 'Sketch canvas image', sketch.diagramDataUrl, y, [495, 220]);
    }
    y = embedAttachmentsGallery(doc, 'Sketch uploads', sketch.attachments, y);

    // —— Damage ——
    const dmg = claim.damage || {};
    const diagram = dmg.diagram || {};
    y = sectionTitle(doc, '6. Damage & towing', y);
    y = fieldsBlock(
      doc,
      [
        ['Claiming damage', dmg.claimingDamage],
        ['Vehicle towed', dmg.towed],
        ['Tow company', dmg.towCompany],
        ['Tow location', dmg.towLocation],
        ['Distance towed', dmg.distanceTowed],
        ['Current vehicle location', dmg.currentVehicleLocation],
        ['Damage marker positions', formatDamageMarkers(diagram.markers)],
        ['Damage area drawings', formatDamageStrokes(diagram.strokes)],
      ],
      y
    );
    y = attachmentList(doc, 'Damage scene photo', diagram.scenePhotos, y);
    y = attachmentList(doc, 'Damage detail photo', diagram.detailPhotos, y);
    y = embedAttachmentsGallery(doc, 'Damage scene photos', diagram.scenePhotos, y);
    y = embedAttachmentsGallery(doc, 'Damage detail photos', diagram.detailPhotos, y);

    // —— Other parties ——
    const parties = claim.otherParties || [];
    y = sectionTitle(doc, '7. Other parties', y);
    if (!parties.length) {
      y = fieldLine(doc, 'Other parties', 'None recorded', y);
    } else {
      parties.forEach((p, i) => {
        y = subsectionTitle(doc, `Other party ${i + 1}`, y);
        y = fieldsBlock(
          doc,
          [
            ['Plate number', p.plateNumber],
            ['Make', p.make],
            ['Model', p.model],
            ['Colour', p.color],
            ['Driver name', p.driverName],
            ['Owner details', p.ownerDetails],
            ['Address', p.address],
            ['Mobile', p.mobile],
            ['Email', p.email],
            ['Licence number', p.licenceNumber],
            ['Licence expiry', p.expiryDate],
            ['Date of birth', p.dateOfBirth],
            ['Insurance company', p.insuranceCompany],
            ['Insurance claim number', p.claimNumber],
          ],
          y
        );
        y = attachmentList(doc, 'Licence front', p.licenceFrontAttachments, y);
        y = attachmentList(doc, 'Licence back', p.licenceBackAttachments, y);
        y = embedAttachmentsGallery(doc, 'Licence front (images)', p.licenceFrontAttachments, y);
        y = embedAttachmentsGallery(doc, 'Licence back (images)', p.licenceBackAttachments, y);
      });
    }

    // —— Witnesses ——
    const witnesses = claim.witnessDetails || [];
    y = sectionTitle(doc, '8. Witnesses', y);
    if (!witnesses.length) {
      y = fieldLine(doc, 'Witnesses', 'None recorded', y);
    } else {
      witnesses.forEach((w, i) => {
        y = subsectionTitle(doc, `Witness ${i + 1}`, y);
        y = fieldsBlock(
          doc,
          [
            ['Name', w.name],
            ['Address', w.address],
            ['Mobile', w.mobile],
            ['Email', w.email],
          ],
          y
        );
      });
    }

    // —— Declaration ——
    const decl = claim.declaration || {};
    y = sectionTitle(doc, '9. Declaration', y);
    y = fieldsBlock(
      doc,
      [
        ['Declaration agreed', decl.agreed],
        ['Signed by (role)', decl.signedBy],
        ['Print name', decl.typedName],
        ['Date signed', decl.date],
      ],
      y
    );
    if (decl.signatureDataUrl) {
      y = embedImage(doc, 'Signature', decl.signatureDataUrl, y, [220, 80]);
    }

    if (admin && typeof admin === 'object') {
      const quoteOptions = Array.isArray(admin.quoteOptions) ? admin.quoteOptions : [];
      const primaryQuote = quoteOptions.find((q) => String(q.id) === String(admin.primaryQuoteId));
      const finalQuote = quoteOptions.find((q) => String(q.id) === String(admin.finalQuoteId));
      const fmtAud = (n) =>
        n != null && n !== '' && !Number.isNaN(Number(n))
          ? `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : '—';

      y = sectionTitle(doc, '10. Admin workspace', y);
      y = fieldsBlock(
        doc,
        [
          ['Claim status', admin.status],
          ['Quote price (repair shop)', fmtAud(admin.quotePrice)],
          ['Insurance approved price', fmtAud(admin.insuranceApprovedPrice)],
          [
            'Primary workshop quote',
            primaryQuote ? `${primaryQuote.supplier} (${fmtAud(primaryQuote.amount)})` : '—',
          ],
          [
            'Final workshop quote',
            finalQuote ? `${finalQuote.supplier} (${fmtAud(finalQuote.amount)})` : '—',
          ],
          ['Payment status', admin.paymentStatus || '—'],
          ['Admin note', admin.adminNote || '—'],
          [
            'Case PDF files',
            Array.isArray(admin.caseFiles) && admin.caseFiles.length
              ? admin.caseFiles.map((f) => f.name || 'file').join(', ')
              : '—',
          ],
        ],
        y
      );

      const parts = Array.isArray(admin.parts) ? admin.parts : [];
      y = subsectionTitle(doc, 'Purchase lines', y);
      if (!parts.length) {
        y = fieldLine(doc, 'Parts', 'None recorded', y);
      } else {
        parts.forEach((p, i) => {
          y = subsectionTitle(doc, `Line ${i + 1}`, y);
          y = fieldsBlock(
            doc,
            [
              ['Supplier', p.company],
              ['Part name', p.partName],
              ['Amount', fmtAud(p.amount)],
              ['Order date', p.orderDate],
              ['Tentative received', p.tentativeReceivedDate],
              ['Received by', p.receivedBy],
              ['Invoice number', p.invoiceNumber],
              ['Status', p.status],
            ],
            y
          );
        });
      }
    }

    y = ensureSpace(doc, y, 40);
    doc.font('Helvetica').fontSize(8).fillColor('#a8a29e').text(
      'This PDF includes all submitted member fields and embedded images where stored with the claim.',
      50,
      y,
      { width: 495 }
    );

    doc.end();
  });
}
