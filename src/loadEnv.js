import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Backend package root (`backend/`), regardless of shell cwd. */
export const BACKEND_ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(BACKEND_ROOT, '.env') });
