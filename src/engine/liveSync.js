// Moving between the monthly model and the live allocation tables (step 4). Pure.
//
// modelToLive(model)       -> rows for people, salaries, allocations, revenue (seed / monthly sync)
// liveToRaw(live, raw, m)  -> raw exports with employees + bench rebuilt from live allocations,
//                             so buildModel works unchanged once the app is the source
// diffAllocations(m, live) -> portal export vs app allocations (the monthly cross-check)

const first = (name) => String(name || '').split(' ')[0];

export function modelToLive(model) {
  const pmByName = new Map(model.pms.map((p) => [p.name.toLowerCase(), p.id]));
  const benchPm = new Map(model.bench.map((b) => [b.empId, b.pmId]));
  const people = [];
  const salaries = [];
  for (const e of model.employees) {
    // Who holds this person's free time: bench list, else their reporting manager if a PM,
    // else the PM with most of their allocated time.
    const main = [...e.allocations].sort((a, b) => b.utilPct - a.utilPct)[0];
    const holder = benchPm.get(e.empId) || pmByName.get((e.reportingManager || '').toLowerCase()) || main?.ownerPm || null;
    people.push({
      emp_id: e.empId,
      name: e.name,
      email: e.email || null,
      designation: e.designation || '',
      category: e.category,
      skills: e.skills || '',
      experience_years: e.experienceYears ?? null,
      // A PM's own free time is their own bench, as the portal counts it.
      bench_pm: e.category === 'engineering' ? holder : e.category === 'pm' ? pmByName.get(e.name.toLowerCase()) || holder : null,
      active: !['leaving', 'exclude'].includes(e.category),
    });
    if (e.ctcMonthlyINR != null) salaries.push({ emp_id: e.empId, ctc_monthly_inr: e.ctcMonthlyINR });
  }
  for (const u of model.payOnly || []) {
    // Payroll-only people: kept for salaries and support cost; assignable only once classified.
    const cat = u.category || 'exclude';
    people.push({ emp_id: u.empId, name: u.name || u.empId, email: null, designation: '', category: cat, skills: '', experience_years: null, bench_pm: null, active: Boolean(u.category) && !['leaving', 'exclude'].includes(cat) });
    salaries.push({ emp_id: u.empId, ctc_monthly_inr: u.ctcMonthlyINR || 0 });
  }
  const allocations = [];
  for (const c of model.customers)
    for (const p of c.people)
      if (p.utilPct > 0)
        allocations.push({ id: `AL-${c.code}-${p.empId}-${allocations.length}`, emp_id: p.empId, customer_code: c.code, subproject: p.project, owner_pm: p.ownerPm || c.accountPm || null, util_pct: p.utilPct, billable: Boolean(p.billable) });
  const revenue = model.customers.map((c) => ({ code: c.code, name: c.name, revenue_inr: c.revenueINR || 0, revenue_usd: c.revenueUSD || 0 }));
  return { people, salaries, allocations, revenue, settings: { target: model.target, fx: model.fx, period: model.period } };
}

// live = { people, allocations } (as read from the database, admin view incl. salaries not needed)
export function liveToRaw(live, raw, model) {
  const pmName = new Map(model.pms.map((p) => [p.id, p.name]));
  const custName = new Map(model.customers.map((c) => [c.code, c.name]));
  const byEmp = new Map();
  for (const a of live.allocations) (byEmp.get(a.emp_id) || byEmp.set(a.emp_id, []).get(a.emp_id)).push(a);
  const employees = [];
  const bench = [];
  for (const p of live.people) {
    if (!p.active && !byEmp.has(p.emp_id)) continue;
    const base = { ID: p.emp_id, Name: p.name, Email: p.email || '', Designation: p.designation, 'Skill Set': p.skills, 'Year of Experience': p.experience_years ?? '', 'Reporting Manager': '' };
    const mine = byEmp.get(p.emp_id) || [];
    for (const a of mine)
      employees.push({
        ...base,
        'Allocated Projects': a.subproject || `${custName.get(a.customer_code) || a.customer_code}- ${first(pmName.get(a.owner_pm))}`,
        'Billing Code': a.customer_code,
        'Owner PM': a.owner_pm || '',
        'Project Utilization(%)': Number(a.util_pct),
        'Is Billable': a.billable ? 'Yes' : 'No',
      });
    const free = Math.max(0, 100 - mine.reduce((t, a) => t + Number(a.util_pct), 0));
    if ((p.category === 'engineering' || p.category === 'pm') && p.bench_pm && free > 0) {
      const project = `Global Bench- ${first(pmName.get(p.bench_pm))}`;
      employees.push({ ...base, 'Allocated Projects': project, 'Project Utilization(%)': free, 'Is Billable': 'No' });
      bench.push({ ID: p.emp_id, Name: p.name, Designation: p.designation, 'Project Name': project, 'Project Manager': pmName.get(p.bench_pm) || '', 'Allocation(%)': free, 'Year of Experience': p.experience_years ?? '', 'Skill Set': p.skills, 'Confirmed Relieving Date': '', 'Utilized salary': 0 });
    } else if (!mine.length) {
      employees.push({ ...base, 'Allocated Projects': '', 'Project Utilization(%)': 0, 'Is Billable': 'No' });
    }
  }
  // Keep relieving dates from the uploaded bench file where we have them.
  const relieving = new Map((raw.bench?.rows || []).map((b) => [String(b.ID).replace(/^0+(?=\d)/, ''), b['Confirmed Relieving Date']]));
  for (const b of bench) b['Confirmed Relieving Date'] = relieving.get(b.ID) || '';
  return {
    ...raw,
    employees: { file: 'Allocations managed in the app', sheetName: 'app', header: [], rows: employees },
    bench: { file: 'Bench from app allocations', sheetName: 'app', header: [], rows: bench },
  };
}

// Portal export (built model) vs app allocations, by person x customer.
export function diffAllocations(model, liveAllocations, people = []) {
  const name = new Map(people.map((p) => [p.emp_id, p.name]));
  const key = (e, c) => `${e}|${c}`;
  const portal = new Map();
  for (const c of model.customers)
    for (const p of c.people) {
      const k = key(p.empId, c.code);
      const x = portal.get(k) || { emp_id: p.empId, name: p.name, code: c.code, customer: c.name, util: 0, billable: false };
      x.util += p.utilPct;
      x.billable = x.billable || p.billable;
      portal.set(k, x);
    }
  const app = new Map();
  const custName = new Map(model.customers.map((c) => [c.code, c.name]));
  for (const a of liveAllocations) {
    const k = key(a.emp_id, a.customer_code);
    const x = app.get(k) || { emp_id: a.emp_id, name: name.get(a.emp_id) || a.emp_id, code: a.customer_code, customer: custName.get(a.customer_code) || a.customer_code, util: 0, billable: false };
    x.util += Number(a.util_pct);
    x.billable = x.billable || a.billable;
    app.set(k, x);
  }
  const out = [];
  for (const [k, p] of portal) {
    const a = app.get(k);
    if (!a) out.push({ kind: 'only-portal', ...p, portal: p.util, app: 0 });
    else if (Math.abs(a.util - p.util) > 0.5 || a.billable !== p.billable) out.push({ kind: 'different', ...p, portal: p.util, app: a.util, portalBillable: p.billable, appBillable: a.billable });
  }
  for (const [k, a] of app) if (!portal.has(k)) out.push({ kind: 'only-app', ...a, portal: 0, app: a.util });
  return out.sort((x, y) => x.customer.localeCompare(y.customer) || x.name.localeCompare(y.name));
}
