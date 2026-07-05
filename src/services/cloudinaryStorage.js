import crypto from 'crypto';

function cfg() {
  return {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME?.trim(),
    apiKey: process.env.CLOUDINARY_API_KEY?.trim(),
    apiSecret: process.env.CLOUDINARY_API_SECRET?.trim(),
    folder: process.env.CLOUDINARY_FOLDER?.trim() || 'horizon-claims',
    uploadTimeoutMs: Number(process.env.CLOUDINARY_UPLOAD_TIMEOUT_MS || 15000),
  };
}

export function isCloudinaryConfigured() {
  const c = cfg();
  return Boolean(c.cloudName && c.apiKey && c.apiSecret);
}

function signParams(params, apiSecret) {
  const payload = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return crypto.createHash('sha1').update(`${payload}${apiSecret}`).digest('hex');
}

function publicIdFor({ claimId, id, slug }) {
  const safeClaim = String(claimId || 'claim').replace(/[^a-z0-9/_-]+/gi, '-').slice(0, 120);
  const safeId = String(id || crypto.randomUUID()).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 90);
  const safeSlug = String(slug || 'evidence').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80);
  return `${safeClaim}/evidence/${safeId}-${safeSlug}`;
}

export async function uploadEvidenceToCloudinary({ buffer, mimeType, filename, claimId, id, slug }) {
  const c = cfg();
  if (!isCloudinaryConfigured()) {
    throw new Error('Cloudinary is not configured');
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const public_id = publicIdFor({ claimId, id, slug });
  const params = {
    folder: c.folder,
    overwrite: 'false',
    public_id,
    timestamp,
  };
  const signature = signParams(params, c.apiSecret);

  const body = new FormData();
  body.append('file', new Blob([buffer], { type: mimeType || 'application/octet-stream' }), filename || 'evidence');
  body.append('api_key', c.apiKey);
  body.append('folder', params.folder);
  body.append('overwrite', params.overwrite);
  body.append('public_id', params.public_id);
  body.append('timestamp', String(timestamp));
  body.append('signature', signature);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(3000, c.uploadTimeoutMs));
  let response;
  try {
    response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(c.cloudName)}/auto/upload`, {
      method: 'POST',
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result?.error?.message || `Cloudinary upload failed (${response.status})`);
  }

  return {
    provider: 'cloudinary',
    publicId: result.public_id,
    resourceType: result.resource_type || 'image',
    url: result.secure_url || result.url,
    bytes: result.bytes,
    format: result.format,
  };
}

export async function deleteCloudinaryAsset(publicId, resourceType = 'image') {
  const c = cfg();
  const id = String(publicId || '').trim();
  if (!isCloudinaryConfigured() || !id) return false;

  const timestamp = Math.floor(Date.now() / 1000);
  const params = {
    invalidate: 'true',
    public_id: id,
    timestamp,
  };
  const signature = signParams(params, c.apiSecret);
  const body = new URLSearchParams({
    api_key: c.apiKey,
    invalidate: params.invalidate,
    public_id: params.public_id,
    timestamp: String(timestamp),
    signature,
  });
  const type = String(resourceType || 'image').replace(/[^a-z]/gi, '') || 'image';
  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(c.cloudName)}/${type}/destroy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return response.ok;
}
