// Step 4: allocations as the source of truth. Runs schema.sql in PGlite and checks the
// database functions as different users, and that the JS version (src/engine/live.js,
// used in local mode) gives exactly the same numbers.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import * as live from '../src/engine/live.js';

const STUB = `
  create role anon nologin; create role authenticated nologin; create schema auth;
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant usage on schema auth to anon, authenticated; grant execute on function auth.jwt() to anon, authenticated;
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
const q = async (sql, params) => (await db.query(sql, params)).rows;
const costs = (changes = []) => q(`select * from customer_costs($1::jsonb) order by code`, [JSON.stringify(changes)]);
const bench = (changes = []) => q(`select * from team_bench($1::jsonb) order by pm_id`, [JSON.stringify(changes)]);
const apply = (changes, note = '') => q(`select apply_allocation_changes($1::jsonb, $2) as n`, [JSON.stringify(changes), note]);

// Same fixture for SQL and JS. C1 (Priya) 60% COST, C2 (Karan).
const fixture = {
  people: [
    { emp_id: 'E1', name: 'Dev One', category: 'engineering', bench_pm: 'priya@aloha.test', active: true },
    { emp_id: 'E2', name: 'Dev Two', category: 'engineering', bench_pm: 'priya@aloha.test', active: true },
    { emp_id: 'E3', name: 'QA Three', category: 'engineering', bench_pm: 'karan@aloha.test', active: true },
    { emp_id: 'P1', name: 'Priya', category: 'pm', bench_pm: null, active: true },
  ],
  salaries: { E1: 20000, E2: 20000, E3: 10000, P1: 50000 },
  allocations: [
    { id: 'A1', emp_id: 'E1', customer_code: 'C1', subproject: 'Acme- Priya', owner_pm: 'priya@aloha.test', util_pct: 100, billable: true },
    { id: 'A2', emp_id: 'E2', customer_code: 'C1', subproject: 'Acme- Priya', owner_pm: 'priya@aloha.test', util_pct: 50, billable: false },
    { id: 'A3', emp_id: 'E3', customer_code: 'C2', subproject: 'Beta- Karan', owner_pm: 'karan@aloha.test', util_pct: 100, billable: true },
    { id: 'A4', emp_id: 'P1', customer_code: 'C1', subproject: 'Acme- Priya', owner_pm: 'priya@aloha.test', util_pct: 20, billable: false },
  ],
  revenue: [
    { code: 'C1', name: 'Acme', revenue_inr: 100000 },
    { code: 'C2', name: 'Beta', revenue_inr: 50000 },
  ],
  profiles: { C1: { pm_ids: ['priya@aloha.test'] }, C2: { pm_ids: ['karan@aloha.test'] } },
  target: 0.7,
};
const PRIYA = { role: 'pm', pmId: 'priya@aloha.test' };

before(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  await db.exec(`
    insert into app_users (email, role, pm_id, name) values
      ('matt@aloha.test', 'admin', null, 'Matt'), ('boss@aloha.test', 'leadership', null, 'Boss'),
      ('priya@aloha.test', 'pm', 'priya@aloha.test', 'Priya'), ('karan@aloha.test', 'pm', 'karan@aloha.test', 'Karan');
    insert into customer_profiles (code, name, pm_ids) values ('C1', 'Acme', '{priya@aloha.test}'), ('C2', 'Beta', '{karan@aloha.test}');
    insert into app_settings (key, value) values ('live', '{"target": 0.7}');
  `);
  for (const p of fixture.people) await q(`insert into people (emp_id, name, category, bench_pm) values ($1, $2, $3, $4)`, [p.emp_id, p.name, p.category, p.bench_pm]);
  for (const [id, ctc] of Object.entries(fixture.salaries)) await q(`insert into people_salaries values ($1, $2)`, [id, ctc]);
  for (const a of fixture.allocations)
    await q(`insert into allocations (id, emp_id, customer_code, subproject, owner_pm, util_pct, billable) values ($1,$2,$3,$4,$5,$6,$7)`, [a.id, a.emp_id, a.customer_code, a.subproject, a.owner_pm, a.util_pct, a.billable]);
  for (const r of fixture.revenue) await q(`insert into customer_revenue (code, name, revenue_inr) values ($1, $2, $3)`, [r.code, r.name, r.revenue_inr]);
});

const num = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v]));
const close = (a, b) => {
  for (const k of Object.keys(b)) {
    if (typeof b[k] === 'number') assert.ok(Math.abs(Number(a[k]) - b[k]) < 1e-6, `${k}: ${a[k]} vs ${b[k]}`);
    else assert.deepEqual(a[k], b[k], k);
  }
};

test('a PM reads their allocations and the people directory, never salaries', async () => {
  await as('priya@aloha.test', async () => {
    assert.deepEqual((await q('select id from allocations order by id')).map((r) => r.id), ['A1', 'A2', 'A4']);
    assert.equal((await q('select * from people')).length, 4);
    assert.equal((await q('select * from people_salaries')).length, 0);
    assert.equal((await q('select * from customer_revenue')).length, 1);
    const load = await q('select * from person_load() order by emp_id');
    assert.deepEqual(load.map((r) => [r.emp_id, Number(r.allocated_pct)]), [['E1', 100], ['E2', 50], ['E3', 100], ['P1', 20]]);
  });
});

test('live costs and play (unsaved changes) for a PM; totals only', async () => {
  const removeA2 = [{ op: 'remove', id: 'A2' }];
  await as('priya@aloha.test', async () => {
    const [c1] = (await costs(removeA2)).map(num);
    assert.equal(c1.code, 'C1');
    assert.deepEqual(Object.keys(c1).sort(), ['code', 'cost_after', 'cost_before', 'eng_after', 'eng_before', 'managed_after', 'managed_before', 'name', 'off_by_after', 'off_by_before', 'revenue_inr', 'spend_after', 'spend_before'].sort());
    close(c1, { spend_before: 40000, spend_after: 30000, cost_before: 0.6, cost_after: 0.7, off_by_before: 10000, off_by_after: 0, managed_before: false, managed_after: true });
    const [b] = (await bench(removeA2)).map(num);
    close(b, { pm_id: 'priya@aloha.test', spend_before: 10000, spend_after: 20000 });
    assert.equal((await q('select id from allocations')).length, 3, 'play does not save');
  });
});

test('SQL and JS give the same numbers', async () => {
  const cases = [[], [{ op: 'remove', id: 'A2' }], [{ op: 'set', id: 'A2', util_pct: 20, billable: true }], [{ op: 'add', emp_id: 'E2', customer_code: 'C1', util_pct: 30 }]];
  for (const ch of cases) {
    const sql = await as('priya@aloha.test', () => costs(ch));
    const js = live.customerCosts(fixture, PRIYA, ch);
    assert.equal(sql.length, js.length);
    sql.map(num).forEach((r, i) => close(r, js[i]));
    const sb = await as('priya@aloha.test', () => bench(ch));
    sb.map(num).forEach((r, i) => close(r, live.teamBench(fixture, PRIYA, ch)[i]));
  }
  const allSql = await as('matt@aloha.test', () => costs([]));
  assert.equal(allSql.length, live.customerCosts(fixture, { role: 'admin' }, []).length);
});

test('a PM cannot touch another PM\'s customer; leadership cannot change anything', async () => {
  await as('priya@aloha.test', async () => {
    await assert.rejects(costs([{ op: 'set', id: 'A3', util_pct: 50 }]), /own customers/);
    await assert.rejects(apply([{ op: 'add', emp_id: 'E1', customer_code: 'C2', util_pct: 10 }]), /own customers/);
    await db.query(`update allocations set util_pct = 1 where id = 'A1'`); // RLS: no effect
  });
  assert.throws(() => live.customerCosts(fixture, PRIYA, [{ op: 'set', id: 'A3', util_pct: 50 }]), /own customers/);
  await as('boss@aloha.test', async () => {
    assert.equal((await q('select * from allocations')).length, 4);
    assert.equal((await q('select * from people_salaries')).length, 4);
    await assert.rejects(apply([{ op: 'remove', id: 'A1' }]), /Only PMs and admins/);
  });
  await as(null, async () => {
    await assert.rejects(q('select * from allocations'));
    await assert.rejects(costs([]));
  });
  const [a1] = await q(`select util_pct from allocations where id = 'A1'`);
  assert.equal(Number(a1.util_pct), 100);
});

test('saving: history is written, over-allocation is refused and nothing is half-saved', async () => {
  await as('priya@aloha.test', async () => {
    await assert.rejects(apply([{ op: 'set', id: 'A2', util_pct: 20 }, { op: 'add', emp_id: 'E1', customer_code: 'C1', util_pct: 10 }]), /Over 100% allocated: Dev One \(110%\)/);
    assert.equal(Number((await q(`select util_pct from allocations where id = 'A2'`))[0].util_pct), 50, 'rolled back');
    const [{ n }] = await apply([{ op: 'remove', id: 'A2' }, { op: 'add', emp_id: 'E2', customer_code: 'C1', util_pct: 25, billable: true }], 'Swap to billable');
    assert.equal(n, 2);
    const h = await q(`select by, action, note, before, after from allocation_history order by id`);
    assert.deepEqual(h.map((r) => r.action), ['remove', 'add']);
    assert.equal(h[0].by, 'Priya');
    assert.equal(h[1].note, 'Swap to billable');
    const added = await q(`select subproject, owner_pm, billable from allocations where emp_id = 'E2'`);
    assert.deepEqual(added[0], { subproject: 'Acme- Priya', owner_pm: 'priya@aloha.test', billable: true });
  });
  assert.throws(() => live.applyChanges(fixture, PRIYA, [{ op: 'add', emp_id: 'E1', customer_code: 'C1', util_pct: 10 }]), /Over 100% allocated: Dev One \(110%\)/);
  await as('karan@aloha.test', async () => {
    assert.equal((await q('select * from allocation_history')).length, 0, 'Karan sees no history for Priya\'s customer');
  });
  await as('matt@aloha.test', async () => {
    const [{ n }] = await apply([{ op: 'set', id: 'A3', util_pct: 80 }], 'Admin change');
    assert.equal(n, 1);
  });
});

test('admin_sync: only admin; refreshes people/salaries/revenue; replaces allocations when given', async () => {
  const payload = {
    people: [{ emp_id: 'E9', name: 'New Dev', designation: 'Developer', category: 'engineering', bench_pm: 'priya@aloha.test', active: true }],
    salaries: [{ emp_id: 'E9', ctc_monthly_inr: 30000 }],
    revenue: [{ code: 'C1', name: 'Acme', revenue_inr: 120000, revenue_usd: 1200 }],
    settings: { target: 0.7, period: 'October 2026' },
  };
  const sync = (p) => q(`select admin_sync($1::jsonb) as r`, [JSON.stringify(p)]);
  await as('priya@aloha.test', async () => await assert.rejects(sync(payload), /Only an admin/));
  await as('boss@aloha.test', async () => await assert.rejects(sync(payload), /Only an admin/));
  await as('matt@aloha.test', async () => {
    const before = (await q('select count(*)::int as n from allocations'))[0].n;
    await sync(payload);
    assert.equal((await q('select count(*)::int as n from allocations'))[0].n, before, 'allocations untouched without p.allocations');
    assert.equal(Number((await q(`select revenue_inr from customer_revenue where code = 'C1'`))[0].revenue_inr), 120000);
    const [{ r }] = await sync({ ...payload, allocations: [{ id: 'S1', emp_id: 'E9', customer_code: 'C1', subproject: 'Acme- Priya', owner_pm: 'priya@aloha.test', util_pct: 60, billable: true }], note: 'Loaded from portal' });
    assert.equal(r.allocations, 1);
    assert.deepEqual((await q('select id from allocations')).map((x) => x.id), ['S1']);
    assert.equal((await q(`select value from app_settings where key = 'allocSource'`))[0].value.source, 'app');
    assert.equal((await q(`select action from allocation_history order by id desc limit 1`))[0].action, 'seed');
  });
  await as('priya@aloha.test', async () => {
    const [b] = (await bench([])).map(num);
    close(b, { pm_id: 'priya@aloha.test', spend_before: 20000 + 20000 + 12000 }); // E1, E2 fully free; E9 40% of 30,000 (P1 has no bench holder here)
  });
});
