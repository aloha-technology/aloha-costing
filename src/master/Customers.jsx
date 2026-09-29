import React, { useMemo, useState } from 'react';
import { Table } from '../views/ui.jsx';
import { RateCardCard, ProfileCard, ReviewTag } from '../views/Master.jsx';
import { Act, Modal, amt, fmtDate } from '../collections/views/parts.jsx';
import { projectCodesOf } from './engine.js';

const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`);
const FILTERS = [
  ['active', 'Active'],
  ['all', 'All'],
  ['revision', 'Revision due'],
  ['missing', 'Missing details'],
];

export default function MasterCustomers(ctx) {
  const { focus, accounts } = ctx;
  const v = focus && !focus.startsWith('?') ? accounts.find((a) => a.account.id === focus) : null;
  if (v) return <AccountDetail {...ctx} v={v} />;
  return <AccountList {...ctx} missingFilter={focus?.startsWith('?missing=') ? focus.slice(9) : ''} />;
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

function AccountDetail(ctx) {
  const { v, go, can, ops, projectsByCode, master, pmsById, unlinked } = ctx;
  const a = v.account;
  const [editing, setEditing] = useState(null); // 'pocs' | 'terms' | 'campaign'
  const [openProject, setOpenProject] = useState(null);
  const [linkCode, setLinkCode] = useState('');
  const setCodes = (codes) => ops.saveAccount({ ...a, projectCodes: codes, billingCode: codes.join(', ') });
  const sd = a.specialDiscount;
  return (
    <>
      <button className="back" onClick={() => go('customers')}>
        ← All customers
      </button>
      <div className="title-row">
        <h2>{a.name}</h2>
        {a.active === false && <span className="flag">closed account</span>}
        {v.missing.map((m) => (
          <span key={m} className="flag warn">
            no {m}
          </span>
        ))}
        <span className="spacer" />
        <a className="btn" href={`#c-customers/${encodeURIComponent(a.id)}`}>
          Dues in Collections →
        </a>
      </div>

      <div className="kpis compact-kpis">
        <div className="kpi">
          <div className="kpi-label">Billing / month</div>
          <div className="kpi-value">{v.revenueUSD ? amt(v.revenueUSD) : '—'}</div>
          <div className="kpi-note">
            {v.seats} billed seats · {v.assigned} people assigned · {v.projects.length} project{v.projects.length === 1 ? '' : 's'}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Rates vs Aloha standard</div>
          <div className="kpi-value">{v.discountVsStandard == null ? '—' : v.discountVsStandard > 0.0005 ? `${pct(v.discountVsStandard)} off` : 'at/above'}</div>
          <div className="kpi-note">from the project rate cards</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Special discount</div>
          <div className="kpi-value">{sd?.pct ? `${sd.pct}%` : '—'}</div>
          <div className="kpi-note">{sd?.pct ? `${sd.reason || 'no reason'}${sd.validTill ? ` · till ${fmtDate(sd.validTill)}` : ''}` : 'none agreed'}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Next rate revision</div>
          <div className="kpi-value" style={{ fontSize: 15 }}>
            {v.nextRevision ? fmtDate(v.nextRevision.date) : '—'}
          </div>
          <div className="kpi-note">{v.revisionStatus ? <ReviewTag status={v.revisionStatus} /> : 'no rate card'}</div>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="title-row" style={{ marginBottom: 6 }}>
            <h2 style={{ margin: 0 }}>Points of contact</h2>
            <span className="spacer" />
            {can.edit && (
              <button className="small" onClick={() => setEditing('pocs')}>
                Edit
              </button>
            )}
          </div>
          {(a.contacts || []).length ? (
            <div className="table-wrap">
              <table>
                <tbody>
                  {a.contacts.map((c, i) => (
                    <tr key={i}>
                      <td className="wrap-cell">
                        <strong>{c.name || '—'}</strong>
                        <span className="sub">{c.title || ''}</span>
                      </td>
                      <td className="wrap-cell">
                        {c.email || <span className="muted">no email</span>}
                        <span className="sub">{c.phone || 'no phone'}</span>
                      </td>
                      <td>
                        <span className="flag info">{{ billing: 'Billing', escalation: 'Escalation', cc: 'Cc', other: 'Other' }[c.role || 'billing']}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="muted">No contacts yet.</div>
          )}
          <p className="hint" style={{ marginBottom: 0 }}>Billing contacts get Collections reminders; escalation contacts are copied from Day 30.</p>
        </div>
        <div className="card">
          <div className="title-row" style={{ marginBottom: 6 }}>
            <h2 style={{ margin: 0 }}>Commercial terms</h2>
            <span className="spacer" />
            {can.edit && (
              <button className="small" onClick={() => setEditing('terms')}>
                Edit
              </button>
            )}
          </div>
          <div className="kv">
            <div>
              <div className="k">Name in contract</div>
              <div className="v">{a.legalName || '—'}</div>
            </div>
            <div>
              <div className="k">Payment terms</div>
              <div className="v">Net {a.paymentTermsDays || 15}</div>
            </div>
            <div>
              <div className="k">Entity · currency</div>
              <div className="v">
                {a.entity || '—'} · {a.currency || 'USD'}
              </div>
            </div>
            <div>
              <div className="k">PMs</div>
              <div className="v">{v.pms.join(', ') || a.pm?.name || '—'}</div>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <div className="k">Special discount</div>
              <div className="v">{sd?.pct ? `${sd.pct}% · ${sd.reason || 'no reason recorded'}${sd.validTill ? ` · valid till ${fmtDate(sd.validTill)}` : ''}` : 'None'}</div>
            </div>
            {a.accountNotes && (
              <div style={{ gridColumn: '1 / -1' }}>
                <div className="k">Notes</div>
                <div className="v">{a.accountNotes}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="title-row" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>Projects, rates and revision dates</h2>
          <span className="spacer" />
          {can.edit && (
            <>
              <select className="inline-in" value={linkCode} onChange={(e) => setLinkCode(e.target.value)} style={{ maxWidth: 280 }}>
                <option value="">Link a project…</option>
                {unlinked.map(({ project }) => (
                  <option key={project.code} value={project.code}>
                    {project.name}
                  </option>
                ))}
              </select>
              <Act disabled={!linkCode} onClick={async () => (await setCodes([...projectCodesOf(a), linkCode]), setLinkCode(''))}>
                Link
              </Act>
            </>
          )}
        </div>
        {!v.projects.length && <div className="muted">No project linked. Link the Costing project(s) this customer pays for.</div>}
        {v.projects.map((p) => (
          <div key={p.code} className="q-card">
            <div className="q-head">
              <strong>{p.name}</strong>
              <span className="muted">{p.code}</span>
              {!p.known && <span className="flag warn">not in this month’s Costing data</span>}
              <span className="muted">
                · {p.pmIds.map((id) => pmsById[id]?.name || id).join(', ') || 'no PM'} · {p.seats} billed seats ({p.assigned} assigned) · {p.revenueUSD ? `${amt(p.revenueUSD)}/month` : 'no billing'}
              </span>
              {p.rateCard && <ReviewTag status={p.rateCard.status} />}
              <span className="spacer" />
              {p.known && (
                <button className="small" onClick={() => setOpenProject(openProject === p.code ? null : p.code)}>
                  {openProject === p.code ? 'Hide' : 'Rate card & profile'}
                </button>
              )}
              {can.edit && (
                <Act onClick={() => setCodes(projectCodesOf(a).filter((c) => c !== p.code))} confirm={`Unlink ${p.name} from ${a.name}?`}>
                  Unlink
                </Act>
              )}
            </div>
            {openProject === p.code && projectsByCode[p.code] && (
              <div style={{ marginTop: 10 }}>
                <RateCardCard c={projectsByCode[p.code]} master={master} can={can} />
                <ProfileCard c={projectsByCode[p.code]} master={master} can={can} pmsById={pmsById} />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="card">
        <div className="title-row" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>Campaign reach-outs</h2>
          <span className="spacer" />
          {can.edit && (
            <button className="small" onClick={() => setEditing('campaign')}>
              + Log reach-out
            </button>
          )}
        </div>
        {v.campaigns.length ? (
          <ul className="activity">
            {[...v.campaigns]
              .sort((x, y) => (y.date || '').localeCompare(x.date || ''))
              .map((c, i) => (
                <li key={i}>
                  <span className="when">
                    {fmtDate(c.date)} · {c.channel || 'email'} · {c.by}
                  </span>
                  <div>
                    <strong>{c.name}</strong>
                    {c.contact && ` → ${c.contact}`} {c.outcome && <span className={`flag ${OUTCOME_TONE[c.outcome]}`}>{c.outcome}</span>}
                  </div>
                  {c.notes && <div className="muted small-text">{c.notes}</div>}
                </li>
              ))}
          </ul>
        ) : (
          <div className="muted">No special reach-outs logged (e.g. referral ask, rate revision, new-service offer).</div>
        )}
      </div>

      {editing === 'pocs' && <PocEditor a={a} ops={ops} onClose={() => setEditing(null)} />}
      {editing === 'terms' && <TermsEditor a={a} ops={ops} onClose={() => setEditing(null)} />}
      {editing === 'campaign' && <CampaignForm accounts={[a]} ops={ops} me={ctx.me} onClose={() => setEditing(null)} />}
    </>
  );
}

export const OUTCOMES = ['Sent', 'Replied', 'Interested', 'Meeting booked', 'Won', 'Not interested', 'No response'];
export const OUTCOME_TONE = { Won: 'good', 'Meeting booked': 'good', Interested: 'good', Replied: 'info', Sent: '', 'No response': 'warn', 'Not interested': 'bad' };

function PocEditor({ a, ops, onClose }) {
  const [list, setList] = useState(() => ((a.contacts || []).length ? a.contacts : [{ name: '', email: '', phone: '', title: '', role: 'billing' }]));
  const set = (i, k, val) => setList(list.map((c, j) => (j === i ? { ...c, [k]: val } : c)));
  return (
    <Modal
      title={`Points of contact: ${a.name}`}
      wide
      onClose={onClose}
      footer={
        <Act
          className="primary"
          onClick={async () => {
            await ops.saveAccount({ ...a, contacts: list.filter((c) => c.name.trim() || (c.email || '').trim() || (c.phone || '').trim()).map((c) => ({ ...c, email: (c.email || '').trim().toLowerCase(), name: c.name.trim(), phone: (c.phone || '').trim() })) });
            onClose();
          }}
        >
          Save
        </Act>
      }
    >
      {list.map((c, i) => (
        <div key={i} className="contact-row" style={{ gridTemplateColumns: '1.1fr 1fr 1.5fr 1fr 1fr auto' }}>
          <input className="inline-in" placeholder="Name" value={c.name} onChange={(e) => set(i, 'name', e.target.value)} />
          <input className="inline-in" placeholder="Title (e.g. AP, CFO)" value={c.title || ''} onChange={(e) => set(i, 'title', e.target.value)} />
          <input className="inline-in" placeholder="email@customer.com" value={c.email || ''} onChange={(e) => set(i, 'email', e.target.value)} />
          <input className="inline-in" placeholder="+1 555 …" value={c.phone || ''} onChange={(e) => set(i, 'phone', e.target.value)} />
          <select className="inline-in" value={c.role || 'billing'} onChange={(e) => set(i, 'role', e.target.value)}>
            <option value="billing">Billing</option>
            <option value="escalation">Escalation</option>
            <option value="cc">Cc always</option>
            <option value="other">Other (not emailed)</option>
          </select>
          <button className="linkish" onClick={() => setList(list.filter((_, j) => j !== i))}>
            remove
          </button>
        </div>
      ))}
      <button className="small" onClick={() => setList([...list, { name: '', email: '', phone: '', title: '', role: 'billing' }])}>
        + Add contact
      </button>
    </Modal>
  );
}

function TermsEditor({ a, ops, onClose }) {
  const [f, setF] = useState({ legalName: a.legalName || '', paymentTermsDays: a.paymentTermsDays || 15, entity: a.entity || '', currency: a.currency || 'USD', active: a.active !== false, accountNotes: a.accountNotes || '', sdPct: a.specialDiscount?.pct ?? '', sdReason: a.specialDiscount?.reason || '', sdTill: a.specialDiscount?.validTill || '' });
  const set = (k, val) => setF((x) => ({ ...x, [k]: val }));
  return (
    <Modal
      title={`Commercial terms: ${a.name}`}
      wide
      onClose={onClose}
      footer={
        <Act
          className="primary"
          disabled={Number(f.sdPct) > 0 && !f.sdReason.trim()}
          onClick={async () => {
            const { sdPct, sdReason, sdTill, ...rest } = f;
            await ops.saveAccount({ ...a, ...rest, paymentTermsDays: Number(f.paymentTermsDays) || 15, specialDiscount: Number(sdPct) > 0 ? { pct: Number(sdPct), reason: sdReason.trim(), validTill: sdTill || null } : null });
            onClose();
          }}
        >
          Save
        </Act>
      }
    >
      <div className="form-grid">
        <label className="wide">
          Customer name exactly as in the contract (used for the payer check)
          <input value={f.legalName} onChange={(e) => set('legalName', e.target.value)} />
        </label>
        <label>
          Payment terms (days)
          <input type="number" value={f.paymentTermsDays} onChange={(e) => set('paymentTermsDays', e.target.value)} />
        </label>
        <label>
          Billing entity
          <select value={f.entity} onChange={(e) => set('entity', e.target.value)}>
            <option value="">—</option>
            <option>IND</option>
            <option>SGP</option>
            <option>US</option>
          </select>
        </label>
        <label>
          Currency
          <select value={f.currency} onChange={(e) => set('currency', e.target.value)}>
            {['USD', 'INR', 'SGD', 'EUR', 'GBP', 'AUD', 'CAD'].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} /> Active customer
        </label>
        <label>
          Special discount %
          <input type="number" step="0.5" value={f.sdPct} onChange={(e) => set('sdPct', e.target.value)} placeholder="0" />
        </label>
        <label>
          Discount valid till (optional)
          <input type="date" value={f.sdTill} onChange={(e) => set('sdTill', e.target.value)} />
        </label>
        <label className="wide">
          Why the special discount? {Number(f.sdPct) > 0 && '(required)'}
          <input value={f.sdReason} onChange={(e) => set('sdReason', e.target.value)} placeholder="e.g. volume above 20 seats, 2-year commitment" />
        </label>
        <label className="wide">
          Account notes
          <textarea rows={3} value={f.accountNotes} onChange={(e) => set('accountNotes', e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}

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
