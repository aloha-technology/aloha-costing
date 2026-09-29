// Local mode: data/model.json and data/*.json, served by the dev-server API only (never built).
// Used when no Supabase settings are configured. The viewer is admin, or a read-only
// preview of another role (previewApi) built exactly the way publish builds it.
import { pmView } from '../engine/views.js';
import * as liveCalc from '../engine/live.js';

const call = async (url, opts) => {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `Request failed (${r.status})`);
  return body;
};

export const localApi = {
  mode: 'local',
  async loadModel() {
    const r = await fetch('/api/model', { cache: 'no-store' });
    if (!r.ok) throw new Error('No data yet. Run "npm run import" first.');
    return r.json();
  },
  listActions: () => call('/api/actions'),
  createActions: (items) => call('/api/actions', { method: 'POST', body: JSON.stringify(items) }),
  updateAction: (action, change) => call(`/api/actions/${encodeURIComponent(action.id)}`, { method: 'PATCH', body: JSON.stringify(change) }),
  listContacts: () => call('/api/contacts'),
  saveContact: (pmId, contact) => call(`/api/contacts/${encodeURIComponent(pmId)}`, { method: 'PUT', body: JSON.stringify(contact) }),
  listComms: () => call('/api/comms'),
  markSent: async (entry) => (await call('/api/comms', { method: 'POST', body: JSON.stringify(entry) })).entry,
  // Live allocations: local mode computes with src/engine/live.js (same rules as the database).
  async getLive(viewer = { role: 'admin' }) {
    const st = await call('/api/live');
    return liveView(st, viewer);
  },
  async liveCosts(changes, viewer = { role: 'admin' }) {
    return liveCalc.customerCosts(await call('/api/live'), viewer, changes);
  },
  async liveBench(changes, viewer = { role: 'admin' }) {
    return liveCalc.teamBench(await call('/api/live'), viewer, changes);
  },
  applyLive: (changes, note, viewer = { role: 'admin' }) => call('/api/live/apply', { method: 'POST', body: JSON.stringify({ changes, note, viewer }) }),
  adminSync: (payload) => call('/api/live/sync', { method: 'POST', body: JSON.stringify(payload) }),
  getImports: () => call('/api/imports'),
  loadFromInbox: () => call('/api/imports/from-inbox', { method: 'POST' }),
  saveImportFile: (period, kind, file) => call(`/api/imports/file/${kind}`, { method: 'PUT', body: JSON.stringify({ period, file }) }),
  setImportRecord: (type, period, key, value) =>
    call(`/api/imports/${type}/${encodeURIComponent(key)}`, value == null ? { method: 'DELETE' } : { method: 'PUT', body: JSON.stringify(value) }),
  publishModel: (model) => call('/api/imports/publish', { method: 'POST', body: JSON.stringify({ model }) }),
  getMaster: () => call('/api/master'),
  saveProfile: (code, p) => call(`/api/master/profiles/${encodeURIComponent(code)}`, { method: 'PUT', body: JSON.stringify(p) }),
  saveRates: (code, r) => call(`/api/master/rates/${encodeURIComponent(code)}`, { method: 'PUT', body: JSON.stringify(r) }),
  saveSettings: (s) => call('/api/master/settings', { method: 'PUT', body: JSON.stringify(s) }),
};

export function previewApi(me) {
  const readOnly = () => Promise.reject(new Error('Preview is read-only'));
  return {
    ...localApi,
    mode: 'preview',
    async loadModel() {
      const m = await localApi.loadModel();
      return me.role === 'pm' ? pmView(m, me.pmId) : m;
    },
    async listActions() {
      const all = await localApi.listActions();
      return me.role === 'pm' ? all.filter((a) => a.ownerPmId === me.pmId).map((a) => ({ ...a, savingINR: 0 })) : all;
    },
    createActions: readOnly,
    updateAction: readOnly,
    saveProfile: readOnly,
    saveRates: readOnly,
    saveSettings: readOnly,
    saveImportFile: readOnly,
    setImportRecord: readOnly,
    adminSync: readOnly,
    // A PM preview can play and save on its own customers, like a real PM.
    getLive: () => localApi.getLive(me),
    liveCosts: (ch) => localApi.liveCosts(ch, me),
    liveBench: (ch) => localApi.liveBench(ch, me),
    applyLive: (ch, note) => localApi.applyLive(ch, note, me),
    publishModel: readOnly,
    loadFromInbox: readOnly,
    async getImports() {
      if (me.role === 'pm') return null;
      const st = await localApi.getImports();
      // Leadership: stamps and revenue corrections only, never raw files or salary corrections.
      return { ...st, files: {}, salaryOverrides: {}, categories: {} };
    },
    async getMaster() {
      const m = await localApi.getMaster();
      if (me.role !== 'pm') return m;
      // PMs: profiles of their own customers only, never the rate card.
      const mine = new Set((await this.loadModel()).customers.map((c) => c.code));
      return { profiles: Object.fromEntries(Object.entries(m.profiles).filter(([code]) => mine.has(code))), rates: {}, settings: m.settings };
    },
  };
}

// What a viewer may see of the live state (mirrors the database's access rules).
function liveView(st, viewer) {
  const all = viewer.role === 'admin' || viewer.role === 'leadership';
  const mine = (code) => liveCalc.isMyCustomer(st, viewer, code);
  const benchMine = new Set(st.people.filter((p) => p.bench_pm && p.bench_pm === viewer.pmId).map((p) => p.emp_id));
  const load = {};
  for (const a of st.allocations) load[a.emp_id] = (load[a.emp_id] || 0) + Number(a.util_pct);
  return {
    source: st.source,
    since: st.since,
    people: st.people,
    salaries: all ? st.salaries : {},
    allocations: st.allocations.filter((a) => mine(a.customer_code) || benchMine.has(a.emp_id)),
    load,
    history: st.history.filter((h) => (h.customer_code ? mine(h.customer_code) : all)).slice(-300).reverse(),
    revenue: st.revenue.filter((r) => mine(r.code)),
  };
}
