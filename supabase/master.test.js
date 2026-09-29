// Checks the Master data access rules (master.sql on top of schema.sql + collections.sql) in PGlite.
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
const rows = async (sql) => (await db.query(sql)).rows;
const fails = (p) => p.then(() => false, () => true);

before(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const f of ['schema.sql', 'collections.sql', 'master.sql']) await db.exec(fs.readFileSync(new URL(`./${f}`, import.meta.url), 'utf8'));
  await db.exec(fs.readFileSync(new URL('./master.sql', import.meta.url), 'utf8')); // re-runnable
  await db.exec(`
    insert into app_users (email, role, pm_id, name) values
      ('matt@aloha.test', 'admin', null, 'Matt'), ('boss@aloha.test', 'leadership', null, 'Boss'),
      ('priya@aloha.test', 'pm', 'priya@aloha.test', 'Priya'), ('acc@aloha.test', 'accounts', null, 'Accounts');
    insert into people (emp_id, name, category) values ('e1', 'Asha', 'engineering');
    insert into people_profiles (emp_id, team, joined_on, incentive_plan) values ('e1', 'QA', '2021-03-15', '5% of new billing');
  `);
});

test('admin writes employee details; leadership reads them', async () => {
  await as('matt@aloha.test', async () => {
    await db.query(`update people_profiles set phone = '+91 1' where emp_id = 'e1'`);
    await db.query(`insert into people_profiles (emp_id, team) values ('e2', 'Design')`);
  });
  await as('boss@aloha.test', async () => {
    assert.equal((await rows('select * from people_profiles')).length, 2);
    assert.ok(await fails(db.query(`insert into people_profiles (emp_id) values ('e3')`)));
  });
});

test('PMs and the accounts team cannot see employee details (incentive plans)', async () => {
  for (const who of ['priya@aloha.test', 'acc@aloha.test']) await as(who, async () => assert.equal((await rows('select * from people_profiles')).length, 0, who));
});

test('people directory: staff roles yes, accounts team no', async () => {
  await as('priya@aloha.test', async () => assert.equal((await rows('select * from people')).length, 1));
  await as('boss@aloha.test', async () => assert.equal((await rows('select * from people')).length, 1));
  await as('acc@aloha.test', async () => assert.equal((await rows('select * from people')).length, 0));
  await as(null, async () => assert.ok(await fails(db.query('select * from people_profiles'))));
});
