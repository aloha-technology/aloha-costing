// Directory: the common information both Costing and Invoices build on — customers (accounts, POCs,
// projects, rates, discounts, revision dates), teams (PMs), employees, contracts, campaigns and
// standard rates. Matt edits; leadership reads. Each field is stored where the area that uses it
// reads it, so an edit here is what Costing and Invoices see.
import React, { useEffect, useMemo, useState } from 'react';
import '../collections/collections.css';
import { AppShell } from '../views/shell.jsx';
import { Settings } from '../views/Master.jsx';
import { useFoundation, useDerived } from './useFoundation.js';
import MasterOverview from './Overview.jsx';
import MasterCustomers from './Customers.jsx';
import { Employees, Pms } from './People.jsx';
import Campaigns from './Campaigns.jsx';
import Contracts from '../collections/views/Contracts.jsx';

const PAGES = {
  overview: ['Overview', 'grid', 'What is filled in and what to do next'],
  customers: ['Customers', 'building', 'Contacts, projects, rates and terms'],
  pms: ['Teams', 'users', 'PMs, their teams and billing'],
  employees: ['Employees', 'user', 'Team, skills, experience and pay'],
  contracts: ['Contracts', 'file', 'Signed contracts per customer'],
  campaigns: ['Campaigns', 'megaphone', 'Special reach-outs to customers'],
  settings: ['Standard rates', 'cog', 'Aloha standard rates and revision cycle'],
};
const NAV = [
  ['', ['overview']],
  ['People & customers', ['customers', 'pms', 'employees']],
  ['Records', ['contracts', 'campaigns']],
  ['Settings', ['settings']],
];
const groups = NAV.map(([t, ids]) => [t, ids.map((id) => [id, PAGES[id][0], PAGES[id][1]])]);
export const MASTER_PREFIX = 'm-';
const readHash = () => {
  const [t = '', f = ''] = location.hash.slice(1).split('/');
  return { tab: t.startsWith(MASTER_PREFIX) ? t.slice(MASTER_PREFIX.length) : '', focus: decodeURIComponent(f) };
};

export default function MasterApp({ viewer, colApi, shell }) {
  const { me } = viewer;
  const tabs = Object.keys(PAGES);
  const f = useFoundation(viewer, colApi);
  const { derived, on } = useDerived(f);
  const [{ tab, focus }, setRoute] = useState(() => {
    const h = readHash();
    // Old links to Billing (moved to Invoices) land on the overview.
    return { tab: tabs.includes(h.tab) ? h.tab : 'overview', focus: tabs.includes(h.tab) ? h.focus : '' };
  });
  useEffect(() => {
    const prev = document.title;
    document.title = 'Aloha · Directory';
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
    if (t === 'billing') return void (location.hash = `#c-billing${fc ? '/' + encodeURIComponent(fc) : ''}`);
    setRoute({ tab: tabs.includes(t) ? t : 'overview', focus: fc });
    window.scrollTo(0, 0);
  };

  const can = { edit: me.role === 'admin' && colApi.mode !== 'preview' && viewer.api.mode !== 'preview' };
  const ctx = { ...f, ...derived, me, go, focus, setFocus: (x) => setRoute((r) => ({ ...r, focus: x })), can, on, colApi, viewer };
  // The contracts screen is shared with Invoices; give it the shape it expects.
  const contractsCtx = useMemo(
    () => ({ data: { contracts: f.contracts || [], customers: f.accounts || [] }, byId: { customers: Object.fromEntries((f.accounts || []).map((c) => [c.id, c])) }, api: colApi, can, ops: f.ops, on, go }),
    [f.contracts, f.accounts, f.ops, colApi, can.edit, on] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [title, , sub] = PAGES[tab];

  return (
    <AppShell
      area="directory"
      {...shell}
      groups={groups}
      tab={tab}
      onTab={go}
      badges={{ customers: [{ n: derived?.unlinked.length || 0, tone: 'good', title: 'Projects not linked to a customer' }] }}
      title={title}
      sub={sub}
      me={me}
      account={
        viewer.api?.mode === 'cloud' && (
          <div style={{ marginTop: 8 }}>
            <button onClick={viewer.signOut}>Sign out</button>
          </div>
        )
      }
      footer={me.role === 'admin' ? null : 'Leadership view (read-only)'}
    >
      {f.error && <div className="empty">{f.error}</div>}
      {f.loading && <div className="empty">Loading…</div>}
      {derived && (
        <>
          {tab === 'overview' && <MasterOverview {...ctx} />}
          {tab === 'customers' && <MasterCustomers {...ctx} />}
          {tab === 'employees' && <Employees {...ctx} />}
          {tab === 'pms' && <Pms {...ctx} />}
          {tab === 'contracts' && <Contracts {...contractsCtx} />}
          {tab === 'campaigns' && <Campaigns {...ctx} />}
          {tab === 'settings' && <Settings master={f.master} can={can} key={f.master.loaded ? 'ready' : 'loading'} />}
        </>
      )}
    </AppShell>
  );
}
