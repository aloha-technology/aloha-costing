// Invoice import from Zoho "Invoice Details" or QuickBooks exports (xlsx/csv rows as objects).
// Rows are matched to existing invoices by invoice number; nothing changes until Matt applies the diff.
import { parseDate, monthOf } from './dates.js';
import { round2 } from './money.js';

const HEADERS = {
  number: ['invoice_number', 'invoice number', 'invoice#', 'invoice no', 'invoice no.', 'num', 'no.', 'invoice'],
  customer: ['customer_name', 'customer name', 'customer', 'name', 'client', 'client name'],
  date: ['date', 'invoice_date', 'invoice date', 'txn date'],
  dueDate: ['due_date', 'due date'],
  amount: ['bcy_total', 'total', 'invoice amount', 'amount', 'fcy_total', 'total (bcy)'],
  balance: ['bcy_balance', 'balance', 'open balance', 'balance due', 'amount due', 'fcy_balance'],
  status: ['status', 'invoice status', 'invoice_status'],
  currency: ['currency_code', 'currency'],
  entity: ['entity', 'billing entity'],
  zohoId: ['invoice_id', 'invoice id'],
};

export const norm = (s) => String(s ?? '').trim().toLowerCase();
const num = (v) => {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/[,$\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

// Invoice numbers are written inconsistently ("APTE -12386", "APTE-12386"): compare without spaces/dashes.
export const invoiceKey = (s) => norm(s).replace(/[\s\-_/]/g, '');

export const slug = (s) =>
  norm(s)
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

function mapHeaders(sample) {
  const keys = Object.keys(sample);
  const out = {};
  for (const [field, names] of Object.entries(HEADERS)) {
    out[field] = keys.find((k) => names.includes(norm(k)));
  }
  return out;
}

// Zoho statuses -> ours. 'Bad Debt' and void are kept for history but never chased.
export function mapStatus(s, balance) {
  const t = norm(s);
  if (t.includes('void')) return 'void';
  if (t.includes('bad')) return 'bad_debt';
  if (t === 'draft') return 'draft';
  if (t === 'paid' || (balance != null && balance <= 0.005)) return 'paid';
  return 'open';
}

export function parseInvoiceRows(rows, { source = 'zoho' } = {}) {
  if (!rows.length) return { invoices: [], errors: ['The file has no rows'] };
  const h = mapHeaders(rows[0]);
  const missing = ['number', 'customer', 'date'].filter((f) => !h[f]);
  if (missing.length) return { invoices: [], errors: [`Could not find columns for: ${missing.join(', ')}. Expected a Zoho "Invoice Details" export.`] };
  const invoices = [];
  const errors = [];
  rows.forEach((r, i) => {
    const number = String(r[h.number] ?? '').trim();
    if (!number) return;
    const date = parseDate(r[h.date]);
    const amount = num(r[h.amount]);
    const balance = h.balance ? num(r[h.balance]) : amount;
    if (!date || amount == null) {
      errors.push(`Row ${i + 2} (${number}): missing date or amount`);
      return;
    }
    const status = mapStatus(h.status ? r[h.status] : '', balance);
    if (status === 'draft') return;
    invoices.push({
      number,
      customerName: String(r[h.customer] ?? '').trim(),
      date,
      dueDate: parseDate(h.dueDate ? r[h.dueDate] : '') || date,
      period: monthOf(date),
      amount: round2(amount),
      balance: round2(balance ?? amount),
      currency: (h.currency && String(r[h.currency] || '').trim().toUpperCase()) || 'USD',
      status,
      entity: h.entity ? String(r[h.entity] || '').trim() : '',
      zohoId: h.zohoId ? String(r[h.zohoId] || '').trim() : '',
      zohoStatus: h.status ? String(r[h.status] || '').trim() : '',
      source,
    });
  });
  return { invoices, errors };
}

// Resolve a customer by Zoho name or alias.
export function customerIndex(customers) {
  const idx = new Map();
  for (const c of customers) for (const n of [c.name, ...(c.zohoNames || [])]) idx.set(norm(n), c);
  return idx;
}

// Compare an import with what the app has. Balances in the app can be ahead of Zoho (a payment
// recorded here first), so a higher Zoho balance than ours is flagged rather than applied.
export function diffImport(existing, incoming, customers) {
  const byKey = new Map(existing.map((i) => [invoiceKey(i.number), i]));
  const idx = customerIndex(customers);
  const added = [];
  const changed = [];
  const closed = [];
  const conflicts = [];
  const unknownCustomers = new Set();
  for (const inc of incoming) {
    const cust = idx.get(norm(inc.customerName));
    if (!cust) unknownCustomers.add(inc.customerName);
    const cur = byKey.get(invoiceKey(inc.number));
    if (!cur) {
      if (inc.status === 'open') added.push({ ...inc, customerId: cust?.id || null });
      continue;
    }
    if (inc.status !== 'open' && cur.status === 'open') closed.push({ current: cur, incoming: inc });
    else if (inc.status === 'open' && cur.status === 'open' && Math.abs(inc.balance - cur.balance) > 0.005) {
      if (inc.balance < cur.balance) changed.push({ current: cur, incoming: inc });
      else conflicts.push({ current: cur, incoming: inc, text: `Zoho shows ${inc.balance}, app shows ${cur.balance} (payment recorded here but not yet in Zoho?)` });
    }
  }
  return { added, changed, closed, conflicts, unknownCustomers: [...unknownCustomers].filter(Boolean).sort() };
}

// Invoice doc for the app from an imported row.
export function newInvoice(inc, { customerId, staleDays, on, by }) {
  const stale = on && staleDays && inc.date < isoMinus(on, staleDays);
  return {
    id: invoiceKey(inc.number),
    number: inc.number,
    customerId,
    date: inc.date,
    dueDate: inc.dueDate,
    period: inc.period,
    amount: inc.amount,
    balance: inc.balance,
    currency: inc.currency || 'USD',
    status: inc.status,
    entity: inc.entity || '',
    zohoId: inc.zohoId || '',
    zohoStatus: inc.zohoStatus || '',
    source: inc.source,
    doNotSend: Boolean(stale),
    doNotSendReason: stale ? `Older than ${staleDays} days at import; review before chasing` : '',
    reminders: [],
    notes: [],
    payments: [],
    confirmed: false,
    createdAt: new Date().toISOString(),
    createdBy: by || 'import',
  };
}

const isoMinus = (on, days) => new Date(Date.parse(`${on}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
