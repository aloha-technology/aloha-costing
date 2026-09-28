import { useEffect, useMemo, useState } from 'react';
import { localApi, previewApi } from './api.local.js';

export const CLOUD = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

// What each role may do in the UI. The database enforces the same rules (schema.sql).
export function permissions(role) {
  return {
    edit: role === 'admin', // create/close actions, WhatsApp, contacts
    pmUpdate: role === 'pm', // notes, start, ask to close on own actions
    seeAll: role === 'admin' || role === 'leadership', // company totals, salaries, data checks
  };
}

// Resolves who is looking and which backend to use.
// status: 'loading' | 'signed-out' | 'no-access' | 'ready'
export function useViewer() {
  // Local mode can preview other roles with ?as=leadership or ?as=pm:<pm id>.
  const as = new URLSearchParams(location.search).get('as') || '';
  const localMe = as === 'leadership' ? { role: 'leadership', name: 'Leadership (preview)' } : as.startsWith('pm:') ? { role: 'pm', pmId: as.slice(3), name: 'PM (preview)' } : { role: 'admin', name: 'Matt' };
  const [state, setState] = useState(CLOUD ? { status: 'loading' } : { status: 'ready', me: { email: null, ...localMe }, preview: localMe.role !== 'admin' });
  const [cloud, setCloud] = useState(null);

  useEffect(() => {
    if (!CLOUD) return;
    let unsub = () => {};
    import('./api.cloud.js').then((mod) => {
      setCloud(mod);
      const resolve = async (session) => {
        if (!session) return setState({ status: 'signed-out' });
        try {
          const me = await mod.lookupMe(session);
          setState(me ? { status: 'ready', me } : { status: 'no-access', email: session.user.email });
        } catch (e) {
          setState({ status: 'error', error: e.message });
        }
      };
      mod.supabase.auth.getSession().then(({ data }) => resolve(data.session));
      const { data } = mod.supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') resolve(session);
      });
      unsub = () => data.subscription.unsubscribe();
    });
    return () => unsub();
  }, []);

  const api = useMemo(() => {
    if (state.status !== 'ready') return null;
    return CLOUD ? cloud?.cloudApi(state.me) : state.preview ? previewApi(state.me) : localApi;
  }, [state, cloud]);

  const signOut = () => cloud?.supabase.auth.signOut();
  return { ...state, api, can: permissions(state.me?.role), signOut, supabase: cloud?.supabase };
}
