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
  // Acme invoices $1,000 for one developer listed at $500 (calibration x2), but added billing is
  // capped at the listed seat rate.
  const s = simulate(model, { alloc: { [key('11')]: { billable: true } } });
  assert.equal(s.customers[0].after.revenueINR, 125000); // + $500 x 50% x 100
  assert.equal(s.netMonthlyINR, 25000);
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

test('assigning bench time to a customer reuses it: bench cost falls, billing rises', () => {
  // Dev B has 50% bench time; assign it to Acme as billable.
  const s = simulate(model, { added: [{ id: 'a1', empId: '11', code: 'C1', utilPct: 50, billable: true }] });
  const c = s.customers[0].after;
  assert.equal(c.costINR, 50000); // + 20,000 x 50%
  assert.equal(c.revenueINR, 125000); // + $500 (seat-rate cap) x 50% x 100
  assert.equal(s.after.benchCostINR, 0); // their bench time is now used
  assert.equal(s.netMonthlyINR, 25000); // bench saved 10,000 - cost 10,000 + billing 25,000
  assert.equal(s.rows[0].added, true);
});

import { merge, splitParts, contributions, pmRollup } from './scenario.js';
import { generateLevers, planToTarget } from './levers.js';

test('rate change raises revenue on that customer', () => {
  const s = simulate(model, { rates: { C1: 10 } });
  assert.equal(s.customers[0].after.revenueINR, 110000);
  assert.equal(s.netMonthlyINR, 10000);
  assert.equal(s.rateRows.length, 1);
});

test('merge combines parts; later parts win', () => {
  const m = merge([{ alloc: { a: { utilPct: 0 } }, rates: { C1: 5 } }, { alloc: { a: { billable: true } }, rates: { C1: 10 }, released: { x: true } }]);
  assert.deepEqual(m.alloc.a, { utilPct: 0, billable: true });
  assert.equal(m.rates.C1, 10);
  assert.equal(m.released.x, true);
});

test('contributions rank each change alone and in combination', () => {
  const items = splitParts(model, { alloc: { [key('11')]: { billable: true } }, rates: { C1: 10 } });
  assert.equal(items.length, 2);
  const c = contributions(model, items);
  assert.equal(c[0].id.includes('alloc'), true); // billing Dev B (+50,000) beats the 10% rate (+10,000)
  assert.equal(Math.round(c[0].aloneINR), 25000);
});

test('levers and the reach-70% planner', () => {
  const m = { ...model, bench: [], pms: [], customers: model.customers.map((c) => ({ ...c, pmIds: [], pmSplit: [], computedCostINR: 0 })) };
  const levers = generateLevers(m);
  assert.ok(levers.some((l) => l.id === 'off:C1'));
  assert.ok(levers.some((l) => l.id === 'rate:C1:10'));
  const plan = planToTarget(m, 'C1');
  assert.equal(plan.reached, true);
  assert.equal(plan.steps.length, 1); // one move on Dev B lifts Acme to 70%
  assert.match(plan.steps[0].label, /Dev B/);
  assert.ok(pmRollup(m, simulate(m, plan.part)).length === 0);
});

test('planner adds a rate increase when people moves are not enough', () => {
  // Cost 35,000 on 1,00,000 revenue needs a ~16.7% rise: within the 25% cap.
  const m = { ...model, customers: model.customers.map((c) => ({ ...c, costINR: 35000, people: c.people.filter((p) => p.billable) })) };
  const plan = planToTarget(m, 'C1');
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].rate, true);
  assert.equal(plan.reached, true);
});

test('planner will not propose an unrealistic rate rise', () => {
  const m = { ...model, customers: model.customers.map((c) => ({ ...c, costINR: 90000, people: c.people.filter((p) => p.billable) })) };
  const plan = planToTarget(m, 'C1'); // needs +200%
  assert.equal(plan.reached, false);
  assert.equal(plan.steps.length, 0);
  assert.match(plan.note, /re-scoping or exiting/);
});
