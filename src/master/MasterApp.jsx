// Master data: the foundation both apps build on. One place for customers (accounts, POCs,
// projects, rates, discounts, revision dates, campaigns), employees and PMs.
// Matt edits; leadership reads. Each field is stored where the app that uses it expects it,
// so an edit here is what Costing and Collections see.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import '../collections/collections.css';
import { Icon, AppSwitch } from '../views/shell.jsx';
import { useMaster, Settings } from '../views/Master.jsx';
import { masterDataApi } from './api.js';
import { employeeView, accountView, pmViews, unlinkedProjects, completeness } from './engine.js';
import { today } from '../collections/engine/dates.js';
import MasterOverview from './Overview.jsx';
import MasterCustomers from './Customers.jsx';
import { Employees, Pms } from './People.jsx';
import Campaigns from './Campaigns.jsx';
import Billing from './Billing.jsx';

const ALL = {
  overview: ['Overview', 'grid', 'How complete the foundation is, and what to fill in next'],
  customers: ['Customers', 'building', 'Accounts, POCs, projects, rates, discounts, revision dates'],
  billing: ['Billing', 'sliders', 'Seats and revenue by month, changes and reasons, resource types'],
  employees: ['Employees', 'user', 'Team, skills, experience at Aloha and before, pay'],
  pms: ['PMs', 'users', 'Experience, team size and billing per PM'],
  campaigns: ['Campaigns', 'chat', 'Special reach-outs to customers'],
  settings: ['Standard rates', 'cog', 'Aloha standard rates and revision cycle'],
};
const NAV = [
  ['Overview', ['overview']],
  ['Foundation', ['customers', 'billing', 'employees', 'pms']],
  ['Reach-out', ['campaigns']],
  ['Settings', ['settings']],
];
export const MASTER_PREFIX = 'm-';
const readHash = () => {
  const [t = '', f = ''] = location.hash.slice(1).split('/');
  return { tab: t.startsWith(MASTER_PREFIX) ? t.slice(MASTER_PREFIX.length) : '', focus: decodeURIComponent(f) };
};

// Loads everything Master data shows, from the existing Costing and Collections stores.
function useFoundation(viewer, colApi) {
  const { api, me } = viewer;
  const master = useMaster(api);
  const [state, setState] = useState({ loading: true });
  const [md, setMd] = useState(null);
  const load = useCallback(async () => {
    try {
      const mdApi = await masterDataApi(me);
      setMd(mdApi);
      const [model, col, profiles, contacts, billing] = await Promise.all([
        api.loadModel(),
        colApi.load(),
        mdApi.listPeopleProfiles().catch(() => ({})),
        me.role === 'admin' ? api.listContacts().catch(() => ({})) : Promise.resolve({}),
        mdApi.listBilling().catch(() => []),
      ]);
      setState({ loading: false, model, accounts: col.customers || [], invoices: col.invoices || [], profiles, contacts, billing });
    } catch (e) {
      setState({ loading: false, error: e.message });
    }
  }, [api, colApi, me]);
  useEffect(() => {
    load();
  }, [load]);

  const ops = {
    async saveAccount(a) {
      const [saved] = await colApi.put('customers', [a]);
      setState((s) => ({ ...s, accounts: s.accounts.some((x) => x.id === saved.id) ? s.accounts.map((x) => (x.id === saved.id ? saved : x)) : [...s.accounts, saved] }));
      return saved;
    },
    async saveAccounts(list) {
      const saved = await colApi.put('customers', list);
      const byId = Object.fromEntries(saved.map((x) => [x.id, x]));
      setState((s) => ({ ...s, accounts: s.accounts.map((x) => byId[x.id] || x) }));
    },
    async saveProfiles(rows) {
      const saved = await md.savePeopleProfiles(rows);
      setState((s) => ({ ...s, profiles: { ...s.profiles, ...Object.fromEntries(saved.map((r) => [r.emp_id, r])) } }));
    },
    async saveBilling(docs) {
      const saved = await md.saveBilling(docs);
      const byId = Object.fromEntries(saved.map((x) => [x.id, x]));
      setState((s) => ({ ...s, billing: [...s.billing.filter((x) => !byId[x.id]), ...saved] }));
    },
    async saveContact(pmId, c) {
      const saved = await api.saveContact(pmId, c);
      setState((s) => ({ ...s, contacts: { ...s.contacts, [pmId]: saved } }));
    },
  };
  return { ...state, master, ops, reload: load };
}

export default function MasterApp({ viewer, colApi, switches }) {
  const { me } = viewer;
  const tabs = NAV.flatMap(([, l]) => l);
  const f = useFoundation(viewer, colApi);
  const [{ tab, focus }, setRoute] = useState(() => {
    const h = readHash();
    return { tab: tabs.includes(h.tab) ? h.tab : 'overview', focus: h.focus };
  });
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    const prev = document.title;
    document.title = 'Aloha Master data';
    return () => {
      document.title = prev;
    };
  }, []);
  useEffect(() => {
    const onHash = () => {
      const h = readHash();
      if (tabs.includes(h.tab)) setRoute({ tab: h.tab, focus: h.focus });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const h = `#${MASTER_PREFIX}${tab}${focus ? '/' + encodeURIComponent(focus) : ''}`;
    if (location.hash !== h) history.replaceState(null, '', location.pathname + location.search + h);
  }, [tab, focus]);
  const go = (t, fc = '') => {
    setRoute({ tab: tabs.includes(t) ? t : 'overview', focus: fc });
    setNavOpen(false);
    window.scrollTo(0, 0);
  };

  const on = today();
  const derived = useMemo(() => {
    if (!f.model) return null;
    const model = f.model;
    const projectsByCode = Object.fromEntries((model.customers || []).map((c) => [c.code, c]));
    const pmsById = Object.fromEntries((model.pms || []).map((p) => [p.id, p]));
    const employeesById = Object.fromEntries((model.employees || []).map((e) => [e.empId, e]));
    const employees = (model.employees || []).map((e) => employeeView(e, f.profiles[e.empId], { on }));
    const accounts = f.accounts.map((a) => accountView(a, { projectsByCode, master: f.master, settings: f.master.settings, on, pmsById }));
    const pms = pmViews(model, employeesById, f.profiles, f.contacts, { on });
    const unlinked = unlinkedProjects(f.accounts, model.customers || []);
    // Resource types for the billing split: Aloha standard roles plus the ones on project rate cards.
    const roleOptions = [...new Set([...Object.keys(f.master.settings?.standardRates?.roles || {}), ...(model.customers || []).flatMap((c) => (c.seats || []).map((s) => s.role))])].filter(Boolean).sort();
    return { projectsByCode, pmsById, employees, accounts, pms, unlinked, roleOptions, completeness: completeness(accounts, employees) };
  }, [f.model, f.accounts, f.profiles, f.contacts, f.master, on]);

  const can = { edit: me.role === 'admin' && colApi.mode !== 'preview' && viewer.api.mode !== 'preview' };
  const [label, , sub] = ALL[tab];
  const ctx = { ...f, ...derived, me, go, focus, setFocus: (x) => setRoute((r) => ({ ...r, focus: x })), can, on, colApi, viewer };

  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''}`} onClick={(e) => navOpen && e.target === e.currentTarget && setNavOpen(false)}>
      <aside className="side">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <div className="brand-name">Aloha Technology</div>
            <div className="brand-sub">Master data</div>
          </div>
        </div>
        <AppSwitch items={switches} />
        {NAV.map(([title, list]) => (
          <div className="nav-group" key={title}>
            <div className="nav-title">{title}</div>
            {list.map((id) => (
              <button key={id} className={`nav-item ${tab === id ? 'on' : ''}`} onClick={() => go(id)}>
                <Icon name={ALL[id][1]} />
                {ALL[id][0]}
                {id === 'customers' && derived?.unlinked.length > 0 && <span className="badge good">{derived.unlinked.length}</span>}
              </button>
            ))}
          </div>
        ))}
        <div className="side-foot">
          <div className="who-name">{me.name}</div>
          <div className="who-role">{me.role}</div>
          {viewer.api?.mode === 'cloud' && (
            <div style={{ marginTop: 8 }}>
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
            <h1>{label}</h1>
            <div className="page-sub">{sub}</div>
          </div>
          {f.model && (
            <div className="chips">
              <span className="chip">
                Payroll & portal data <strong>{f.model.period}</strong>
              </span>
            </div>
          )}
        </header>
        <main className="content">
          {f.error && <div className="empty">{f.error}</div>}
          {f.loading && <div className="empty">Loading master data…</div>}
          {derived && (
            <>
              {tab === 'overview' && <MasterOverview {...ctx} />}
              {tab === 'customers' && <MasterCustomers {...ctx} />}
              {tab === 'billing' && <Billing {...ctx} />}
              {tab === 'employees' && <Employees {...ctx} />}
              {tab === 'pms' && <Pms {...ctx} />}
              {tab === 'campaigns' && <Campaigns {...ctx} />}
              {tab === 'settings' && <Settings master={f.master} can={can} key={f.master.loaded ? 'ready' : 'loading'} />}
            </>
          )}
        </main>
        <footer>
          {me.role === 'admin' ? 'Admin view' : 'Leadership view (read-only)'} · customer contacts, discounts and campaigns are shared with Collections; projects, rates and PMs with Project Costing ·
          what you enter here is never overwritten by the monthly payroll / HR refresh
        </footer>
      </div>
    </div>
  );
}
