import path from 'path';
import { BACKEND_ROOT } from '../loadEnv.js';

const rawUpload = process.env.UPLOAD_DIR?.trim();

/** Relative `UPLOAD_DIR` values resolve from backend package root, not shell cwd. */
export const UPLOAD_ROOT = rawUpload
  ? path.isAbsolute(rawUpload)
    ? path.resolve(rawUpload)
    : path.resolve(BACKEND_ROOT, rawUpload)
  : path.join(BACKEND_ROOT, 'uploads');

export function claimsUploadDir(claimMongoId) {
  return path.join(UPLOAD_ROOT, 'claims', String(claimMongoId));
}
