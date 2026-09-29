import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDefaults } from './settings.js';
import { invoiceStage, customerQueue, buildQueue, draftFor, recordStage, recipients, fillTemplate } from './reminders.js';
import { bucketOf, agingTotals, overdueDays } from './aging.js';
import { payerCheck, autoAllocate, applyAllocations, settledAmount, validatePayment } from './payments.js';
import { parseInvoiceRows, diffImport, invoiceKey, newInvoice } from './importer.js';
import { customerSummary } from './suggest.js';
import { buildReport, periodText } from './report.js';
import { parseDate, addDays } from './dates.js';

const S = withDefaults(null);
const inv = (o = {}) => ({ id: 'A1', number: 'APTE -1', customerId: 'acme', date: '2026-09-01', dueDate: '2026-09-16', period: '2026-09', amount: 3000, balance: 3000, currency: 'USD', status: 'open', reminders: [], ...o });
const cust = (o = {}) => ({
  id: 'acme',
  name: 'Acme Inc',
  legalName: 'Acme Software, Inc.',
  confirmed: true,
  pm: { name: 'Priya', email: 'pm@aloha.test' },
  contacts: [
    { name: 'Dana Smith', email: 'ap@acme.com', role: 'billing' },
    { name: 'CFO', email: 'cfo@acme.com', role: 'escalation' },
  ],
  ...o,
});

test('timeline: stages by days since invoice date', () => {
  assert.equal(invoiceStage(inv(), S, '2026-09-05').state, 'waiting'); // day 4
  assert.equal(invoiceStage(inv(), S, '2026-09-06').stage.key, 'gentle'); // day 5
  assert.equal(invoiceStage(inv(), S, '2026-09-11').stage.key, 'followup'); // day 10
  assert.equal(invoiceStage(inv(), S, '2026-09-17').stage.key, 'overdue'); // day 16
  assert.equal(invoiceStage(inv(), S, '2026-09-21').stage.key, 'push');
  assert.equal(invoiceStage(inv(), S, '2026-09-28').stage.key, 'push2');
  assert.equal(invoiceStage(inv(), S, '2026-10-01').stage.key, 'escalate');
  assert.equal(invoiceStage(inv(), S, '2026-10-06').stage.key, 'escalate2');
  assert.equal(invoiceStage(inv(), S, '2026-10-11').stage.key, 'stopwork');
});

test('timeline: late start sends only the latest stage; sent stages wait for the next', () => {
  const on = '2026-10-03'; // day 32
  assert.equal(invoiceStage(inv(), S, on).stage.key, 'escalate');
  const sent = inv({ reminders: [{ stage: 'escalate', action: 'sent', at: '2026-10-01T10:00:00Z' }] });
  const st = invoiceStage(sent, S, on);
  assert.equal(st.state, 'waiting');
  assert.equal(st.next.key, 'escalate2');
  assert.equal(st.nextOn, '2026-10-06');
  const all = inv({ reminders: [{ stage: 'stopwork', action: 'sent', at: '2026-10-11' }] });
  assert.equal(invoiceStage(all, S, '2026-11-30').state, 'finished');
});

test('controls: paid, do-not-send, snooze and skip stop a reminder', () => {
  const on = '2026-09-17';
  assert.equal(invoiceStage(inv({ status: 'paid', balance: 0 }), S, on).state, 'closed');
  assert.equal(invoiceStage(inv({ doNotSend: true }), S, on).state, 'do-not-send');
  assert.equal(invoiceStage(inv({ snoozeUntil: '2026-09-20' }), S, on).state, 'snoozed');
  assert.equal(invoiceStage(inv({ snoozeUntil: '2026-09-17' }), S, on).state, 'due');
  assert.equal(invoiceStage(inv({ reminders: [{ stage: 'overdue', action: 'skipped', at: on }] }), S, on).state, 'waiting');
});

test('due-date basis counts from the due date', () => {
  const s = withDefaults({ basis: 'due' });
  assert.equal(invoiceStage(inv(), s, '2026-09-20').state, 'waiting'); // 4 days overdue
  assert.equal(invoiceStage(inv(), s, '2026-09-21').stage.key, 'gentle');
});

test('customer queue: one email, highest stage, customer-level holds', () => {
  const on = '2026-10-02';
  const a = inv(); // day 31 -> escalate
  const b = inv({ id: 'A2', number: 'APTE -2', date: '2026-09-22', dueDate: '2026-10-07', period: '2026-09' }); // day 10 -> followup
  const q = customerQueue(cust(), [a, b], S, on);
  assert.equal(q.due.length, 2);
  assert.equal(q.stage.key, 'escalate');
  assert.equal(q.blocked, null);
  const d = draftFor(q, S);
  assert.deepEqual(d.to, ['ap@acme.com']);
  assert.ok(d.cc.includes('pm@aloha.test'));
  assert.ok(d.cc.includes('cfo@acme.com'));
  assert.deepEqual(d.stages, { A1: 'escalate', A2: 'followup' });
  assert.match(d.subject, /Invoices APTE -1, APTE -2 – \$6,000\.00 – Urgent/);
  assert.match(d.body, /Hi Dana,/);
  assert.match(d.body, /APTE -2 dated 22 Sep 2026/);

  assert.equal(customerQueue(cust({ contacts: [] }), [a], S, on).blocked.reason, 'no-contact');
  assert.equal(customerQueue(cust({ promise: { date: '2026-10-05' } }), [a], S, on).blocked.reason, 'promise');
  const recent = inv({ id: 'A3', status: 'paid', balance: 0, reminders: [{ stage: 'gentle', action: 'sent', at: '2026-10-01T09:00:00Z' }] });
  assert.equal(customerQueue(cust(), [a, recent], S, on).blocked.reason, 'gap');
});

test('recipients: PM from Day 16, Nidhi + customer escalation from Day 30', () => {
  const s = withDefaults({ internalEscalation: [{ name: 'Nidhi', email: 'nidhi@aloha.test' }] });
  const st = (k) => s.stages.find((x) => x.key === k);
  assert.deepEqual(recipients(cust(), st('followup'), s).cc, []);
  assert.deepEqual(recipients(cust(), st('overdue'), s).cc, ['pm@aloha.test']);
  assert.deepEqual(recipients(cust(), st('escalate'), s).cc.sort(), ['cfo@acme.com', 'nidhi@aloha.test', 'pm@aloha.test']);
});

test('template fill for one invoice matches the doc wording', () => {
  const { subject, body } = fillTemplate(S.stages[0], { customer: cust(), invoices: [inv()], settings: S });
  assert.equal(subject, 'Invoice APTE -1 – $3,000.00 – Reminder');
  assert.match(body, /reminder on invoice APTE -1 for \$3,000\.00, due on 16 Sep 2026\./);
  assert.match(body, /Thanks,\nMatt\nFinance & Accounts/);
});

test('recordStage marks each invoice with its own stage', () => {
  const out = recordStage([inv(), inv({ id: 'A2' })], { stage: 'escalate', stages: { A2: 'followup' }, action: 'sent', at: 'x', by: 'Matt' });
  assert.equal(out[0].reminders[0].stage, 'escalate');
  assert.equal(out[1].reminders[0].stage, 'followup');
});

test('buildQueue orders by stage then amount', () => {
  const c2 = cust({ id: 'b', name: 'B' });
  const q = buildQueue([cust(), c2], [inv(), inv({ id: 'B1', customerId: 'b', date: '2026-09-25' })], S, '2026-10-01');
  assert.deepEqual(q.map((x) => x.customer.id), ['acme', 'b']);
});

test('aging buckets and colours', () => {
  assert.equal(bucketOf(3).key, 'current');
  assert.equal(bucketOf(16).key, '16-30');
  assert.equal(bucketOf(61).key, '61-90');
  assert.equal(bucketOf(400).key, '90+');
  const t = agingTotals([inv(), inv({ id: 'x', date: '2026-06-01', balance: 500 }), inv({ status: 'paid', balance: 0 })], '2026-09-10');
  assert.equal(t.find((b) => b.key === 'current').amount, 3000);
  assert.equal(t.find((b) => b.key === '90+').amount, 500);
  assert.equal(overdueDays(inv(), '2026-09-10'), 0);
});

test('payer name check against contract name and aliases', () => {
  assert.equal(payerCheck('ACME SOFTWARE INC', cust()).result, 'match');
  assert.equal(payerCheck('ACME SOFTWARE', cust()).result, 'match');
  assert.equal(payerCheck('AMERICAN ASSURANCE', { name: 'American Assurance Corporation' }).result, 'match');
  assert.equal(payerCheck('Acme Holdings', cust()).result, 'partial');
  assert.equal(payerCheck('Zeta Payments LLC', cust()).result, 'mismatch');
  assert.equal(payerCheck('Zeta Payments LLC', cust({ payerAliases: ['Zeta Payments'] })).result, 'match');
});

test('payment: bank charges and FX settle invoices, oldest first', () => {
  const invs = [inv({ id: 'new', date: '2026-09-10', number: 'N' }), inv({ id: 'old', date: '2026-08-01', number: 'O' })];
  const { allocations, unapplied } = autoAllocate(invs, 4000);
  assert.deepEqual(allocations, [{ invoiceId: 'old', amount: 3000 }, { invoiceId: 'new', amount: 1000 }]);
  assert.equal(unapplied, 0);
  assert.equal(settledAmount({ currency: 'USD', invoiceCurrency: 'USD', amountReceived: 2975, bankCharges: 25 }), 3000);
  assert.equal(settledAmount({ currency: 'SGD', invoiceCurrency: 'USD', amountReceived: 1300, fxRate: 0.77, bankCharges: 0 }), 1001);
  const p = { id: 'P1', date: '2026-09-20', allocations };
  const after = applyAllocations(invs, p);
  const old = after.find((i) => i.id === 'old');
  assert.equal(old.status, 'paid');
  assert.equal(old.balance, 0);
  assert.equal(after.find((i) => i.id === 'new').balance, 2000);
  const undone = applyAllocations(after, p, { sign: -1 });
  assert.equal(undone.find((i) => i.id === 'old').status, 'open');
  assert.equal(undone.find((i) => i.id === 'old').balance, 3000);
});

test('payment validation', () => {
  const base = { customerId: 'acme', date: '2026-09-20', amountReceived: 100, bankCharges: 0, currency: 'USD', invoiceCurrency: 'USD', allocations: [] };
  assert.deepEqual(validatePayment(base, {}), []);
  assert.match(validatePayment({ ...base, currency: 'SGD' }, {})[0], /rate/);
  assert.match(validatePayment({ ...base, payerCheck: 'mismatch' }, {})[0], /note/);
  assert.match(validatePayment({ ...base, allocations: [{ invoiceId: 'A1', amount: 150 }] }, { A1: inv() })[0], /More is allocated/);
});

test('Zoho import: parse, diff, stale invoices marked do-not-send', () => {
  const rows = [
    { invoice_number: 'APTE -1', customer_name: 'Acme Inc', date: '2026-09-01', due_date: '2026-09-16', bcy_total: '3000', bcy_balance: '0', status: 'paid' },
    { invoice_number: 'APTE -9', customer_name: 'Acme Inc', date: '2026-09-20', due_date: '2026-10-05', bcy_total: '1,200', bcy_balance: '1,200', status: 'sent' },
    { invoice_number: 'X-1', customer_name: 'Nobody Ltd', date: '2026-09-20', bcy_total: 50, bcy_balance: 50, status: 'overdue' },
    { invoice_number: 'D-1', customer_name: 'Acme Inc', date: '2026-09-20', bcy_total: 50, bcy_balance: 50, status: 'draft' },
  ];
  const { invoices, errors } = parseInvoiceRows(rows);
  assert.deepEqual(errors, []);
  assert.equal(invoices.length, 3);
  assert.equal(invoices[1].amount, 1200);
  const d = diffImport([inv({ id: invoiceKey('APTE-1') })], invoices, [cust()]);
  assert.equal(d.closed.length, 1);
  assert.equal(d.added.length, 2);
  assert.equal(d.added[0].customerId, 'acme');
  assert.deepEqual(d.unknownCustomers, ['Nobody Ltd']);
  assert.equal(invoiceKey('APTE -12386'), invoiceKey('apte-12386'));
  const stale = newInvoice({ ...invoices[1], date: '2024-01-01' }, { customerId: 'acme', staleDays: 365, on: '2026-09-29' });
  assert.equal(stale.doNotSend, true);
  assert.equal(parseInvoiceRows([{ foo: 1 }]).errors.length, 1);
});

test('dates parse the formats in Matt\'s sheets', () => {
  assert.equal(parseDate('09-Jan-2026'), '2026-01-09');
  assert.equal(parseDate('2026-07-31'), '2026-07-31');
  assert.equal(parseDate(46022), '2025-12-31');
  assert.equal(parseDate('05/03/2026'), '2026-03-05');
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
});

test('suggestions and Sid report', () => {
  const on = '2026-10-15';
  const c = cust({ confirmed: false, contacts: [], promise: { date: '2026-10-01' } });
  const s = customerSummary(c, [inv()], S, on);
  const kinds = s.actions.map((a) => a.kind);
  assert.equal(s.actions[0].priority, 'critical');
  assert.ok(kinds.includes('promise') && kinds.includes('contact') && kinds.includes('setup'));
  const sheets = buildReport({ customers: [c], invoices: [inv()], payments: [] }, [s], { on });
  assert.deepEqual(sheets.map((x) => x.name), ['Summary', 'Pending by customer', 'Month-wise AR', 'Open invoices', 'Payments received']);
  assert.equal(sheets[1].rows[1][0], 'Acme Inc');
  assert.equal(periodText([inv(), inv({ period: '2026-10', balance: 500 })]), 'Sep 2026 (Invoices: 1, Amount: $3,000.00)\nOct 2026 (Invoices: 1, Amount: $500.00)');
});
