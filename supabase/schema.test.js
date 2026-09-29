// Runs supabase/schema.sql in an in-process Postgres (PGlite) with a stub of Supabase's
// auth schema, then checks the row-level security rules as different users.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.jwt() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
`;

let db;
// Run fn as a logged-in user (or anon when email is null), like PostgREST does.
async function as(email, fn) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [email ? JSON.stringify({ email }) : '']);
  await db.exec(`set role ${email ? 'authenticated' : 'anon'}`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}
const rows = async (sql, params) => (await db.query(sql, params)).rows;

before(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const schema = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  await db.exec(schema);
  await db.exec(schema); // re-runnable
  await db.exec(`
    insert into app_users (email, role, pm_id, name) values
      ('matt@aloha.test', 'admin', null, 'Matt'),
      ('boss@aloha.test', 'leadership', null, 'Boss'),
      ('priya@aloha.test', 'pm', 'priya@aloha.test', 'Priya'),
      ('karan@aloha.test', 'pm', 'karan@aloha.test', 'Karan');
    insert into snapshots values
      ('2026-09', 'admin', now(), '{"secret": "salaries"}'),
      ('2026-09', 'pm:priya@aloha.test', now(), '{"pm": "rahul"}'),
      ('2026-09', 'pm:karan@aloha.test', now(), '{"pm": "amol"}');
    insert into actions (id, customer_code, title, owner_pm_id, created_by, due_date, original_due_date, finding_id)
      values ('A1', 'C1', 'Fix margin', 'priya@aloha.test', 'Matt', '2026-10-01', '2026-10-01', 'C1:BELOW_TARGET'),
             ('A2', 'C2', 'Release QA', 'karan@aloha.test', 'Matt', '2026-10-01', '2026-10-01', 'C2:NON_BILLABLE');
    insert into action_savings values ('A1', 50000), ('A2', 75000);
    insert into pm_contacts (pm_id, whatsapp) values ('priya@aloha.test', '+910000000000');
  `);
});

test('anonymous visitors see nothing', async () => {
  await as(null, async () => {
    await assert.rejects(rows('select * from snapshots'));
    await assert.rejects(rows('select * from actions'));
  });
});

test('a PM sees only their own snapshot and actions, never savings or contacts', async () => {
  await as('priya@aloha.test', async () => {
    assert.deepEqual((await rows('select audience from snapshots')).map((r) => r.audience), ['pm:priya@aloha.test']);
    assert.deepEqual((await rows('select id from actions')).map((r) => r.id), ['A1']);
    assert.equal((await rows('select * from action_savings')).length, 0);
    assert.equal((await rows('select * from pm_contacts')).length, 0);
    assert.equal((await rows('select * from comms_log')).length, 0);
    assert.deepEqual((await rows('select email from app_users')).map((r) => r.email), ['priya@aloha.test']);
  });
});

test('a PM cannot write directly, only through pm_action_update on their own actions', async () => {
  await as('priya@aloha.test', async () => {
    await db.query(`update actions set status = 'done' where id = 'A1'`); // silently matches 0 rows under RLS
    await assert.rejects(rows(`insert into actions (id, customer_code, title, owner_pm_id, created_by, due_date, original_due_date) values ('X','C','t','priya@aloha.test','me','2026-10-01','2026-10-01')`));
    await assert.rejects(rows(`insert into snapshots values ('x', 'admin', now(), '{}')`));
    await assert.rejects(rows(`select pm_action_update('A2', 'note', 'hi')`), /own actions/);

    await rows(`select pm_action_update('A1', 'start', null)`);
    await assert.rejects(rows(`select pm_action_update('A1', 'request_close', '')`), /before asking to close/);
    await rows(`select pm_action_update('A1', 'note', 'Talked to client')`);
    await rows(`select pm_action_update('A1', 'request_close', 'Released one QA')`);
    await assert.rejects(rows(`select pm_action_update('A1', 'bogus', 'x')`), /Unknown operation/);
  });
  const [a] = await rows(`select status, history from actions where id = 'A1'`);
  assert.equal(a.status, 'closure_requested');
  assert.deepEqual(a.history.map((h) => h.type), ['status', 'note', 'status']);
  assert.equal(a.history[2].by, 'Priya');
});

test('leadership reads everything but cannot write', async () => {
  await as('boss@aloha.test', async () => {
    assert.deepEqual((await rows('select audience from snapshots')).map((r) => r.audience), ['admin']);
    assert.equal((await rows('select * from action_savings')).length, 2);
    const r = await db.query(`update actions set title = 'x' where id = 'A2'`);
    assert.equal(r.affectedRows, 0);
    await assert.rejects(rows(`select pm_action_update('A2', 'note', 'hi')`), /own actions/);
  });
});

test('admin can create and close actions; one open action per finding', async () => {
  await as('matt@aloha.test', async () => {
    await rows(`insert into actions (id, customer_code, title, owner_pm_id, created_by, due_date, original_due_date, finding_id) values ('A3','C3','t','karan@aloha.test','Matt','2026-10-01','2026-10-01','C3:X')`);
    await assert.rejects(
      rows(`insert into actions (id, customer_code, title, owner_pm_id, created_by, due_date, original_due_date, finding_id) values ('A4','C3','t','karan@aloha.test','Matt','2026-10-01','2026-10-01','C3:X')`)
    );
    const r = await db.query(`update actions set status = 'done', closure_note = 'ok', closed_at = now() where id = 'A1'`);
    assert.equal(r.affectedRows, 1);
    await rows(`insert into comms_log (id, by, pm_id, type, text) values ('M1', 'Matt', 'priya@aloha.test', 'digest', 'hello')`);
    assert.equal((await rows('select * from pm_contacts')).length, 1);
  });
  await as('priya@aloha.test', async () => {
    await assert.rejects(rows(`select pm_action_update('A1', 'note', 'late note')`), /closed/);
  });
});

test('customer profiles, rates and settings: who can read and write', async () => {
  await db.exec(`
    insert into customer_profiles (code, name, brief, pm_ids) values ('C1', 'Acme', 'ERP rebuild', '{priya@aloha.test}'), ('C2', 'Beta', 'CRM', '{karan@aloha.test}');
    insert into customer_rates (code, roles, last_revised) values ('C1', '{"Developer": {"billRateUSD": 2500}}', '2025-08-01');
    insert into app_settings (key, value) values ('costing', '{"revisionMonths": 12}');
  `);
  await as('priya@aloha.test', async () => {
    assert.deepEqual((await rows('select code from customer_profiles')).map((r) => r.code), ['C1']);
    assert.equal((await rows('select * from customer_rates')).length, 0, 'PMs never see the rate card');
    assert.equal((await rows('select * from app_settings')).length, 1);
    const r = await db.query(`update customer_profiles set brief = 'x' where code = 'C1'`);
    assert.equal(r.affectedRows, 0);
  });
  await as('boss@aloha.test', async () => {
    assert.equal((await rows('select * from customer_profiles')).length, 2);
    assert.equal((await rows('select * from customer_rates')).length, 1);
    await assert.rejects(rows(`insert into customer_rates (code) values ('C9')`));
  });
  await as('matt@aloha.test', async () => {
    await rows(`insert into customer_profiles (code, name, manual) values ('NEW1', 'New Co', true)`);
    await rows(`update customer_rates set reason = 'Volume' where code = 'C1'`);
    await rows(`update app_settings set value = '{"revisionMonths": 18}' where key = 'costing'`);
  });
  await as(null, async () => {
    await assert.rejects(rows('select * from customer_profiles'));
  });
});

test('uploads, validations, classifications and corrections: access', async () => {
  await as('matt@aloha.test', async () => {
    await rows(`insert into import_files (period, kind, file_name, rows) values ('2026-09', 'paysheet', 'pay.xlsx', '[{"ID":"1","CTC":100000}]')`);
    await rows(`insert into dataset_validations (period, kind, status) values ('2026-09', 'paysheet', 'validated')`);
    await rows(`insert into people_categories (emp_id, category) values ('900', 'support')`);
    await rows(`insert into salary_overrides (emp_id, ctc_monthly_inr, reason) values ('1', 120000, 'raise')`);
    await rows(`insert into revenue_overrides (period, code, amount_usd, reason) values ('2026-09', 'C1', 5000, 'credit note')`);
    await rows(`insert into snapshots values ('2026-10', 'admin', now(), '{}') on conflict (period, audience) do update set data = excluded.data`);
    await assert.rejects(rows(`insert into people_categories (emp_id, category) values ('901', 'bogus')`));
  });
  await as('boss@aloha.test', async () => {
    assert.equal((await rows('select * from import_files')).length, 0, 'raw uploads (salaries) are admin-only');
    assert.equal((await rows('select * from salary_overrides')).length, 0);
    assert.equal((await rows('select * from people_categories')).length, 0);
    assert.equal((await rows('select * from dataset_validations')).length, 1);
    assert.equal((await rows('select * from revenue_overrides')).length, 1);
    await assert.rejects(rows(`insert into snapshots values ('x', 'admin', now(), '{}')`));
  });
  await as('priya@aloha.test', async () => {
    for (const t of ['import_files', 'dataset_validations', 'customer_validations', 'people_categories', 'revenue_overrides', 'salary_overrides'])
      assert.equal((await rows(`select * from ${t}`)).length, 0, t);
    await assert.rejects(rows(`insert into snapshots values ('x', 'pm:priya@aloha.test', now(), '{}')`));
  });
  await as(null, async () => {
    await assert.rejects(rows('select * from import_files'));
  });
});

test('no DELETE or UPDATE without WHERE (Supabase rejects them; PGlite does not)', () => {
  const sql = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
  const stmts = sql.split(';').map((s) => s.replace(/\s+/g, ' ').trim());
  const bad = stmts.filter((s) => /\b(delete from|update)\s+public\.\w+/i.test(s) && !/\bwhere\b/i.test(s) && !/\bon conflict\b/i.test(s));
  assert.deepEqual(bad, []);
});
