// Report for Sid: sheets as arrays of rows (turned into an .xlsx in the browser).
// Layout follows Matt's existing "Pending Invoices" sheet (Project Name, Billing Code, Billing Period,
// Total Invoices, Total Amount, Matt's Comment) plus aging, month-wise AR and payments received.
import { agingTotals, ageDays, overdueDays, isOpen, bucketOf } from './aging.js';
import { monthLabel, fmtDate } from './dates.js';
import { round2 } from './money.js';

const usd = (n) => round2(n);

export function buildReport({ customers, invoices, payments }, summaries, { on, from, to }) {
  const custById = Object.fromEntries(customers.map((c) => [c.id, c]));
  const open = invoices.filter(isOpen);
  const totalOpen = usd(open.reduce((s, i) => s + i.balance, 0));
  const overdue = open.filter((i) => overdueDays(i, on) > 0);
  const inRange = payments.filter((p) => (!from || p.date >= from) && (!to || p.date <= to));
  const collected = usd(inRange.reduce((s, p) => s + (p.settled || 0), 0));
  const charges = usd(inRange.reduce((s, p) => s + (Number(p.bankCharges) || 0), 0));

  const summary = [
    ['Aloha Technology – Receivables report'],
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
    ['Aging', 'Invoices', 'Amount (USD)', '% of total'],
    ...agingTotals(open, on).map((b) => [b.label, b.count, usd(b.amount), totalOpen ? Math.round((b.amount / totalOpen) * 1000) / 10 : 0]),
  ];

  const pending = [
    ['Project Name', 'Billing Code', 'PM', 'Billing Period', 'Total Invoices', 'Total Amount', 'Oldest (days)', 'Aging', "Matt's Comment", 'Next action'],
    ...summaries
      .filter((s) => s.count)
      .sort((a, b) => b.balance - a.balance)
      .map((s) => [
        s.customer.name,
        s.customer.billingCode || '',
        s.customer.pm?.name || '',
        periodText(s.open),
        s.count,
        s.balance,
        s.maxAge,
        s.bucket.label,
        s.customer.comment || '',
        s.actions[0]?.text || '',
      ]),
  ];
  pending.push(['Total', '', '', '', open.length, totalOpen]);

  // Month-wise: billed vs still open, by billing month (like the AR pivot Sid gets today).
  const months = {};
  for (const i of invoices) {
    if (i.status === 'void' || i.status === 'draft') continue;
    const m = (months[i.period] ||= { billed: 0, open: 0, count: 0 });
    m.billed += i.amount;
    m.open += isOpen(i) ? i.balance : 0;
    m.count += isOpen(i) ? 1 : 0;
  }
  const monthWise = [
    ['Billing month', 'Invoiced (USD)', 'Outstanding (USD)', 'Open invoices', 'Collected %'],
    ...Object.keys(months)
      .sort()
      .reverse()
      .map((k) => [monthLabel(k), usd(months[k].billed), usd(months[k].open), months[k].count, months[k].billed ? Math.round((1 - months[k].open / months[k].billed) * 1000) / 10 : 0]),
  ];

  const detail = [
    ['Customer', 'PM', 'Invoice #', 'Invoice date', 'Due date', 'Month', 'Amount', 'Balance', 'Days since invoice', 'Days overdue', 'Aging', 'Last reminder', 'Do not send', 'Notes'],
    ...open
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((i) => {
        const c = custById[i.customerId] || {};
        const last = (i.reminders || []).filter((r) => r.action === 'sent').slice(-1)[0];
        return [
          c.name || i.customerId,
          c.pm?.name || '',
          i.number,
          i.date,
          i.dueDate,
          monthLabel(i.period),
          i.amount,
          i.balance,
          ageDays(i, on),
          overdueDays(i, on),
          bucketOf(ageDays(i, on)).label,
          last ? `${last.stage} ${last.at.slice(0, 10)}` : '',
          i.doNotSend ? 'Yes' : '',
          (i.notes || []).map((n) => n.text).join(' | '),
        ];
      }),
  ];

  const paid = [
    ['Date', 'Customer', 'Payer name (bank)', 'Payer check', 'Currency', 'Amount received', 'Bank charges', 'FX rate', 'Settled (USD)', 'Invoices', 'Reference', 'Note'],
    ...inRange
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((p) => [
        p.date,
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
    { name: 'Summary', rows: summary, widths: [46, 14, 16, 12] },
    { name: 'Pending by customer', rows: pending, widths: [34, 16, 16, 44, 10, 14, 10, 14, 50, 50] },
    { name: 'Month-wise AR', rows: monthWise, widths: [16, 16, 18, 14, 12] },
    { name: 'Open invoices', rows: detail, widths: [34, 16, 16, 12, 12, 10, 12, 12, 10, 10, 14, 20, 10, 50] },
    { name: 'Payments received', rows: paid, widths: [12, 34, 30, 12, 9, 14, 12, 9, 14, 30, 20, 40] },
  ];
}

// "Feb 2026 (Invoices: 1, Amount: $12,000.00) Mar 2026 (...)", as in the current sheet.
export function periodText(open) {
  const by = {};
  for (const i of open) (by[i.period] ||= { n: 0, amt: 0 }).n++, (by[i.period].amt += i.balance);
  return Object.keys(by)
    .sort()
    .map((k) => `${monthLabel(k)} (Invoices: ${by[k].n}, Amount: $${by[k].amt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`)
    .join('\n');
}
