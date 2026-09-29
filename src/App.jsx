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
import { Icon, Glossary, BenchBanner } from './views/shell.jsx';
import { useMaster, Settings } from './views/Master.jsx';
import { useActions } from './actions/useActions.js';
import { useComms } from './whatsapp/useComms.js';
import { useViewer } from './data/useViewer.js';
import { summarize } from './actions/logic.js';

// Left navigation per role: groups of [id, label, icon, subtitle].
const NAV = {
  admin: [
    ['Overview', [['overview', 'Dashboard', 'grid', 'Company COST, spend layers and where to act']]],
    [
      'Portfolio',
      [
        ['customers', 'Customers', 'building', 'Billing, spend and COST by customer'],
        ['pms', 'Teams', 'users', 'COST by PM team, with bench and support'],
        ['people', 'People', 'user', 'Everyone, their allocations and salaries'],
        ['bench', 'Bench', 'pause', 'People on bench and what it costs'],
      ],
    ],
    [
      'Improve',
      [
        ['allocations', 'Allocations', 'swap', 'Add or remove people and set %, with live COST'],
        ['play', 'Play', 'sliders', 'Explore the best path to the COST target'],
        ['actions', 'Actions', 'check', 'Tracked actions and TATs'],
        ['whatsapp', 'WhatsApp', 'chat', 'Weekly digests and alerts for PMs'],
      ],
    ],
    [
      'Data',
      [
        ['checks', 'Data & validation', 'shield', 'Upload, validate, classify and correct the monthly data'],
        ['settings', 'Settings', 'cog', 'Aloha standard rates and rate revision'],
      ],
    ],
  ],
  leadership: [
    ['Overview', [['overview', 'Dashboard', 'grid', 'Company COST, spend layers and where to act']]],
    [
      'Portfolio',
      [
        ['customers', 'Customers', 'building', 'Billing, spend and COST by customer'],
        ['pms', 'Teams', 'users', 'COST by PM team, with bench and support'],
        ['people', 'People', 'user', 'Everyone, their allocations and salaries'],
        ['bench', 'Bench', 'pause', 'People on bench and what it costs'],
      ],
    ],
    [
      'Improve',
      [
        ['allocations', 'Allocations', 'swap', 'Who is on which customer, with live COST'],
        ['play', 'Play', 'sliders', 'Explore the best path to the COST target'],
        ['actions', 'Actions', 'check', 'Tracked actions and TATs'],
      ],
    ],
    [
      'Data',
      [
        ['checks', 'Data & validation', 'shield', 'Upload, validate, classify and correct the monthly data'],
        ['settings', 'Settings', 'cog', 'Aloha standard rates and rate revision'],
      ],
    ],
  ],
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
  return <Main viewer={viewer} />;
}

function Main({ viewer }) {
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
  const [navOpen, setNavOpen] = useState(false);

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
    if (location.hash !== h) history.replaceState(null, '', h + location.search);
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
    setNavOpen(false);
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
    <div className={`shell ${navOpen ? 'nav-open' : ''}`} onClick={(e) => navOpen && e.target === e.currentTarget && setNavOpen(false)}>
      <aside className="side">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <div className="brand-name">Aloha Technology</div>
            <div className="brand-sub">Project Costing</div>
          </div>
        </div>
        {groups.map(([title, list]) => (
          <div className="nav-group" key={title}>
            <div className="nav-title">{title}</div>
            {list.map(([id, label, icon]) => (
              <button key={id} className={`nav-item ${tab === id ? 'on' : ''}`} onClick={() => go(id)}>
                <Icon name={icon} />
                {label}
                {id === 'actions' && overdue > 0 && <span className="badge" title="Overdue">{overdue}</span>}
                {id === 'actions' && can.edit && closureRequests > 0 && <span className="badge good" title="Closure requested">{closureRequests}</span>}
              </button>
            ))}
          </div>
        ))}
        <div className="side-foot">
          <div className="who-name">{me.name}</div>
          <div className="who-role">{me.role}</div>
          {api.mode === 'cloud' && (
            <div style={{ marginTop: 8 }}>
              <button onClick={() => setChangingPw(true)}>Change password</button>
              <button onClick={viewer.signOut}>Sign out</button>
            </div>
          )}
        </div>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <button className="menu-btn" aria-label="Menu" onClick={() => setNavOpen((o) => !o)}>
            ☰
          </button>
          <div>
            <h1>{current[1]}</h1>
            <div className="page-sub">{current[3]}</div>
          </div>
          <div className="chips">
            <span className="chip">
              Period <strong>{model.period}</strong>
            </span>
            <span className="chip" title="Rate used to convert invoiced USD to INR (from the costing sheet)">
              US$1 = <strong>₹{model.fx?.toFixed(2)}</strong>
            </span>
            <span className="chip accent" title="COST is Aloha's name for actual profit %">
              COST target <strong>{Math.round(model.target * 100)}%</strong>
            </span>
            <Glossary target={model.target} />
          </div>
        </header>
        <main className="content">
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
          {tab === 'settings' && can.seeAll && <Settings master={master} can={can} key={master.loaded ? 'ready' : 'loading'} />}
        </main>
        {api.mode === 'preview' && (
          <div className="preview-bar">
            Previewing as <strong>{me.role === 'pm' ? pmsById[me.pmId]?.name || me.pmId : 'leadership'}</strong> (read-only).{' '}
            <a href={location.pathname}>Back to admin</a>
          </div>
        )}
        <footer>
          {ROLE_NOTE[me.role]} · {api.mode === 'cloud' ? 'published' : 'local data'} {new Date(model.generatedAt).toLocaleString()} · spend from payroll
          (CTC × allocation)
        </footer>
      </div>
    </div>
  );
}
