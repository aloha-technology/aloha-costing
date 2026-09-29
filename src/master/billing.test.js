import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linesFromInvoicing, summarize, companyMonths, accountBilling, roleCheck, periodOf, prevPeriod, monthRecord, changeRecord, monthName } from './billing.js';

const rows = [
  { name: 'Acme Inc', code: 'P1', seats: 3, amountUSD: 9000, diffSeats: 1, diffAmountUSD: 3000 },
  { name: 'Zeta (short term project)', code: 'P2', seats: 1, amountUSD: 3500, diffSeats: 1, diffAmountUSD: 3500 },
  { name: 'Acme Inc (2nd invoice)', code: 'P1', seats: 1, amountUSD: 2900, diffSeats: 0, diffAmountUSD: 0 },
  { name: 'No Code Co', code: '', seats: 2, amountUSD: 6000, diffSeats: 0, diffAmountUSD: 0 },
];

test('periods', () => {
  assert.equal(periodOf('September 2026'), '2026-09');
  assert.equal(prevPeriod('2026-01'), '2025-12');
  assert.equal(monthName('2026-09'), 'Sep-26');
});

test('first month: lines from the sheet, deltas from its change columns, short term detected', () => {
  const l = linesFromInvoicing(rows, '2026-09');
  assert.equal(l.length, 3);
  const acme = l.find((x) => x.key === 'P1');
  assert.equal(acme.seats, 4);
  assert.equal(acme.amountUSD, 11900);
  assert.equal(acme.seatDelta, 1);
  assert.equal(l.find((x) => x.key === 'P2').term, 'short');
  assert.equal(l.find((x) => x.code === '').key, 'n:no-code-co');
  const s = summarize(l);
  assert.deepEqual([s.seats, s.revenue, s.longSeats, s.shortSeats, s.shortRevenue, s.changed], [7, 21400, 6, 1, 3500, 2]);
});

test('next month: deltas against last month, term and resource types carry over, dropped lines recorded at zero', () => {
  const sep = linesFromInvoicing(rows, '2026-09').map((x) => (x.key === 'P1' ? { ...x, term: 'long', byRole: [{ role: 'Developer', seats: 4, rateUSD: 2975 }] } : x));
  const oct = linesFromInvoicing([{ name: 'Acme Inc', code: 'P1', seats: 5, amountUSD: 14875, diffSeats: 9, diffAmountUSD: 9 }], '2026-10', sep);
  const acme = oct.find((x) => x.key === 'P1');
  assert.equal(acme.seatDelta, 1);
  assert.equal(acme.amountDelta, 2975);
  assert.equal(acme.byRole[0].role, 'Developer');
  const zeta = oct.find((x) => x.key === 'P2');
  assert.equal(zeta.seats, 0);
  assert.equal(zeta.seatDelta, -1);
  assert.equal(zeta.term, 'short');
});

test('resource-type split must add up', () => {
  assert.equal(roleCheck({ seats: 4, amountUSD: 11900, byRole: [{ seats: 3, rateUSD: 3000 }, { seats: 1, rateUSD: 2900 }] }).state, 'ok');
  assert.equal(roleCheck({ seats: 4, amountUSD: 11900, byRole: [{ seats: 3, rateUSD: 3000 }] }).state, 'mismatch');
  assert.equal(roleCheck({ seats: 1, amountUSD: 1, byRole: [] }).state, 'none');
});

test('company months: recorded lines where there are any, reported totals otherwise, with deltas', () => {
  const records = [
    monthRecord('2026-07', { longSeats: 338.54, longRevenue: 935589, shortSeats: 1, shortRevenue: 3500 }, 'Billing Count'),
    monthRecord('2026-08', { seats: 329.01, revenue: 916943 }, 'Delta sheet summary'),
    ...linesFromInvoicing(rows, '2026-09'),
    changeRecord('2026-08', { name: 'Acme Inc', key: 'P1', seatDelta: 1, remarks: '1 dev added' }),
  ];
  const m = companyMonths(records);
  assert.deepEqual(m.map((x) => x.period), ['2026-07', '2026-08', '2026-09']);
  const withOld = companyMonths([...records, changeRecord('2026-05', { name: 'Old Co', seatDelta: -1 })]);
  assert.equal(withOld[0].source, 'changes only');
  assert.equal(withOld[0].seats, null);
  assert.equal(withOld[1].seatDelta, null);
  assert.equal(m[0].seats, 339.54);
  assert.equal(m[0].revenue, 939089);
  assert.equal(m[1].seatDelta, -10.53);
  assert.equal(m[1].changed, 1);
  assert.equal(m[2].source, 'recorded lines');
  assert.equal(m[2].revenueDelta, 21400 - 916943);
});

test('account billing: lines by code or name, changes, Zoho invoiced per month, rate per seat', () => {
  const records = [...linesFromInvoicing(rows, '2026-09'), changeRecord('2026-06', { name: 'No Code Co (weave)', seatDelta: -1, remarks: 'seat reduced' })];
  const invoices = [
    { customerId: 'nc', period: '2026-09', amount: 6000, status: 'open' },
    { customerId: 'nc', period: '2026-08', amount: 9000, status: 'paid' },
    { customerId: 'nc', period: '2026-08', amount: 50, status: 'void' },
  ];
  const b = accountBilling(records, { codes: [], names: ['No Code Co'], invoices, accountId: 'nc' });
  assert.equal(b.latest.seats, 2);
  assert.equal(b.ratePerSeat, 3000);
  assert.equal(b.changes.length, 1);
  assert.deepEqual(b.months.map((x) => [x.period, x.seats, x.invoicedUSD]), [['2026-09', 2, 6000], ['2026-08', null, 9000]]);
  const byCode = accountBilling(records, { codes: ['P1'], names: [], invoices: [], accountId: 'x' });
  assert.equal(byCode.latest.amountUSD, 11900);
});
