// Cloud mode: Supabase. What each login can read or write is enforced by the row-level
// security in supabase/schema.sql; this file just maps rows to the app's shapes.
import { createClient } from '@supabase/supabase-js';
import { newAction, applyChange, isClosed } from '../actions/logic.js';

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
  auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true },
});

const must = ({ data, error }) => {
  if (error) throw new Error(error.message);
  return data;
};

const toRow = (a) => ({
  id: a.id,
  customer_code: a.customerCode,
  customer_name: a.customerName,
  finding_id: a.findingId,
  kind: a.kind,
  severity: a.severity,
  title: a.title,
  ask: a.ask || '',
  description: a.description,
  owner_pm_id: a.ownerPmId,
  period: a.period,
  status: a.status,
  created_at: a.createdAt,
  created_by: a.createdBy,
  due_date: a.dueDate,
  original_due_date: a.originalDueDate,
  closed_at: a.closedAt,
  closure_note: a.closureNote,
  history: a.history,
});

const fromRow = (r, savings) => ({
  id: r.id,
  customerCode: r.customer_code,
  customerName: r.customer_name,
  findingId: r.finding_id,
  kind: r.kind,
  severity: r.severity,
  title: r.title,
  ask: r.ask,
  description: r.description,
  ownerPmId: r.owner_pm_id,
  period: r.period,
  status: r.status,
  createdAt: r.created_at,
  createdBy: r.created_by,
  dueDate: r.due_date,
  originalDueDate: r.original_due_date,
  closedAt: r.closed_at,
  closureNote: r.closure_note,
  history: r.history || [],
  savingINR: savings?.get(r.id) || 0,
});

// PM changes go through the pm_action_update() database function.
const PM_OPS = { note: 'note', in_progress: 'start', closure_requested: 'request_close' };

export function cloudApi(me) {
  const by = me.name || me.email;
  const seesAll = me.role === 'admin' || me.role === 'leadership';

  const loadSavings = async () =>
    seesAll ? new Map(must(await supabase.from('action_savings').select('*')).map((s) => [s.action_id, Number(s.saving_inr)])) : null;

  return {
    mode: 'cloud',
    ...masterApi(me),
    async loadModel() {
      const audience = seesAll ? 'admin' : `pm:${me.pmId}`;
      const rows = must(await supabase.from('snapshots').select('data').eq('audience', audience).order('generated_at', { ascending: false }).limit(1));
      if (!rows.length) throw new Error('No data has been published yet.');
      return rows[0].data;
    },

    async listActions() {
      const [rows, savings] = await Promise.all([supabase.from('actions').select('*').then(must), loadSavings()]);
      return rows.map((r) => fromRow(r, savings));
    },

    async createActions(items) {
      const current = must(await supabase.from('actions').select('finding_id,status'));
      const open = new Set(current.filter((a) => a.finding_id && !isClosed(a)).map((a) => a.finding_id));
      const created = items.map((x) => newAction(x, { by })).filter((a) => !a.findingId || !open.has(a.findingId));
      if (!created.length) return [];
      must(await supabase.from('actions').insert(created.map(toRow)));
      const savings = created.filter((a) => a.savingINR).map((a) => ({ action_id: a.id, saving_inr: a.savingINR }));
      if (savings.length) must(await supabase.from('action_savings').insert(savings));
      return created;
    },

    async updateAction(action, change) {
      if (me.role === 'pm') {
        let latest;
        if (change.status && change.status !== action.status) {
          const op = PM_OPS[change.status];
          if (!op) throw new Error('Only Matt can close or drop actions');
          latest = must(await supabase.rpc('pm_action_update', { p_id: action.id, p_op: op, p_note: change.closureNote || change.note || null }));
        } else if (change.note) {
          latest = must(await supabase.rpc('pm_action_update', { p_id: action.id, p_op: 'note', p_note: change.note }));
        } else {
          throw new Error('PMs can add notes, start, or ask to close');
        }
        return fromRow(latest);
      }
      const next = applyChange(action, change, { by });
      must(await supabase.from('actions').update(toRow(next)).eq('id', action.id));
      return next;
    },

    async listContacts() {
      if (me.role !== 'admin') return {};
      const rows = must(await supabase.from('pm_contacts').select('*'));
      return Object.fromEntries(rows.map((r) => [r.pm_id, { whatsapp: r.whatsapp, groupLink: r.group_link, updatedAt: r.updated_at }]));
    },

    async saveContact(pmId, { whatsapp = '', groupLink = '' }) {
      const row = { pm_id: pmId, whatsapp: whatsapp.trim(), group_link: groupLink.trim(), updated_at: new Date().toISOString() };
      must(await supabase.from('pm_contacts').upsert(row));
      return { whatsapp: row.whatsapp, groupLink: row.group_link, updatedAt: row.updated_at };
    },

    async listComms() {
      if (!seesAll) return [];
      const rows = must(await supabase.from('comms_log').select('*'));
      return rows.map((r) => ({ id: r.id, at: r.at, by: r.by, pmId: r.pm_id, type: r.type, text: r.text, actionIds: r.action_ids }));
    },

    async markSent({ pmId, type, text, actionIds = [] }) {
      const entry = { id: `M-${Date.now().toString(36)}`, at: new Date().toISOString(), by, pmId, type, text, actionIds };
      must(await supabase.from('comms_log').insert({ id: entry.id, at: entry.at, by, pm_id: pmId, type, text, action_ids: actionIds }));
      // Note the send on each covered action, as the local API does.
      const label = { digest: 'weekly digest', overdue: 'overdue alert', action: 'new-action message' }[type] || type;
      if (actionIds.length) {
        const rows = must(await supabase.from('actions').select('*').in('id', actionIds));
        for (const r of rows) {
          const next = applyChange(fromRow(r), { note: `Sent to PM on WhatsApp (${label})` }, { by });
          must(await supabase.from('actions').update({ history: next.history }).eq('id', r.id));
        }
      }
      return entry;
    },
  };
}

// --- Customer master data --------------------------------------------------------------
const profileFromRow = (r) => ({ name: r.name, brief: r.brief, technologies: r.technologies || [], teams: r.teams, notes: r.notes, manual: r.manual, pmIds: r.pm_ids || [], updatedBy: r.updated_by, updatedAt: r.updated_at });
const ratesFromRow = (r) => ({ roles: r.roles || {}, reason: r.reason || '', lastRevised: r.last_revised, updatedBy: r.updated_by, updatedAt: r.updated_at });

export function masterApi(me) {
  const by = me.name || me.email;
  return {
    async getMaster() {
      const [p, r, s] = await Promise.all([
        supabase.from('customer_profiles').select('*').then(must),
        supabase.from('customer_rates').select('*').then(must),
        supabase.from('app_settings').select('*').eq('key', 'costing').then(must),
      ]);
      return {
        profiles: Object.fromEntries(p.map((x) => [x.code, profileFromRow(x)])),
        rates: Object.fromEntries(r.map((x) => [x.code, ratesFromRow(x)])),
        settings: s[0]?.value || null,
      };
    },
    async saveProfile(code, p) {
      const row = { code, name: p.name || '', brief: p.brief || '', technologies: p.technologies || [], teams: p.teams ?? null, notes: p.notes || '', manual: Boolean(p.manual), updated_by: by, updated_at: new Date().toISOString() };
      if (p.pmIds) row.pm_ids = p.pmIds;
      return profileFromRow(must(await supabase.from('customer_profiles').upsert(row).select().single()));
    },
    async saveRates(code, r) {
      const row = { code, roles: r.roles || {}, reason: r.reason || '', last_revised: r.lastRevised || null, updated_by: by, updated_at: new Date().toISOString() };
      return ratesFromRow(must(await supabase.from('customer_rates').upsert(row).select().single()));
    },
    async saveSettings(s) {
      must(await supabase.from('app_settings').upsert({ key: 'costing', value: s, updated_by: by, updated_at: new Date().toISOString() }));
      return s;
    },
  };
}

export async function lookupMe(session) {
  const email = session.user.email.toLowerCase();
  const rows = must(await supabase.from('app_users').select('*').eq('email', email));
  if (!rows.length) return null;
  const u = rows[0];
  return { email, role: u.role, pmId: u.pm_id, name: u.name || email.split('@')[0] };
}
