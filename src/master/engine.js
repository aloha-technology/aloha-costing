// Master data: one view of customers, employees and PMs built from what each app already has.
// Pure JS. Imported values (HR export, payroll, portal) are the base; what Matt enters in Master
// data wins, and every merged field says where it came from so gaps are visible.
import { rateCard } from '../engine/ratecard.js';
import { nameTokens } from '../collections/engine/payments.js';
import { contactsFor, hasRole } from '../collections/engine/contacts.js';

const YEAR = 365.25 * 86400000;
const round1 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);
const has = (v) => v !== undefined && v !== null && v !== '';

export const TEAMS = ['Development', 'QA', 'Design', 'DevOps', 'Data & AI', 'Business Analysis', 'Project Management', 'Research', 'Support', 'Leadership', 'Other'];

// Best guess of the team from the designation; Matt can override it.
export function teamFromDesignation(designation = '', category = '') {
  const d = designation.toLowerCase();
  if (category === 'pm' || /project manager|program manager|delivery manager|scrum/.test(d)) return 'Project Management';
  if (/qa|test|quality/.test(d)) return 'QA';
  if (/design|ui\/ux|ux|graphic/.test(d)) return 'Design';
  if (/devops|cloud|infra|sysadmin|network/.test(d)) return 'DevOps';
  if (/data|ai\b|ml|machine learning|analytics|bi\b/.test(d)) return 'Data & AI';
  if (/business analyst|\bba\b/.test(d)) return 'Business Analysis';
  if (/research/.test(d)) return 'Research';
  if (/hr|admin|account|mis|finance|recruit|office/.test(d)) return 'Support';
  if (/director|head|vp|ceo|cto|coo|founder/.test(d)) return 'Leadership';
  if (/develop|engineer|lead|architect|programmer|coder/.test(d)) return 'Development';
  return category === 'support' ? 'Support' : 'Other';
}

// One employee: HR export + payroll (e = model employee) with Matt's entries (profile) on top.
export function employeeView(e, profile = {}, { on }) {
  const p = profile || {};
  const alohaYears = p.joined_on ? round1((Date.parse(on) - Date.parse(p.joined_on)) / YEAR) : null;
  const importedExp = e.experienceYears ?? null;
  // Total experience: entered > (entered prior + years at Aloha) > HR export.
  let priorYears = has(p.prior_experience_years) ? Number(p.prior_experience_years) : null;
  let totalExp = importedExp;
  let expSource = importedExp != null ? 'HR export' : null;
  if (has(p.experience_years)) (totalExp = Number(p.experience_years)), (expSource = 'entered');
  else if (priorYears != null && alohaYears != null) (totalExp = round1(priorYears + alohaYears)), (expSource = 'calculated');
  if (priorYears == null && totalExp != null && alohaYears != null) priorYears = round1(Math.max(0, totalExp - alohaYears));
  // Say so when the figures contradict each other instead of hiding it.
  let conflict = null;
  if (alohaYears != null && totalExp != null && alohaYears > totalExp + 0.5) conflict = `Total experience (${round1(totalExp)} yrs) is less than years at Aloha (${alohaYears})`;
  else if (expSource === 'calculated' && importedExp != null && Math.abs(importedExp - totalExp) > 1) conflict = `HR export says ${importedExp} yrs total; before + at Aloha gives ${round1(totalExp)}`;
  const guessedTeam = teamFromDesignation(e.designation, e.category);
  const allocs = (e.allocations || []).filter((a) => a.code);
  const view = {
    empId: e.empId,
    name: e.name,
    email: e.email,
    designation: e.designation,
    category: e.category,
    reportingManager: e.reportingManager,
    team: p.team || guessedTeam,
    teamSource: p.team ? 'entered' : 'from designation',
    skills: has(p.skills) ? p.skills : e.skills || '',
    skillsSource: has(p.skills) ? 'entered' : e.skills ? 'HR export' : null,
    totalExp: round1(totalExp),
    expSource,
    conflict,
    alohaYears,
    priorYears: round1(priorYears),
    joinedOn: p.joined_on || null,
    phone: p.phone || '',
    location: p.location || '',
    notes: p.notes || '',
    incentivePlan: p.incentive_plan || '',
    ctc: e.ctcMonthlyINR ?? null,
    base: e.baseMonthlyINR ?? null,
    incentive: e.incentiveMonthlyINR ?? null,
    allocatedPct: e.allocatedPct ?? allocs.reduce((s, a) => s + (a.utilPct || 0), 0),
    benchPct: e.benchPct || 0,
    projects: allocs.map((a) => ({ code: a.code, name: a.customer || a.project, utilPct: a.utilPct, billable: a.billable, ownerPm: a.ownerPm })),
    updatedBy: p.updated_by || null,
    updatedAt: p.updated_at || null,
  };
  view.missing = [conflict && 'experience check', !p.joined_on && 'joining date', !view.skills && 'skills', view.totalExp == null && 'experience', !p.team && 'team (guessed)'].filter(Boolean);
  return view;
}

// Billed seats come from the invoicing sheet; the portal's resource list counts everyone assigned
// (billable or not), so it is shown separately as "assigned".
export const billedSeats = (c) => (c?.invoicing?.seats != null ? Number(c.invoicing.seats) : (c?.seats || []).reduce((s, x) => s + x.count, 0));
export const assignedSeats = (c) => (c?.seats || []).reduce((s, x) => s + x.count, 0);

// Linked projects of an account: codes on the account, or its billing code list from the first setup.
export const projectCodesOf = (account) =>
  account.projectCodes?.length ? account.projectCodes : String(account.billingCode || '').split(',').map((x) => x.trim()).filter(Boolean);

// One customer account (who pays, from Collections) with its projects (from Costing).
export function accountView(account, { projectsByCode, master = {}, settings, on, pmsById = {} }) {
  const codes = projectCodesOf(account);
  const projects = codes.map((code) => {
    const c = projectsByCode[code];
    const profile = master.profiles?.[code] || {};
    const rc = c ? rateCard(c, master.rates?.[code] || {}, settings, on) : null;
    return {
      code,
      known: Boolean(c),
      name: c?.name || profile.name || code,
      pmIds: c?.pmIds || profile.pmIds || [],
      seats: round1(billedSeats(c)) || 0,
      assigned: assignedSeats(c),
      revenueUSD: c?.revenueUSD || 0,
      rateCard: rc,
      brief: profile.brief || '',
      technologies: profile.technologies || [],
    };
  });
  const pmIds = [...new Set(projects.flatMap((p) => p.pmIds))];
  const reviews = projects.filter((p) => p.rateCard).map((p) => ({ code: p.code, name: p.name, ...p.rateCard }));
  const dated = reviews.filter((r) => r.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const billed = reviews.reduce((s, r) => s + r.billedValueUSD, 0);
  const standard = reviews.reduce((s, r) => s + r.standardValueUSD, 0);
  const contacts = account.contacts || [];
  const v = {
    account,
    projects,
    pmIds,
    pms: pmIds.map((id) => pmsById[id]?.name || id),
    seats: round1(projects.reduce((s, p) => s + p.seats, 0)),
    assigned: projects.reduce((s, p) => s + p.assigned, 0),
    revenueUSD: projects.reduce((s, p) => s + p.revenueUSD, 0),
    discountVsStandard: standard > 0 ? 1 - billed / standard : null,
    specialDiscount: account.specialDiscount || null,
    nextRevision: dated[0] ? { date: dated[0].dueDate, status: dated[0].status, project: dated[0].name } : null,
    revisionStatus: dated.some((r) => r.status === 'due') ? 'due' : dated.some((r) => r.status === 'soon') ? 'soon' : reviews.length && dated.length === reviews.length ? 'ok' : reviews.length ? 'unknown' : null,
    billingContact: contactsFor(account, 'billing')[0] || null,
    invoiceTo: contactsFor(account, 'invoice'),
    taxInvoiceTo: contactsFor(account, 'tax_invoice'),
    amContact: contacts.find((c) => hasRole(c, 'am')) || null,
    signer: contacts.find((c) => hasRole(c, 'signer')) || null,
    campaigns: account.campaigns || [],
  };
  v.missing = [
    !v.billingContact && 'billing email',
    !contacts.some((c) => c.phone) && 'phone',
    !account.legalName && 'name in contract',
    account.active !== false && !codes.length && 'linked projects',
    reviews.length > 0 && !dated.length && 'rate revision date',
  ].filter(Boolean);
  return v;
}

// Costing projects no account claims, with the most likely account by name.
export function unlinkedProjects(accounts, projects) {
  const claimed = new Set(accounts.flatMap(projectCodesOf));
  const idx = accounts.map((a) => ({ a, t: [a.name, ...(a.zohoNames || [])].map(nameTokens) }));
  return projects
    .filter((p) => !claimed.has(p.code))
    .map((p) => {
      const t = nameTokens(p.name);
      let best = null;
      for (const { a, t: names } of idx)
        for (const n of names) {
          const common = t.filter((w) => n.includes(w)).length;
          const score = t.length && n.length ? common / Math.min(t.length, n.length) : 0;
          if (score > (best?.score || 0)) best = { account: a, score };
        }
      return { project: p, suggestion: best && best.score >= 0.5 ? best.account : null };
    });
}

// Each PM: experience, team size (people they run on projects + their bench), billing (seats and revenue).
export function pmViews(model, employeesById, profiles = {}, contacts = {}, { on }) {
  const byCode = Object.fromEntries((model.customers || []).map((c) => [c.code, c]));
  return (model.pms || []).map((pm) => {
    const team = new Set();
    for (const e of model.employees || []) for (const a of e.allocations || []) if (a.ownerPm === pm.id && a.code && e.empId !== pmEmpId(pm, model)) team.add(e.empId);
    const bench = (model.bench || []).filter((b) => b.pmId === pm.id && b.empId !== pmEmpId(pm, model));
    for (const b of bench) team.add(b.empId);
    let seats = 0;
    let revenueUSD = 0;
    for (const code of pm.customerCodes || []) {
      const c = byCode[code];
      if (!c) continue;
      const split = (c.pmSplit || []).find((s) => s.pmId === pm.id);
      const share = (c.pmSplit || []).length > 1 ? split?.revenueShare ?? 0 : 1;
      seats += billedSeats(c) * share;
      revenueUSD += (c.revenueUSD || 0) * share;
    }
    const empId = pmEmpId(pm, model);
    const e = empId ? employeesById[empId] : null;
    const view = e ? employeeView(e, profiles[empId], { on }) : null;
    return {
      id: pm.id,
      name: pm.name,
      email: pm.email,
      empId,
      whatsapp: contacts[pm.id]?.whatsapp || pm.whatsapp || '',
      phone: view?.phone || '',
      totalExp: view?.totalExp ?? null,
      alohaYears: view?.alohaYears ?? null,
      joinedOn: view?.joinedOn ?? null,
      customers: (pm.customerCodes || []).length,
      accountOwnerOf: (pm.accountOwnerOf || []).length,
      teamSize: team.size,
      benchPeople: bench.length,
      seats: round1(seats),
      revenueUSD: Math.round(revenueUSD),
      revenuePerSeat: seats > 0 ? Math.round(revenueUSD / seats) : null,
      belowTarget: pm.belowTarget || 0,
    };
  });
}

const pmEmpId = (pm, model) => (model.employees || []).find((e) => e.email && e.email.toLowerCase() === (pm.email || pm.id).toLowerCase())?.empId || null;

// Every campaign touch across accounts, newest first.
export function campaignRows(accounts) {
  return accounts
    .flatMap((a) => (a.campaigns || []).map((c) => ({ ...c, accountId: a.id, accountName: a.name })))
    .sort((x, y) => (y.date || '').localeCompare(x.date || ''));
}

// How complete the foundation is, for the overview.
export function completeness(accountViews, employees) {
  const active = accountViews.filter((v) => v.account.active !== false);
  const pctOf = (list, f) => (list.length ? list.filter(f).length / list.length : null);
  return {
    accounts: active.length,
    billingEmail: pctOf(active, (v) => v.billingContact),
    phone: pctOf(active, (v) => (v.account.contacts || []).some((c) => c.phone)),
    projectsLinked: pctOf(active, (v) => v.projects.length > 0),
    revisionDate: pctOf(active.filter((v) => v.projects.some((p) => p.rateCard)), (v) => v.revisionStatus && v.revisionStatus !== 'unknown'),
    employees: employees.length,
    joinDate: pctOf(employees, (e) => e.joinedOn),
    team: pctOf(employees, (e) => e.teamSource === 'entered'),
    skills: pctOf(employees, (e) => e.skills),
  };
}
