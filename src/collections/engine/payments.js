// Recording payments: payer-name check, allocation to invoices, and invoice balances.
import { round2 } from './money.js';
import { isOpen } from './aging.js';

// Company-name normalisation for comparing the bank's payer name with the contract name.
const NOISE = new Set(['inc', 'incorporated', 'llc', 'ltd', 'limited', 'pte', 'pvt', 'private', 'co', 'corp', 'corporation', 'company', 'the', 'dba', 'plc', 'gmbh', 'llp', 'lp', 'group', 'and', 'of']);
export function nameTokens(s) {
  return (s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !NOISE.has(w));
}

// 'match' | 'partial' | 'mismatch' | 'unknown', comparing against the contract name, Zoho name and known aliases.
export function payerCheck(payerName, customer) {
  const p = nameTokens(payerName);
  if (!p.length) return { result: 'unknown', against: null };
  const names = [customer.legalName, customer.name, ...(customer.payerAliases || [])].filter(Boolean);
  let best = { result: 'mismatch', against: customer.legalName || customer.name, score: 0 };
  for (const n of names) {
    const t = nameTokens(n);
    if (!t.length) continue;
    const joinedP = p.join('');
    const joinedT = t.join('');
    if (joinedP === joinedT) return { result: 'match', against: n, score: 1 };
    const common = p.filter((w) => t.includes(w)).length;
    // Banks often truncate payer names ("AMERICAN ASSURANCE" for "American Assurance Corporation").
    const prefix = joinedT.startsWith(joinedP) || joinedP.startsWith(joinedT);
    const score = prefix ? 0.9 : common / Math.max(p.length, t.length);
    if (score > best.score) best = { result: score >= 0.99 ? 'match' : score >= 0.5 ? 'partial' : 'mismatch', against: n, score };
  }
  return best;
}

// Suggested split of an amount across a customer's open invoices, oldest first.
export function autoAllocate(invoices, amount) {
  let left = round2(amount);
  const out = [];
  for (const inv of [...invoices].filter(isOpen).sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number))) {
    if (left <= 0) break;
    const take = round2(Math.min(left, inv.balance));
    out.push({ invoiceId: inv.id, amount: take });
    left = round2(left - take);
  }
  return { allocations: out, unapplied: left };
}

// Amount settled against invoices (invoice currency) = what reached the bank + bank charges,
// converted when the payment came in another currency.
export function settledAmount(p) {
  const fx = p.currency === p.invoiceCurrency || !p.fxRate ? 1 : Number(p.fxRate);
  return round2((Number(p.amountReceived) || 0) * fx + (Number(p.bankCharges) || 0));
}

// New invoice docs after applying (or reversing, sign = -1) a payment's allocations.
export function applyAllocations(invoices, payment, { sign = 1, at } = {}) {
  const byId = Object.fromEntries((payment.allocations || []).map((a) => [a.invoiceId, a.amount]));
  return invoices
    .filter((inv) => byId[inv.id] != null)
    .map((inv) => {
      const balance = Math.max(0, round2(inv.balance - sign * byId[inv.id]));
      const paid = balance <= 0.005;
      const payments = sign > 0 ? [...(inv.payments || []), { paymentId: payment.id, amount: byId[inv.id], date: payment.date }] : (inv.payments || []).filter((x) => x.paymentId !== payment.id);
      return {
        ...inv,
        balance: paid ? 0 : balance,
        status: paid ? 'paid' : inv.status === 'paid' ? 'open' : inv.status,
        paidAt: paid ? payment.date || at : null,
        payments,
      };
    });
}

export function validatePayment(p, invoicesById) {
  const errs = [];
  if (!p.customerId) errs.push('Choose the customer');
  if (!p.date) errs.push('Enter the payment date');
  if (!(Number(p.amountReceived) > 0)) errs.push('Enter the amount received');
  if (Number(p.bankCharges) < 0) errs.push('Bank charges cannot be negative');
  if (p.currency !== p.invoiceCurrency && !(Number(p.fxRate) > 0)) errs.push(`Enter the ${p.currency}→${p.invoiceCurrency} rate`);
  const allocated = round2((p.allocations || []).reduce((s, a) => s + (Number(a.amount) || 0), 0));
  if (allocated > settledAmount(p) + 0.01) errs.push('More is allocated to invoices than was paid');
  for (const a of p.allocations || []) {
    const inv = invoicesById[a.invoiceId];
    if (inv && a.amount > inv.balance + 0.01) errs.push(`${inv.number}: allocation is above the balance`);
  }
  if (p.payerCheck === 'mismatch' && !(p.payerNote || '').trim()) errs.push('Payer name does not match the contract: add a note (e.g. paid by parent company)');
  return errs;
}
