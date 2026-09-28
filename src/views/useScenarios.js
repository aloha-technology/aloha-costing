import { useCallback, useEffect, useMemo, useState } from 'react';
import { merge } from '../engine/scenario.js';
import { generateLevers } from '../engine/levers.js';

// Named what-if scenarios, kept in this browser only (localStorage), shared by People and Play.
// Each scenario = manual edits (from People / applied plans) + levers switched on.
const STORE = 'aloha-scenarios-v2';
const blank = () => ({ alloc: {}, released: {}, added: [], rates: {} });
const newId = () => `S${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

function load(period) {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (s && s.period === period && s.list?.length) return s;
    // Carry over a scenario made before named scenarios existed.
    const v1 = JSON.parse(localStorage.getItem('aloha-scenario-v1') || 'null');
    const manual = v1 && v1.period === period ? { ...blank(), alloc: v1.alloc || {}, released: v1.released || {}, added: v1.added || [] } : blank();
    const id = newId();
    return { period, activeId: id, list: [{ id, name: 'Scenario 1', manual, levers: [] }] };
  } catch {
    const id = newId();
    return { period, activeId: id, list: [{ id, name: 'Scenario 1', manual: blank(), levers: [] }] };
  }
}

export function useScenarios(model) {
  const [state, setState] = useState(() => load(model.period));
  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(state));
    } catch {
      /* storage blocked: scenarios just won't persist */
    }
  }, [state]);

  const levers = useMemo(() => generateLevers(model), [model]);
  const leverById = useMemo(() => new Map(levers.map((l) => [l.id, l])), [levers]);
  const active = state.list.find((s) => s.id === state.activeId) || state.list[0];
  const effectiveOf = useCallback((s) => merge([...s.levers.map((id) => leverById.get(id)?.part), s.manual]), [leverById]);
  const effective = useMemo(() => effectiveOf(active), [active, effectiveOf]);

  const patchActive = (fn) => setState((st) => ({ ...st, list: st.list.map((s) => (s.id === st.activeId ? fn(s) : s)) }));

  return {
    list: state.list,
    active,
    effective,
    effectiveOf,
    levers,
    leverById,
    setActive: (id) => setState((st) => ({ ...st, activeId: id })),
    // Same shape as React's setState, applied to the active scenario's manual edits.
    updateManual: (fnOrValue) => patchActive((s) => ({ ...s, manual: { ...blank(), ...(typeof fnOrValue === 'function' ? fnOrValue(s.manual) : fnOrValue) } })),
    addPart: (part) => patchActive((s) => ({ ...s, manual: merge([s.manual, part]) })),
    toggleLever: (id) => patchActive((s) => ({ ...s, levers: s.levers.includes(id) ? s.levers.filter((x) => x !== id) : [...s.levers, id] })),
    removeItem: (itemId) =>
      patchActive((s) => {
        if (itemId.startsWith('lever:')) return { ...s, levers: s.levers.filter((x) => x !== itemId.slice(6)) };
        const m = { ...s.manual, alloc: { ...s.manual.alloc }, released: { ...s.manual.released }, rates: { ...s.manual.rates } };
        const [, kind, ...rest] = itemId.split(':');
        const k = rest.join(':');
        if (kind === 'alloc') delete m.alloc[k];
        if (kind === 'rel') delete m.released[k];
        if (kind === 'rate') delete m.rates[k];
        if (kind === 'add') m.added = (m.added || []).filter((a) => a.id !== k);
        return { ...s, manual: m };
      }),
    reset: () => patchActive((s) => ({ ...s, manual: blank(), levers: [] })),
    create: (name) => {
      const id = newId();
      setState((st) => ({ ...st, activeId: id, list: [...st.list, { id, name: name || `Scenario ${st.list.length + 1}`, manual: blank(), levers: [] }] }));
    },
    duplicate: () => {
      const id = newId();
      setState((st) => {
        const cur = st.list.find((s) => s.id === st.activeId);
        return { ...st, activeId: id, list: [...st.list, { ...structuredClone(cur), id, name: `${cur.name} (copy)` }] };
      });
    },
    rename: (name) => name && patchActive((s) => ({ ...s, name })),
    remove: () =>
      setState((st) => {
        if (st.list.length === 1) return { ...st, list: [{ ...st.list[0], manual: blank(), levers: [] }] };
        const list = st.list.filter((s) => s.id !== st.activeId);
        return { ...st, list, activeId: list[0].id };
      }),
  };
}
