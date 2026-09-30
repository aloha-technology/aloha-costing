import React, { useMemo, useState } from 'react';
import { Table } from '../views/ui.jsx';
import { ReviewTag } from '../views/Master.jsx';
import { Act, Modal, amt } from '../collections/views/parts.jsx';
import { projectCodesOf } from './engine.js';
import CustomerDetail from './CustomerDetail.jsx';

const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`);
const FILTERS = [
  ['active', 'Active'],
  ['all', 'All'],
  ['revision', 'Revision due'],
  ['missing', 'Missing details'],
];

export default function MasterCustomers(ctx) {
  const { focus, accounts } = ctx;
  // "?project=<code>" (from Costing): open the paying customer that owns the project.
  const project = focus?.startsWith('?project=') ? focus.slice(9) : null;
  const v = project ? accounts.find((a) => projectCodesOf(a.account).includes(project)) : focus && !focus.startsWith('?') ? accounts.find((a) => a.account.id === focus) : null;
  if (v) return <CustomerDetail {...ctx} v={v} />;
  return (
    <>
      {project && <div className="warnbox" style={{ marginBottom: 12 }}>That project isn’t linked to a paying customer yet. Link it under “Projects not linked” below.</div>}
      <AccountList {...ctx} missingFilter={focus?.startsWith('?missing=') ? focus.slice(9) : ''} />
    </>
  );
}

function AccountList({ accounts, unlinked, go, can, ops, missingFilter, setFocus }) {
  const [filter, setFilter] = useState(missingFilter ? 'missing' : 'active');
  const [q, setQ] = useState('');
  const rows = useMemo(
    () =>
      accounts
        .filter((v) => {
          const a = v.account;
          if (q && !`${a.name} ${a.legalName || ''} ${v.pms.join(' ')} ${(a.contacts || []).map((c) => `${c.name} ${c.email}`).join(' ')}`.toLowerCase().includes(q.toLowerCase())) return false;
          if (filter === 'active') return a.active !== false;
          if (filter === 'revision') return v.revisionStatus === 'due' || v.revisionStatus === 'soon';
          if (filter === 'missing') return a.active !== false && (missingFilter ? v.missing.includes(missingFilter) : v.missing.length > 0);
          return true;
        })
        .map((v) => ({ ...v, id: v.account.id, name: v.account.name })),
    [accounts, filter, q, missingFilter]
  );
  return (
    <>
      <div className="toolbar">
        <div className="seg">
          {FILTERS.map(([k, l]) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => (setFilter(k), setFocus(''))}>
              {l}
            </button>
          ))}
        </div>
        {filter === 'missing' && missingFilter && (
          <span className="chip">
            missing: <strong>{missingFilter}</strong>{' '}
            <a onClick={() => setFocus('')} style={{ marginLeft: 4 }}>
              ✕
            </a>
          </span>
        )}
        <input type="text" placeholder="Search name, PM, contact" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="card">
        <Table
          rowKey={(r) => r.id}
          onRowClick={(r) => go('customers', r.id)}
          initialSort={{ key: 'revenueUSD', dir: 'desc' }}
          columns={[
            { key: 'name', label: 'Customer (who pays)', render: (r) => <span className="wrap-cell">{r.name}{r.account.active === false && <span className="flag">closed</span>}</span> },
            { key: 'pms', label: 'PMs', sort: (r) => r.pms.join(), render: (r) => <span className="wrap-cell">{r.pms.join(', ') || '—'}</span> },
            { key: 'projects', label: 'Projects', align: 'right', sort: (r) => r.projects.length, render: (r) => r.projects.length || <span className="flag warn">none</span> },
            { key: 'seats', label: 'Billed seats', align: 'right' },
            { key: 'revenueUSD', label: 'Billing / month', align: 'right', render: (r) => (r.revenueUSD ? amt(r.revenueUSD) : '—') },
            { key: 'discountVsStandard', label: 'vs standard', align: 'right', render: (r) => (r.discountVsStandard == null ? '—' : r.discountVsStandard > 0.0005 ? `${pct(r.discountVsStandard)} off` : 'at/above') },
            { key: 'poc', label: 'Billing POC', sort: (r) => (r.billingContact ? 1 : 0), render: (r) => (r.billingContact ? <span className="wrap-cell">{r.billingContact.name || r.billingContact.email}<span className="sub">{r.billingContact.email}</span></span> : <span className="flag bad">missing</span>) },
            { key: 'revisionStatus', label: 'Rate revision', sort: (r) => r.nextRevision?.date || 'z', render: (r) => (r.revisionStatus ? <ReviewTag status={r.revisionStatus} /> : '—') },
          ]}
          rows={rows}
        />
      </div>
      {unlinked.length > 0 && <UnlinkedProjects unlinked={unlinked} accounts={accounts} can={can} ops={ops} />}
    </>
  );
}

// Costing projects that no paying customer claims yet: link them so both apps agree.
function UnlinkedProjects({ unlinked, accounts, can, ops }) {
  const [choice, setChoice] = useState({});
  const sorted = [...accounts].sort((a, b) => a.account.name.localeCompare(b.account.name));
  const link = async (project, accountId) => {
    const a = accounts.find((x) => x.account.id === accountId)?.account;
    if (!a) return;
    const codes = [...new Set([...projectCodesOf(a), project.code])];
    await ops.saveAccount({ ...a, projectCodes: codes, billingCode: codes.join(', ') });
  };
  return (
    <div className="card">
      <h2>Projects not linked to a paying customer ({unlinked.length})</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        Projects come from Project Costing; the paying customer from Collections (Zoho). Linking them puts PMs, seats, rates and dues in one place.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Project (Costing)</th>
              <th className="r">Billing / month</th>
              <th>Paying customer</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {unlinked.map(({ project, suggestion }) => {
              const sel = choice[project.code] ?? suggestion?.id ?? '';
              return (
                <tr key={project.code}>
                  <td className="wrap-cell">
                    {project.name} <span className="sub">{project.code}</span>
                  </td>
                  <td className="r">{project.revenueUSD ? amt(project.revenueUSD) : '—'}</td>
                  <td>
                    <select className="inline-in" value={sel} disabled={!can.edit} onChange={(e) => setChoice({ ...choice, [project.code]: e.target.value })} style={{ maxWidth: 320 }}>
                      <option value="">Choose…</option>
                      {sorted.map((v) => (
                        <option key={v.account.id} value={v.account.id}>
                          {v.account.name}
                          {suggestion?.id === v.account.id ? ' (suggested)' : ''}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{can.edit && <Act disabled={!sel} onClick={() => link(project, sel)}>Link</Act>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const OUTCOMES = ['Sent', 'Replied', 'Interested', 'Meeting booked', 'Won', 'Not interested', 'No response'];
export const OUTCOME_TONE = { Won: 'good', 'Meeting booked': 'good', Interested: 'good', Replied: 'info', Sent: '', 'No response': 'warn', 'Not interested': 'bad' };

// Log one reach-out on one or many accounts (used here and on the Campaigns page).
export function CampaignForm({ accounts, ops, me, onClose, names = [] }) {
  const [f, setF] = useState({ name: '', date: new Date().toISOString().slice(0, 10), channel: 'Email', contact: '', outcome: 'Sent', notes: '' });
  const set = (k, val) => setF((x) => ({ ...x, [k]: val }));
  const one = accounts.length === 1;
  return (
    <Modal
      title={one ? `Log reach-out: ${accounts[0].name}` : `Log reach-out for ${accounts.length} customers`}
      onClose={onClose}
      footer={
        <Act
          className="primary"
          disabled={!f.name.trim()}
          onClick={async () => {
            const entry = { ...f, name: f.name.trim(), by: me?.name || 'Matt', at: new Date().toISOString() };
            await ops.saveAccounts(accounts.map((a) => ({ ...a, campaigns: [...(a.campaigns || []), one ? entry : { ...entry, contact: '' }] })));
            onClose();
          }}
        >
          Save
        </Act>
      }
    >
      <div className="form-grid">
        <label className="wide">
          Campaign
          <input list="campaign-names" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Referral ask Q4 2026, Rate revision 2026, AI services offer" autoFocus />
          <datalist id="campaign-names">
            {names.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </label>
        <label>
          Date
          <input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} />
        </label>
        <label>
          Channel
          <select value={f.channel} onChange={(e) => set('channel', e.target.value)}>
            {['Email', 'Call', 'Meeting', 'LinkedIn', 'WhatsApp', 'Event'].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        {one && (
          <label>
            Contacted
            <select value={f.contact} onChange={(e) => set('contact', e.target.value)}>
              <option value="">—</option>
              {(accounts[0].contacts || []).map((c, i) => (
                <option key={i} value={c.name || c.email}>
                  {c.name || c.email}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Outcome
          <select value={f.outcome} onChange={(e) => set('outcome', e.target.value)}>
            {OUTCOMES.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
        <label className="wide">
          Notes
          <textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}
