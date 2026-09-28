// Node-only: find the latest export of each kind in data/inbox and read it into row objects.
// Files are recognised by their column headers, not their names, because the portal
// adds timestamps to filenames.
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';

XLSX.set_fs(fs);

const KINDS = {
  summary: (h) => h.includes('Billing Code') && h.includes('Cost INR'),
  employees: (h) => h.includes('Allocated Projects') && h.includes('Project Utilization(%)'),
  projects: (h) => h.includes('Resource Type') && h.includes('Rate'),
  paysheet: (h) => h.includes('CTC') && h.includes('Base Salary'),
  bench: (h) => h.includes('Utilized salary'),
  invoicing: (h) => h.includes('Project Code') && h.includes('PM'),
};

export function readInbox(dir) {
  const found = {};
  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.xlsx?$/i.test(f) && !f.startsWith('~$'))
    .map((f) => ({ f, full: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime); // newest first, so the first match per kind wins

  for (const { f, full } of files) {
    const wb = XLSX.readFile(full);
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const header = (XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })[0] || []).map((h) =>
      h == null ? '' : String(h).trim()
    );
    const kind = Object.keys(KINDS).find((k) => KINDS[k](header));
    if (!kind || found[kind]) continue;
    // ProjectsDetails is a grouped layout (project cells only on the first row), so keep it as arrays.
    const rows =
      kind === 'projects'
        ? XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }).slice(1)
        : XLSX.utils.sheet_to_json(sheet, { defval: null }).map(trimKeys);
    found[kind] = { file: f, sheetName, header, rows };
  }
  return found;
}

function trimKeys(row) {
  const out = {};
  for (const k of Object.keys(row)) out[k.trim()] = row[k];
  return out;
}
