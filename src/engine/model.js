// Pure: turns the raw exports into the costing model the app renders.
// No file or network access here so it can run in Node (import) and in tests.
import { num, text, code, empId, email, yes, role, projectSuffix, isBenchProject } from './normalize.js';
import { findingsForCustomer } from './rules.js';

export const DEFAULT_TARGET = 0.7;

export function buildModel(raw, { target = DEFAULT_TARGET, generatedAt = new Date().toISOString() } = {}) {
  const need = ['summary', 'employees', 'projects', 'paysheet', 'invoicing'];
  const missing = need.filter((k) => !raw[k]);
  if (missing.length) throw new Error(`Missing exports in inbox: ${missing.join(', ')}`);

  const employeesRows = raw.employees.rows;
  const empByEmail = new Map();
  const empByName = new Map();
  for (const e of employeesRows) {
    if (email(e.Email)) empByEmail.set(email(e.Email), e);
    if (text(e.Name)) empByName.set(text(e.Name).toLowerCase(), e);
  }

  // --- PM directory: invoicing file is the source of names + emails -----------------
  const pms = new Map(); // id -> pm
  const pmIdByName = new Map(); // lower full name -> id
  const summaryPmNames = new Set();
  for (const s of raw.summary.rows)
    for (const n of text(s['Project Manager']).split(',').map(text).filter(Boolean)) summaryPmNames.add(n);

  const addPm = (pm) => {
    pms.set(pm.id, pm);
    pmIdByName.set(pm.name.toLowerCase(), pm.id);
    return pm;
  };

  for (const inv of raw.invoicing.rows) {
    const mail = email(inv.PM);
    if (!mail || pms.has(mail)) continue;
    const emp = empByEmail.get(mail);
    // Fall back to matching the email's local part against names in the costing sheet
    // (e.g. kiranj@ -> "Kiran R Joshi").
    const name =
      (emp && text(emp.Name)) ||
      [...summaryPmNames].find((n) => mail.startsWith(n.split(' ')[0].toLowerCase())) ||
      mail.split('@')[0];
    addPm({ id: mail, name, email: mail, source: 'invoicing', whatsapp: null });
  }
  // Co-PMs named in the costing sheet but not owning any invoice line.
  for (const n of summaryPmNames) {
    if (pmIdByName.has(n.toLowerCase())) continue;
    const emp = empByName.get(n.toLowerCase());
    const mail = emp ? email(emp.Email) : '';
    addPm({ id: mail || `name:${n.toLowerCase()}`, name: n, email: mail || null, source: 'costing-sheet', whatsapp: null });
  }

  const pmByFirstName = (first) => {
    const f = text(first).toLowerCase();
    if (!f) return null;
    const hits = [...pms.values()].filter((p) => {
      const pf = p.name.split(' ')[0].toLowerCase();
      return pf === f || pf.startsWith(f) || f.startsWith(pf);
    });
    return hits.length === 1 ? hits[0].id : null;
  };

  // --- Invoicing by billing code ------------------------------------------------------
  const invKeys = Object.keys(raw.invoicing.rows[0] || {});
  const amountKey = invKeys.find((k) => / Amount$/.test(k) && !/^Diff/i.test(k));
  const countKey = amountKey ? amountKey.replace(/ Amount$/, '') : null;
  const invoicing = new Map();
  for (const inv of raw.invoicing.rows) {
    const c = code(inv['Project Code']);
    if (!c) continue;
    const cur = invoicing.get(c) || { amountUSD: 0, seats: 0, diffAmountUSD: 0, diffSeats: 0, lines: [], owner: email(inv.PM) };
    cur.amountUSD += num(inv[amountKey]);
    cur.seats += num(inv[countKey]);
    cur.diffAmountUSD += num(inv['Diff. of Amount Sep & Aug'] ?? findDiff(inv, 'Amount'));
    cur.diffSeats += num(inv['Diff. of Count Sep & Aug'] ?? findDiff(inv, 'Count'));
    cur.lines.push(text(inv['Customer Name']));
    invoicing.set(c, cur);
  }

  // --- Seats & rates per sub-project (Customer- PM) ----------------------------------
  const subprojects = new Map(); // name -> {name, code, ownerPm, seats[]}
  let current = null;
  for (const r of raw.projects.rows) {
    if (text(r[0])) {
      current = { name: text(r[0]), code: code(r[1]), totalResources: num(r[2]), seats: [], suffix: projectSuffix(r[0]) };
      subprojects.set(current.name, current);
    }
    if (!current || r[3] == null) continue;
    current.seats.push({ role: role(r[3]), count: num(r[4]), rateUSD: num(r[5]) });
  }

  // --- Salaries -------------------------------------------------------------------------
  const pay = new Map();
  for (const p of raw.paysheet.rows) pay.set(empId(p.ID), { base: num(p['Base Salary']), incentive: num(p['Incentive Amount']), ctc: num(p.CTC) });

  // --- Allocations: one row per person per project ------------------------------------
  const allocations = [];
  const unknownProjects = new Set();
  const noPay = new Map();
  for (const e of employeesRows) {
    const project = text(e['Allocated Projects']);
    if (!project) continue;
    const sp = subprojects.get(project);
    const id = empId(e.ID);
    const salary = pay.get(id);
    if (!salary) noPay.set(id || text(e.Name), { id, name: text(e.Name), designation: text(e.Designation), project });
    if (!sp && !isBenchProject(project)) unknownProjects.add(project);
    const util = num(e['Project Utilization(%)']);
    allocations.push({
      empId: id,
      name: text(e.Name),
      email: email(e.Email),
      designation: role(e.Designation),
      reportingManager: text(e['Reporting Manager']),
      project,
      code: sp ? sp.code : '',
      bench: isBenchProject(project),
      suffix: projectSuffix(project),
      utilPct: util,
      billable: yes(e['Is Billable']),
      ctcMonthlyINR: salary ? salary.ctc : null,
      costINR: salary ? (salary.ctc * util) / 100 : 0,
    });
  }

  // --- Customers ------------------------------------------------------------------------
  const customers = raw.summary.rows
    .filter((s) => text(s['Project Name']))
    .map((s) => {
      const c = code(s['Billing Code']);
      const revenueUSD = num(s['Revenue USD']);
      const revenueINR = num(s['Revenue INR']);
      const costINR = num(s['Cost INR']);
      const inv = invoicing.get(c) || null;
      const pmIds = text(s['Project Manager'])
        .split(',')
        .map(text)
        .filter(Boolean)
        .map((n) => pmIdByName.get(n.toLowerCase()))
        .filter(Boolean);
      const accountPm = inv && pms.has(inv.owner) ? inv.owner : pmIds[0] || null;

      const people = allocations.filter((a) => a.code === c && !a.bench);
      const subs = [...subprojects.values()].filter((sp) => sp.code === c);
      const ownerOf = (suffix) => pmByFirstName(suffix) || accountPm;

      // Split this customer's cost (and an estimated revenue share) across its PMs.
      const byPm = new Map();
      const slot = (id) => {
        if (!byPm.has(id)) byPm.set(id, { pmId: id, costINR: 0, people: 0, seatValueUSD: 0, subprojects: [] });
        return byPm.get(id);
      };
      for (const sp of subs) {
        const s = slot(ownerOf(sp.suffix));
        s.subprojects.push(sp.name);
        s.seatValueUSD += sp.seats.reduce((a, x) => a + x.count * x.rateUSD, 0);
      }
      for (const p of people) {
        const s = slot(ownerOf(p.suffix));
        s.costINR += p.costINR;
        s.people += 1;
      }
      for (const id of pmIds) slot(id);
      const totalSeatValue = [...byPm.values()].reduce((a, x) => a + x.seatValueUSD, 0);
      const computedCostINR = people.reduce((a, p) => a + p.costINR, 0);
      const pmSplit = [...byPm.values()]
        .filter((x) => x.pmId)
        .map((x) => ({
          ...x,
          revenueShare: totalSeatValue > 0 ? x.seatValueUSD / totalSeatValue : 1 / byPm.size,
          costShare: computedCostINR > 0 ? x.costINR / computedCostINR : 0,
        }));

      const fx = revenueUSD > 0 ? revenueINR / revenueUSD : null;
      const customer = {
        code: c,
        name: text(s['Project Name']),
        pmIds: [...new Set([...pmIds, ...pmSplit.map((x) => x.pmId)])],
        accountPm,
        revenueUSD,
        revenueINR,
        costINR,
        fx,
        margin: revenueINR > 0 ? (revenueINR - costINR) / revenueINR : null,
        belowTarget: revenueINR > 0 ? (revenueINR - costINR) / revenueINR < target : costINR > 0,
        gapINR: Math.max(0, costINR - (1 - target) * revenueINR),
        billable: num(s['Billabel Resources']),
        allocated: num(s['Resources Allocated']),
        computedCostINR,
        reconciliation: costINR > 0 ? computedCostINR / costINR : null,
        invoicing: inv && { amountUSD: inv.amountUSD, seats: inv.seats, diffAmountUSD: inv.diffAmountUSD, diffSeats: inv.diffSeats, lines: inv.lines },
        seats: subs.flatMap((sp) => sp.seats.map((x) => ({ ...x, subproject: sp.name }))),
        pmSplit,
        people: people
          .map(({ empId, name, designation, project, utilPct, billable, ctcMonthlyINR, costINR, suffix }) => ({
            empId,
            name,
            isPm: pmIdByName.has(name.toLowerCase()),
            designation,
            project,
            ownerPm: ownerOf(suffix),
            utilPct,
            billable,
            ctcMonthlyINR,
            costINR,
          }))
          .sort((a, b) => b.costINR - a.costINR),
      };
      customer.gapUSD = fx ? customer.gapINR / fx : null;
      customer.findings = findingsForCustomer(customer, { target });
      return customer;
    });

  // --- Bench ----------------------------------------------------------------------------
  const bench = (raw.bench?.rows || [])
    .filter((b) => text(b.Name))
    .map((b) => {
      const pmName = text(b['Project Manager']);
      const pmId = pmIdByName.get(pmName.toLowerCase()) || pmByFirstName(projectSuffix(b['Project Name']));
      return {
        empId: empId(b.ID),
        name: text(b.Name),
        designation: role(b.Designation),
        pmId,
        pmName,
        allocPct: num(b['Allocation(%)']),
        experienceYears: num(b['Year of Experience']),
        skills: text(b['Skill Set']),
        relievingDate: text(b['Confirmed Relieving Date']) || null,
        costINR: num(b['Utilized salary']),
      };
    })
    .sort((a, b) => b.costINR - a.costINR);

  // --- PM roll-up -----------------------------------------------------------------------
  const pmList = [...pms.values()].map((pm) => {
    const mine = customers.filter((c) => c.pmIds.includes(pm.id));
    let revenueINR = 0;
    let costINR = 0;
    let gapINR = 0;
    for (const c of mine) {
      const split = c.pmSplit.find((x) => x.pmId === pm.id);
      const revShare = split ? split.revenueShare : 1 / c.pmIds.length;
      const costShare = c.computedCostINR > 0 && split ? split.costShare : revShare;
      revenueINR += c.revenueINR * revShare;
      costINR += c.costINR * costShare;
      gapINR += c.gapINR * costShare;
    }
    const myBench = bench.filter((b) => b.pmId === pm.id);
    return {
      ...pm,
      customerCodes: mine.map((c) => c.code),
      accountOwnerOf: mine.filter((c) => c.accountPm === pm.id).map((c) => c.code),
      customers: mine.length,
      belowTarget: mine.filter((c) => c.belowTarget).length,
      criticalFindings: mine.reduce((a, c) => a + c.findings.filter((f) => f.severity === 'critical').length, 0),
      estRevenueINR: revenueINR,
      estCostINR: costINR,
      estMargin: revenueINR > 0 ? (revenueINR - costINR) / revenueINR : null,
      gapINR,
      benchPeople: myBench.length,
      benchCostINR: myBench.reduce((a, b) => a + b.costINR, 0),
    };
  });

  // --- Totals & data quality ------------------------------------------------------------
  const sum = (arr, k) => arr.reduce((a, x) => a + (x[k] || 0), 0);
  const revenueINR = sum(customers, 'revenueINR');
  const costINR = sum(customers, 'costINR');
  const benchCostINR = sum(bench, 'costINR');
  const fxRows = customers.filter((c) => c.fx);
  const summaryCodes = new Set(customers.map((c) => c.code));

  return {
    generatedAt,
    period: raw.summary.sheetName,
    target,
    fx: fxRows.length ? sum(fxRows, 'revenueINR') / sum(fxRows, 'revenueUSD') : null,
    sources: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.file])),
    totals: {
      customers: customers.length,
      revenueINR,
      revenueUSD: sum(customers, 'revenueUSD'),
      costINR,
      margin: revenueINR > 0 ? (revenueINR - costINR) / revenueINR : null,
      belowTarget: customers.filter((c) => c.belowTarget).length,
      gapINR: sum(customers, 'gapINR'),
      benchPeople: bench.length,
      benchCostINR,
      marginAfterBench: revenueINR > 0 ? (revenueINR - costINR - benchCostINR) / revenueINR : null,
      computedCostINR: sum(customers, 'computedCostINR'),
    },
    customers: customers.sort((a, b) => b.gapINR - a.gapINR),
    pms: pmList.sort((a, b) => b.gapINR - a.gapINR),
    bench,
    dataQuality: {
      employeesWithoutSalary: [...noPay.values()],
      unknownProjects: [...unknownProjects],
      invoicedNotInCosting: [...invoicing.entries()]
        .filter(([c]) => !summaryCodes.has(c))
        .map(([c, v]) => ({ code: c, lines: v.lines, amountUSD: v.amountUSD })),
      costingNotInvoiced: customers.filter((c) => !c.invoicing).map((c) => ({ code: c.code, name: c.name })),
      pmsWithoutEmail: pmList.filter((p) => !p.email).map((p) => p.name),
    },
  };
}

function findDiff(row, kind) {
  const k = Object.keys(row).find((x) => /^Diff/i.test(x) && x.includes(kind));
  return k ? row[k] : 0;
}
