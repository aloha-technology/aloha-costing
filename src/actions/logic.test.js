import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newAction, applyChange, isOverdue, daysLate, defaultDue, addDays, summarize, stillFlagged } from './logic.js';

const now = new Date('2026-09-28T10:00:00');
const base = { customerCode: 'C1', customerName: 'Acme', ownerPmId: 'pm@x', title: 'Fix margin', dueDate: '2026-10-01', findingId: 'C1:BELOW_TARGET', savingINR: 5000 };

test('TAT defaults by severity', () => {
  assert.equal(defaultDue('critical', '2026-09-28'), '2026-10-01');
  assert.equal(defaultDue('high', '2026-09-28'), '2026-10-05');
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
});

test('new action validates required fields', () => {
  assert.throws(() => newAction({ ...base, ownerPmId: '' }), /ownerPmId/);
  assert.throws(() => newAction({ ...base, dueDate: '1/10/2026' }), /YYYY-MM-DD/);
  const a = newAction(base, { now });
  assert.equal(a.status, 'open');
  assert.equal(a.originalDueDate, '2026-10-01');
  assert.equal(a.history.length, 1);
});

test('closing requires a note and is logged; reopening clears closure', () => {
  const a = newAction(base, { now });
  assert.throws(() => applyChange(a, { status: 'done' }), /closure note/);
  const closed = applyChange(a, { status: 'done', closureNote: 'Released 1 QA' }, { now });
  assert.equal(closed.closureNote, 'Released 1 QA');
  assert.ok(closed.closedAt);
  assert.equal(closed.history.at(-1).type, 'status');
  const reopened = applyChange(closed, { status: 'open' });
  assert.equal(reopened.closedAt, null);
  assert.equal(a.history.length, 1, 'original not mutated');
});

test('due date moves are logged and overdue is computed', () => {
  const a = applyChange(newAction(base, { now }), { dueDate: '2026-10-10', note: 'PM asked for more time' });
  assert.deepEqual(a.history.slice(1).map((h) => h.type), ['due', 'note']);
  assert.equal(isOverdue(a, '2026-10-10'), false);
  assert.equal(isOverdue(a, '2026-10-12'), true);
  assert.equal(daysLate(a, '2026-10-12'), 2);
  const done = applyChange(a, { status: 'done', closureNote: 'ok' });
  assert.equal(isOverdue(done, '2026-10-12'), false);
});

test('summary and still-flagged check', () => {
  const a = newAction(base, { now });
  const s = summarize([a], '2026-10-05');
  assert.equal(s.open, 1);
  assert.equal(s.overdue, 1);
  assert.equal(s.openSavingINR, 5000);
  const model = { customers: [{ code: 'C1', findings: [{ id: 'C1:BELOW_TARGET' }] }] };
  assert.equal(stillFlagged(a, model), true);
  assert.equal(stillFlagged(a, { customers: [{ code: 'C1', findings: [] }] }), false);
});
