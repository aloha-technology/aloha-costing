// Node-only: read the newest export of each kind in data/inbox (see parse.js).
import fs from 'node:fs';
import path from 'node:path';
import { parseWorkbook } from './parse.js';

export function readInbox(dir) {
  const found = {};
  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.xlsx?$/i.test(f) && !f.startsWith('~$'))
    .map((f) => ({ f, full: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime); // newest first, so the first match per kind wins

  for (const { f, full } of files) {
    const parsed = parseWorkbook(fs.readFileSync(full), f);
    if (!parsed.kind || found[parsed.kind]) continue;
    const { kind, ...rest } = parsed;
    found[kind] = rest;
  }
  return found;
}
