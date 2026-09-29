// Rate card: each customer's bill rate per resource type against Aloha's standard rate.
// Pure; settings and per-customer rate records are passed in (they live in the database).
import { addDays, toISODate } from '../actions/logic.js';

export const DEFAULT_SETTINGS = {
  standardRates: { default: 3000, roles: { 'AI Engineer': 4000 } }, // USD per seat per month
  revisionMonths: 12, // a rate is due for revision this long after it was last revised
};

export const standardRate = (settings, role) => {
  const r = (settings || DEFAULT_SETTINGS).standardRates;
  return r.roles?.[role] ?? r.default;
};

export function addMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  return toISODate(new Date(y, m - 1 + months, d));
}

// record = { roles: { [role]: { billRateUSD?, reason? } }, reason?, lastRevised?: 'YYYY-MM-DD' }
export function rateCard(customer, record = {}, settings = DEFAULT_SETTINGS, today = toISODate(new Date())) {
  const byRole = new Map();
  for (const s of customer.seats || []) {
    const r = byRole.get(s.role) || { role: s.role, seats: 0, value: 0 };
    r.seats += s.count;
    r.value += s.count * s.rateUSD;
    byRole.set(s.role, r);
  }
  const roles = record.roles || {};
  for (const role of Object.keys(roles)) if (!byRole.has(role)) byRole.set(role, { role, seats: 0, value: 0 });

  const rows = [...byRole.values()]
    .map((r) => {
      const fromSeats = r.seats > 0 ? r.value / r.seats : 0;
      const override = roles[r.role]?.billRateUSD;
      const billRateUSD = override != null && override !== '' ? Number(override) : fromSeats;
      const standardUSD = standardRate(settings, r.role);
      const billed = billRateUSD > 0;
      return {
        role: r.role,
        seats: r.seats,
        billRateUSD,
        overridden: override != null && override !== '',
        standardUSD,
        billed,
        discountPct: billed && standardUSD > 0 ? (standardUSD - billRateUSD) / standardUSD : null,
        reason: roles[r.role]?.reason || record.reason || '',
      };
    })
    .sort((a, b) => b.seats * b.billRateUSD - a.seats * a.billRateUSD || a.role.localeCompare(b.role));

  const billedRows = rows.filter((r) => r.billed && r.seats > 0);
  const billedValueUSD = billedRows.reduce((a, r) => a + r.seats * r.billRateUSD, 0);
  const standardValueUSD = billedRows.reduce((a, r) => a + r.seats * r.standardUSD, 0);

  const lastRevised = record.lastRevised || null;
  let status = 'unknown';
  let dueDate = null;
  if (lastRevised) {
    dueDate = addMonths(lastRevised, settings.revisionMonths || 12);
    status = dueDate <= today ? 'due' : dueDate <= addDays(today, 60) ? 'soon' : 'ok';
  }
  return {
    rows,
    billedValueUSD,
    standardValueUSD,
    discountPct: standardValueUSD > 0 ? 1 - billedValueUSD / standardValueUSD : null,
    // What billing would be at Aloha's standard rates, for the seats on the card.
    upliftAtStandardUSD: Math.max(0, standardValueUSD - billedValueUSD),
    lastRevised,
    dueDate,
    status,
    reason: record.reason || '',
  };
}

export const REVIEW_LABEL = { due: 'Due for revision', soon: 'Due within 60 days', ok: 'Up to date', unknown: 'Not recorded' };
