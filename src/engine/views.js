// Builds the PM-safe copy of the model that is published for one PM.
// Whitelist, not blacklist: only fields named here leave Matt's machine, so a new
// salary-level field added to the model later can't leak by accident.
//
// PMs get: their customers' revenue, total cost, margin and gap; who is on the account
// (role, time, billable) but no one's CTC or cost; PM-safe finding text; their bench
// people without cost. No company totals, no data-quality lists.

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

const CUSTOMER_KEYS = ['code', 'name', 'pmIds', 'accountPm', 'revenueUSD', 'revenueINR', 'costINR', 'fx', 'margin', 'belowTarget', 'gapINR', 'gapUSD', 'billable', 'allocated'];
const PERSON_KEYS = ['empId', 'name', 'designation', 'project', 'ownerPm', 'utilPct', 'billable', 'isPm'];
const SEAT_KEYS = ['role', 'count', 'rateUSD', 'subproject'];
const FINDING_KEYS = ['id', 'kind', 'severity', 'title', 'pmText', 'ask', 'action', 'ownerPmIds'];
const PM_SELF_KEYS = ['id', 'name', 'email', 'source', 'customerCodes', 'accountOwnerOf', 'customers', 'belowTarget', 'criticalFindings', 'estRevenueINR', 'estCostINR', 'estMargin', 'gapINR', 'benchPeople'];
const BENCH_KEYS = ['empId', 'name', 'designation', 'pmId', 'pmName', 'allocPct', 'experienceYears', 'skills', 'relievingDate'];

export function pmView(model, pmId) {
  const customers = model.customers
    .filter((c) => c.pmIds.includes(pmId))
    .map((c) => ({
      ...pick(c, CUSTOMER_KEYS),
      invoicing: c.invoicing && pick(c.invoicing, ['amountUSD', 'seats', 'diffAmountUSD', 'diffSeats']),
      // Only people counts per PM: cost shares of a small team would reveal individual cost.
      pmSplit: c.pmSplit.map((s) => pick(s, ['pmId', 'people', 'subprojects', 'revenueShare'])),
      people: c.people.map((p) => pick(p, PERSON_KEYS)),
      seats: c.seats.map((s) => pick(s, SEAT_KEYS)),
      findings: c.findings.filter((f) => f.pmText).map((f) => ({ ...pick(f, FINDING_KEYS), savingINR: 0 })),
    }));

  const self = model.pms.find((p) => p.id === pmId);
  const pms = model.pms.map((p) => (p.id === pmId ? { ...pick(p, PM_SELF_KEYS), benchCostINR: 0 } : { id: p.id, name: p.name, customers: 0 }));

  return {
    audience: `pm:${pmId}`,
    generatedAt: model.generatedAt,
    period: model.period,
    target: model.target,
    fx: model.fx,
    viewer: { role: 'pm', pmId, name: self?.name || pmId },
    customers,
    pms,
    bench: model.bench.filter((b) => b.pmId === pmId).map((b) => ({ ...pick(b, BENCH_KEYS), costINR: 0 })),
  };
}

export function adminView(model) {
  return { ...model, audience: 'admin' };
}
