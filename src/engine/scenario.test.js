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
  const s = simulate(model, { alloc: { [key('11')]: { billable: true } } });
  assert.equal(s.customers[0].after.revenueINR, 125000); // + $500 x 50% x 100
  assert.equal(s.netMonthlyINR, 25000);
});

test('adding time beyond 100% is reported', () => {
  const s = simulate(model, { alloc: { [key('10')]: { utilPct: 120 } } });
  assert.equal(s.overAllocated.length, 1);
});
