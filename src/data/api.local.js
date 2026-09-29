// Local mode: data/model.json and data/*.json, served by the dev-server API only (never built).
// Used when no Supabase settings are configured. The viewer is admin, or a read-only
// preview of another role (previewApi) built exactly the way publish builds it.
import { pmView } from '../engine/views.js';

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
    async getMaster() {
      const m = await localApi.getMaster();
      if (me.role !== 'pm') return m;
      // PMs: profiles of their own customers only, never the rate card.
      const mine = new Set((await this.loadModel()).customers.map((c) => c.code));
      return { profiles: Object.fromEntries(Object.entries(m.profiles).filter(([code]) => mine.has(code))), rates: {}, settings: m.settings };
    },
  };
}
