import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { teamFromDesignation, employeeView, accountView, unlinkedProjects, pmViews, campaignRows, completeness, projectCodesOf } from './engine.js';

const on = '2026-09-29';

test('team guessed from designation', () => {
  assert.equal(teamFromDesignation('Manual QA'), 'QA');
  assert.equal(teamFromDesignation('Senior Developer'), 'Development');
  assert.equal(teamFromDesignation('Graphic Designer'), 'Design');
  assert.equal(teamFromDesignation('Project Manager'), 'Project Management');
  assert.equal(teamFromDesignation('Business Analyst'), 'Business Analysis');
  assert.equal(teamFromDesignation('MIS'), 'Support');
  assert.equal(teamFromDesignation('Technical Lead'), 'Development');
});

test('employee: HR export as base, Matt’s entries win; Aloha vs before', () => {
  const e = { empId: '1', name: 'A', designation: 'Developer', skills: 'java', experienceYears: 8, ctcMonthlyINR: 100000, baseMonthlyINR: 90000, incentiveMonthlyINR: 10000, allocations: [{ code: 'P1', customer: 'Acme', utilPct: 100, billable: true }] };
  const plain = employeeView(e, null, { on });
  assert.equal(plain.team, 'Development');
  assert.equal(plain.teamSource, 'from designation');
  assert.equal(plain.alohaYears, null);
  assert.ok(plain.missing.includes('joining date'));
  const v = employeeView(e, { joined_on: '2023-09-29', team: 'Data & AI', skills: 'java, spark' }, { on });
  assert.equal(v.alohaYears, 3);
  assert.equal(v.priorYears, 5);
  assert.equal(v.totalExp, 8);
  assert.equal(v.team, 'Data & AI');
  assert.equal(v.skillsSource, 'entered');
  assert.equal(v.incentive, 10000);
  assert.equal(v.projects[0].name, 'Acme');
  // Total is calculated when the export has none but prior experience was entered.
  const c = employeeView({ ...e, experienceYears: null }, { joined_on: '2024-09-29', prior_experience_years: 3 }, { on });
  assert.equal(c.totalExp, 5);
  assert.equal(c.expSource, 'calculated');
  // Entered prior experience wins over HR's total, and a contradiction is flagged.
  const d = employeeView({ ...e, experienceYears: 3 }, { joined_on: '2021-03-29', prior_experience_years: 4 }, { on });
  assert.equal(d.totalExp, 9.5);
  assert.match(d.conflict, /HR export says 3/);
  const x = employeeView({ ...e, experienceYears: 2 }, { joined_on: '2019-09-29' }, { on });
  assert.match(x.conflict, /less than years at Aloha/);
  assert.equal(x.priorYears, 0);
  assert.equal(plain.conflict, null);
});

const projectsByCode = {
  P1: { code: 'P1', name: 'Acme Web', pmIds: ['pm1'], revenueUSD: 9000, seats: [{ role: 'Developer', count: 3, rateUSD: 3000, subproject: 'Web' }] },
  P2: { code: 'P2', name: 'Acme App', pmIds: ['pm2'], revenueUSD: 5400, seats: [{ role: 'Developer', count: 2, rateUSD: 2700, subproject: 'App' }] },
  P3: { code: 'P3', name: 'Zeta Corp', pmIds: ['pm1'], revenueUSD: 3000, seats: [{ role: 'Developer', count: 1, rateUSD: 3000 }] },
};
const settings = { standardRates: { default: 3000, roles: {} }, revisionMonths: 12 };

test('account: projects, PMs, seats, revenue, rate revision, gaps', () => {
  const acct = { id: 'acme', name: 'Acme Inc', billingCode: 'P1, P2', contacts: [{ name: 'Dana', email: 'ap@acme.test', role: 'billing', phone: '+1 555' }], legalName: 'Acme Inc.', active: true };
  const master = { rates: { P1: { lastRevised: '2025-08-01' }, P2: { lastRevised: '2026-01-01' } } };
  const v = accountView(acct, { projectsByCode, master, settings, on, pmsById: { pm1: { name: 'Priya' } } });
  assert.deepEqual(projectCodesOf(acct), ['P1', 'P2']);
  assert.equal(v.seats, 5);
  assert.equal(v.revenueUSD, 14400);
  assert.deepEqual(v.pms, ['Priya', 'pm2']);
  assert.equal(v.nextRevision.date, '2026-08-01');
  assert.equal(v.revisionStatus, 'due');
  assert.equal(Math.round(v.discountVsStandard * 1000), 40); // 14,400 billed vs 15,000 standard
  assert.deepEqual(v.missing, []);
  const bare = accountView({ id: 'x', name: 'X', active: true }, { projectsByCode, master: {}, settings, on });
  assert.deepEqual(bare.missing, ['billing email', 'phone', 'name in contract', 'linked projects']);
});

test('unlinked projects get an account suggestion by name', () => {
  const accts = [{ id: 'acme', name: 'Acme Inc', billingCode: 'P1' }, { id: 'zeta', name: 'Zeta Corporation LLC' }];
  const u = unlinkedProjects(accts, Object.values(projectsByCode));
  assert.deepEqual(u.map((x) => x.project.code), ['P2', 'P3']);
  assert.equal(u[0].suggestion.id, 'acme');
  assert.equal(u[1].suggestion.id, 'zeta');
});

test('PM: team size, seats and revenue split by PM share', () => {
  const model = {
    customers: [
      { code: 'P1', revenueUSD: 10000, invoicing: { seats: 4 }, seats: [{ count: 6, subproject: 'Web' }, { count: 2, subproject: 'Ops' }], pmSplit: [{ pmId: 'pm1', subprojects: ['Web'], revenueShare: 0.75 }, { pmId: 'pm2', subprojects: ['Ops'], revenueShare: 0.25 }] },
      { code: 'P3', revenueUSD: 3000, seats: [{ count: 1 }], pmSplit: [{ pmId: 'pm1' }] },
    ],
    pms: [{ id: 'pm1', name: 'Priya', email: 'pm1', customerCodes: ['P1', 'P3'] }],
    employees: [
      { empId: 'e1', allocations: [{ code: 'P1', ownerPm: 'pm1' }] },
      { empId: 'e2', allocations: [{ code: 'P3', ownerPm: 'pm1' }, { code: 'P1', ownerPm: 'pm1' }] },
      { empId: 'e3', allocations: [{ code: 'P1', ownerPm: 'pm2' }] },
    ],
    bench: [{ empId: 'e4', pmId: 'pm1' }],
  };
  const [p] = pmViews(model, {}, {}, { pm1: { whatsapp: '+91 1' } }, { on });
  assert.equal(p.teamSize, 3);
  assert.equal(p.benchPeople, 1);
  assert.equal(p.seats, 4);
  assert.equal(p.revenueUSD, 10500);
  assert.equal(p.whatsapp, '+91 1');
});

test('campaigns and completeness', () => {
  const rows = campaignRows([{ id: 'a', name: 'A', campaigns: [{ name: 'Referral', date: '2026-09-01' }, { name: 'Rate rise', date: '2026-09-20' }] }]);
  assert.deepEqual(rows.map((r) => r.name), ['Rate rise', 'Referral']);
  const c = completeness([{ account: { active: true, contacts: [] }, projects: [], billingContact: null, revisionStatus: null }], [{ joinedOn: '2020-01-01', teamSource: 'entered', skills: 'x' }]);
  assert.equal(c.billingEmail, 0);
  assert.equal(c.joinDate, 1);
});

// Real data (local only): every model employee and PM builds without gaps in the numbers.
const modelFile = new URL('../../data/model.json', import.meta.url);
test('real model builds employee and PM views', { skip: !fs.existsSync(modelFile) && 'no local model' }, () => {
  const model = JSON.parse(fs.readFileSync(modelFile, 'utf8'));
  const byId = Object.fromEntries(model.employees.map((e) => [e.empId, e]));
  const views = model.employees.map((e) => employeeView(e, null, { on }));
  assert.equal(views.length, model.employees.length);
  const pms = pmViews(model, byId, {}, {}, { on });
  assert.ok(pms.length > 5);
  assert.ok(pms.every((p) => Number.isFinite(p.revenueUSD) && Number.isFinite(p.seats)));
  const total = pms.reduce((s, p) => s + p.revenueUSD, 0);
  const all = model.customers.reduce((s, c) => s + (c.revenueUSD || 0), 0);
  assert.ok(total <= all * 1.01, 'PM revenue should not exceed company revenue');
});
