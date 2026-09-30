// Salary rules (leadership, 2026-09-30): flag people paid above the cap for their level, and project
// teams whose mix or cost breaks the "group of 3" rule. Pure JS; salary-level, so admin + leadership only.
//
//   - Fresher / mid-level / senior dev each have a monthly CTC cap (₹).
//   - Per group of 3 developers on a project: at most one mid-level OR one senior (not both),
//     and the group's allocated CTC no more than ₹90k.
// Everything is editable in Costing → Salary rules and stored with the costing settings.

export const DEFAULT_SALARY_RULES = {
  // Who the rules apply to (designation contains any of these, case-insensitive).
  scope: ['Developer'],
  levels: [
    { key: 'fresher', label: 'Fresher', maxYears: 1, capINR: 25000 },
    { key: 'mid', label: 'Mid-level', maxYears: 5, capINR: 40000 },
    { key: 'senior', label: 'Senior dev', maxYears: null, capINR: 70000 },
  ],
  // Titles that set the level whatever the years (e.g. "Senior Developer" is senior).
  titleLevels: [{ match: 'senior', level: 'senior' }],
  groupSize: 3,
  groupBudgetINR: 90000,
  maxSeniorsPerGroup: 1, // mid-level + senior together, per group
};

export const withRuleDefaults = (r) => ({ ...DEFAULT_SALARY_RULES, ...(r || {}), levels: r?.levels?.length ? r.levels : DEFAULT_SALARY_RULES.levels });

const inScope = (e, rules) => rules.scope.some((s) => s && (e.designation || '').toLowerCase().includes(s.toLowerCase()));

// Level of one person: by title first, then by years of experience.
export function levelOf(e, rules) {
  const title = (e.designation || '').toLowerCase();
  const byTitle = (rules.titleLevels || []).find((t) => t.match && title.includes(t.match.toLowerCase()));
  if (byTitle) return { key: byTitle.level, why: `title “${e.designation}”` };
  const yrs = e.experienceYears;
  if (yrs == null) return { key: null, why: 'no experience in the HR export' };
  const lv = rules.levels.find((l) => l.maxYears == null || yrs < l.maxYears);
  return { key: lv.key, why: `${yrs} yrs experience` };
}

// People above the cap for their level.
export function peopleOverCap(employees, rules) {
  const byKey = Object.fromEntries(rules.levels.map((l) => [l.key, l]));
  const out = [];
  for (const e of employees) {
    if (!inScope(e, rules) || !(e.ctcMonthlyINR > 0)) continue;
    const lv = levelOf(e, rules);
    const cap = byKey[lv.key]?.capINR;
    if (cap && e.ctcMonthlyINR > cap) out.push({ ...e, level: lv.key, levelLabel: byKey[lv.key].label, why: lv.why, capINR: cap, overINR: e.ctcMonthlyINR - cap });
  }
  return out.sort((a, b) => b.overINR - a.overINR || String(a.name).localeCompare(String(b.name)));
}

// Each project's developer team against the group-of-3 rule, using allocation %.
export function teamChecks(employees, customers, rules) {
  const byKey = Object.fromEntries(rules.levels.map((l) => [l.key, l]));
  const names = Object.fromEntries((customers || []).map((c) => [c.code, c.name]));
  const teams = {};
  for (const e of employees) {
    if (!inScope(e, rules)) continue;
    const lv = levelOf(e, rules);
    for (const a of e.allocations || []) {
      if (!a.code || a.bench || !(a.utilPct > 0)) continue;
      const t = (teams[a.code] ||= { code: a.code, name: names[a.code] || a.customer || a.code, pms: new Set(), people: [] });
      if (a.ownerPm) t.pms.add(a.ownerPm);
      t.people.push({ empId: e.empId, name: e.name, designation: e.designation, experienceYears: e.experienceYears, level: lv.key, levelLabel: byKey[lv.key]?.label || 'Unknown', utilPct: a.utilPct, ctcMonthlyINR: e.ctcMonthlyINR || 0, allocatedINR: ((e.ctcMonthlyINR || 0) * a.utilPct) / 100 });
    }
  }
  return Object.values(teams)
    .map((t) => {
      const heads = t.people.length;
      const fte = t.people.reduce((s, p) => s + p.utilPct / 100, 0);
      const count = (k) => t.people.filter((p) => p.level === k).length;
      const [freshers, mids, seniors] = [count('fresher'), count('mid'), count('senior')];
      const groups = Math.max(1, Math.ceil(heads / rules.groupSize));
      const allowedSeniors = groups * rules.maxSeniorsPerGroup;
      const allocatedINR = t.people.reduce((s, p) => s + p.allocatedINR, 0);
      const budgetINR = (rules.groupBudgetINR * fte) / rules.groupSize;
      const issues = [];
      if (mids + seniors > allowedSeniors)
        issues.push({ kind: 'mix', text: `${mids} mid-level + ${seniors} senior for ${heads} dev${heads === 1 ? '' : 's'}: at most ${allowedSeniors} allowed (${rules.maxSeniorsPerGroup} per ${rules.groupSize})` });
      if (allocatedINR > budgetINR + 1)
        issues.push({ kind: 'cost', text: `₹${Math.round(allocatedINR).toLocaleString('en-IN')} allocated vs ₹${Math.round(budgetINR).toLocaleString('en-IN')} limit (₹${rules.groupBudgetINR.toLocaleString('en-IN')} per ${rules.groupSize} full-time devs)` });
      return { ...t, pms: [...t.pms], heads, fte: Math.round(fte * 100) / 100, freshers, mids, seniors, unknown: heads - freshers - mids - seniors, allocatedINR, budgetINR, overINR: Math.max(0, allocatedINR - budgetINR), issues };
    })
    .sort((a, b) => b.issues.length - a.issues.length || b.overINR - a.overINR);
}

// Reviews on hold: everyone over their cap, and every in-scope person on a project that breaks the rule.
export function reviewsOnHold(over, teams) {
  const ids = new Map();
  for (const p of over) ids.set(p.empId, { ...(ids.get(p.empId) || { empId: p.empId, name: p.name, reasons: [] }), reasons: [...(ids.get(p.empId)?.reasons || []), `paid above the ${p.levelLabel} cap`] });
  for (const t of teams.filter((x) => x.issues.length))
    for (const p of t.people) {
      const cur = ids.get(p.empId) || { empId: p.empId, name: p.name, reasons: [] };
      cur.reasons = [...cur.reasons, `on ${t.name}, which breaks the team rule`];
      ids.set(p.empId, cur);
    }
  return [...ids.values()];
}
