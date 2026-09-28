import React, { useEffect, useMemo, useState } from 'react';
import Overview from './views/Overview.jsx';
import Customers from './views/Customers.jsx';
import Pms from './views/Pms.jsx';
import Bench from './views/Bench.jsx';
import DataChecks from './views/DataChecks.jsx';
import Actions from './views/Actions.jsx';
import WhatsApp from './views/WhatsApp.jsx';
import Login, { ChangePassword } from './views/Login.jsx';
import People from './views/People.jsx';
import { useActions } from './actions/useActions.js';
import { useComms } from './whatsapp/useComms.js';
import { useViewer } from './data/useViewer.js';
import { summarize } from './actions/logic.js';

const TABS = {
  admin: [
    ['overview', 'Overview'],
    ['customers', 'Customers'],
    ['pms', 'PMs'],
    ['people', 'People'],
    ['actions', 'Actions'],
    ['whatsapp', 'WhatsApp'],
    ['bench', 'Bench'],
    ['checks', 'Data checks'],
  ],
  leadership: [
    ['overview', 'Overview'],
    ['customers', 'Customers'],
    ['pms', 'PMs'],
    ['people', 'People'],
    ['actions', 'Actions'],
    ['bench', 'Bench'],
    ['checks', 'Data checks'],
  ],
  pm: [
    ['mine', 'My accounts'],
    ['customers', 'Customers'],
    ['actions', 'Actions'],
    ['bench', 'Bench'],
  ],
};

const ROLE_NOTE = {
  admin: 'Admin view · includes salary-level detail',
  leadership: 'Leadership view (read-only) · includes salary-level detail',
  pm: 'PM view · your customers only',
};

export default function App() {
  const viewer = useViewer();
  if (viewer.status === 'loading') return <div className="empty">Loading…</div>;
  if (viewer.status === 'signed-out') return <Login supabase={viewer.supabase} />;
  if (viewer.status === 'change-password') return <ChangePassword supabase={viewer.supabase} me={viewer.me} onSignOut={viewer.signOut} required />;
  if (viewer.status === 'no-access')
    return (
      <Login
        supabase={viewer.supabase}
        notice={`${viewer.email} is signed in but hasn't been given access. Ask Matt to add you, or sign in with another email.`}
      />
    );
  if (viewer.status === 'error') return <div className="empty">{viewer.error}</div>;
  return <Main viewer={viewer} />;
}

function Main({ viewer }) {
  const { me, api, can } = viewer;
  const tabs = TABS[me.role] || TABS.pm;
  const [model, setModel] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTabState] = useState(() => {
    const t = location.hash.slice(1).split('/')[0];
    return tabs.some(([id]) => id === t) ? t : tabs[0][0];
  });
  const [focus, setFocus] = useState(() => decodeURIComponent(location.hash.split('/')[1] || ''));
  const [changingPw, setChangingPw] = useState(false);

  useEffect(() => {
    api.loadModel().then(setModel, (e) => setError(e.message));
  }, [api]);

  // Follow links / back-forward that change the hash after load.
  useEffect(() => {
    const onHash = () => {
      const [t, f = ''] = location.hash.slice(1).split('/');
      if (tabs.some(([id]) => id === t)) {
        setTabState(t);
        setFocus(decodeURIComponent(f));
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [tabs]);

  useEffect(() => {
    const h = `#${tab}${focus ? '/' + encodeURIComponent(focus) : ''}`;
    if (location.hash !== h) history.replaceState(null, '', h + location.search);
  }, [tab, focus]);

  const store = useActions(api);
  const comms = useComms(can.edit ? api : null);
  const pmsById = useMemo(() => Object.fromEntries((model?.pms || []).map((p) => [p.id, p])), [model]);
  const go = (t, f = '') => {
    // Links into views a role doesn't have (e.g. a PM clicking a PM name) go home instead.
    const allowed = tabs.some(([id]) => id === t);
    setTabState(allowed ? t : tabs[0][0]);
    setFocus(allowed ? f : '');
    window.scrollTo(0, 0);
  };

  if (changingPw) return <ChangePassword supabase={viewer.supabase} me={me} onDone={() => setChangingPw(false)} />;
  if (error) return <div className="empty">{error}</div>;
  if (!model) return <div className="empty">Loading…</div>;

  const ctx = { model, pmsById, go, focus, setFocus, store, comms, me, can };
  const overdue = summarize(store.actions).overdue;
  const closureRequests = store.actions.filter((a) => a.status === 'closure_requested').length;

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Project Costing</h1>
          <div className="sub">
            Aloha Technology · {model.period} · target margin {Math.round(model.target * 100)}%
          </div>
        </div>
        <nav>
          {tabs.map(([id, label]) => (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => go(id)}>
              {label}
              {id === 'actions' && overdue > 0 && <span className="badge">{overdue}</span>}
              {id === 'actions' && can.edit && closureRequests > 0 && <span className="badge good">{closureRequests}</span>}
            </button>
          ))}
        </nav>
        {api.mode === 'cloud' && (
          <div className="who">
            <span>
              {me.name} <span className="muted">· {me.role}</span>
            </span>
            <button className="linkish" onClick={() => setChangingPw(true)}>
              Change password
            </button>
            <button className="linkish" onClick={viewer.signOut}>
              Sign out
            </button>
          </div>
        )}
      </header>
      <main>
        {tab === 'overview' && <Overview {...ctx} />}
        {tab === 'mine' && <Pms {...ctx} focus={me.pmId} setFocus={() => {}} />}
        {tab === 'customers' && <Customers {...ctx} />}
        {tab === 'pms' && <Pms {...ctx} />}
        {tab === 'people' && can.seeAll && <People {...ctx} />}
        {tab === 'actions' && <Actions {...ctx} />}
        {tab === 'whatsapp' && <WhatsApp {...ctx} />}
        {tab === 'bench' && <Bench {...ctx} />}
        {tab === 'checks' && <DataChecks {...ctx} />}
      </main>
      {api.mode === 'preview' && (
        <div className="preview-bar">
          Previewing as <strong>{me.role === 'pm' ? pmsById[me.pmId]?.name || me.pmId : 'leadership'}</strong> (read-only).{' '}
          <a href={location.pathname}>Back to admin</a>
        </div>
      )}
      <footer>
        {ROLE_NOTE[me.role]} · {api.mode === 'cloud' ? 'published' : 'local data'} {new Date(model.generatedAt).toLocaleString()}
      </footer>
    </div>
  );
}
