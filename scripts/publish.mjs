// Publishes the current import to Supabase: one full snapshot for admin/leadership and
// one PM-safe snapshot per PM (built by pmView, salaries removed on this machine).
// Usage: npm run import && npm run publish
import { adminClient, loadModel, periodKey, must } from './supabase-admin.mjs';
import { adminView, pmView } from '../src/engine/views.js';

const model = loadModel();
const supabase = adminClient();
const period = periodKey(model.period);

const rows = [
  { period, audience: 'admin', generated_at: model.generatedAt, data: adminView(model) },
  ...model.pms.map((pm) => ({ period, audience: `pm:${pm.id}`, generated_at: model.generatedAt, data: pmView(model, pm.id) })),
];

must(await supabase.from('snapshots').upsert(rows, { onConflict: 'period,audience' }), 'Upload snapshots');

// Keep each customer's name and PM list on its profile (brief/tech/notes are left as Matt entered them),
// so a PM can read the profiles of exactly the customers they're on.
const sync = await supabase.from('customer_profiles').upsert(model.customers.map((c) => ({ code: c.code, name: c.name, pm_ids: c.pmIds })), { onConflict: 'code' });
if (sync.error) console.warn(`Customer profiles not synced (${sync.error.message}). Run the latest supabase/schema.sql in the SQL editor, then publish again.`);
console.log(`Published ${model.period} (${period}): 1 admin snapshot + ${rows.length - 1} PM snapshots.`);
