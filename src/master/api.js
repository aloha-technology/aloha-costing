// Master data storage for the details Matt enters about employees (people_profiles).
// Everything else Master data shows comes from the Costing and Collections APIs.
//   local -> dev-server API over data/people-profiles.json (scripts/masterdata-api.js)
//   cloud -> Supabase table people_profiles (supabase/master.sql)
import { CLOUD } from '../data/useViewer.js';

const FIELDS = ['team', 'joined_on', 'prior_experience_years', 'experience_years', 'skills', 'phone', 'location', 'incentive_plan', 'notes'];
export const cleanProfile = (p) => Object.fromEntries(FIELDS.map((k) => [k, p[k] === '' || p[k] === undefined ? (k === 'notes' ? '' : null) : p[k]]));

export async function masterDataApi(me) {
  const by = me?.name || me?.email || 'Matt';
  if (!CLOUD) {
    const call = async (url, opts = {}) => {
      const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(me?.role !== 'admin' ? { 'x-preview-role': me?.role || '' } : {}) } });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `Request failed (${r.status})`);
      return body;
    };
    return {
      listPeopleProfiles: () => call('/api/people-profiles'),
      savePeopleProfiles: (rows) => call('/api/people-profiles', { method: 'PUT', body: JSON.stringify(rows.map((r) => ({ emp_id: r.emp_id, ...cleanProfile(r) }))) }),
    };
  }
  const { supabase } = await import('../data/api.cloud.js');
  const must = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };
  return {
    async listPeopleProfiles() {
      const rows = must(await supabase.from('people_profiles').select('*'));
      return Object.fromEntries(rows.map((r) => [r.emp_id, r]));
    },
    async savePeopleProfiles(rows) {
      const at = new Date().toISOString();
      const out = rows.map((r) => ({ emp_id: r.emp_id, ...cleanProfile(r), updated_by: by, updated_at: at }));
      for (let i = 0; i < out.length; i += 500) must(await supabase.from('people_profiles').upsert(out.slice(i, i + 500)));
      return out;
    },
  };
}
