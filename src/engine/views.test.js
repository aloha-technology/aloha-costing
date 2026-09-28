import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pmView } from './views.js';

// Keys that carry an individual's salary or cost, or admin-only analysis.
const FORBIDDEN = ['ctcMonthlyINR', 'detail', 'computedCostINR', 'reconciliation', 'costShare', 'dataQuality', 'totals', 'sources'];

function walk(v, visit, path = '') {
  if (Array.isArray(v)) v.forEach((x, i) => walk(x, visit, `${path}[${i}]`));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (visit(k, x, `${path}.${k}`), walk(x, visit, `${path}.${k}`));
}

const modelPath = new URL('../../data/model.json', import.meta.url);
const real = fs.existsSync(modelPath) && JSON.parse(fs.readFileSync(modelPath, 'utf8'));

test('PM view carries no salary-level fields or numbers (real data)', { skip: !real && 'no local model' }, () => {
  const personCosts = new Set();
  for (const c of real.customers) for (const p of c.people) for (const v of [p.ctcMonthlyINR, p.costINR]) if (v > 1000) personCosts.add(v);
  for (const b of real.bench) if (b.costINR > 1000) personCosts.add(b.costINR);

  for (const pm of real.pms) {
    const v = pmView(real, pm.id);
    const customerCosts = new Set(v.customers.flatMap((c) => [c.costINR, c.gapINR]));
    walk(v, (k, x, path) => {
      assert.ok(!FORBIDDEN.includes(k), `${pm.name}: forbidden key at ${path}`);
      if (k === 'costINR' && !/^\.customers\[\d+\]\.costINR$/.test(path)) assert.equal(x, 0, `${pm.name}: non-zero cost at ${path}`);
      if (typeof x === 'number' && personCosts.has(x) && !customerCosts.has(x)) assert.fail(`${pm.name}: individual cost value at ${path}`);
    });
    assert.ok(v.customers.every((c) => c.pmIds.includes(pm.id)), 'only own customers');
    assert.ok(v.bench.every((b) => b.pmId === pm.id), 'only own bench');
  }
});

test('PM view keeps what the PM screens need', { skip: !real && 'no local model' }, () => {
  const pm = real.pms.find((p) => p.customers > 3);
  const v = pmView(real, pm.id);
  const c = v.customers[0];
  for (const k of ['name', 'margin', 'gapINR', 'people', 'findings', 'seats']) assert.ok(k in c, k);
  assert.ok(c.findings.every((f) => f.pmText && f.ask !== undefined));
  assert.equal(v.viewer.pmId, pm.id);
  assert.equal(v.pms.find((p) => p.id === pm.id).customers, pm.customers);
});
