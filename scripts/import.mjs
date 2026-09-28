// Reads the latest exports from data/inbox and writes the costing model the app loads.
// Output goes to data/model.json (git-ignored, never part of a build) because it contains salaries.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInbox } from '../src/engine/read.js';
import { buildModel } from '../src/engine/model.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inbox = path.join(root, 'data', 'inbox');
const outDir = path.join(root, 'data');

const raw = readInbox(inbox);
for (const [kind, v] of Object.entries(raw)) console.log(`${kind.padEnd(10)} ${v.file} (${v.rows.length} rows)`);

const model = buildModel(raw);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'model.json'), JSON.stringify(model));

const t = model.totals;
console.log(`\n${model.period}: ${t.customers} customers, margin ${(t.margin * 100).toFixed(2)}%, ${t.belowTarget} below target`);
console.log(`Wrote ${path.relative(root, path.join(outDir, 'model.json'))}`);
