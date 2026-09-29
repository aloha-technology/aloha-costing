// Sends Collections emails that are queued (approved by Matt, or automatic stages).
//   npm run col:send                 local data (data/collections), SMTP from .env
//   npm run col:send -- --cloud      Supabase data (service-role key), e.g. from the scheduled GitHub Action
//   add --dry-run to see what would go without sending
// Automatic stages (Settings -> Auto-send) are queued first; everything else needs Matt's click.
import path from 'node:path';
import { localStore, supabaseStore, queueAutomatic, sendQueued } from './collections-store.mjs';
import { root, adminClient } from './supabase-admin.mjs';

const cloud = process.argv.includes('--cloud');
const dryRun = process.argv.includes('--dry-run');
const store = cloud ? supabaseStore(adminClient(), 'scheduler') : localStore(path.join(root, 'data', 'collections'));

const auto = dryRun ? [] : await queueAutomatic(store);
if (auto.length) console.log(`Queued ${auto.length} automatic reminder(s).`);
const r = await sendQueued(store, process.env, { dryRun }).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
console.log(`${dryRun ? 'Dry run: would send' : 'Sent'} ${r.sent}, failed ${r.failed}.`);
for (const x of r.results.filter((x) => !x.ok)) console.log(`  ${x.id}: ${x.error}`);
if (r.failed) process.exitCode = 1;
