// Invoices area: dues and follow-up, payments, tax invoices, the monthly billing register and reports.
// Matt (admin) works here; leadership reads; the accounts team only sees the tax-invoice portal.
// Customer contacts, contracts and rates are kept in Directory.
import React, { useEffect, useMemo, useState } from 'react';
import './collections.css';
import { AppShell } from '../views/shell.jsx';
import BillingPage from '../master/BillingPage.jsx';
import { useCollections } from './useCollections.js';
import { buildQueue } from './engine/reminders.js';
import { daysBetween, fmtDate } from './engine/dates.js';
import Dashboard from './views/Dashboard.jsx';
import Customers from './views/Customers.jsx';
import Invoices from './views/Invoices.jsx';
import Reminders from './views/Reminders.jsx';
import Payments from './views/Payments.jsx';
import TaxInvoices from './views/TaxInvoices.jsx';
import Reports from './views/Reports.jsx';
import Setup from './views/Setup.jsx';
import Settings from './views/Settings.jsx';

const ALL = {
  dashboard: ['Dashboard', 'grid', 'Pending by customer, month, PM and age'],
  reminders: ['Reminders', 'bell', 'Today’s follow-up emails, outbox and sent log'],
  customers: ['Dues by customer', 'building', 'Open invoices, notes and next actions per customer'],
  invoices: ['Invoices', 'receipt', 'Every invoice with its reminder controls'],
  payments: ['Payments', 'card', 'Money received, bank charges and payer check'],
  tax: ['Tax invoices', 'shield', 'Uploaded by accounts, checked and sent by Matt'],
  billing: ['Billing', 'chart', 'Seats and revenue by month, with changes and reasons'],
  reports: ['Reports', 'file', 'Receivables report for Sid (Excel)'],
  setup: ['Setup & import', 'upload', 'Confirm customers, import the latest Zoho export'],
  settings: ['Settings', 'cog', 'Timeline, templates, escalation contacts'],
};
const NAV = {
  admin: [
    ['', ['dashboard']],
    ['Follow-up', ['reminders', 'customers', 'invoices']],
    ['Money in', ['payments', 'tax']],
    ['Billing', ['billing', 'reports']],
    ['Admin', ['setup', 'settings']],
  ],
  leadership: [
    ['', ['dashboard']],
    ['Follow-up', ['reminders', 'customers', 'invoices']],
    ['Money in', ['payments', 'tax']],
    ['Billing', ['billing', 'reports']],
  ],
  accounts: [['Accounts', ['tax']]],
};

export const COL_PREFIX = 'c-';
const readHash = () => {
  const [t = '', f = ''] = location.hash.slice(1).split('/');
  return { tab: t.startsWith(COL_PREFIX) ? t.slice(COL_PREFIX.length) : '', focus: decodeURIComponent(f) };
};

export default function CollectionsApp({ viewer, api, shell }) {
  const { me } = viewer;
  const groups = NAV[me.role] || [];
  const tabs = groups.flatMap(([, l]) => l);
  const col = useCollections(api, me);
  const [{ tab, focus }, setRoute] = useState(() => {
    const h = readHash();
    return { tab: tabs.includes(h.tab) ? h.tab : tabs[0], focus: h.focus };
  });
  useEffect(() => {
    const prev = document.title;
    document.title = 'Aloha · Invoices';
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
    if (location.hash !== h) history.replaceState(null, '', location.pathname + location.search + h);
  }, [tab, focus]);

  const go = (t, f = '') => {
    setRoute({ tab: tabs.includes(t) ? t : tabs[0], focus: tabs.includes(t) ? f : '' });
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
    <AppShell
      area="invoices"
      {...shell}
      groups={groups.map(([t, ids]) => [t, ids.map((id) => [id, ALL[id][0], ALL[id][1]])])}
      tab={tab}
      onTab={go}
      badges={Object.fromEntries(Object.entries(badges).map(([id, n]) => [id, [{ n, tone: id === 'setup' ? 'good' : '' }]]))}
      title={label}
      sub={sub}
      me={me}
      chips={
        me.role !== 'accounts' &&
        last && (
          <span className={`chip ${stale > 7 ? 'stale' : ''}`} title={`Last import ${fmtDate(last.at?.slice(0, 10))} from ${last.source || 'Zoho'}`}>
            Zoho data as of <strong>{fmtDate(last.asOf)}</strong>
            {stale > 7 && me.role === 'admin' && (
              <a onClick={() => go('setup')} style={{ marginLeft: 4 }}>
                import latest
              </a>
            )}
          </span>
        )
      }
      account={
        viewer.api?.mode === 'cloud' && (
          <div style={{ marginTop: 8 }}>
            <button onClick={viewer.signOut}>Sign out</button>
          </div>
        )
      }
      preview={
        api.mode === 'preview' && (
          <div className="preview-bar">
            Previewing as <strong>{me.role}</strong>
            {api.readOnly ? ' (read-only)' : ''}. <a href={location.pathname + '#c-dashboard'}>Back to admin</a>
          </div>
        )
      }
      footer={me.role === 'accounts' ? 'Accounts portal · tax invoices only' : me.role === 'leadership' ? 'Leadership view (read-only)' : null}
    >
      {tab === 'dashboard' && <Dashboard {...ctx} />}
      {tab === 'reminders' && <Reminders {...ctx} />}
      {tab === 'customers' && <Customers {...ctx} />}
      {tab === 'invoices' && <Invoices {...ctx} />}
      {tab === 'payments' && <Payments {...ctx} />}
      {tab === 'tax' && <TaxInvoices {...ctx} />}
      {tab === 'billing' && <BillingPage viewer={viewer} api={api} me={me} can={ctx.can} focus={focus} setFocus={ctx.setFocus} />}
      {tab === 'reports' && <Reports {...ctx} />}
      {tab === 'setup' && <Setup {...ctx} />}
      {tab === 'settings' && <Settings {...ctx} />}
    </AppShell>
  );
}
