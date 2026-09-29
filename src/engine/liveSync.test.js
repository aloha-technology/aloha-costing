import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readInbox } from './read.js';
import { buildModel } from './model.js';
import { modelToLive, liveToRaw, diffAllocations } from './liveSync.js';

const inbox = path.resolve('data', 'inbox');
const hasInbox = fs.existsSync(inbox) && fs.readdirSync(inbox).some((f) => /\.xlsx$/i.test(f));

test('round trip: seed the app from the export, rebuild from the app, same customer spend', { skip: !hasInbox && 'no inbox files' }, () => {
  const raw = readInbox(inbox);
  const m = buildModel(raw, { generatedAt: 'fixed' });
  const live = modelToLive(m);
  assert.equal(live.allocations.length, m.customers.reduce((a, c) => a + c.people.filter((p) => p.utilPct > 0).length, 0));
  assert.ok(live.people.every((p) => p.emp_id && p.name));

  const m2 = buildModel(liveToRaw(live, raw, m), { generatedAt: 'fixed' });
  for (const c of m.customers) {
    const c2 = m2.customers.find((x) => x.code === c.code);
    assert.ok(Math.abs(c2.costINR - c.costINR) < 1, `${c.name}: ${c2.costINR} vs ${c.costINR}`);
    assert.equal(c2.people.length, c.people.filter((p) => p.utilPct > 0).length, c.name);
    for (const p of c.people.filter((x) => x.utilPct > 0)) {
      const p2 = c2.people.find((x) => x.empId === p.empId && x.utilPct === p.utilPct);
      assert.ok(p2, `${c.name} ${p.name}`);
      assert.equal(p2.ownerPm, p.ownerPm, `${c.name} ${p.name} owner`);
    }
  }
  assert.ok(Math.abs(m2.totals.costINR - m.totals.costINR) < 1);
  // Unassigned engineering time now shows as bench held by a PM.
  assert.ok(m2.totals.benchCostINR >= m.totals.benchCostINR - 1);
  assert.equal(diffAllocations(m, live.allocations, live.people).length, 0, 'no differences right after seeding');
});

test('cross-check lists additions, removals and changes', () => {
  const m = { customers: [{ code: 'C1', name: 'Acme', people: [{ empId: 'E1', name: 'A', utilPct: 100, billable: true }, { empId: 'E2', name: 'B', utilPct: 50, billable: false }] }] };
  const d = diffAllocations(m, [
    { emp_id: 'E1', customer_code: 'C1', util_pct: 80, billable: true },
    { emp_id: 'E3', customer_code: 'C1', util_pct: 20, billable: true },
  ], [{ emp_id: 'E3', name: 'C' }]);
  assert.deepEqual(d.map((x) => [x.kind, x.emp_id, x.portal, x.app]).sort(), [['different', 'E1', 100, 80], ['only-app', 'E3', 0, 20], ['only-portal', 'E2', 50, 0]]);
});
