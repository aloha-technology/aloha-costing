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
