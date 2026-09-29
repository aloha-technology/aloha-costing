// Uploads the local Collections data (data/collections) to Supabase, e.g. after the first setup.
//   npm run col:push              preview counts
//   npm run col:push -- --apply   upsert customers, invoices, payments, contracts, outbox, tax invoices, settings and files
// Needs supabase/collections.sql to have been run. Existing rows with the same id are replaced.
import fs from 'node:fs';
import path from 'node:path';
import { adminClient, root, must } from './supabase-admin.mjs';
import { localStore, supabaseStore } from './collections-store.mjs';

const apply = process.argv.includes('--apply');
const dir = path.join(root, 'data', 'collections');
const local = localStore(dir);
const all = local.loadAll();
const kinds = ['customers', 'invoices', 'payments', 'contracts', 'outbox', 'taxInvoices'];
console.table(Object.fromEntries(kinds.map((k) => [k, all[k].length])));
const fileIds = [...all.contracts, ...all.taxInvoices].map((x) => x.fileId).filter(Boolean);
console.log(`Files to upload: ${fileIds.length}`);
if (!apply) {
  console.log('\nPreview only. Run with --apply to upload.');
  process.exit(0);
}

const client = adminClient();
const cloud = supabaseStore(client, 'Matt (upload)');
for (const k of kinds) if (all[k].length) await cloud.put(k, all[k]);
if (all.settings) await cloud.saveSettings(all.settings);
for (const id of fileIds) {
  const p = local.filePath(id);
  if (!p) {
    console.warn(`  missing local file ${id}`);
    continue;
  }
  must(await client.storage.from('collections').upload(id, fs.readFileSync(p), { upsert: true }), `upload ${id}`);
}
console.log('Done.');
