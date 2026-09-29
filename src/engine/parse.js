// Reads one export workbook into { kind, file, sheetName, header, rows }. Browser-safe:
// used by the in-app upload (Data & validation) and by the Node import script.
// Files are recognised by their column headers, not their names, because the portal adds
// timestamps to filenames.
import * as XLSX from 'xlsx';

import { KINDS } from './kinds.js';
export { KINDS, KIND_LABEL, REQUIRED_KINDS, periodKey } from './kinds.js';

// data: ArrayBuffer / Uint8Array (browser) or Buffer (Node).
export function parseWorkbook(data, fileName) {
  const wb = XLSX.read(data, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const header = (XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })[0] || []).map((h) => (h == null ? '' : String(h).trim()));
  const kind = Object.keys(KINDS).find((k) => KINDS[k](header)) || null;
  // ProjectsDetails is a grouped layout (project cells only on the first row), so keep it as arrays.
  const rows =
    kind === 'projects'
      ? XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }).slice(1)
      : XLSX.utils.sheet_to_json(sheet, { defval: null }).map(trimKeys);
  return { kind, file: fileName, sheetName, header, rows };
}

function trimKeys(row) {
  const out = {};
  for (const k of Object.keys(row)) out[k.trim()] = row[k];
  return out;
}
