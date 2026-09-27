/**
 * Short-lived storage for buyer PDFs between OCR parse and claim create.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { UPLOAD_ROOT } from '../config/paths.js';

const TMP_DIR = path.join(UPLOAD_ROOT, 'tmp', 'buyer-pdf');
const TTL_MS = Number(process.env.BUYER_PDF_TMP_TTL_MS || 60 * 60 * 1000);

function ensureTmpDir() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

function metaPath(token) {
  return path.join(TMP_DIR, `${token}.json`);
}

function pdfPath(token) {
  return path.join(TMP_DIR, `${token}.pdf`);
}

export function storeBuyerPdfTemp({ buffer, originalName, staffId }) {
  ensureTmpDir();
  const token = crypto.randomUUID();
  const meta = {
    token,
    originalName: String(originalName || 'buyer.pdf').slice(0, 512),
    staffId: staffId ? String(staffId) : null,
    createdAt: Date.now(),
    expiresAt: Date.now() + TTL_MS,
    size: buffer.length,
  };
  fs.writeFileSync(pdfPath(token), buffer);
  fs.writeFileSync(metaPath(token), JSON.stringify(meta), 'utf8');
  return meta;
}

export function consumeBuyerPdfTemp(token, staffId = null) {
  const clean = String(token || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(clean)) return null;

  const mPath = metaPath(clean);
  const pPath = pdfPath(clean);
  if (!fs.existsSync(mPath) || !fs.existsSync(pPath)) return null;

  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(mPath, 'utf8'));
  } catch {
    return null;
  }

  if (!meta?.expiresAt || Date.now() > Number(meta.expiresAt)) {
    try {
      fs.unlinkSync(mPath);
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(pPath);
    } catch {
      /* ignore */
    }
    return null;
  }

  if (staffId && meta.staffId && String(meta.staffId) !== String(staffId)) {
    return null;
  }

  const buffer = fs.readFileSync(pPath);
  try {
    fs.unlinkSync(mPath);
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(pPath);
  } catch {
    /* ignore */
  }

  return {
    buffer,
    originalName: meta.originalName || 'buyer.pdf',
    size: buffer.length,
  };
}

/** Best-effort cleanup of expired temp PDFs (called opportunistically). */
export function cleanupExpiredBuyerPdfTemps() {
  try {
    ensureTmpDir();
    const names = fs.readdirSync(TMP_DIR);
    const now = Date.now();
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const mPath = path.join(TMP_DIR, name);
      try {
        const meta = JSON.parse(fs.readFileSync(mPath, 'utf8'));
        if (meta?.expiresAt && now > Number(meta.expiresAt)) {
          const token = path.basename(name, '.json');
          fs.unlinkSync(mPath);
          const p = pdfPath(token);
          if (fs.existsSync(p)) fs.unlinkSync(p);
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}
