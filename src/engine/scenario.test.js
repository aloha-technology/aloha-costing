import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, allocKey, seatRate } from './scenario.js';

// One customer at 60% margin: revenue 1,00,000, cost 40,000. Dev B is 50% non-billable.
const model = {
  target: 0.7,
  fx: 100,
  totals: { benchCostINR: 10000 },
  customers: [
    {
      code: 'C1', name: 'Acme', revenueINR: 100000, revenueUSD: 1000, costINR: 40000, fx: 100, margin: 0.6, belowTarget: true, gapINR: 10000, billable: 2,
      seats: [{ role: 'Developer', count: 2, rateUSD: 500, subproject: 'Acme- Priya' }],
      people: [
        { empId: '10', name: 'Dev A', designation: 'Developer', project: 'Acme- Priya', utilPct: 100, billable: true, ctcMonthlyINR: 20000 },
        { empId: '11', name: 'Dev B', designation: 'Developer', project: 'Acme- Priya', utilPct: 50, billable: false, ctcMonthlyINR: 20000 },
      ],
    },
  ],
  employees: [
    { empId: '10', ctcMonthlyINR: 20000, benchPct: 0, idlePct: 0 },
    { empId: '11', ctcMonthlyINR: 20000, benchPct: 50, idlePct: 0 },
  ],
};
const key = (id) => allocKey('C1', id, 'Acme- Priya');

test('no changes, no difference', () => {
  const s = simulate(model, {});
  assert.equal(s.rows.length, 0);
  assert.equal(s.netMonthlyINR, 0);
  assert.equal(s.after.margin, 0.6);
});

test('taking a non-billable person off helps the customer, but moves cost to bench', () => {
  const s = simulate(model, { alloc: { [key('11')]: { utilPct: 0 } } });
  const c = s.customers[0].after;
  assert.equal(c.costINR, 30000);
  assert.equal(c.margin, 0.7);
  assert.equal(c.belowTarget, false);
  assert.equal(s.after.benchCostINR, 20000); // their freed 50% lands on bench
  assert.equal(s.netMonthlyINR, 0); // no company saving until released or reused
});

test('releasing that person saves their cost and their bench time', () => {
  const s = simulate(model, { released: { '11': true } });
  assert.equal(s.customers[0].after.costINR, 30000);
  assert.equal(s.after.benchCostINR, 0);
  assert.equal(s.netMonthlyINR, 20000);
  assert.equal(s.changes, 1);
});

test('making someone billable adds revenue at their seat rate', () => {
  assert.deepEqual(seatRate(model.customers[0], 'Developer', 'Acme- Priya'), { rateUSD: 500, basis: 'Developer seat rate' });
  // Acme invoices $1,000 for one billable developer listed at $500, so billing is calibrated x2.
  const s = simulate(model, { alloc: { [key('11')]: { billable: true } } });
  assert.equal(s.customers[0].after.revenueINR, 150000); // + $500 x 2 x 50% x 100
  assert.equal(s.netMonthlyINR, 50000);
});

test('adding time beyond 100% is reported', () => {
  const s = simulate(model, { alloc: { [key('10')]: { utilPct: 120 } } });
  assert.equal(s.overAllocated.length, 1);
});

import { scenarioActions } from '../actions/fromScenario.js';

test('scenario becomes PM-safe actions with owners and savings', () => {
  const m = {
    ...model,
    period: 'September 2026',
    bench: [],
    customers: model.customers.map((c) => ({ ...c, pmIds: ['pm@x'], accountPm: 'pm@x', people: c.people.map((p) => ({ ...p, ownerPm: 'pm@x' })) })),
    employees: [
      { empId: '10', name: 'Dev A', designation: 'Developer', ctcMonthlyINR: 20000, benchPct: 0, idlePct: 0, allocations: [{ code: 'C1', customer: 'Acme', utilPct: 100, ownerPm: 'pm@x' }] },
      { empId: '11', name: 'Dev B', designation: 'Developer', ctcMonthlyINR: 20000, benchPct: 50, idlePct: 0, allocations: [{ code: 'C1', customer: 'Acme', utilPct: 50, ownerPm: 'pm@x' }] },
    ],
  };
  const scenario = { alloc: { [key('11')]: { utilPct: 0 }, [key('10')]: { utilPct: 80 } }, released: { '11': true } };
  const acts = scenarioActions(m, simulate(m, { alloc: { [key('11')]: { utilPct: 0 }, [key('10')]: { utilPct: 80 } } }), scenario);
  const off = acts.find((a) => a.input.findingId === `scenario:${key('11')}`);
  assert.equal(off.input.title, 'Take Dev B (Developer) off Acme (50% → 0%)');
  assert.equal(off.input.ownerPmId, 'pm@x');
  assert.equal(off.input.savingINR, 10000);
  assert.equal(off.input.severity, 'high');
  const less = acts.find((a) => a.input.findingId === `scenario:${key('10')}`);
  assert.match(less.input.title, /^Reduce time 100% → 80%: Dev A/);
  const rel = acts.find((a) => a.kind === 'release');
  assert.match(rel.input.title, /Plan release or redeployment of Dev B/);
  for (const a of acts) for (const t of [a.input.title, a.input.ask, a.input.description]) assert.doesNotMatch(t, /₹|20,000|10,000|margin \d/);
});

test('removing all billable time takes revenue to zero, never below', () => {
  const s = simulate(model, { alloc: { [key('10')]: { utilPct: 0 } } });
  assert.equal(s.customers[0].after.revenueINR, 0);
});
