// Per-customer roll-up and suggested next actions.
import { ageDays, overdueDays, bucketOf, isOpen } from './aging.js';
import { customerQueue, lastReminderOn } from './reminders.js';
import { monthOf, fmtDate, daysBetween } from './dates.js';
import { round2 } from './money.js';
import { contactsFor } from './contacts.js';
import { taxInvoicesDue } from './taxinvoices.js';

const PRIORITY = { critical: 0, high: 1, medium: 2, low: 3 };

export function customerSummary(customer, invoices, settings, on, extras = {}) {
  const open = invoices.filter(isOpen).sort((a, b) => a.date.localeCompare(b.date));
  const balance = round2(open.reduce((s, i) => s + i.balance, 0));
  const oldest = open[0];
  const maxAge = oldest ? ageDays(oldest, on) : 0;
  const maxOverdue = open.reduce((m, i) => Math.max(m, overdueDays(i, on)), 0);
  const months = [...new Set(open.map((i) => i.period || monthOf(i.date)))].sort();
  const q = customerQueue(customer, invoices, settings, on);
  const sentStages = new Set(invoices.flatMap((i) => (i.reminders || []).filter((r) => r.action === 'sent').map((r) => r.stage)));
  const s = {
    customer,
    open,
    balance,
    count: open.length,
    months,
    maxAge,
    maxOverdue,
    bucket: bucketOf(maxAge),
    queue: q,
    lastReminder: lastReminderOn(invoices),
    stopWorkSent: sentStages.has('stopwork'),
    partial: open.some((i) => i.balance < i.amount - 0.005),
    paidNoTax: taxInvoicesDue(invoices, extras.taxInvoices || [], on).length,
  };
  s.actions = suggest(s, settings, on, extras);
  return s;
}

function suggest(s, settings, on, { contracts = [], taxInvoices = [] }) {
  const c = s.customer;
  const out = [];
  const add = (priority, text, kind) => out.push({ priority, text, kind });
  const billing = contactsFor(c, 'billing');

  if (!c.confirmed) add('medium', 'Check and confirm this customer’s setup', 'setup');
  if (s.count && !billing.length) add('high', 'Add a billing contact email; reminders cannot go without one', 'contact');
  if (c.promise?.date) {
    if (c.promise.date < on) add('critical', `Promise to pay by ${fmtDate(c.promise.date)} was missed; call the customer and loop in the PM`, 'promise');
    else add('low', `Promised ${c.promise.amount ? `$${c.promise.amount.toLocaleString()} ` : ''}by ${fmtDate(c.promise.date)}; reminders on hold until then`, 'promise');
  }
  if (s.queue.due.length && !s.queue.blocked) add(s.queue.stage.day >= 30 ? 'high' : 'medium', `Send the “${s.queue.stage.label}” reminder today`, 'reminder');
  if (s.stopWorkSent && s.count) add('critical', 'Stop-work notice already sent: agree with the PM and leadership whether to pause work', 'stopwork');
  else if (s.maxAge >= 40 && s.count) add('critical', 'Past Day 40: send the stop-work notice after checking with the PM', 'stopwork');
  if (s.maxAge >= 30 && s.count && !contactsFor(c, 'escalation').length)
    add('high', 'Add a customer-side escalation contact (e.g. CFO / owner) for Day 30+ emails', 'contact');
  if (s.maxAge >= 16 && s.count && !c.pm?.email) add('medium', 'Add the PM so they are copied from Day 16', 'pm');
  if (s.partial) add('medium', 'Part-paid invoice: confirm the remaining balance with the customer', 'partial');
  if (s.maxAge > 90 && s.count) add('high', 'Over 90 days: review with Sid (payment plan, legal notice or bad debt)', 'review');
  if (s.count && s.lastReminder && daysBetween(s.lastReminder, on) > 14 && !c.promise) add('medium', 'No follow-up in over 2 weeks: call instead of email', 'call');
  if (s.paidNoTax) add('medium', `${s.paidNoTax} paid invoice${s.paidNoTax > 1 ? 's' : ''} need${s.paidNoTax > 1 ? '' : 's'} a tax invoice (waiting for accounts to upload)`, 'tax');
  const pendingTax = taxInvoices.filter((t) => t.customerId === c.id && (t.status === 'uploaded' || t.status === 'checked'));
  if (pendingTax.length) add('medium', `${pendingTax.length} tax invoice${pendingTax.length > 1 ? 's' : ''} to check and send`, 'tax');
  if (c.active !== false && !contracts.some((k) => k.customerId === c.id)) add('low', 'Upload the signed contract', 'contract');

  return out.sort((a, b) => PRIORITY[a.priority] - PRIORITY[b.priority]);
}

export function allSummaries({ customers, invoices, contracts, taxInvoices }, settings, on) {
  const byCust = {};
  for (const i of invoices) (byCust[i.customerId] ||= []).push(i);
  return customers.map((c) => customerSummary(c, byCust[c.id] || [], settings, on, { contracts, taxInvoices }));
}
