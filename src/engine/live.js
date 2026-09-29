// Live allocation costs in JavaScript: the same rules as the database functions
// customer_costs / team_bench / apply_allocation_changes (supabase/schema.sql), used by the
// local dev server. supabase/allocations.test.js checks both give identical results.
//
// state = { people: [{emp_id, name, category, bench_pm, active}], salaries: {emp_id: ctc},
//           allocations: [{id, emp_id, customer_code, subproject, owner_pm, util_pct, billable}],
//           revenue: [{code, name, revenue_inr}], profiles: {code: {pm_ids}}, target }
// viewer = { role: 'admin'|'leadership'|'pm', pmId }

const canSeeAll = (v) => v.role === 'admin' || v.role === 'leadership';
const ownsCustomer = (state, v, code) => v.role === 'pm' && Boolean(v.pmId) && (state.profiles[code]?.pm_ids || []).includes(v.pmId);
export const isMyCustomer = (state, v, code) => canSeeAll(v) || ownsCustomer(state, v, code);

export function checkChanges(state, v, changes = []) {
  if (v.role === 'admin') return;
  for (const c of changes) {
    if (v.role !== 'pm' || !v.pmId) throw new Error('Only PMs and admins can change allocations');
    const code = c.op === 'add' ? c.customer_code : state.allocations.find((a) => a.id === c.id)?.customer_code;
    if (!['add', 'set', 'remove'].includes(c.op)) throw new Error(`Unknown change ${c.op}`);
    if (!code || !ownsCustomer(state, v, code)) throw new Error('You can only change allocations on your own customers');
  }
}

export function allocAfter(state, changes = []) {
  const touched = new Map(changes.filter((c) => c.op === 'set' || c.op === 'remove').map((c) => [c.id, c]));
  const out = [];
  for (const a of state.allocations) {
    const c = touched.get(a.id);
    if (!c) out.push(a);
    else if (c.op === 'set') out.push({ ...a, util_pct: c.util_pct ?? a.util_pct, billable: c.billable ?? a.billable });
  }
  changes.filter((c) => c.op === 'add').forEach((c, i) => out.push({ id: `new:${i + 1}`, emp_id: c.emp_id, customer_code: c.customer_code, util_pct: c.util_pct, billable: c.billable ?? false }));
  return out;
}

function spendBy(state, allocs) {
  const cat = new Map(state.people.map((p) => [p.emp_id, p.category]));
  const m = new Map();
  for (const a of allocs) {
    if (!cat.has(a.emp_id)) continue;
    const x = m.get(a.customer_code) || { spend: 0, eng: 0 };
    const s = ((state.salaries[a.emp_id] || 0) * a.util_pct) / 100;
    x.spend += s;
    if (cat.get(a.emp_id) !== 'pm') x.eng += s;
    m.set(a.customer_code, x);
  }
  return m;
}

export function customerCosts(state, v, changes = []) {
  checkChanges(state, v, changes);
  const t = state.target ?? 0.7;
  const b = spendBy(state, state.allocations);
  const f = spendBy(state, allocAfter(state, changes));
  const cost = (rev, s) => (rev > 0 ? (rev - s) / rev : null);
  return state.revenue
    .filter((r) => isMyCustomer(state, v, r.code))
    .map((r) => {
      const sb = b.get(r.code)?.spend || 0;
      const sa = f.get(r.code)?.spend || 0;
      return {
        code: r.code,
        name: r.name,
        revenue_inr: r.revenue_inr,
        spend_before: sb,
        spend_after: sa,
        eng_before: b.get(r.code)?.eng || 0,
        eng_after: f.get(r.code)?.eng || 0,
        cost_before: cost(r.revenue_inr, sb),
        cost_after: cost(r.revenue_inr, sa),
        off_by_before: Math.max(0, sb - (1 - t) * r.revenue_inr),
        off_by_after: Math.max(0, sa - (1 - t) * r.revenue_inr),
        managed_before: r.revenue_inr > 0 && (r.revenue_inr - sb) / r.revenue_inr >= t,
        managed_after: r.revenue_inr > 0 && (r.revenue_inr - sa) / r.revenue_inr >= t,
      };
    });
}

export function teamBench(state, v, changes = []) {
  checkChanges(state, v, changes);
  const load = (allocs) => allocs.reduce((m, a) => m.set(a.emp_id, (m.get(a.emp_id) || 0) + a.util_pct), new Map());
  const lb = load(state.allocations);
  const la = load(allocAfter(state, changes));
  const by = new Map();
  for (const p of state.people) {
    if (!p.active || !['engineering', 'pm'].includes(p.category) || !p.bench_pm) continue;
    if (!canSeeAll(v) && p.bench_pm !== v.pmId) continue;
    const ctc = state.salaries[p.emp_id] || 0;
    const fb = Math.max(0, 100 - (lb.get(p.emp_id) || 0));
    const fa = Math.max(0, 100 - (la.get(p.emp_id) || 0));
    const x = by.get(p.bench_pm) || { pm_id: p.bench_pm, people: 0, free_pct_before: 0, free_pct_after: 0, spend_before: 0, spend_after: 0 };
    if (fb > 0 || fa > 0) x.people += 1;
    x.free_pct_before += fb;
    x.free_pct_after += fa;
    x.spend_before += (ctc * fb) / 100;
    x.spend_after += (ctc * fa) / 100;
    by.set(p.bench_pm, x);
  }
  return [...by.values()];
}

// Returns { state: newState, history: [...] } or throws; the caller persists.
export function applyChanges(state, v, changes = [], note = '', who = 'Matt', now = new Date().toISOString()) {
  if (v.role !== 'admin' && !(v.role === 'pm' && v.pmId)) throw new Error('Only PMs and admins can change allocations');
  checkChanges(state, v, changes);
  let allocations = [...state.allocations];
  const history = [];
  for (const c of changes) {
    if (c.op === 'add') {
      if (!(c.util_pct > 0 && c.util_pct <= 100)) throw new Error('Time must be between 1 and 100%');
      const owner = c.owner_pm || v.pmId || null;
      const sp = allocations.find((a) => a.customer_code === c.customer_code && a.owner_pm === owner)?.subproject || '';
      const a = { id: `AL-${Math.random().toString(36).slice(2, 14)}`, emp_id: c.emp_id, customer_code: c.customer_code, subproject: sp, owner_pm: owner, util_pct: c.util_pct, billable: c.billable ?? false, updated_by: who, updated_at: now };
      allocations.push(a);
      history.push({ at: now, by: who, emp_id: a.emp_id, customer_code: a.customer_code, action: 'add', before: null, after: { util_pct: a.util_pct, billable: a.billable }, note });
    } else if (c.op === 'set') {
      const i = allocations.findIndex((a) => a.id === c.id);
      if (i < 0) throw new Error('Allocation not found');
      const a = allocations[i];
      const next = { ...a, util_pct: c.util_pct ?? a.util_pct, billable: c.billable ?? a.billable, updated_by: who, updated_at: now };
      allocations[i] = next;
      history.push({ at: now, by: who, emp_id: a.emp_id, customer_code: a.customer_code, action: 'set', before: { util_pct: a.util_pct, billable: a.billable }, after: { util_pct: next.util_pct, billable: next.billable }, note });
    } else if (c.op === 'remove') {
      const a = allocations.find((x) => x.id === c.id);
      if (!a) throw new Error('Allocation not found');
      allocations = allocations.filter((x) => x.id !== c.id);
      history.push({ at: now, by: who, emp_id: a.emp_id, customer_code: a.customer_code, action: 'remove', before: { util_pct: a.util_pct, billable: a.billable }, after: null, note });
    }
  }
  const load = allocations.reduce((m, a) => m.set(a.emp_id, (m.get(a.emp_id) || 0) + a.util_pct), new Map());
  const over = [...load].filter(([, u]) => u > 100.5).map(([id, u]) => `${state.people.find((p) => p.emp_id === id)?.name || id} (${Math.round(u)}%)`);
  if (over.length) throw new Error(`Over 100% allocated: ${over.join(', ')}`);
  return { state: { ...state, allocations }, history };
}
