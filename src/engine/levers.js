// Ready-made "levers" (possible moves) and the reach-70% planner, built on scenario.js.
import { simulate, merge, allocKey } from './scenario.js';

// Plans won't propose a rate rise above this; beyond it the account needs re-scoping.
export const MAX_RATE_PCT = 25;

const nonBillable = (c) => c.people.filter((p) => !p.billable && !p.isPm && p.utilPct > 0);

// Every lever: { id, group, code?, label, detail, part }. Customer levers only for customers
// below target (where they matter); company levers apply across everyone.
export function generateLevers(model) {
  const out = [];
  const below = model.customers.filter((c) => c.belowTarget).sort((a, b) => b.gapINR - a.gapINR);
  for (const c of below) {
    const nb = nonBillable(c);
    if (nb.length) {
      out.push({
        id: `off:${c.code}`, group: 'Take non-billable off', code: c.code,
        label: `Take ${nb.length} non-billable ${nb.length === 1 ? 'person' : 'people'} off ${c.name}`,
        detail: nb.map((p) => `${p.name} (${p.utilPct}%)`).join(', '),
        part: { alloc: Object.fromEntries(nb.map((p) => [allocKey(c.code, p.empId, p.project), { utilPct: 0 }])) },
      });
      out.push({
        id: `bill:${c.code}`, group: 'Bill non-billable', code: c.code,
        label: `Bill the ${nb.length} non-billable ${nb.length === 1 ? 'person' : 'people'} on ${c.name}`,
        detail: nb.map((p) => `${p.name} (${p.utilPct}%)`).join(', '),
        part: { alloc: Object.fromEntries(nb.map((p) => [allocKey(c.code, p.empId, p.project), { billable: true }])) },
      });
    }
    const thin = c.people.filter((p) => !p.billable && !p.isPm && p.utilPct > 0 && p.utilPct <= 10);
    if (thin.length >= 2) {
      out.push({
        id: `thin:${c.code}`, group: 'Consolidate small slices', code: c.code,
        label: `Remove ${thin.length} small (≤10%) non-billable slices on ${c.name}`,
        detail: thin.map((p) => `${p.name} (${p.utilPct}%)`).join(', '),
        part: { alloc: Object.fromEntries(thin.map((p) => [allocKey(c.code, p.empId, p.project), { utilPct: 0 }])) },
      });
    }
    for (const pct of [5, 10]) {
      out.push({
        id: `rate:${c.code}:${pct}`, group: 'Raise rates', code: c.code,
        label: `Raise ${c.name} billing by ${pct}%`,
        detail: `Rate increase on the current invoice`,
        part: { rates: { [c.code]: pct } },
      });
    }
  }

  // Company-wide levers.
  const allNb = model.customers.flatMap((c) => nonBillable(c).map((p) => [allocKey(c.code, p.empId, p.project), p]));
  if (allNb.length)
    out.push({
      id: 'company:bill-all', group: 'Company-wide', label: `Bill all ${allNb.length} non-billable allocations (company)`,
      detail: 'Every non-billable, non-PM allocation made billable',
      part: { alloc: Object.fromEntries(allNb.map(([k]) => [k, { billable: true }])) },
    });
  const relieving = model.bench.filter((b) => b.relievingDate);
  if (relieving.length)
    out.push({
      id: 'company:release-relieving', group: 'Company-wide', label: `Release the ${relieving.length} people with a confirmed relieving date`,
      detail: relieving.map((b) => b.name).join(', '),
      part: { released: Object.fromEntries(relieving.map((b) => [b.empId, true])) },
    });
  // PMs sitting on bench are not release candidates.
  const pmNames = new Set(model.pms.map((p) => p.name.toLowerCase()));
  const longBench = (model.employees || []).filter(
    (e) => e.benchPct >= 50 && !(e.allocations || []).some((a) => a.billable) && !pmNames.has((e.name || '').toLowerCase()) && e.designation !== 'Project Manager'
  );
  if (longBench.length)
    out.push({
      id: 'company:release-bench50', group: 'Company-wide', label: `Release the ${longBench.length} people with ≥50% bench and no billable work`,
      detail: longBench.map((e) => `${e.name} (${e.benchPct}%)`).join(', '),
      part: { released: Object.fromEntries(longBench.map((e) => [e.empId, true])) },
    });
  return out;
}

// Fewest changes that bring one customer to the target, on top of a base scenario.
// Tries per-person moves greedily (bill or take off each non-billable person), then adds the
// smallest rate increase needed if people moves aren't enough.
export function planToTarget(model, code, base = {}) {
  const c = model.customers.find((x) => x.code === code);
  const target = model.target;
  const custOf = (sim) => sim.customers.find((x) => x.code === code).after;
  const steps = [];
  let current = merge([base]);
  let now = custOf(simulate(model, current));
  if (!c || !now.belowTarget) return { code, name: c?.name, steps, reached: true, start: now, end: now };
  const start = now;

  const candidates = nonBillable(c).flatMap((p) => {
    const key = allocKey(c.code, p.empId, p.project);
    return [
      { person: p.empId, label: `Bill ${p.name} (${p.designation}, ${p.utilPct}%)`, part: { alloc: { [key]: { billable: true } } } },
      { person: p.empId, label: `Take ${p.name} (${p.designation}) off (${p.utilPct}% → 0%)`, part: { alloc: { [key]: { utilPct: 0 } } } },
    ];
  });
  const used = new Set();
  while (now.belowTarget && steps.length < 12) {
    let best = null;
    for (const cand of candidates) {
      if (used.has(cand.person)) continue;
      const after = custOf(simulate(model, merge([current, cand.part])));
      const gain = (after.margin ?? -Infinity) - (now.margin ?? -Infinity);
      if (gain > 1e-6 && (!best || gain > best.gain)) best = { cand, after, gain };
    }
    if (!best) break;
    used.add(best.cand.person);
    current = merge([current, best.cand.part]);
    now = best.after;
    steps.push({ label: best.cand.label, part: best.cand.part, marginAfter: now.margin });
  }

  let note = null;
  if (now.belowTarget && now.revenueINR > 0) {
    // Rate increase that closes the rest: revenue needed = cost / (1 - target).
    const pct = Math.ceil((now.costINR / (1 - target) / now.revenueINR - 1) * 1000) / 10;
    if (pct <= MAX_RATE_PCT) {
      const part = { rates: { [code]: (current.rates?.[code] || 0) + pct } };
      current = merge([current, part]);
      now = custOf(simulate(model, current));
      steps.push({ label: `Raise billing by ${pct}%`, part, marginAfter: now.margin, rate: true });
    } else {
      note = `Would still need a +${Math.round(pct)}% rate increase: consider re-scoping or exiting this account.`;
    }
  } else if (now.belowTarget) {
    note = 'No revenue left to raise: re-scope or exit this account.';
  }
  return { code, name: c.name, steps, reached: !now.belowTarget, start, end: now, note, part: merge(steps.map((s) => s.part)) };
}
