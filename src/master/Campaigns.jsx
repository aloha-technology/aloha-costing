import React, { useMemo, useState } from 'react';
import { fmtDate } from '../collections/views/parts.jsx';
import { campaignRows } from './engine.js';
import { CampaignForm, OUTCOME_TONE } from './Customers.jsx';

export default function Campaigns({ accounts, ops, can, go, me }) {
  const rows = useMemo(() => campaignRows(accounts.map((v) => v.account)), [accounts]);
  const names = [...new Set(rows.map((r) => r.name))];
  const [name, setName] = useState('');
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState(new Set());
  const [logging, setLogging] = useState(false);
  const shown = rows.filter((r) => !name || r.name === name);
  const summary = names.map((n) => {
    const list = rows.filter((r) => r.name === n);
    return { name: n, reached: new Set(list.map((r) => r.accountId)).size, positive: list.filter((r) => ['Interested', 'Meeting booked', 'Won', 'Replied'].includes(r.outcome)).length, won: list.filter((r) => r.outcome === 'Won').length, last: list[0]?.date };
  });
  const active = accounts.filter((v) => v.account.active !== false).sort((a, b) => b.revenueUSD - a.revenueUSD);
  return (
    <>
      <div className="toolbar">
        {can.edit && (
          <button className="primary" onClick={() => setPicking(true)}>
            + New reach-out to several customers
          </button>
        )}
        <select value={name} onChange={(e) => setName(e.target.value)} aria-label="Campaign">
          <option value="">All campaigns</option>
          {names.map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </div>
      {summary.length > 0 && (
        <div className="card">
          <h2>Campaigns</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th className="r">Customers reached</th>
                  <th className="r">Positive replies</th>
                  <th className="r">Won</th>
                  <th>Last touch</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((s) => (
                  <tr key={s.name} className="click" onClick={() => setName(s.name)}>
                    <td>{s.name}</td>
                    <td className="r">{s.reached}</td>
                    <td className="r">{s.positive}</td>
                    <td className="r">{s.won}</td>
                    <td>{fmtDate(s.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="card">
        <h2>Reach-outs{name && `: ${name}`}</h2>
        {!shown.length ? (
          <div className="empty small">No reach-outs logged yet. Use this for special campaigns: referral asks, rate revisions, new-service offers, renewals.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Campaign</th>
                  <th>Channel</th>
                  <th>Contacted</th>
                  <th>Outcome</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={i} className="click" onClick={() => go('customers', r.accountId)}>
                    <td>{fmtDate(r.date)}</td>
                    <td className="wrap-cell">{r.accountName}</td>
                    <td>{r.name}</td>
                    <td>{r.channel}</td>
                    <td>{r.contact || '—'}</td>
                    <td>{r.outcome && <span className={`flag ${OUTCOME_TONE[r.outcome] || ''}`}>{r.outcome}</span>}</td>
                    <td className="wrap-cell muted">{r.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {picking && (
        <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && setPicking(false)}>
          <div className="modal wide">
            <div className="modal-head">
              <h2>Choose customers ({picked.size})</h2>
              <button className="linkish" onClick={() => setPicking(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="row" style={{ marginTop: 0, marginBottom: 8 }}>
                <button className="small" onClick={() => setPicked(new Set(active.map((v) => v.account.id)))}>
                  All active ({active.length})
                </button>
                <button className="small" onClick={() => setPicked(new Set())}>
                  None
                </button>
              </div>
              {active.map((v) => (
                <label key={v.account.id} className="check" style={{ display: 'flex', gap: 8, padding: '3px 0', fontSize: 13 }}>
                  <input type="checkbox" checked={picked.has(v.account.id)} onChange={() => setPicked((s) => { const n = new Set(s); n.has(v.account.id) ? n.delete(v.account.id) : n.add(v.account.id); return n; })} />
                  {v.account.name} <span className="muted">{v.pms.join(', ')}</span>
                </label>
              ))}
            </div>
            <div className="modal-foot">
              <button className="primary" disabled={!picked.size} onClick={() => (setPicking(false), setLogging(true))}>
                Next
              </button>
            </div>
          </div>
        </div>
      )}
      {logging && <CampaignForm accounts={accounts.filter((v) => picked.has(v.account.id)).map((v) => v.account)} ops={ops} me={me} names={names} onClose={() => (setLogging(false), setPicked(new Set()))} />}
    </>
  );
}
