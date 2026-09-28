// Shared setup for scripts that talk to Supabase with the service-role key.
// The key comes from .env (git-ignored) and must never be used in the browser app.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function adminClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env (see .env.example).');
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function loadModel() {
  const file = path.join(root, 'data', 'model.json');
  if (!fs.existsSync(file)) {
    console.error('No model yet. Run "npm run import" first.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

// "September 2026" -> "2026-09"; anything else is used as-is.
export function periodKey(label) {
  const m = String(label).trim().toLowerCase().match(/^([a-z]+)\s+(\d{4})$/);
  const i = m ? MONTHS.indexOf(m[1]) : -1;
  return i >= 0 ? `${m[2]}-${String(i + 1).padStart(2, '0')}` : String(label).trim();
}

export const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};
