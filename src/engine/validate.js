// Automatic checks for each uploaded dataset, shown to Matt before he validates it.
// Pure: (raw datasets, built model) -> { [kind]: { label, file, rows, facts[], checks[] } }.
// check.level: 'error' (must be fixed or knowingly accepted), 'warning' (review), 'info'.
import { KIND_LABEL, REQUIRED_KINDS } from './kinds.js';
import { code as cleanCode, empId as cleanId, num, text } from './normalize.js';

const inr = (n) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString('en-IN')}`);
const usd = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const dupes = (arr) => [...new Set(arr.filter((x, i) => x && arr.indexOf(x) !== i))];

export function validateInputs(raw, model) {
  const out = {};
  const add = (kind, facts, checks) => {
    out[kind] = { kind, label: KIND_LABEL[kind], file: raw[kind]?.file || null, rows: raw[kind]?.rows?.length || 0, facts, checks };
  };
  for (const k of REQUIRED_KINDS)
    if (!raw[k]) add(k, [], [{ level: 'error', text: `${KIND_LABEL[k]} has not been uploaded.` }]);
  if (!model) return out;
  const dq = model.dataQuality;
  const t = model.totals;
  const summaryCodes = new Set(model.customers.map((c) => c.code));

  if (raw.summary) {
    const codes = raw.summary.rows.map((r) => cleanCode(r['Billing Code']));
    const noCode = raw.summary.rows.filter((r) => text(r['Project Name']) && !cleanCode(r['Billing Code']));
    add('summary', [`${model.customers.length} customers`, `Period: ${model.period}`, `Costing-sheet revenue ${usd(t.costingRevenueUSD)}`, `Costing-sheet cost ${inr(t.sheetCostINR)}`], [
      ...(dupes(codes).length ? [{ level: 'error', text: `${dupes(codes).length} billing codes appear more than once`, items: dupes(codes) }] : []),
      ...(noCode.length ? [{ level: 'error', text: `${noCode.length} customers have no billing code`, items: noCode.map((r) => text(r['Project Name'])) }] : []),
      ...(t.revenueMismatches ? [{ level: 'warning', text: `${t.revenueMismatches} customers' revenue differs from invoicing (invoiced amount is used)` }] : []),
    ]);
  }

  if (raw.employees) {
    const over = model.employees.filter((e) => e.allocatedPct + e.benchPct > 100.5);
    const idle = model.employees.filter((e) => !e.allocations.length && !e.benchPct && e.category !== 'support');
    add('employees', [`${model.employees.length} people`, `${raw.employees.rows.length} allocation rows`], [
      ...(dq.employeesWithoutSalary.length ? [{ level: 'warning', text: `${dq.employeesWithoutSalary.length} allocated people are not on payroll (no spend counted)`, items: dq.employeesWithoutSalary.map((e) => `${e.name} · ${e.project}`) }] : []),
      ...(over.length ? [{ level: 'error', text: `${over.length} people are allocated over 100%`, items: over.map((e) => `${e.name} (${Math.round(e.allocatedPct + e.benchPct)}%)`) }] : []),
      ...(dq.unknownProjects.length ? [{ level: 'warning', text: `${dq.unknownProjects.length} projects in allocations have no seat data`, items: dq.unknownProjects }] : []),
      ...(idle.length ? [{ level: 'info', text: `${idle.length} engineers/PMs have no allocation and no bench`, items: idle.map((e) => `${e.name} (${e.designation})`) }] : []),
    ]);
  }

  if (raw.projects) {
    const codes = new Set(raw.projects.rows.map((r) => cleanCode(r[1])).filter(Boolean));
    const notInCosting = [...codes].filter((c) => !summaryCodes.has(c));
    const noRole = raw.projects.rows.filter((r) => r[3] == null && num(r[4]) > 0).length;
    add('projects', [`${raw.projects.rows.filter((r) => text(r[0])).length} projects`, `${codes.size} billing codes`], [
      ...(noRole ? [{ level: 'warning', text: `${noRole} seat rows have no resource type` }] : []),
      ...(notInCosting.length ? [{ level: 'info', text: `${notInCosting.length} billing codes have seats but aren't on this month's costing sheet (inactive or internal)` }] : []),
    ]);
  }

  if (raw.paysheet) {
    const ids = raw.paysheet.rows.map((r) => cleanId(r.ID));
    const zero = raw.paysheet.rows.filter((r) => !(num(r.CTC) > 0));
    add('paysheet', [`${raw.paysheet.rows.length} people`, `Payroll ${inr(t.payrollINR)}/month`, ...(model.corrections?.salary ? [`${model.corrections.salary} salary corrections applied`] : [])], [
      ...(dupes(ids).length ? [{ level: 'error', text: `${dupes(ids).length} employee IDs appear more than once`, items: dupes(ids) }] : []),
      ...(zero.length ? [{ level: 'warning', text: `${zero.length} people have zero CTC`, items: zero.map((r) => `${text(r.NAME)} (${r.ID})`) }] : []),
      ...(model.unclassified.length
        ? [{ level: 'warning', text: `${model.unclassified.length} people (${inr(t.unclassifiedPayrollINR)}/month) are on payroll but not in the employee list: classify them`, action: 'classify' }]
        : []),
    ]);
  }

  if (raw.invoicing) {
    const notInCosting = dq.invoicedNotInCosting;
    add('invoicing', [`${raw.invoicing.rows.length} invoice lines`, `Invoiced ${usd(model.customers.reduce((a, c) => a + (c.invoicing?.amountUSD || 0), 0) + notInCosting.reduce((a, x) => a + x.amountUSD, 0))}`, ...(model.corrections?.revenue ? [`${model.corrections.revenue} revenue corrections applied`] : [])], [
      ...(notInCosting.length ? [{ level: 'warning', text: `${notInCosting.length} invoiced codes aren't on the costing sheet (their revenue isn't counted)`, items: notInCosting.map((x) => `${x.lines.join('; ')} · ${usd(x.amountUSD)}`) }] : []),
      ...(dq.costingNotInvoiced.length ? [{ level: 'warning', text: `${dq.costingNotInvoiced.length} customers have no invoicing line (costing-sheet revenue used)`, items: dq.costingNotInvoiced.map((x) => x.name) }] : []),
    ]);
  }

  if (raw.bench) {
    const notOnPay = model.bench.filter((b) => !model.employees.find((e) => e.empId === b.empId)?.ctcMonthlyINR);
    const fileTotal = model.bench.reduce((a, b) => a + (b.fileCostINR || 0), 0);
    add('bench', [`${model.bench.length} people on bench`, `Bench spend ${inr(t.benchCostINR)}/month (payroll)`], [
      ...(notOnPay.length ? [{ level: 'warning', text: `${notOnPay.length} bench people are not on payroll`, items: notOnPay.map((b) => b.name) }] : []),
      ...(Math.abs(fileTotal - t.benchCostINR) > 0.05 * t.benchCostINR ? [{ level: 'info', text: `The bench file's own salary total is ${inr(fileTotal)} vs ${inr(t.benchCostINR)} from payroll` }] : []),
    ]);
  }
  return out;
}

export const summarizeChecks = (v) => ({
  errors: v.checks.filter((c) => c.level === 'error').length,
  warnings: v.checks.filter((c) => c.level === 'warning').length,
});
