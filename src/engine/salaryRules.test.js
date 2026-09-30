import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_SALARY_RULES as R, levelOf, peopleOverCap, teamChecks, reviewsOnHold } from './salaryRules.js';

const dev = (id, yrs, ctc, allocations = [], designation = 'Developer') => ({ empId: id, name: id, designation, experienceYears: yrs, ctcMonthlyINR: ctc, allocations });
const on = (code, utilPct = 100) => ({ code, customer: code, utilPct, ownerPm: 'pm1' });

test('levels by title first, then years', () => {
  assert.equal(levelOf(dev('a', 0.5, 0), R).key, 'fresher');
  assert.equal(levelOf(dev('a', 3, 0), R).key, 'mid');
  assert.equal(levelOf(dev('a', 6, 0), R).key, 'senior');
  assert.equal(levelOf(dev('a', 2, 0, [], 'Senior Developer'), R).key, 'senior');
  assert.equal(levelOf(dev('a', null, 0), R).key, null);
});

test('people over their level cap; out-of-scope roles ignored', () => {
  const over = peopleOverCap([dev('f', 0.5, 30000), dev('m', 3, 40000), dev('m2', 3, 45000), dev('s', 7, 90000), dev('qa', 3, 99000, [], 'Manual QA')], R);
  assert.deepEqual(over.map((p) => [p.empId, p.overINR]), [['s', 20000], ['f', 5000], ['m2', 5000]]);
});

test('team of 3: one mid OR one senior, not both; ₹90k limit by allocation', () => {
  const ok = [dev('f1', 0.5, 25000, [on('P1')]), dev('f2', 0.5, 25000, [on('P1')]), dev('m', 3, 40000, [on('P1')])];
  assert.equal(teamChecks(ok, [{ code: 'P1', name: 'Good' }], R)[0].issues.length, 0);
  const both = [dev('f1', 0.5, 20000, [on('P2')]), dev('m', 3, 30000, [on('P2')]), dev('s', 7, 40000, [on('P2')])];
  const t = teamChecks(both, [], R)[0];
  assert.deepEqual(t.issues.map((i) => i.kind), ['mix']);
  const dear = [dev('f1', 0.5, 25000, [on('P3')]), dev('f2', 0.5, 25000, [on('P3')]), dev('s', 7, 70000, [on('P3')])];
  assert.deepEqual(teamChecks(dear, [], R)[0].issues.map((i) => i.kind), ['cost']);
  // Half-time on the project counts half: 70k senior at 50% + two freshers = 85k vs 75k limit for 2.5 FTE.
  const half = [dev('f1', 0.5, 25000, [on('P4')]), dev('f2', 0.5, 25000, [on('P4')]), dev('s', 7, 70000, [on('P4', 50)])];
  const h = teamChecks(half, [], R)[0];
  assert.equal(h.fte, 2.5);
  assert.equal(Math.round(h.budgetINR), 75000);
  assert.equal(Math.round(h.allocatedINR), 85000);
  // Six devs = two groups: two mid/senior allowed.
  const six = [1, 2, 3, 4].map((i) => dev(`f${i}`, 0.5, 20000, [on('P5')])).concat([dev('m1', 3, 35000, [on('P5')]), dev('m2', 3, 35000, [on('P5')])]);
  assert.equal(teamChecks(six, [], R)[0].issues.length, 0);
});

test('reviews on hold: over-cap people and everyone on a breaking team', () => {
  const emps = [dev('f1', 0.5, 20000, [on('P2')]), dev('m', 3, 30000, [on('P2')]), dev('s', 7, 80000, [on('P2')])];
  const hold = reviewsOnHold(peopleOverCap(emps, R), teamChecks(emps, [], R));
  assert.equal(hold.length, 3);
  assert.equal(hold.find((h) => h.empId === 's').reasons.length, 2);
});

const modelFile = new URL('../../data/model.json', import.meta.url);
test('real data: checks run over every employee and project', { skip: !fs.existsSync(modelFile) && 'no local model' }, () => {
  const m = JSON.parse(fs.readFileSync(modelFile, 'utf8'));
  const teams = teamChecks(m.employees, m.customers, R);
  assert.ok(teams.length > 10);
  assert.ok(teams.every((t) => Number.isFinite(t.allocatedINR) && Number.isFinite(t.budgetINR)));
});
