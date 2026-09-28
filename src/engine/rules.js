// Rules that turn a customer's numbers into findings and recommended actions.
// Every finding carries texts for two audiences:
//   detail  - for Matt and leadership; may mention salary-level amounts
//   pmText  - safe to show or send to PMs; never includes an individual's salary or cost
//   ask     - one-line, PM-safe request used in WhatsApp lists
export const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');
const pct = (n) => (n * 100).toFixed(1) + '%';

export function findingsForCustomer(c, { target }) {
  const out = [];
  const add = (f) => out.push({ ownerPmIds: c.pmIds, savingINR: 0, ...f, id: f.id || `${c.code}:${f.kind}` });
  const marginWith = (lessCost) => (c.revenueINR > 0 ? (c.revenueINR - (c.costINR - lessCost)) / c.revenueINR : null);
  const below = c.margin != null && c.margin < target;

  if (c.revenueINR <= 0 && c.costINR > 0) {
    add({
      kind: 'ZERO_REVENUE',
      severity: 'critical',
      title: 'Cost with no revenue',
      detail: `${inr(c.costINR)} cost this month and no revenue on the costing sheet.`,
      pmText: `No revenue is recorded for ${c.name} this month, but the team is still costing us.`,
      action: 'Confirm whether billing is missing (tell accounts) or plan to release/re-deploy the team.',
      ask: 'Confirm billing with accounts, or plan to release/re-deploy the team',
      savingINR: c.costINR,
    });
  }

  if (below) {
    const needRevenueINR = c.costINR / (1 - target);
    const upliftUSD = c.fx ? (needRevenueINR - c.revenueINR) / c.fx : null;
    add({
      kind: 'BELOW_TARGET',
      severity: c.margin < 0.5 ? 'critical' : c.margin < 0.6 ? 'high' : 'medium',
      title: `Margin ${pct(c.margin)} vs ${pct(target)} target`,
      detail: `Cost is ${inr(c.gapINR)}${c.gapUSD != null ? ` (${usd(c.gapUSD)})` : ''} a month above the ${pct(1 - target)} cost line.`,
      pmText: `${c.name} is at ${pct(c.margin)} margin against the ${pct(target)} target.`,
      action:
        `Cut monthly cost by ${inr(c.gapINR)}` +
        (upliftUSD != null ? `, or raise billing by about ${usd(upliftUSD)} a month, to reach ${pct(target)}.` : '.'),
      savingINR: c.gapINR,
      ask: `Bring margin to ${pct(target)}: cut ${inr(c.gapINR)}/month` + (upliftUSD != null ? ` or raise billing ~${usd(upliftUSD)}/month` : ''),
    });
  }

  // PMs' own time is management overhead, not a "release" candidate; handled separately below.
  const nonBillable = c.people.filter((p) => !p.billable && !p.isPm && p.costINR > 0);
  if (nonBillable.length) {
    const cost = nonBillable.reduce((a, p) => a + p.costINR, 0);
    const share = c.costINR > 0 ? cost / c.costINR : 0;
    add({
      kind: 'NON_BILLABLE',
      severity: below ? (share > 0.2 ? 'high' : 'medium') : 'low',
      title: `${nonBillable.length} non-billable ${nonBillable.length === 1 ? 'person' : 'people'} on the account`,
      detail:
        `${inr(cost)} a month (${pct(share)} of cost): ` +
        nonBillable.map((p) => `${p.name} (${p.designation}, ${p.utilPct}%)`).join(', ') +
        `. Billing or releasing them would take margin to ${pct(marginWith(cost) ?? 0)}.`,
      pmText:
        `Non-billable on ${c.name}: ` +
        nonBillable.map((p) => `${p.name} (${p.designation}, ${p.utilPct}%)`).join(', ') +
        '. Please confirm if each can be billed, reduced, or released.',
      action: 'Bill, reduce, or release each non-billable person.',
      ask: `Bill, reduce or release: ${nonBillable.map((p) => p.name).join(', ')}`,
      savingINR: cost,
      ownerPmIds: uniq(nonBillable.map((p) => p.ownerPm)),
    });
  } else if (below && c.allocated > c.billable) {
    add({
      kind: 'SEAT_GAP',
      severity: 'medium',
      title: `${fmtCount(c.allocated - c.billable)} more allocated than billed`,
      detail: `${c.allocated} resources allocated, ${c.billable} billed.`,
      pmText: `${c.name} has ${c.allocated} people allocated but ${c.billable} billed.`,
      action: 'Match allocation to billed seats, or get the extra seats billed.',
      ask: `Match ${c.allocated} allocated to ${c.billable} billed, or get the extra billed`,
    });
  }

  const pmTime = c.people.filter((p) => p.isPm && !p.billable && p.costINR > 0);
  const pmCost = pmTime.reduce((a, p) => a + p.costINR, 0);
  if (below && c.costINR > 0 && pmCost / c.costINR > 0.15) {
    add({
      kind: 'PM_OVERHEAD',
      severity: 'medium',
      title: `High non-billable PM time`,
      detail: `${inr(pmCost)} a month (${pct(pmCost / c.costINR)} of cost) of non-billable PM time: ` + pmTime.map((p) => `${p.name} (${p.utilPct}%)`).join(', ') + '.',
      pmText: `Non-billable PM time is a large share of cost on ${c.name} (${pmTime.map((p) => `${p.name} ${p.utilPct}%`).join(', ')}). Can it be reduced or billed?`,
      action: 'Reduce PM allocation on this account, or bill PM time as a seat.',
      ask: 'Reduce non-billable PM time, or bill it as a seat',
      savingINR: pmCost,
      ownerPmIds: uniq(pmTime.map((p) => p.ownerPm)),
    });
  }

  if (below && c.revenueINR > 0) {
    const drivers = c.people.filter((p) => p.costINR > 0.25 * c.revenueINR);
    for (const p of drivers.slice(0, 2)) {
      add({
        kind: 'COST_DRIVER',
        id: `${c.code}:COST_DRIVER:${p.empId}`,
        severity: 'high',
        title: `${p.name} is the biggest cost driver`,
        detail: `${p.name} (${p.designation}, ${p.utilPct}% here) costs ${inr(p.costINR)} a month on this account (${pct(p.costINR / c.revenueINR)} of revenue); CTC ${inr(p.ctcMonthlyINR)}.`,
        pmText: `${p.name} (${p.designation}, ${p.utilPct}% on ${c.name}) is the biggest cost driver on this account.`,
        action: 'Review whether this role/seniority matches the billed seat; consider a swap or a rate review.',
        ask: `Review ${p.name}'s role vs the billed seat (swap or rate review)`,
        ownerPmIds: uniq([p.ownerPm]),
      });
    }
  }

  const thin = c.people.filter((p) => p.utilPct > 0 && p.utilPct <= 10);
  if (below && thin.length >= 3) {
    add({
      kind: 'THIN_SLICES',
      severity: 'low',
      title: `${thin.length} people with ≤10% time here`,
      detail: `${inr(thin.reduce((a, p) => a + p.costINR, 0))} a month in small slices: ${thin.map((p) => p.name).join(', ')}.`,
      pmText: `${thin.length} people have 10% or less time on ${c.name} (${thin.map((p) => p.name).join(', ')}). Can this be consolidated?`,
      action: 'Consolidate small allocations onto fewer people.',
      ask: `Consolidate ${thin.length} small (≤10%) allocations`,
      ownerPmIds: uniq(thin.map((p) => p.ownerPm)),
    });
  }

  if (c.invoicing) {
    // Revenue already uses the invoiced amount; flag when the costing sheet says otherwise.
    const diff = c.costingRevenueUSD - c.invoicing.amountUSD;
    if (Math.abs(diff) > Math.max(1, 0.01 * c.invoicing.amountUSD)) {
      add({
        kind: 'INVOICE_MISMATCH',
        severity: 'medium',
        title: `Costing sheet shows ${usd(c.costingRevenueUSD)}, invoiced ${usd(c.invoicing.amountUSD)}`,
        detail:
          `Margins here use the invoiced ${usd(c.invoicing.amountUSD)}. The costing sheet is ${usd(Math.abs(diff))} ${diff > 0 ? 'higher' : 'lower'}` +
          `${diff > 0 ? ' (possibly an invoice counted on more than one customer)' : ''}; get it corrected in the portal.`,
        pmText: `The costing sheet revenue for ${c.name} doesn't match what was invoiced this month; margins here use the invoiced amount.`,
        action: 'Reconcile with accounts and get the costing sheet corrected.',
        ask: 'Confirm this month’s billing for this customer with accounts',
        ownerPmIds: c.accountPm ? [c.accountPm] : c.pmIds,
      });
    }
    if (c.invoicing.diffAmountUSD < 0) {
      add({
        kind: 'BILLING_DROP',
        severity: 'medium',
        title: `Billing down ${usd(-c.invoicing.diffAmountUSD)} vs last month`,
        detail: `Seats ${c.invoicing.diffSeats >= 0 ? '+' : ''}${c.invoicing.diffSeats}; amount ${usd(c.invoicing.diffAmountUSD)} vs last month.`,
        pmText: `Billing for ${c.name} dropped by ${usd(-c.invoicing.diffAmountUSD)} vs last month. Has the team been reduced to match?`,
        action: 'Reduce the team to match the lower billing, or restore the billed seats.',
        ask: `Billing down ${usd(-c.invoicing.diffAmountUSD)}: reduce the team to match, or restore seats`,
        ownerPmIds: c.accountPm ? [c.accountPm] : c.pmIds,
      });
    }
  } else if (c.revenueUSD > 0) {
    add({
      kind: 'NOT_INVOICED',
      severity: 'medium',
      title: 'Not on the invoicing sheet',
      detail: `${usd(c.revenueUSD)} revenue in costing, but no invoicing line with this billing code.`,
      pmText: `${c.name} isn't on this month's invoicing sheet.`,
      action: 'Check with accounts that this customer was invoiced.',
      ask: 'Confirm this customer was invoiced',
    });
  }

  const noSalary = c.people.filter((p) => p.ctcMonthlyINR == null);
  if (noSalary.length) {
    add({
      kind: 'MISSING_SALARY',
      severity: 'low',
      title: `${noSalary.length} allocated ${noSalary.length === 1 ? 'person' : 'people'} not on the paysheet`,
      detail: noSalary.map((p) => p.name).join(', '),
      pmText: null,
      action: 'Update the paysheet export.',
      ownerPmIds: [],
    });
  }

  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

const uniq = (a) => [...new Set(a.filter(Boolean))];
const fmtCount = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
