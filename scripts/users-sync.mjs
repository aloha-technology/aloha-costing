// Gives people access: PMs (from the invoicing/costing data) plus the admins, leadership and
// accounts team listed in data/users.json. Shows the plan first; nothing changes without --apply.
//   npm run users            # preview
//   npm run users -- --apply # create logins + roles
//   npm run users -- --only=a@x.com --apply   # just these people
// New logins get a random starting password, saved to data/new-passwords.txt (never printed).
// People must choose their own password the first time they sign in.
import fs from 'node:fs';
import path from 'node:path';
import { adminClient, loadModel, root, must, tempPassword, savePasswords } from './supabase-admin.mjs';

const apply = process.argv.includes('--apply');
const usersFile = path.join(root, 'data', 'users.json');
if (!fs.existsSync(usersFile)) {
  fs.writeFileSync(usersFile, JSON.stringify({ admins: [{ email: 'matt@alohatechnology.com', name: 'Matt' }], leadership: [], excludePms: [] }, null, 2) + '\n');
  console.log(`Created ${path.relative(root, usersFile)}. Add leadership emails there, then run again.\n`);
}
const cfg = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
const lower = (e) => String(e).trim().toLowerCase();
// Entries can be "a@b.com" or { "email": "a@b.com", "name": "Asha" }.
const entry = (x) => (typeof x === 'string' ? { email: lower(x), name: null } : { email: lower(x.email), name: x.name || null });
const model = loadModel();

const wanted = new Map();
for (const x of cfg.admins || []) wanted.set(entry(x).email, { ...entry(x), role: 'admin', pm_id: null });
for (const x of cfg.leadership || []) if (!wanted.has(entry(x).email)) wanted.set(entry(x).email, { ...entry(x), role: 'leadership', pm_id: null });
// Accounts team: Collections tax-invoice portal only (needs supabase/collections.sql).
for (const x of cfg.accounts || []) if (!wanted.has(entry(x).email)) wanted.set(entry(x).email, { ...entry(x), role: 'accounts', pm_id: null });
const excluded = new Set((cfg.excludePms || []).map(lower));
const noEmail = [];
for (const pm of model.pms) {
  if (!pm.email) {
    noEmail.push(pm.name);
    continue;
  }
  const email = lower(pm.email);
  if (excluded.has(email) || wanted.has(email)) continue;
  wanted.set(email, { email, role: 'pm', pm_id: pm.id, name: pm.name });
}

const supabase = adminClient();
const existingRoles = new Map(must(await supabase.from('app_users').select('*'), 'Read app_users').map((u) => [u.email, u]));
const authEmails = new Set();
for (let page = 1; ; page++) {
  const { users } = must(await supabase.auth.admin.listUsers({ page, perPage: 1000 }), 'List logins');
  users.forEach((u) => u.email && authEmails.add(lower(u.email)));
  if (users.length < 1000) break;
}

// --only a@x.com,b@y.com limits this run to those people (e.g. test with your own login first).
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice(7).split(',').map(lower)) : null;
if (only) for (const e of [...wanted.keys()]) if (!only.has(e)) wanted.delete(e);

const plan = [...wanted.values()].map((u) => ({
  ...u,
  login: authEmails.has(u.email) ? 'exists' : 'create',
  role_change: existingRoles.get(u.email)?.role === u.role ? '' : existingRoles.has(u.email) ? `${existingRoles.get(u.email).role} → ${u.role}` : 'new',
}));
console.table(plan.map(({ email, role, name, login, role_change }) => ({ email, role, name: name || '', login, role_change })));
const stale = [...existingRoles.keys()].filter((e) => !wanted.has(e));
if (stale.length) console.log(`In the database but no longer listed (left untouched): ${stale.join(', ')}`);
if (noEmail.length) console.log(`PMs without an email (can't log in): ${noEmail.join(', ')}`);

if (!apply) {
  console.log('\nPreview only. Run "npm run users -- --apply" to make these changes.');
  process.exit(0);
}

const issued = [];
for (const u of plan.filter((p) => p.login === 'create')) {
  const password = tempPassword();
  must(
    await supabase.auth.admin.createUser({ email: u.email, password, email_confirm: true, user_metadata: { must_change_password: true } }),
    `Create login ${u.email}`
  );
  issued.push({ email: u.email, name: u.name, password });
}
must(await supabase.from('app_users').upsert(plan.map(({ email, role, pm_id, name }) => ({ email, role, pm_id, name })), { onConflict: 'email' }), 'Save roles');
console.log(`\nDone: ${issued.length} logins created, ${plan.length} roles saved.`);
if (issued.length) console.log(`Starting passwords saved to ${savePasswords(issued)} (not shown here).`);
