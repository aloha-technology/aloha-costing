// Report for Sid: sheets as arrays of rows (turned into an .xlsx in the browser).
// The first two sheets reproduce Matt's "New_File_AR_FY 22 - 26.xlsx":
//   Pivot  billing month (invoice date) -> Sum of bcy_total, Sum of bcy_balance, Grand Total
//          (void and bad-debt invoices left out, as the pivot's status filter does)
//   Dump   one row per invoice with the Zoho columns, Matt's comment and the true-void amount
// followed by Pending by customer (Matt's "Pending Invoices" layout), Aging & collections, Payments received.
// formats: { columnIndex: Excel number format } for the rows below the header row.
import { agingTotals, overdueDays, isOpen } from './aging.js';
import { fmtDate, monthLabel, toDate } from './dates.js';
import { round2 } from './money.js';

const usd = (n) => round2(n);
const AMT = '#,##0;-#,##0;"-"';
const DATE = 'yyyy-mm-dd';
const MON = 'mmm-yy';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Excel date serial for an ISO date (no time zone involved).
export const excelSerial = (iso) => (iso ? Math.round((toDate(iso) - Date.UTC(1899, 11, 30)) / 86400000) : '');
// '2024-01' -> 'Jan-24', as the pivot's row labels.
export const pivotLabel = (ym) => `${MONTHS[+ym.slice(5, 7) - 1]}-${ym.slice(2, 4)}`;

// Status as the Zoho dump shows it: open invoices are "overdue" or "sent" depending on the due date.
export function dumpStatus(inv, on) {
  if (inv.status === 'open') return (inv.dueDate || inv.date) < on ? 'overdue' : 'sent';
  if (inv.status === 'paid') return 'paid';
  if (inv.zohoStatus && inv.status !== 'open') return inv.zohoStatus;
  return { void: 'void', bad_debt: 'Bad Debt' }[inv.status] || inv.status;
}

export function buildPivot(invoices, { fromMonth, toMonth }) {
  const months = {};
  for (const i of invoices) {
    if (i.status === 'void' || i.status === 'bad_debt' || i.status === 'draft') continue;
    if ((fromMonth && i.period < fromMonth) || (toMonth && i.period > toMonth)) continue;
    const m = (months[i.period] ||= { billed: 0, open: 0 });
    m.billed += i.amount;
    m.open += isOpen(i) ? i.balance : 0;
  }
  const keys = Object.keys(months).sort();
  const total = keys.reduce((t, k) => ({ billed: t.billed + months[k].billed, open: t.open + months[k].open }), { billed: 0, open: 0 });
  return {
    name: 'Pivot',
    widths: [17, 16, 18],
    headerRow: 2,
    formats: { 1: AMT, 2: AMT },
    rows: [
      ['status', '(Multiple Items)'],
      [],
      ['Row Labels', 'Sum of bcy_total', 'Sum of bcy_balance'],
      ...keys.map((k) => [pivotLabel(k), usd(months[k].billed), usd(months[k].open)]),
      ['Grand Total', usd(total.billed), usd(total.open)],
    ],
  };
}

export function buildDump(invoices, customers, on) {
  const name = Object.fromEntries(customers.map((c) => [c.id, c.name]));
  const rows = invoices
    .filter((i) => i.status !== 'draft')
    .map((i) => ({ i, cust: name[i.customerId] || i.customerId }))
    .sort((a, b) => a.cust.localeCompare(b.cust) || a.i.date.localeCompare(b.i.date))
    .map(({ i, cust }) => {
      const comment = (i.notes || []).filter((n) => !n.text.startsWith('Import:')).slice(-1)[0]?.text || '';
      return [
        i.zohoId || '',
        dumpStatus(i, on),
        excelSerial(i.date),
        +i.date.slice(5, 7),
        excelSerial(`${i.date.slice(0, 7)}-01`),
        excelSerial(i.dueDate || i.date),
        i.number,
        cust,
        i.status === 'void' ? 0 : usd(i.amount),
        i.status === 'open' ? usd(i.balance) : i.status === 'bad_debt' ? usd(i.balance) : 0,
        comment,
        i.status === 'void' && i.voidAmount ? i.voidAmount : '',
      ];
    });
  return {
    name: 'Dump',
    widths: [19, 9, 11, 7, 11, 11, 16, 44, 11, 11, 44, 18],
    headerRow: 0,
    formats: { 2: DATE, 4: MON, 5: DATE, 8: AMT, 9: AMT, 11: AMT },
    rows: [["invoice_id", 'status', 'date', 'Month Count', 'Month Name', 'due_date', 'invoice_number', 'customer_name', 'bcy_total', 'bcy_balance', "Matt's comment", 'Invoice Amt(True Void)'], ...rows],
  };
}

export function buildReport({ customers, invoices, payments }, summaries, { on, from, to, fromMonth = '2024-01', toMonth }) {
  const custById = Object.fromEntries(customers.map((c) => [c.id, c]));
  const open = invoices.filter(isOpen);
  const totalOpen = usd(open.reduce((s, i) => s + i.balance, 0));
  const overdue = open.filter((i) => overdueDays(i, on) > 0);
  const inRange = payments.filter((p) => (!from || p.date >= from) && (!to || p.date <= to));
  const collected = usd(inRange.reduce((s, p) => s + (p.settled || 0), 0));
  const charges = usd(inRange.reduce((s, p) => s + (Number(p.bankCharges) || 0), 0));

  const pending = [
    ['Project Name', 'Billing Code', 'PM', 'Billing Period', 'Total Invoices', 'Total Amount', 'Oldest (days)', 'Aging', "Matt's Comment", 'Next action'],
    ...summaries
      .filter((s) => s.count)
      .sort((a, b) => b.balance - a.balance)
      .map((s) => [s.customer.name, s.customer.billingCode || '', s.customer.pm?.name || '', periodText(s.open), s.count, s.balance, s.maxAge, s.bucket.label, s.customer.comment || '', s.actions[0]?.text || '']),
  ];
  pending.push(['Total', '', '', '', open.length, totalOpen]);

  const summary = [
    ['Aloha Technology – Receivables'],
    [`As of ${fmtDate(on)}`],
    [],
    ['Metric', 'Value'],
    ['Total outstanding (USD)', totalOpen],
    ['Overdue (USD)', usd(overdue.reduce((s, i) => s + i.balance, 0))],
    ['Open invoices', open.length],
    ['Customers with dues', new Set(open.map((i) => i.customerId)).size],
    [`Collected ${from ? fmtDate(from) : ''} – ${to ? fmtDate(to) : fmtDate(on)} (USD, incl. bank charges)`, collected],
    ['Bank charges in the period (USD)', charges],
    [],
    ['Aging (days since invoice)', 'Invoices', 'Amount (USD)', '% of total'],
    ...agingTotals(open, on).map((b) => [b.label, b.count, usd(b.amount), totalOpen ? Math.round((b.amount / totalOpen) * 1000) / 10 : 0]),
  ];

  const paid = [
    ['Date', 'Customer', 'Payer name (bank)', 'Payer check', 'Currency', 'Amount received', 'Bank charges', 'FX rate', 'Settled (USD)', 'Invoices', 'Reference', 'Note'],
    ...inRange
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((p) => [
        excelSerial(p.date),
        custById[p.customerId]?.name || p.customerId,
        p.payerName || '',
        p.payerCheck || '',
        p.currency,
        Number(p.amountReceived) || 0,
        Number(p.bankCharges) || 0,
        p.currency === p.invoiceCurrency ? '' : p.fxRate,
        p.settled,
        (p.allocations || []).map((a) => a.invoiceNumber || a.invoiceId).join(', '),
        p.reference || '',
        [p.payerNote, p.note].filter(Boolean).join(' | '),
      ]),
  ];

  return [
    buildPivot(invoices, { fromMonth, toMonth }),
    buildDump(invoices, customers, on),
    { name: 'Pending by customer', rows: pending, widths: [34, 16, 16, 44, 10, 14, 10, 14, 50, 50], headerRow: 0, formats: { 5: AMT } },
    { name: 'Aging & collections', rows: summary, widths: [46, 14, 16, 12], headerRow: 3, formats: {} },
    { name: 'Payments received', rows: paid, widths: [12, 34, 30, 12, 9, 14, 12, 9, 14, 30, 20, 40], headerRow: 0, formats: { 0: DATE, 5: '#,##0.00', 6: '#,##0.00', 8: '#,##0.00' } },
  ];
}

// "Feb 2026 (Invoices: 1, Amount: $12,000.00) Mar 2026 (...)", as in the Pending Invoices sheet.
export function periodText(open) {
  const by = {};
  for (const i of open) (by[i.period] ||= { n: 0, amt: 0 }).n++, (by[i.period].amt += i.balance);
  return Object.keys(by)
    .sort()
    .map((k) => `${monthLabel(k)} (Invoices: ${by[k].n}, Amount: $${by[k].amt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`)
    .join('\n');
}
