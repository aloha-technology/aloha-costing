// What-if engine for the People tab. Pure: (model, scenario) -> before/after numbers.
//
// scenario = {
//   alloc:    { [allocKey]: { utilPct?, billable? } }   // changed allocations
//   released: { [empId]: true }                          // people leaving the company
//   added:    [{ id, empId, code, utilPct, billable }]   // free time assigned to a customer
//   rates:    { [customerCode]: pct }                    // billing rate change, e.g. 10 = +10%
// }
//
// Rules (shown to the user on screen):
// - Cost moves by CTC x change in time. Deltas are applied to the official (costing sheet) cost.
// - Time taken off customers goes to bench unless the person is released, so the company only
//   saves when people are released or their freed time is reused elsewhere.
// - Billing follows billable time at the person's seat rate on that project (their role's rate,
//   else the customer's average seat rate, else revenue per billed seat), calibrated so the
//   customer's current billable time adds up to what it was actually invoiced (so removing all
//   billable time takes revenue to ~0, never below). Added billing is capped at the seat rate.

export const allocKey = (code, empId, project) => `${code}|${empId}|${project}`;

export function seatRate(customer, designation, project) {
  const seats = customer.seats.filter((s) => s.rateUSD > 0);
  const exact = seats.find((s) => s.role === designation && s.subproject === project) || seats.find((s) => s.role === designation);
  if (exact) return { rateUSD: exact.rateUSD, basis: `${designation} seat rate` };
  if (seats.length) {
    const count = seats.reduce((a, s) => a + s.count, 0);
    return { rateUSD: seats.reduce((a, s) => a + s.rateUSD * s.count, 0) / count, basis: 'average seat rate' };
  }
  if (customer.billable > 0) return { rateUSD: customer.revenueUSD / customer.billable, basis: 'revenue per billed seat' };
  return { rateUSD: 0, basis: 'no rate' };
}

const marginOf = (rev, cost) => (rev > 0 ? (rev - cost) / rev : null);

export function simulate(model, scenario = {}) {
  const alloc = scenario.alloc || {};
  const released = scenario.released || {};
  const target = model.target;
  const empById = new Map((model.employees || []).map((e) => [e.empId, e]));

  const custDelta = new Map(); // code -> { cost, revenue }
  const personDelta = new Map(); // empId -> total change in allocated time (pct points)
  const rows = []; // one per changed allocation

  for (const c of model.customers) {
    // Calibration: actual invoiced revenue / billing implied by billable time x seat rates.
    const implied = c.people.reduce((a, p) => a + (p.billable ? (seatRate(c, p.designation, p.project).rateUSD * p.utilPct) / 100 : 0), 0);
    const calib = implied > 0 ? c.revenueUSD / implied : 1;
    for (const p of c.people) {
      const key = allocKey(c.code, p.empId, p.project);
      const ch = alloc[key];
      const gone = released[p.empId];
      if (!ch && !gone) continue;
      const newUtil = gone ? 0 : ch?.utilPct ?? p.utilPct;
      const newBillable = gone ? false : ch?.billable ?? p.billable;
      const ctc = p.ctcMonthlyINR || 0;
      const dCost = (ctc * (newUtil - p.utilPct)) / 100;
      const { rateUSD, basis } = seatRate(c, p.designation, p.project);
      const oldBilled = p.billable ? p.utilPct : 0;
      const newBilled = newBillable ? newUtil : 0;
      // Removing billed time is calibrated to the real invoice; adding is capped at the listed seat rate.
      const mult = newBilled < oldBilled ? calib : Math.min(calib, 1);
      const dRev = ((rateUSD * mult * (newBilled - oldBilled)) / 100) * (c.fx || model.fx || 0);
      if (!dCost && !dRev && newUtil === p.utilPct && newBillable === p.billable) continue;
      const d = custDelta.get(c.code) || { cost: 0, revenue: 0 };
      d.cost += dCost;
      d.revenue += dRev;
      custDelta.set(c.code, d);
      personDelta.set(p.empId, (personDelta.get(p.empId) || 0) + (newUtil - p.utilPct));
      rows.push({ key, code: c.code, customer: c.name, empId: p.empId, name: p.name, designation: p.designation, ownerPm: p.ownerPm || c.accountPm, isPm: Boolean(p.isPm), from: { utilPct: p.utilPct, billable: p.billable }, to: { utilPct: newUtil, billable: newBillable }, dCostINR: dCost, dRevenueINR: dRev, rateBasis: `${basis}${Math.abs(calib - 1) > 0.01 ? `, calibrated to invoice (x${calib.toFixed(2)})` : ''}`, released: Boolean(gone) });
    }
  }

  // New assignments: put someone's free (bench / unallocated) time onto a customer.
  const custByCode = new Map(model.customers.map((c) => [c.code, c]));
  for (const add of scenario.added || []) {
    const c = custByCode.get(add.code);
    const e = empById.get(add.empId);
    if (!c || !e || released[add.empId] || !(add.utilPct > 0)) continue;
    const implied = c.people.reduce((a, p) => a + (p.billable ? (seatRate(c, p.designation, p.project).rateUSD * p.utilPct) / 100 : 0), 0);
    const calib = implied > 0 ? c.revenueUSD / implied : 1;
    const { rateUSD, basis } = seatRate(c, e.designation, null);
    const dCost = ((e.ctcMonthlyINR || 0) * add.utilPct) / 100;
    const dRev = add.billable ? ((rateUSD * Math.min(calib, 1) * add.utilPct) / 100) * (c.fx || model.fx || 0) : 0;
    const d = custDelta.get(c.code) || { cost: 0, revenue: 0 };
    d.cost += dCost;
    d.revenue += dRev;
    custDelta.set(c.code, d);
    personDelta.set(e.empId, (personDelta.get(e.empId) || 0) + add.utilPct);
    rows.push({ key: `add|${add.id}`, added: true, code: c.code, customer: c.name, empId: e.empId, name: e.name, designation: e.designation, ownerPm: c.accountPm || c.pmIds?.[0] || null, isPm: false, from: { utilPct: 0, billable: false }, to: { utilPct: add.utilPct, billable: Boolean(add.billable) }, dCostINR: dCost, dRevenueINR: dRev, rateBasis: `${basis}${Math.abs(calib - 1) > 0.01 ? `, calibrated to invoice (x${calib.toFixed(2)})` : ''}`, released: false });
  }

  // Bench: freed time lands on bench unless released; released people take their bench cost with them.
  let dBench = 0;
  const overAllocated = [];
  for (const [id, dUtil] of personDelta) {
    const e = empById.get(id);
    const ctc = e?.ctcMonthlyINR || 0;
    if (released[id]) {
      dBench -= (ctc * (e?.benchPct || 0)) / 100;
      continue;
    }
    const idleBefore = e ? e.benchPct + e.idlePct : 0;
    const idleAfter = idleBefore - dUtil;
    if (idleAfter < -0.5) overAllocated.push({ empId: id, name: e?.name, totalPct: 100 - idleAfter });
    dBench += (ctc * Math.min(Math.max(idleAfter, 0), 100) - ctc * Math.min(idleBefore, 100)) / 100;
  }
  for (const id of Object.keys(released)) {
    if (personDelta.has(id) || !released[id]) continue; // only-bench people released
    const e = empById.get(id);
    if (e) dBench -= ((e.ctcMonthlyINR || 0) * e.benchPct) / 100;
  }

  const rates = scenario.rates || {};
  const rateRows = [];
  const customers = model.customers.map((c) => {
    const d = custDelta.get(c.code) || { cost: 0, revenue: 0 };
    const ratePct = Number(rates[c.code]) || 0;
    const dRate = (c.revenueINR * ratePct) / 100;
    if (ratePct) rateRows.push({ code: c.code, customer: c.name, ratePct, dRevenueINR: dRate, ownerPm: c.accountPm || c.pmIds?.[0] || null });
    const revenueINR = Math.max(0, c.revenueINR + d.revenue + dRate);
    const costINR = c.costINR + d.cost;
    const margin = marginOf(revenueINR, costINR);
    return {
      code: c.code,
      name: c.name,
      changed: custDelta.has(c.code) || Boolean(ratePct),
      before: { revenueINR: c.revenueINR, costINR: c.costINR, margin: c.margin, belowTarget: c.belowTarget, gapINR: c.gapINR },
      after: {
        revenueINR,
        costINR,
        margin,
        belowTarget: revenueINR > 0 ? margin < target : costINR > 0,
        gapINR: Math.max(0, costINR - (1 - target) * revenueINR),
      },
    };
  });

  const sum = (f) => customers.reduce((a, c) => a + f(c), 0);
  const t = model.totals;
  const beforeBench = t.benchCostINR;
  const afterBench = Math.max(0, beforeBench + dBench);
  const totals = (side, bench) => {
    const rev = sum((c) => c[side].revenueINR);
    const cost = sum((c) => c[side].costINR);
    return {
      revenueINR: rev,
      costINR: cost,
      benchCostINR: bench,
      margin: marginOf(rev, cost),
      marginAfterBench: marginOf(rev, cost + bench),
      belowTarget: customers.filter((c) => c[side].belowTarget).length,
      gapINR: sum((c) => c[side].gapINR),
    };
  };
  const before = totals('before', beforeBench);
  const after = totals('after', afterBench);
  return {
    rows,
    rateRows,
    customers,
    before,
    after,
    // Positive = money saved per month across the company (customer cost + bench, net of billing change).
    netMonthlyINR: before.costINR + before.benchCostINR - (after.costINR + after.benchCostINR) + (after.revenueINR - before.revenueINR),
    overAllocated,
    changes: rows.filter((r) => !r.released).length + Object.values(released).filter(Boolean).length + rateRows.length,
  };
}

// --- Combining scenario parts -------------------------------------------------------------
// A "part" is a partial scenario ({ alloc, released, added, rates }). Levers, plans and the
// user's manual edits are all parts; merge() combines them (later parts win on conflicts).
export function merge(parts) {
  const out = { alloc: {}, released: {}, added: [], rates: {} };
  for (const p of parts) {
    if (!p) continue;
    for (const [k, v] of Object.entries(p.alloc || {})) out.alloc[k] = { ...out.alloc[k], ...v };
    for (const [k, v] of Object.entries(p.released || {})) if (v) out.released[k] = true;
    for (const a of p.added || []) out.added.push(a);
    for (const [k, v] of Object.entries(p.rates || {})) out.rates[k] = v;
  }
  return out;
}

// Split a scenario into one part per individual change, so each can be measured on its own.
export function splitParts(model, sc, prefix = 'm') {
  const emp = new Map((model.employees || []).map((e) => [e.empId, e]));
  const cust = new Map(model.customers.map((c) => [c.code, c]));
  const items = [];
  for (const [key, v] of Object.entries(sc.alloc || {})) {
    const [code, empId] = key.split('|');
    const what = [v.utilPct != null ? `time → ${v.utilPct}%` : null, v.billable != null ? (v.billable ? 'billable' : 'not billable') : null].filter(Boolean).join(', ');
    items.push({ id: `${prefix}:alloc:${key}`, label: `${emp.get(empId)?.name || empId} on ${cust.get(code)?.name || code}: ${what}`, part: { alloc: { [key]: v } } });
  }
  for (const id of Object.keys(sc.released || {}).filter((k) => sc.released[k]))
    items.push({ id: `${prefix}:rel:${id}`, label: `Release ${emp.get(id)?.name || id}`, part: { released: { [id]: true } } });
  for (const a of sc.added || [])
    items.push({ id: `${prefix}:add:${a.id}`, label: `Assign ${emp.get(a.empId)?.name || a.empId} to ${cust.get(a.code)?.name || a.code} at ${a.utilPct}%${a.billable ? ', billable' : ''}`, part: { added: [a] } });
  for (const [code, pct] of Object.entries(sc.rates || {}))
    if (pct) items.push({ id: `${prefix}:rate:${code}`, label: `${cust.get(code)?.name || code}: rate ${pct > 0 ? '+' : ''}${pct}%`, part: { rates: { [code]: pct } } });
  return items;
}

// How much each item contributes: 'alone' (only that item) and 'inCombination' (the combined
// result minus the result without it). Sorted by contribution.
export function contributions(model, items) {
  const all = simulate(model, merge(items.map((i) => i.part)));
  return items
    .map((it, idx) => {
      const alone = simulate(model, merge([it.part]));
      const without = simulate(model, merge(items.filter((_, j) => j !== idx).map((i) => i.part)));
      return {
        ...it,
        aloneINR: alone.netMonthlyINR,
        inCombinationINR: all.netMonthlyINR - without.netMonthlyINR,
        marginPts: ((all.after.margin ?? 0) - (without.after.margin ?? 0)) * 100,
        gapChangeINR: all.after.gapINR - without.after.gapINR,
      };
    })
    .sort((a, b) => b.inCombinationINR - a.inCombinationINR || a.gapChangeINR - b.gapChangeINR);
}

// Estimated PM figures before/after, using each customer's PM split (as the PMs tab does).
export function pmRollup(model, sim) {
  const after = new Map(sim.customers.map((c) => [c.code, c]));
  return model.pms
    .filter((p) => p.customers)
    .map((pm) => {
      const acc = { before: { rev: 0, cost: 0, gap: 0 }, after: { rev: 0, cost: 0, gap: 0 } };
      for (const c of model.customers.filter((x) => x.pmIds.includes(pm.id))) {
        const split = c.pmSplit.find((x) => x.pmId === pm.id);
        const rs = split ? split.revenueShare : 1 / c.pmIds.length;
        const cs = split && c.computedCostINR > 0 ? split.costShare : rs;
        const a = after.get(c.code);
        for (const side of ['before', 'after']) {
          acc[side].rev += a[side].revenueINR * rs;
          acc[side].cost += a[side].costINR * cs;
          acc[side].gap += a[side].gapINR * cs;
        }
      }
      const m = (x) => (x.rev > 0 ? (x.rev - x.cost) / x.rev : null);
      return { id: pm.id, name: pm.name, before: { ...acc.before, margin: m(acc.before) }, after: { ...acc.after, margin: m(acc.after) } };
    });
}
