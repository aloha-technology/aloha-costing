import { test } from 'node:test';
import assert from 'node:assert/strict';
import { num, code, empId, role, projectSuffix } from './normalize.js';
import { buildModel } from './model.js';

test('parsers handle portal formats', () => {
  assert.equal(num('INR 1,96,722.83'), 196722.83);
  assert.equal(num('$3,100.00'), 3100);
  assert.equal(num('100%'), 100);
  assert.equal(num('-'), 0);
  assert.equal(code('W1pewEXM6O\r\n'), 'W1pewEXM6O');
  assert.equal(empId('004'), '4');
  assert.equal(role('projectmanager'), 'Project Manager');
  assert.equal(projectSuffix('Northwind- Priya'), 'Priya');
  assert.equal(projectSuffix('Global Bench- Priya - From Others'), 'Priya');
  assert.equal(projectSuffix('Contoso'), '');
});

// Tiny fixture: one customer, two PMs; Priya's part has a non-billable developer.
const raw = {
  summary: {
    file: 's.xlsx',
    sheetName: 'September 2026',
    rows: [
      { 'Project Name': 'Acme', 'Billing Code': 'C1', 'Project Manager': 'Priya Nair,Karan Mehta', 'Revenue USD': 1000, 'Revenue INR': 100000, 'Cost INR': 40000, 'Billabel Resources': 2, 'Resources Allocated': 3 },
    ],
  },
  invoicing: { file: 'i.xlsx', rows: [{ 'Customer Name': 'Acme Inc', 'Project Code': 'C1 ', PM: 'priyan@x.com', 'Sep-26': 2, 'Sep-26 Amount': 1000, 'Diff. of Count Sep & Aug': 0, 'Diff. of Amount Sep & Aug': -200 }] },
  employees: {
    file: 'e.xlsx',
    rows: [
      { ID: '1', Name: 'Priya Nair', Email: 'priyan@x.com', Designation: 'Project Manager', 'Allocated Projects': '', 'Project Utilization(%)': 0, 'Is Billable': 'No' },
      { ID: '2', Name: 'Karan Mehta', Email: 'karanm@x.com', Designation: 'Project Manager', 'Allocated Projects': '', 'Project Utilization(%)': 0, 'Is Billable': 'No' },
      { ID: '10', Name: 'Dev A', Email: 'a@x.com', Designation: 'Developer', 'Allocated Projects': 'Acme- Priya', 'Project Utilization(%)': 100, 'Is Billable': 'Yes' },
      { ID: '11', Name: 'Dev B', Email: 'b@x.com', Designation: 'Developer', 'Allocated Projects': 'Acme- Priya', 'Project Utilization(%)': 50, 'Is Billable': 'No' },
      { ID: '12', Name: 'QA C', Email: 'c@x.com', Designation: 'Manual QA', 'Allocated Projects': 'Acme- Karan', 'Project Utilization(%)': 100, 'Is Billable': 'Yes' },
    ],
  },
  projects: {
    file: 'p.xlsx',
    rows: [
      ['Acme- Priya', 'C1', 2, 'Developer', 2, '$500.00'],
      ['Acme- Karan', 'C1', 1, 'Manual QA', 1, '$500.00'],
    ],
  },
  paysheet: { file: 'pay.xlsx', rows: [{ ID: '010', CTC: 20000, 'Base Salary': 20000, 'Incentive Amount': 0 }, { ID: '11', CTC: 20000, 'Base Salary': 20000, 'Incentive Amount': 0 }, { ID: '12', CTC: 10000, 'Base Salary': 10000, 'Incentive Amount': 0 }] },
};

test('customer margin, gap and cost split', () => {
  const m = buildModel(raw, { generatedAt: 'fixed' });
  const c = m.customers[0];
  assert.equal(c.margin, 0.6);
  assert.equal(c.belowTarget, true);
  assert.ok(Math.abs(c.gapINR - 10000) < 1e-6); // 40,000 cost - 30% of 1,00,000
  assert.equal(c.computedCostINR, 40000); // 20,000 + 10,000 + 10,000
  assert.equal(c.accountPm, 'priyan@x.com');
  const rahul = c.pmSplit.find((s) => s.pmId === 'priyan@x.com');
  assert.equal(rahul.costINR, 30000);
  assert.equal(rahul.revenueShare, 2 / 3);
});

test('findings: non-billable goes to the owning PM and PM text has no salary', () => {
  const c = buildModel(raw).customers[0];
  const nb = c.findings.find((f) => f.kind === 'NON_BILLABLE');
  assert.deepEqual(nb.ownerPmIds, ['priyan@x.com']);
  assert.equal(nb.savingINR, 10000);
  for (const f of c.findings) if (f.pmText) assert.doesNotMatch(f.pmText, /₹/);
  assert.ok(c.findings.some((f) => f.kind === 'BILLING_DROP'));
});

test('PM directory comes from invoicing, co-PMs from the costing sheet', () => {
  const m = buildModel(raw);
  const byId = Object.fromEntries(m.pms.map((p) => [p.id, p]));
  assert.equal(byId['priyan@x.com'].name, 'Priya Nair');
  assert.equal(byId['priyan@x.com'].source, 'invoicing');
  assert.equal(byId['karanm@x.com'].source, 'costing-sheet');
});

test('revenue uses the invoiced amount and flags a costing-sheet difference', () => {
  const inv = { ...raw.invoicing, rows: [{ ...raw.invoicing.rows[0], 'Sep-26 Amount': 800 }] };
  const c = buildModel({ ...raw, invoicing: inv }).customers[0];
  assert.equal(c.revenueSource, 'invoicing');
  assert.equal(c.revenueUSD, 800);
  assert.equal(c.revenueINR, 80000); // costing sheet rate: 1,00,000 / 1,000
  assert.equal(c.costingRevenueUSD, 1000);
  assert.equal(c.revenueDiffUSD, 200);
  assert.equal(c.margin, 0.5);
  const f = c.findings.find((x) => x.kind === 'INVOICE_MISMATCH');
  assert.match(f.title, /Costing sheet shows \$1,000, invoiced \$800/);
  assert.doesNotMatch(f.pmText, /₹/);
});

test('without an invoicing line, revenue falls back to the costing sheet', () => {
  const c = buildModel({ ...raw, invoicing: { ...raw.invoicing, rows: [] } }).customers[0];
  assert.equal(c.revenueSource, 'costing');
  assert.equal(c.revenueUSD, 1000);
  assert.ok(c.findings.some((x) => x.kind === 'NOT_INVOICED'));
});
