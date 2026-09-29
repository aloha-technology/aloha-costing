// Invoice age, aging buckets and colour bands.
import { daysBetween } from './dates.js';

export const isOpen = (inv) => inv.status === 'open' && inv.balance > 0.005;

// Days since the invoice date (drives the reminder timeline) and days past the due date.
export const ageDays = (inv, on) => daysBetween(inv.date, on);
export const overdueDays = (inv, on) => Math.max(0, daysBetween(inv.dueDate || inv.date, on));

// Buckets by age since invoice date. Net 15, so "Current" = not yet due.
export const BUCKETS = [
  { key: 'current', label: 'Current (0–15)', min: -Infinity, max: 15, tone: 'b0' },
  { key: '16-30', label: '16–30 days', min: 16, max: 30, tone: 'b1' },
  { key: '31-45', label: '31–45 days', min: 31, max: 45, tone: 'b2' },
  { key: '46-60', label: '46–60 days', min: 46, max: 60, tone: 'b3' },
  { key: '61-90', label: '61–90 days', min: 61, max: 90, tone: 'b4' },
  { key: '90+', label: '90+ days', min: 91, max: Infinity, tone: 'b5' },
];

export const bucketOf = (age) => BUCKETS.find((b) => age >= b.min && age <= b.max) || BUCKETS[BUCKETS.length - 1];

// Totals per bucket for a list of open invoices.
export function agingTotals(invoices, on) {
  const out = BUCKETS.map((b) => ({ ...b, count: 0, amount: 0 }));
  for (const inv of invoices) {
    if (!isOpen(inv)) continue;
    const i = BUCKETS.indexOf(bucketOf(ageDays(inv, on)));
    out[i].count += 1;
    out[i].amount += inv.balance;
  }
  return out;
}
