import nodemailer from 'nodemailer';
import { generateClaimPdfBuffer } from './claimPdf.js';

const RESEND_EMAILS_URL = 'https://api.resend.com/emails';

function claimRecipient() {
  return process.env.CLAIM_SUBMISSION_EMAIL_TO?.trim();
}

function resendApiKey() {
  return process.env.RESEND_API_KEY?.trim();
}

function mailFromRaw() {
  return process.env.CLAIM_SUBMISSION_EMAIL_FROM?.trim() || process.env.SMTP_USER?.trim() || '';
}

function isResendConfigured() {
  return Boolean(claimRecipient() && mailFromRaw() && resendApiKey());
}

function isSmtpConfigured() {
  const to = claimRecipient();
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = String(process.env.SMTP_PASS ?? '').trim();
  return Boolean(to && host && user && pass.length >= 8);
}

export function isClaimEmailConfigured() {
  return isResendConfigured() || isSmtpConfigured();
}

export function getClaimEmailProvider() {
  if (isResendConfigured()) return 'resend';
  if (isSmtpConfigured()) return 'smtp';
  return 'none';
}

function mailFromForSmtp() {
  const raw = mailFromRaw();
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

async function sendViaResend({ to, from, subject, text, attachment }) {
  const response = await fetch(RESEND_EMAILS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      text,
      attachments: [
        {
          filename: attachment.filename,
          content: attachment.content.toString('base64'),
          content_type: attachment.contentType,
        },
      ],
    }),
  });

  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.message || body?.error || JSON.stringify(body);
    } catch {
      detail = await response.text();
    }
    throw new Error(`Resend email failed (${response.status}): ${detail}`);
  }

  return response.json();
}

/**
 * Generate claim PDF and email it.
 */
export async function emailClaimSubmission({ claim, intakeReference, systemReference }) {
  if (!isClaimEmailConfigured()) return { sent: false, reason: 'not_configured' };

  const pdfBuffer = await generateClaimPdfBuffer({ claim, intakeReference, systemReference });
  const to = claimRecipient();
  const from = mailFromRaw();

  const plate = claim?.memberVehicle?.plateNumber || '-';
  const driver =
    claim?.driver?.name ||
    [claim?.driver?.firstName, claim?.driver?.lastName].filter(Boolean).join(' ') ||
    '-';
  const incidentDate = claim?.incident?.date || '-';
  const safeName = String(intakeReference).replace(/[^A-Za-z0-9-]/g, '');
  const subject = `New accident claim ${intakeReference} - ${plate}`;
  const text = [
    'A new accident claim was submitted via the Horizon portal.',
    '',
    `Member reference: ${intakeReference}`,
    `File reference: ${systemReference}`,
    `Plate: ${plate}`,
    `Driver: ${driver}`,
    `Incident date: ${incidentDate}`,
    '',
    'Full details are in the attached PDF.',
  ].join('\n');
  const attachment = {
    filename: `horizon-claim-${safeName}.pdf`,
    content: pdfBuffer,
    contentType: 'application/pdf',
  };

  if (getClaimEmailProvider() === 'resend') {
    await sendViaResend({ to, from, subject, text, attachment });
    return { sent: true, provider: 'resend' };
  }

  const transporter = createTransport();
  await transporter.sendMail({
    from: mailFromForSmtp(),
    to,
    subject,
    text,
    attachments: [attachment],
  });

  return { sent: true, provider: 'smtp' };
}

/** Fire-and-forget wrapper for use after HTTP response. */
export function queueClaimSubmissionEmail(meta) {
  if (!isClaimEmailConfigured()) {
    console.warn(
      '[claim-email] Skipped - set CLAIM_SUBMISSION_EMAIL_TO plus RESEND_API_KEY and CLAIM_SUBMISSION_EMAIL_FROM, or SMTP_HOST, SMTP_USER, and SMTP_PASS'
    );
    return;
  }
  emailClaimSubmission(meta)
    .then((result) => {
      console.info(
        `[claim-email] Sent PDF for ${meta.intakeReference} via ${result.provider} -> ${process.env.CLAIM_SUBMISSION_EMAIL_TO}`
      );
    })
    .catch((err) => {
      console.error('[claim-email] Failed to send submission email:', err?.message || err);
    });
}
