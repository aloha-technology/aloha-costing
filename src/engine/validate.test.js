import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readInbox } from './read.js';
import { buildModel } from './model.js';
import { validateInputs } from './validate.js';

const inbox = path.resolve('data', 'inbox');
const hasInbox = fs.existsSync(inbox) && fs.readdirSync(inbox).some((f) => /\.xlsx$/i.test(f));
const raw = hasInbox && readInbox(inbox);

test('missing required datasets are errors', () => {
  const v = validateInputs({}, null);
  assert.equal(Object.keys(v).length, 5);
  assert.ok(Object.values(v).every((x) => x.checks[0].level === 'error'));
});

test('checks on the real exports (September)', { skip: !hasInbox && 'no inbox files' }, () => {
  const m = buildModel(raw, { generatedAt: 'fixed' });
  const v = validateInputs(raw, m);
  assert.deepEqual(Object.keys(v).sort(), ['bench', 'employees', 'invoicing', 'paysheet', 'projects', 'summary']);
  const pay = v.paysheet.checks.find((c) => c.action === 'classify');
  assert.match(pay.text, /^120 people/);
  assert.ok(v.invoicing.checks.some((c) => /invoiced codes aren't on the costing sheet/.test(c.text)));
});

test('classifying payroll people moves their cost into the right layer', { skip: !hasInbox && 'no inbox files' }, () => {
  const base = buildModel(raw, { generatedAt: 'fixed' });
  const [a, b, c] = base.unclassified;
  const m = buildModel(raw, { generatedAt: 'fixed', categories: { [a.empId]: 'support', [b.empId]: 'leaving', [c.empId]: 'engineering' } });
  assert.equal(m.unclassified.length, base.unclassified.length - 3);
  assert.ok(Math.abs(m.totals.supportINR - base.totals.supportINR - a.ctcMonthlyINR) < 1);
  assert.ok(Math.abs(m.totals.excludedINR - base.totals.excludedINR - b.ctcMonthlyINR) < 1);
  assert.ok(Math.abs(m.totals.unassignedINR - base.totals.unassignedINR - c.ctcMonthlyINR) < 1);
  assert.equal(validateInputs(raw, m).paysheet.checks.find((x) => x.action === 'classify').text.startsWith(`${base.unclassified.length - 3} people`), true);
});

test('revenue and salary corrections are applied', { skip: !hasInbox && 'no inbox files' }, () => {
  const base = buildModel(raw, { generatedAt: 'fixed' });
  const cust = base.customers.find((c) => c.people.length > 1);
  const person = cust.people.find((p) => p.ctcMonthlyINR);
  const m = buildModel(raw, {
    generatedAt: 'fixed',
    revenueOverrides: { [cust.code]: { amountUSD: 10000, reason: 'test' } },
    salaryOverrides: { [person.empId]: { ctcMonthlyINR: person.ctcMonthlyINR + 10000, reason: 'test' } },
  });
  const c2 = m.customers.find((c) => c.code === cust.code);
  assert.equal(c2.revenueSource, 'manual');
  assert.equal(c2.revenueUSD, 10000);
  assert.ok(c2.costINR > cust.costINR);
  assert.equal(m.corrections.salary, 1);
});
