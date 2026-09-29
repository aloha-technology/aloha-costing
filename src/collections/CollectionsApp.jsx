// Aloha Collections: pending-invoice follow-up, payments, contracts and tax invoices.
// Matt (admin) works here; leadership reads; the accounts team only sees the tax-invoice portal.
import React, { useEffect, useMemo, useState } from 'react';
import './collections.css';
import { Icon, AppSwitch } from '../views/shell.jsx';
import { useCollections } from './useCollections.js';
import { buildQueue } from './engine/reminders.js';
import { daysBetween, fmtDate } from './engine/dates.js';
import Dashboard from './views/Dashboard.jsx';
import Customers from './views/Customers.jsx';
import Invoices from './views/Invoices.jsx';
import Reminders from './views/Reminders.jsx';
import Payments from './views/Payments.jsx';
import TaxInvoices from './views/TaxInvoices.jsx';
import Contracts from './views/Contracts.jsx';
import Reports from './views/Reports.jsx';
import Setup from './views/Setup.jsx';
import Settings from './views/Settings.jsx';

const ALL = {
  dashboard: ['Dashboard', 'grid', 'Pending by customer, month, PM and age'],
  reminders: ['Reminders', 'chat', 'Today’s follow-up emails, outbox and sent log'],
  customers: ['Customers', 'building', 'Contacts, PMs, dues, notes and next actions'],
  invoices: ['Invoices', 'check', 'Every invoice with its reminder controls'],
  payments: ['Payments', 'sliders', 'Record money received, bank charges and payer check'],
  tax: ['Tax invoices', 'shield', 'Uploaded by accounts, checked and sent by Matt'],
  contracts: ['Contracts', 'user', 'Customer contracts repository'],
  reports: ['Reports', 'pause', 'Receivables report for Sid (Excel)'],
  setup: ['Setup & import', 'users', 'Confirm customers, import the latest Zoho export'],
  settings: ['Settings', 'cog', 'Timeline, templates, escalation contacts'],
};
const NAV = {
  admin: [
    ['Overview', ['dashboard']],
    ['Follow-up', ['reminders', 'customers', 'invoices']],
    ['Money in', ['payments', 'tax']],
    ['Records', ['contracts', 'reports']],
    ['Admin', ['setup', 'settings']],
  ],
  leadership: [
    ['Overview', ['dashboard']],
    ['Follow-up', ['reminders', 'customers', 'invoices']],
    ['Money in', ['payments', 'tax']],
    ['Records', ['contracts', 'reports']],
  ],
  accounts: [['Accounts', ['tax']]],
};

export const COL_PREFIX = 'c-';
const readHash = () => {
  const [t = '', f = ''] = location.hash.slice(1).split('/');
  return { tab: t.startsWith(COL_PREFIX) ? t.slice(COL_PREFIX.length) : '', focus: decodeURIComponent(f) };
};

export default function CollectionsApp({ viewer, api, switches }) {
  const { me } = viewer;
  const groups = NAV[me.role] || [];
  const tabs = groups.flatMap(([, l]) => l);
  const col = useCollections(api, me);
  const [{ tab, focus }, setRoute] = useState(() => {
    const h = readHash();
    return { tab: tabs.includes(h.tab) ? h.tab : tabs[0], focus: h.focus };
  });
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    const prev = document.title;
    document.title = 'Aloha Collections';
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
  }, [tabs]);
  useEffect(() => {
    const h = `#${COL_PREFIX}${tab}${focus ? '/' + encodeURIComponent(focus) : ''}`;
    if (location.hash !== h) history.replaceState(null, '', h + location.search);
  }, [tab, focus]);

  const go = (t, f = '') => {
    setRoute({ tab: tabs.includes(t) ? t : tabs[0], focus: tabs.includes(t) ? f : '' });
    setNavOpen(false);
    window.scrollTo(0, 0);
  };

  const { data, error, settings, on } = col;
  const badges = useMemo(() => {
    if (!data) return {};
    const q = me.role === 'accounts' ? [] : buildQueue(data.customers, data.invoices, settings, on);
    return {
      reminders: q.filter((x) => !x.blocked).length + data.outbox.filter((e) => e.status === 'failed').length,
      tax: me.role === 'accounts' ? data.taxInvoices.filter((t) => t.status === 'rejected').length : data.taxInvoices.filter((t) => t.status === 'uploaded').length,
      setup: data.customers.filter((c) => !c.confirmed && data.invoices.some((i) => i.customerId === c.id && i.status === 'open')).length,
    };
  }, [data, settings, on, me.role]);

  if (error) return <div className="empty">{error}</div>;
  if (!data) return <div className="empty">Loading Collections…</div>;

  const [label, , sub] = ALL[tab];
  const ctx = { ...col, me, go, focus, setFocus: (f) => setRoute((r) => ({ ...r, focus: f })), can: { edit: me.role === 'admin' && !api.readOnly } };
  const last = data.settings?.lastImport;
  const stale = last?.asOf ? daysBetween(last.asOf, on) : null;

  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''}`} onClick={(e) => navOpen && e.target === e.currentTarget && setNavOpen(false)}>
      <aside className="side">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <div className="brand-name">Aloha Technology</div>
            <div className="brand-sub">Collections</div>
          </div>
        </div>
        <AppSwitch items={switches} />
        {groups.map(([title, list]) => (
          <div className="nav-group" key={title}>
            <div className="nav-title">{title}</div>
            {list.map((id) => (
              <button key={id} className={`nav-item ${tab === id ? 'on' : ''}`} onClick={() => go(id)}>
                <Icon name={ALL[id][1]} />
                {ALL[id][0]}
                {badges[id] > 0 && <span className={`badge ${id === 'setup' ? 'good' : ''}`}>{badges[id]}</span>}
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
          {me.role !== 'accounts' && (
            <div className="chips">
              <span className="chip">
                Today <strong>{fmtDate(on)}</strong>
              </span>
              {last && (
                <span className={`chip ${stale > 7 ? 'stale' : ''}`} title={`Last import ${fmtDate(last.at?.slice(0, 10))} from ${last.source || 'Zoho'}`}>
                  Zoho data as of <strong>{fmtDate(last.asOf)}</strong>
                  {stale > 7 && me.role === 'admin' && (
                    <a onClick={() => go('setup')} style={{ marginLeft: 4 }}>
                      import latest
                    </a>
                  )}
                </span>
              )}
            </div>
          )}
        </header>
        <main className="content">
          {tab === 'dashboard' && <Dashboard {...ctx} />}
          {tab === 'reminders' && <Reminders {...ctx} />}
          {tab === 'customers' && <Customers {...ctx} />}
          {tab === 'invoices' && <Invoices {...ctx} />}
          {tab === 'payments' && <Payments {...ctx} />}
          {tab === 'tax' && <TaxInvoices {...ctx} />}
          {tab === 'contracts' && <Contracts {...ctx} />}
          {tab === 'reports' && <Reports {...ctx} />}
          {tab === 'setup' && <Setup {...ctx} />}
          {tab === 'settings' && <Settings {...ctx} />}
        </main>
        {api.mode === 'preview' && (
          <div className="preview-bar">
            Previewing as <strong>{me.role}</strong>
            {api.readOnly ? ' (read-only)' : ''}. <a href={location.pathname + '#c-dashboard'}>Back to admin</a>
          </div>
        )}
        <footer>
          {me.role === 'accounts' ? 'Accounts portal · tax invoices only' : me.role === 'leadership' ? 'Leadership view (read-only)' : 'Admin view'} ·{' '}
          {api.mode === 'cloud' ? 'live data' : 'local data'} · no email goes to a customer without Matt’s approval unless a stage is set to auto-send
        </footer>
      </div>
    </div>
  );
}
