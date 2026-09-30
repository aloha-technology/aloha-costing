import React, { useEffect, useMemo, useState } from 'react';
import Overview from './views/Overview.jsx';
import Customers from './views/Customers.jsx';
import Pms from './views/Pms.jsx';
import Bench from './views/Bench.jsx';
import DataValidation, { useImports } from './views/DataValidation.jsx';
import Actions from './views/Actions.jsx';
import WhatsApp from './views/WhatsApp.jsx';
import Login, { ChangePassword } from './views/Login.jsx';
import People from './views/People.jsx';
import Play from './views/Play.jsx';
import Allocations from './views/Allocations.jsx';
import { Glossary, BenchBanner, AppShell, AREAS } from './views/shell.jsx';
import { useMaster } from './views/Master.jsx';
import { useActions } from './actions/useActions.js';
import { useComms } from './whatsapp/useComms.js';
import { useViewer } from './data/useViewer.js';
import { summarize } from './actions/logic.js';
import CollectionsApp from './collections/CollectionsApp.jsx';
import { useColApi } from './collections/data/useColApi.js';
import MasterApp from './master/MasterApp.jsx';

// Costing navigation per role: groups of [id, label, icon, subtitle]. Standard rates live in Directory.
const COSTING = [
  ['', [['overview', 'Dashboard', 'grid', 'Company COST, spend layers and where to act']]],
  [
    'Portfolio',
    [
      ['customers', 'Customers', 'building', 'Billing, spend and COST by customer'],
      ['pms', 'Teams', 'users', 'COST by PM team, with bench and support'],
      ['people', 'People', 'user', 'Allocations and salaries, with a what-if'],
      ['bench', 'Bench', 'pause', 'People on bench and what it costs'],
    ],
  ],
  [
    'Improve',
    [
      ['allocations', 'Allocations', 'swap', 'Who is on which customer, with live COST'],
      ['play', 'Play', 'sliders', 'Find the best path to the COST target'],
      ['actions', 'Actions', 'check', 'Tracked actions and TATs'],
      ['whatsapp', 'WhatsApp', 'chat', 'Weekly digests and alerts for PMs'],
    ],
  ],
  ['Data', [['checks', 'Data & validation', 'upload', 'Upload, validate and publish the monthly data']]],
];
const NAV = {
  admin: COSTING,
  leadership: COSTING.map(([t, l]) => [t, l.filter(([id]) => id !== 'whatsapp')]),
  pm: [
    [
      'My work',
      [
        ['mine', 'My team', 'grid', 'Your customers, COST and bench'],
        ['allocations', 'Allocations & play', 'swap', 'Add or remove people and set %: try first, then save'],
        ['customers', 'Customers', 'building', 'Your customers'],
        ['bench', 'Bench', 'pause', 'Your bench'],
        ['actions', 'Actions', 'check', 'Actions assigned to you'],
      ],
    ],
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
    return <Login supabase={viewer.supabase} notice={`${viewer.email} is signed in but hasn't been given access. Ask Matt to add you, or sign in with another email.`} />;
  if (viewer.status === 'error') return <div className="empty">{viewer.error}</div>;
  return <Apps viewer={viewer} />;
}

// One tool, three areas sharing the sign-in: Directory (#m-…: customers, teams, employees),
// Costing and Invoices (#c-…). PMs only get Costing; the accounts team only the Invoices
// tax-invoice portal; Directory is for Matt and leadership.
const areaOf = (role) => {
  if (role === 'accounts') return 'invoices';
  if (role === 'pm') return 'costing';
  const h = location.hash;
  return h.startsWith('#c-') ? 'invoices' : h.startsWith('#m-') ? 'directory' : 'costing';
};
function Apps({ viewer }) {
  const role = viewer.me.role;
  const [area, setArea] = useState(() => areaOf(role));
  const colApi = useColApi(viewer);
  useEffect(() => {
    const onHash = () => setArea(areaOf(role));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [role]);
  const areas = role === 'admin' || role === 'leadership' ? ['directory', 'costing', 'invoices'] : [];
  const onArea = (x) => {
    location.hash = AREAS[x].home;
    setArea(x);
  };
  const shell = { areas, onArea };
  if (area === 'costing') return <Main viewer={viewer} shell={shell} />;
  if (!colApi) return <div className="empty">Loading…</div>;
  if (area === 'directory') return <MasterApp viewer={viewer} colApi={colApi} shell={shell} />;
  return <CollectionsApp viewer={viewer} api={colApi} shell={shell} />;
}

function Main({ viewer, shell }) {
  const { me, api, can } = viewer;
  const groups = NAV[me.role] || NAV.pm;
  const items = useMemo(() => groups.flatMap(([, list]) => list), [groups]);
  const has = (t) => items.some(([id]) => id === t);
  const [model, setModel] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTabState] = useState(() => {
    const t = location.hash.slice(1).split('/')[0];
    return items.some(([id]) => id === t) ? t : items[0][0];
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
      if (items.some(([id]) => id === t)) {
        setTabState(t);
        setFocus(decodeURIComponent(f));
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [items]);

  useEffect(() => {
    const h = `#${tab}${focus ? '/' + encodeURIComponent(focus) : ''}`;
    if (location.hash !== h) history.replaceState(null, '', location.pathname + location.search + h);
  }, [tab, focus]);

  const store = useActions(api);
  const comms = useComms(can.edit ? api : null);
  const master = useMaster(api);
  const imports = useImports(api, can.seeAll);
  const reloadModel = () => api.loadModel().then(setModel);
  const pmsById = useMemo(() => Object.fromEntries((model?.pms || []).map((p) => [p.id, p])), [model]);
  const go = (t, f = '') => {
    // Links into views a role doesn't have (e.g. a PM clicking a PM name) go home instead.
    setTabState(has(t) ? t : items[0][0]);
    setFocus(has(t) ? f : '');
    window.scrollTo(0, 0);
  };

  if (changingPw) return <ChangePassword supabase={viewer.supabase} me={me} onDone={() => setChangingPw(false)} />;
  if (error) return <div className="empty">{error}</div>;
  if (!model) return <div className="empty">Loading…</div>;

  const ctx = { model, pmsById, go, focus, setFocus, store, comms, me, can, master, imports, api, reloadModel };
  const overdue = summarize(store.actions).overdue;
  const closureRequests = store.actions.filter((a) => a.status === 'closure_requested').length;
  const current = items.find(([id]) => id === tab) || items[0];

  return (
    <AppShell
      area="costing"
      {...shell}
      groups={groups}
      tab={tab}
      onTab={go}
      badges={{ actions: [{ n: overdue, title: 'Overdue' }, { n: can.edit ? closureRequests : 0, tone: 'good', title: 'Closure requested' }] }}
      title={current[1]}
      sub={current[3]}
      me={me}
      chips={
        <>
          <span className="chip">
            <strong>{model.period}</strong>
          </span>
          <span className="chip" title="Rate used to convert invoiced USD to INR (from the costing sheet)">
            US$1 = <strong>₹{model.fx?.toFixed(2)}</strong>
          </span>
          <span className="chip accent" title="COST is Aloha's name for actual profit %">
            COST target <strong>{Math.round(model.target * 100)}%</strong>
          </span>
          <Glossary target={model.target} />
        </>
      }
      account={
        api.mode === 'cloud' && (
          <div style={{ marginTop: 8 }}>
            <button onClick={() => setChangingPw(true)}>Change password</button>
            <button onClick={viewer.signOut}>Sign out</button>
          </div>
        )
      }
      preview={
        api.mode === 'preview' && (
          <div className="preview-bar">
            Previewing as <strong>{me.role === 'pm' ? pmsById[me.pmId]?.name || me.pmId : 'leadership'}</strong> (read-only).{' '}
            <a href={location.pathname}>Back to admin</a>
          </div>
        )
      }
      footer={`${ROLE_NOTE[me.role]} · ${api.mode === 'cloud' ? 'published' : 'local data'} ${new Date(model.generatedAt).toLocaleDateString()}`}
    >

          {me.role === 'pm' && <BenchBanner model={model} me={me} go={go} />}
          {tab === 'overview' && <Overview {...ctx} />}
          {tab === 'mine' && <Pms {...ctx} focus={me.pmId} setFocus={() => {}} />}
          {tab === 'customers' && <Customers {...ctx} />}
          {tab === 'pms' && <Pms {...ctx} />}
          {tab === 'people' && can.seeAll && <People {...ctx} />}
          {tab === 'play' && can.seeAll && <Play {...ctx} />}
          {tab === 'allocations' && <Allocations {...ctx} />}
          {tab === 'actions' && <Actions {...ctx} />}
          {tab === 'whatsapp' && <WhatsApp {...ctx} />}
          {tab === 'bench' && <Bench {...ctx} />}
          {tab === 'checks' && <DataValidation {...ctx} />}
    </AppShell>
  );
}
