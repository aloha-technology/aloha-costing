// Tax invoices go out after payment. Which paid invoices still need one?
import { addDays } from './dates.js';

// invoices: app invoices or the accounts directory ({ id, status, paidAt }).
// A tax invoice that was sent back (rejected) doesn't count: a new one is still needed.
export function taxInvoicesDue(invoices, taxInvoices, on, { windowDays = 120 } = {}) {
  const covered = new Set(taxInvoices.filter((t) => t.invoiceId && t.status !== 'rejected').map((t) => t.invoiceId));
  const since = addDays(on, -windowDays);
  return invoices
    .filter((i) => i.status === 'paid' && i.paidAt && i.paidAt >= since && !covered.has(i.id))
    .sort((a, b) => b.paidAt.localeCompare(a.paidAt));
}

// Warning for sending a tax invoice before the invoice is paid.
export const unpaidWarning = (inv) => (inv && inv.status === 'open' && inv.balance > 0.005 ? `Invoice ${inv.number} is not fully paid yet. Tax invoices are normally sent after payment.` : null);
