import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pmView } from './views.js';

// Keys that carry an individual's salary, or admin-only analysis.
const FORBIDDEN = ['ctcMonthlyINR', 'baseMonthlyINR', 'incentiveMonthlyINR', 'detail', 'computedCostINR', 'reconciliation', 'costShare', 'dataQuality', 'totals', 'sources', 'employees', 'unclassified', 'invoicingLines'];

// Aggregates (customer / team / bench totals) are allowed in the PM view and are exact
// (Matt's decision, 2026-09-29). On a one-person account an aggregate can equal one person's
// cost, so the numeric check below skips these keys and only looks at everything else.
const AGGREGATE_KEY = /^(costINR|sheetCostINR|gapINR|gapUSD|estCostINR|estRevenueINR|spendINR|benchCostINR|benchShareINR|supportShareINR|pmSpendINR|revenueINR)$/;

function walk(v, visit, path = '') {
  if (Array.isArray(v)) v.forEach((x, i) => walk(x, visit, `${path}[${i}]`));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (visit(k, x, `${path}.${k}`), walk(x, visit, `${path}.${k}`));
}

const modelPath = new URL('../../data/model.json', import.meta.url);
const real = fs.existsSync(modelPath) && JSON.parse(fs.readFileSync(modelPath, 'utf8'));

test('PM view carries no per-person salary or cost (real data)', { skip: !real && 'no local model' }, () => {
  const personCosts = new Set();
  for (const c of real.customers) for (const p of c.people) for (const v of [p.ctcMonthlyINR, p.costINR]) if (v > 1000) personCosts.add(v);
  for (const e of real.employees) if (e.ctcMonthlyINR > 1000) personCosts.add(e.ctcMonthlyINR);

  for (const pm of real.pms) {
    const v = pmView(real, pm.id);
    walk(v, (k, x, path) => {
      assert.ok(!FORBIDDEN.includes(k), `${pm.name}: forbidden key at ${path}`);
      const inPerson = /\.(people|bench)\[\d+\]\.[^.]+$/.test(path);
      if (inPerson && /cost|ctc|salary/i.test(k)) assert.equal(x, 0, `${pm.name}: per-person cost at ${path}`);
      if (typeof x === 'number' && x > 1000 && personCosts.has(x) && !AGGREGATE_KEY.test(k)) assert.fail(`${pm.name}: individual cost value at ${path}`);
    });
    assert.ok(v.customers.every((c) => c.pmIds.includes(pm.id)), 'only own customers');
    assert.ok(v.bench.every((b) => b.pmId === pm.id), 'only own bench');
  }
});

test('PM view keeps what the PM screens need', { skip: !real && 'no local model' }, () => {
  const pm = real.pms.find((p) => p.customers > 3);
  const v = pmView(real, pm.id);
  const c = v.customers[0];
  for (const k of ['name', 'margin', 'gapINR', 'people', 'findings', 'seats', 'layers', 'managed']) assert.ok(k in c, k);
  assert.ok(c.findings.every((f) => f.pmText && f.ask !== undefined));
  assert.equal(v.viewer.pmId, pm.id);
  const self = v.pms.find((p) => p.id === pm.id);
  assert.equal(self.customers, pm.customers);
  assert.ok(self.teamLayers && self.benchCostINR >= 0);
});
