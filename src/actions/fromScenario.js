// Turns a what-if scenario (engine/scenario.js simulate() output) into proposed actions.
// Everything written here reaches PMs, so no salary, per-person cost, or before/after
// margins (one change's margin effect would reveal that person's cost). The estimated
// saving goes in savingINR, which is stored in the admin-only action_savings table.
import { defaultDue } from './logic.js';

const who = (r) => `${r.name} (${r.designation})`;

function describe(r) {
  const { from, to } = r;
  const time = from.utilPct !== to.utilPct;
  const bill = from.billable !== to.billable;
  if (to.utilPct === 0) return { title: `Take ${who(r)} off ${r.customer} (${from.utilPct}% → 0%)`, ask: `Take ${r.name} off ${r.customer}` };
  const parts = [];
  if (bill) parts.push(to.billable ? 'bill' : 'stop billing');
  if (time) parts.push(`${to.utilPct < from.utilPct ? 'reduce' : 'increase'} time ${from.utilPct}% → ${to.utilPct}%`);
  const verb = parts.join(' and ');
  const title = `${verb[0].toUpperCase()}${verb.slice(1)}: ${who(r)} on ${r.customer}`;
  return { title, ask: `${verb[0].toUpperCase()}${verb.slice(1)} for ${r.name} on ${r.customer}` };
}

// Returns [{ id, kind: 'change' | 'release', input (for newAction), saving }].
export function scenarioActions(model, sim, scenario) {
  const target = model.target;
  const custByCode = new Map(model.customers.map((c) => [c.code, c]));
  const out = [];

  for (const r of sim.rows.filter((x) => !x.released)) {
    const c = custByCode.get(r.code);
    const { title, ask } = describe(r);
    const severity = c?.belowTarget ? 'high' : 'medium';
    out.push({
      id: `scenario:${r.key}`,
      kind: 'change',
      input: {
        customerCode: r.code,
        customerName: r.customer,
        findingId: `scenario:${r.key}`,
        kind: 'SCENARIO',
        severity,
        title,
        ask,
        description: `Proposed from a costing review of ${r.customer}${c?.belowTarget ? `, which is below the ${Math.round(target * 100)}% target` : ''}. Please confirm this change can be made, or reply with what's blocking it.`,
        ownerPmId: r.ownerPm,
        dueDate: defaultDue(severity),
        savingINR: Math.max(0, -r.dCostINR + r.dRevenueINR),
        period: model.period,
      },
    });
  }

  const empById = new Map((model.employees || []).map((e) => [e.empId, e]));
  const benchPm = new Map(model.bench.map((b) => [b.empId, b.pmId]));
  for (const id of Object.keys(scenario.released || {}).filter((k) => scenario.released[k])) {
    const e = empById.get(id);
    if (!e) continue;
    // Owner: the PM with most of their time, else their bench PM.
    const main = [...e.allocations].sort((a, b) => b.utilPct - a.utilPct)[0];
    const owner = main?.ownerPm || benchPm.get(id);
    const code = main?.code || (model.customers.find((c) => c.pmIds.includes(owner)) || {}).code;
    if (!owner || !code) continue;
    const accounts = e.allocations.map((a) => a.customer).join(', ');
    out.push({
      id: `scenario:release:${id}`,
      kind: 'release',
      input: {
        customerCode: code,
        customerName: main?.customer || 'Bench',
        findingId: `scenario:release:${id}`,
        kind: 'SCENARIO_RELEASE',
        severity: 'high',
        title: `Plan release or redeployment of ${e.name} (${e.designation})`,
        ask: `Plan release or billable redeployment of ${e.name}`,
        description: `Proposed from a costing review. ${e.name} is on ${accounts || 'bench'}. Please plan a handover and confirm a release date, or propose billable work instead.`,
        ownerPmId: owner,
        dueDate: defaultDue('high'),
        savingINR: e.ctcMonthlyINR || 0,
        period: model.period,
      },
    });
  }
  return out;
}
