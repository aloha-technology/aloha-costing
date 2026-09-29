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

export { periodKey } from '../src/engine/kinds.js';

export const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};

// Starting passwords: random, easy to read out (no 0/O, 1/l/I), e.g. "k7Qm-3xPz-9Rtb".
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function tempPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const s = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

// Passwords go to a git-ignored file only, never to the terminal.
export function savePasswords(rows) {
  const file = path.join(root, 'data', 'new-passwords.txt');
  const stamp = new Date().toLocaleString();
  const lines = rows.map((r) => `${r.email}\t${r.name || ''}\t${r.password}`);
  fs.appendFileSync(file, `\n# ${stamp}: send each person their line on WhatsApp, then delete this file\n${lines.join('\n')}\n`);
  return path.relative(root, file);
}
