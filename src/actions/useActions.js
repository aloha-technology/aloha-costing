import { useCallback, useEffect, useMemo, useState } from 'react';

// Action items for the current viewer; api is the local or cloud backend (src/data/).
export function useActions(api) {
  const [actions, setActions] = useState([]);
  const [error, setError] = useState(null);

  const reload = useCallback(
    () =>
      api
        ? api.listActions().then(setActions, (e) => setError(e.message))
        : Promise.resolve(),
    [api]
  );
  useEffect(() => {
    reload();
  }, [reload]);

  const create = useCallback(
    async (items) => {
      const created = await api.createActions(items);
      setActions((a) => [...a, ...created]);
      return created;
    },
    [api]
  );

  const update = useCallback(
    async (id, change) => {
      const current = actions.find((a) => a.id === id);
      const updated = await api.updateAction(current, change);
      // PM updates come back without savings (they can't read them); keep what we had.
      setActions((all) => all.map((a) => (a.id === id ? { ...updated, savingINR: updated.savingINR || a.savingINR } : a)));
      return updated;
    },
    [api, actions]
  );

  // Latest (open first, then newest) action per finding, for badges next to findings.
  const byFinding = useMemo(() => {
    const m = new Map();
    const rank = (a) => (a.status === 'done' || a.status === 'dropped' ? 0 : 1);
    for (const a of actions) {
      if (!a.findingId) continue;
      const cur = m.get(a.findingId);
      if (!cur || rank(a) > rank(cur) || (rank(a) === rank(cur) && a.createdAt > cur.createdAt)) m.set(a.findingId, a);
    }
    return m;
  }, [actions]);

  return { actions, error, create, update, reload, byFinding };
}
