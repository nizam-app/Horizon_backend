import nodemailer from 'nodemailer';
import { generateClaimPdfBuffer } from './claimPdf.js';

export function isClaimEmailConfigured() {
  const to = process.env.CLAIM_SUBMISSION_EMAIL_TO?.trim();
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = String(process.env.SMTP_PASS ?? '').trim();
  return Boolean(to && host && user && pass.length >= 8);
}

function mailFrom() {
  const raw =
    process.env.CLAIM_SUBMISSION_EMAIL_FROM?.trim() || process.env.SMTP_USER?.trim() || '';
  const angled = /^(.+?)\s*<([^>]+)>$/.exec(raw);
  if (angled) return { name: angled[1].trim(), address: angled[2].trim() };
  return raw;
}

function createTransport() {
  const user = process.env.SMTP_USER?.trim();
  const pass = String(process.env.SMTP_PASS ?? '').trim();
  if (!user || !pass) {
    throw new Error('SMTP_USER and SMTP_PASS are required to send claim emails');
  }
  const host = process.env.SMTP_HOST?.trim();
  if (host === 'smtp.gmail.com') {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    });
  }
  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass },
  });
}

/** Test SMTP login without sending mail (use ?verifyEmail=1 on /health). */
export async function verifySmtpConnection() {
  const transporter = createTransport();
  await transporter.verify();
}

/**
 * Generate claim PDF and email it (non-blocking errors logged by caller).
 */
export async function emailClaimSubmission({ claim, intakeReference, systemReference }) {
  if (!isClaimEmailConfigured()) return { sent: false, reason: 'not_configured' };

  const pdfBuffer = await generateClaimPdfBuffer({ claim, intakeReference, systemReference });
  const to = process.env.CLAIM_SUBMISSION_EMAIL_TO.trim();
  const from = mailFrom();

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
  if (!isClaimEmailConfigured()) {
    console.warn(
      '[claim-email] Skipped — set CLAIM_SUBMISSION_EMAIL_TO, SMTP_HOST, SMTP_USER, and SMTP_PASS on the API server'
    );
    return;
  }
  emailClaimSubmission(meta)
    .then(() => {
      console.info(`[claim-email] Sent PDF for ${meta.intakeReference} → ${process.env.CLAIM_SUBMISSION_EMAIL_TO}`);
    })
    .catch((err) => {
      console.error('[claim-email] Failed to send submission email:', err?.message || err);
    });
}
