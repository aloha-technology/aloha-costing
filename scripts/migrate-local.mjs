// One-time move of local actions, WhatsApp contacts and the sent log (data/*.json)
// into Supabase. Safe to re-run: existing ids are skipped.
//   npm run migrate            # preview
//   npm run migrate -- --apply
import fs from 'node:fs';
import path from 'node:path';
import { adminClient, root, must } from './supabase-admin.mjs';

const apply = process.argv.includes('--apply');
const read = (f, empty) => {
  const p = path.join(root, 'data', f);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : empty;
};
const actions = read('actions.json', []);
const contacts = read('pm-contacts.json', {});
const comms = read('comms.json', []);
console.log(`Local: ${actions.length} actions, ${Object.keys(contacts).length} contacts, ${comms.length} sent messages.`);
if (!apply) {
  console.log('Preview only. Run "npm run migrate -- --apply" to copy them to Supabase.');
  process.exit(0);
}

const supabase = adminClient();
const have = new Set(must(await supabase.from('actions').select('id'), 'Read actions').map((r) => r.id));
const fresh = actions.filter((a) => !have.has(a.id));
if (fresh.length) {
  must(
    await supabase.from('actions').insert(
      fresh.map((a) => ({
        id: a.id, customer_code: a.customerCode, customer_name: a.customerName, finding_id: a.findingId, kind: a.kind,
        severity: a.severity, title: a.title, ask: a.ask || '', description: a.description, owner_pm_id: a.ownerPmId,
        period: a.period, status: a.status, created_at: a.createdAt, created_by: a.createdBy, due_date: a.dueDate,
        original_due_date: a.originalDueDate, closed_at: a.closedAt, closure_note: a.closureNote, history: a.history,
      }))
    ),
    'Copy actions'
  );
  const savings = fresh.filter((a) => a.savingINR).map((a) => ({ action_id: a.id, saving_inr: a.savingINR }));
  if (savings.length) must(await supabase.from('action_savings').upsert(savings), 'Copy savings');
}
if (Object.keys(contacts).length)
  must(
    await supabase.from('pm_contacts').upsert(
      Object.entries(contacts).map(([pm_id, c]) => ({ pm_id, whatsapp: c.whatsapp || '', group_link: c.groupLink || '', updated_at: c.updatedAt || new Date().toISOString() }))
    ),
    'Copy contacts'
  );
if (comms.length)
  must(
    await supabase.from('comms_log').upsert(comms.map((m) => ({ id: m.id, at: m.at, by: m.by, pm_id: m.pmId, type: m.type, text: m.text, action_ids: m.actionIds || [] }))),
    'Copy sent log'
  );
console.log(`Copied ${fresh.length} new actions (${actions.length - fresh.length} already there), contacts and sent log.`);
