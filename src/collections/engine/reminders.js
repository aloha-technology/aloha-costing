// Follow-up timeline: which reminder is due for each invoice, grouped into one email per customer.
//
// Rules
// - Stage day <= invoice age -> that stage is reached. Only the latest reached stage is ever sent
//   (an invoice that is already on day 33 gets "Escalate", not the five earlier emails).
// - A stage is done once it has been sent or skipped for that invoice.
// - Blocked: paid/void, "Do not send", snoozed, customer promise-to-pay pending, no billing email,
//   or the customer had a reminder within minGapDays (then it waits a few days).
// - One email per customer: its invoices due that day go together, at the highest stage among them.
import { ageDays, overdueDays, isOpen } from './aging.js';
import { addDays, daysBetween, fmtDate } from './dates.js';
import { money, round2 } from './money.js';
import { contactsFor } from './contacts.js';

const done = (inv, key) => (inv.reminders || []).some((r) => r.stage === key);

// Stage status for a single invoice (customer-level blocks are applied in customerQueue).
export function invoiceStage(inv, settings, on) {
  if (!isOpen(inv)) return { state: 'closed' };
  const basisDays = settings.basis === 'due' ? overdueDays(inv, on) : ageDays(inv, on);
  const stages = settings.stages;
  const reached = stages.filter((s) => s.day <= basisDays);
  const latest = reached[reached.length - 1] || null;
  const nextIdx = latest ? stages.indexOf(latest) + 1 : 0;
  const next = stages[nextIdx] || null;
  const base = settings.basis === 'due' ? inv.dueDate || inv.date : inv.date;
  const nextOn = next ? addDays(base, next.day) : null;

  if (inv.doNotSend) return { state: 'do-not-send', latest, next, nextOn, days: basisDays };
  if (inv.snoozeUntil && inv.snoozeUntil > on) return { state: 'snoozed', until: inv.snoozeUntil, latest, next, nextOn, days: basisDays };
  if (!latest) return { state: 'waiting', next, nextOn, days: basisDays };
  if (done(inv, latest.key)) {
    return next ? { state: 'waiting', latest, next, nextOn, days: basisDays } : { state: 'finished', latest, days: basisDays };
  }
  return { state: 'due', stage: latest, next, nextOn, days: basisDays };
}

const contactsOf = contactsFor;
const emails = (list) => [...new Set(list.map((c) => (c.email || '').trim().toLowerCase()).filter(Boolean))];

export function lastReminderOn(invoices) {
  let last = null;
  for (const inv of invoices) for (const r of inv.reminders || []) if (r.action === 'sent' && (!last || r.at > last)) last = r.at;
  return last ? last.slice(0, 10) : null;
}

// Everything the Reminders page needs for one customer on a given day.
export function customerQueue(customer, invoices, settings, on) {
  const open = invoices.filter(isOpen);
  const rows = open.map((inv) => ({ inv, ...invoiceStage(inv, settings, on) }));
  const due = rows.filter((r) => r.state === 'due');
  if (!due.length) return { customer, due: [], rows, blocked: null };

  let blocked = null;
  const last = lastReminderOn(invoices);
  if (customer.doNotSend) blocked = { reason: 'customer', text: 'Customer set to "Do not send"' };
  else if (!emails(contactsOf(customer, 'billing')).length) blocked = { reason: 'no-contact', text: 'No billing contact email' };
  else if (settings.holdOnPromise && customer.promise?.date && customer.promise.date >= on)
    blocked = { reason: 'promise', text: `Promised to pay by ${fmtDate(customer.promise.date)}` };
  else if (last && daysBetween(last, on) < settings.minGapDays)
    blocked = { reason: 'gap', text: `Reminder sent ${fmtDate(last)}; next after ${fmtDate(addDays(last, settings.minGapDays))}`, until: addDays(last, settings.minGapDays) };

  const stage = due.reduce((best, r) => (!best || r.stage.day > best.day ? r.stage : best), null);
  return { customer, due, rows, stage, blocked };
}

// All customers with something due today (blocked ones included, flagged), most serious first.
export function buildQueue(customers, invoices, settings, on) {
  const byCustomer = groupBy(invoices, (i) => i.customerId);
  return customers
    .map((c) => customerQueue(c, byCustomer[c.id] || [], settings, on))
    .filter((q) => q.due.length)
    .sort((a, b) => b.stage.day - a.stage.day || total(b.due) - total(a.due));
}

const total = (rows) => rows.reduce((s, r) => s + r.inv.balance, 0);

export function groupBy(list, key) {
  const out = {};
  for (const x of list) (out[key(x)] ||= []).push(x);
  return out;
}

// Recipients for a stage: billing contacts; PM from the overdue stage; escalation contacts from Day 30.
export function recipients(customer, stage, settings) {
  const to = emails(contactsOf(customer, 'billing'));
  const cc = [...(settings.alwaysCc || []).map((c) => (typeof c === 'string' ? { email: c } : c)), ...contactsOf(customer, 'cc')];
  if (stage?.addPm && customer.pm?.email) cc.push(customer.pm);
  if (stage?.addEscalation) cc.push(...(settings.internalEscalation || []), ...contactsOf(customer, 'escalation'));
  return { to, cc: emails(cc).filter((e) => !to.includes(e)) };
}

const firstName = (customer) => {
  const c = contactsOf(customer, 'billing')[0];
  return (c?.name || '').trim().split(/\s+/)[0] || 'Team';
};

// Fill a template for one or more invoices of the same customer.
export function fillTemplate(tpl, { customer, invoices, settings, extra = {} }) {
  const cur = invoices[0]?.currency || 'USD';
  const totalAmt = round2(invoices.reduce((s, i) => s + i.balance, 0));
  const many = invoices.length > 1;
  const numbers = invoices.map((i) => i.number).join(', ');
  const earliestDue = invoices.map((i) => i.dueDate || i.date).sort()[0];
  const table = invoices.map((i) => `  • ${i.number} dated ${fmtDate(i.date)}, due ${fmtDate(i.dueDate)}: ${money(i.balance, i.currency)}`).join('\n');
  const values = {
    Name: firstName(customer),
    'Invoice #': numbers,
    Amount: money(totalAmt, cur),
    'Due Date': fmtDate(earliestDue),
    'PM Name': customer.pm?.name || 'our project manager',
    'Your Name': settings.signature || settings.senderName,
    Customer: customer.name,
    Days: String(extra.days ?? ''),
    'Invoice Table': table,
    'Tax Invoice #': extra.taxInvoiceNo || '',
  };
  const fill = (text) => {
    let t = text || '';
    t = t.replace(/\$\[Amount\]/g, '[Amount]'); // the doc's "$[Amount]" becomes one formatted amount
    if (many) {
      t = t.replace(/\binvoice \[Invoice #\]/g, 'invoices [Invoice #]').replace(/\bInvoice \[Invoice #\]/g, 'Invoices [Invoice #]');
      t = t.replace(/\bdue on \[Due Date\]/g, 'the earliest due on [Due Date]');
    }
    return t.replace(/\[([^\]]+)\]/g, (m, k) => (k in values ? values[k] : m));
  };
  let body = fill(tpl.body);
  if (many && !/\[Invoice Table\]/.test(tpl.body)) {
    // List the invoices above the sign-off.
    const at = body.search(/\n(Thanks|Regards|Best)/i);
    const block = `\nInvoice details:\n${table}\n`;
    body = at >= 0 ? body.slice(0, at) + '\n' + block + body.slice(at) : `${body}\n${block}`;
  }
  let subject = fill(tpl.subject);
  if (many && invoices.length > 3) subject = subject.replace(numbers, `${invoices[0].number} +${invoices.length - 1} more`);
  return { subject, body };
}

// The draft email for a customer's queue entry.
export function draftFor(q, settings) {
  const invoices = q.due.map((r) => r.inv);
  const { subject, body } = fillTemplate(q.stage, { customer: q.customer, invoices, settings, extra: { days: Math.max(...q.due.map((r) => r.days)) } });
  const stages = Object.fromEntries(q.due.map((r) => [r.inv.id, r.stage.key]));
  return { ...recipients(q.customer, q.stage, settings), subject, body, stage: q.stage.key, stages, invoiceIds: invoices.map((i) => i.id) };
}

// Invoices after an email went (or a stage was skipped): record each invoice's own stage
// (stages[invoiceId]; falls back to the email's stage).
export function recordStage(invoices, { stage, stages = {}, action, at, by, outboxId, note }) {
  return invoices.map((inv) => ({
    ...inv,
    reminders: [...(inv.reminders || []), { stage: stages[inv.id] || stage, action, at, by, outboxId: outboxId || null, note: note || '' }],
  }));
}
