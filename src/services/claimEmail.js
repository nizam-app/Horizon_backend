import nodemailer from 'nodemailer';
import { generateClaimPdfBuffer } from './claimPdf.js';

export function isClaimEmailConfigured() {
  const to = process.env.CLAIM_SUBMISSION_EMAIL_TO?.trim();
  const host = process.env.SMTP_HOST?.trim();
  return Boolean(to && host);
}

function createTransport() {
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST?.trim(),
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: user ? { user, pass } : undefined,
  });
}

/**
 * Generate claim PDF and email it (non-blocking errors logged by caller).
 */
export async function emailClaimSubmission({ claim, intakeReference, systemReference }) {
  if (!isClaimEmailConfigured()) return { sent: false, reason: 'not_configured' };

  const pdfBuffer = await generateClaimPdfBuffer({ claim, intakeReference, systemReference });
  const to = process.env.CLAIM_SUBMISSION_EMAIL_TO.trim();
  const from =
    process.env.CLAIM_SUBMISSION_EMAIL_FROM?.trim() ||
    process.env.SMTP_USER?.trim() ||
    'Horizon Claims <noreply@horizon.local>';

  const plate = claim?.memberVehicle?.plateNumber || '—';
  const driver =
    claim?.driver?.name ||
    [claim?.driver?.firstName, claim?.driver?.lastName].filter(Boolean).join(' ') ||
    '—';
  const incidentDate = claim?.incident?.date || '—';
  const safeName = String(intakeReference).replace(/[^A-Za-z0-9-]/g, '');

  const transporter = createTransport();
  await transporter.sendMail({
    from,
    to,
    subject: `New accident claim ${intakeReference} — ${plate}`,
    text: [
      'A new accident claim was submitted via the Horizon portal.',
      '',
      `Member reference: ${intakeReference}`,
      `File reference: ${systemReference}`,
      `Plate: ${plate}`,
      `Driver: ${driver}`,
      `Incident date: ${incidentDate}`,
      '',
      'Full details are in the attached PDF.',
    ].join('\n'),
    attachments: [
      {
        filename: `horizon-claim-${safeName}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });

  return { sent: true };
}

/** Fire-and-forget wrapper for use after HTTP response. */
export function queueClaimSubmissionEmail(meta) {
  if (!isClaimEmailConfigured()) return;
  emailClaimSubmission(meta).catch((err) => {
    console.error('[claim-email] Failed to send submission email:', err?.message || err);
  });
}
