// One customer in Directory: name and actions, what's still missing, a single stat strip, contacts and
// contract terms side by side, then tabs for projects (rate cards), billing history, contracts, campaigns.
// Editing: one "Edit details" window for everything Matt keeps about the customer.
import React, { useState } from 'react';
import { RateCardCard, ProfileCard, ReviewTag } from '../views/Master.jsx';
import { Act, Modal, amt, fmtDate, FileLink } from '../collections/views/parts.jsx';
import { ContactsEditor, ContactsList } from '../collections/views/Contacts.jsx';
import { normalizeContact } from '../collections/engine/contacts.js';
import { ContractForm } from '../collections/views/Contracts.jsx';
import { projectCodesOf } from './engine.js';
import { accountBilling, monthName } from './billing.js';
import { CampaignForm, OUTCOME_TONE } from './Customers.jsx';

const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`);

export default function CustomerDetail(ctx) {
  const { v, go, can, ops, projectsByCode, master, pmsById, unlinked } = ctx;
  const a = v.account;
  const [editing, setEditing] = useState(null); // 'details' | 'campaign'
  const [tab, setTab] = useState('projects');
  const [openProject, setOpenProject] = useState(null);
  const [linkCode, setLinkCode] = useState('');
  const setCodes = (codes) => ops.saveAccount({ ...a, projectCodes: codes, billingCode: codes.join(', ') });
  const sd = a.specialDiscount;
  const bill = accountBilling(ctx.billing || [], { codes: projectCodesOf(a), names: [a.name, ...(a.zohoNames || [])], invoices: ctx.invoices || [], accountId: a.id });
  const contractsCount = (ctx.contracts || []).filter((k) => k.customerId === a.id).length;
  const detailsMissing = v.missing.filter((m) => m !== 'rate revision date' && m !== 'linked projects');
  const pms = v.pms.length ? v.pms : a.pm?.name ? [a.pm.name] : [];

  return (
    <>
      <button className="back" onClick={() => go('customers')}>
        ← All customers
      </button>
      <div className="title-row">
        <h2>{a.name}</h2>
        {a.active === false && <span className="flag">closed</span>}
        <span className="spacer" />
        <a className="btn" href={`#c-customers/${encodeURIComponent(a.id)}`}>
          Invoices & dues →
        </a>
        {can.edit && (
          <button className="primary" onClick={() => setEditing('details')}>
            Edit details
          </button>
        )}
      </div>

      {v.missing.length > 0 && (
        <div className="todo-line">
          <span>
            Still to fill in: <strong>{v.missing.join(', ')}</strong>
          </span>
          {can.edit && detailsMissing.length > 0 && (
            <button className="linkish" onClick={() => setEditing('details')}>
              Fill in →
            </button>
          )}
          {v.missing.includes('rate revision date') && (
            <button className="linkish" onClick={() => setTab('projects')}>
              Revision dates: on each project’s rate card
            </button>
          )}
        </div>
      )}

      <div className="stat-strip">
        <div>
          <span>Billing</span>
          <strong>{v.revenueUSD ? `${amt(v.revenueUSD)}/mo` : '—'}</strong>
        </div>
        <div>
          <span>Billed seats</span>
          <strong>{v.seats || '—'}</strong>
          <em>{v.assigned} people assigned</em>
        </div>
        <div>
          <span>Rate per seat</span>
          <strong>{bill.ratePerSeat ? amt(bill.ratePerSeat) : '—'}</strong>
        </div>
        <div>
          <span>vs Aloha standard</span>
          <strong>{v.discountVsStandard == null ? '—' : v.discountVsStandard > 0.0005 ? `${pct(v.discountVsStandard)} below` : 'at or above'}</strong>
          {sd?.pct ? <em>+ {sd.pct}% special discount</em> : null}
        </div>
        <div>
          <span>Next rate revision</span>
          <strong>{v.nextRevision ? fmtDate(v.nextRevision.date) : 'not set'}</strong>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h2>Contacts</h2>
          {(a.contacts || []).length ? (
            <ContactsList customer={a} compact />
          ) : (
            <div className="empty-cta">
              <div className="muted">No contacts yet. Reminders, invoices and tax invoices need at least one.</div>
              {can.edit && (
                <button className="primary" onClick={() => setEditing('details')}>
                  + Add contacts
                </button>
              )}
            </div>
          )}
        </div>
        <div className="card">
          <h2>Contract & terms</h2>
          <dl className="facts">
            <dt>Name in contract</dt>
            <dd>{a.legalName || <span className="muted">not set</span>}</dd>
            <dt>Payment terms</dt>
            <dd>Net {a.paymentTermsDays || 15} days</dd>
            <dt>Entity · currency</dt>
            <dd>
              {a.entity || '—'} · {a.currency || 'USD'}
            </dd>
            <dt>Special discount</dt>
            <dd>{sd?.pct ? `${sd.pct}% · ${sd.reason || 'no reason'}${sd.validTill ? ` · till ${fmtDate(sd.validTill)}` : ''}` : 'None'}</dd>
            <dt>PMs</dt>
            <dd title={pms.join(', ')}>{pms.length ? (pms.length > 3 ? `${pms.slice(0, 3).join(', ')} +${pms.length - 3} more` : pms.join(', ')) : '—'}</dd>
            {a.accountNotes && (
              <>
                <dt>Notes</dt>
                <dd>{a.accountNotes}</dd>
              </>
            )}
          </dl>
        </div>
      </div>

      <div className="tabs page-tabs">
        {[
          ['projects', `Projects (${v.projects.length})`],
          ['billing', 'Billing history'],
          ['contracts', `Contracts (${contractsCount})`],
          ['campaigns', `Campaigns (${v.campaigns.length})`],
        ].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'projects' && (
        <div className="card">
          {!v.projects.length ? (
            <div className="muted">No project linked yet. Link the Costing project(s) this customer pays for.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>PMs</th>
                    <th className="r">Billed seats</th>
                    <th className="r">Billing / mo</th>
                    <th>Rate card</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {v.projects.map((p) => (
                    <React.Fragment key={p.code}>
                      <tr>
                        <td title={p.code}>
                          <strong>{p.name}</strong>
                          {!p.known && <span className="flag warn">no data this month</span>}
                        </td>
                        <td className="wrap-cell muted">{p.pmIds.map((id) => pmsById[id]?.name || id).join(', ') || '—'}</td>
                        <td className="r">{p.seats || '—'}</td>
                        <td className="r">{p.revenueUSD ? amt(p.revenueUSD) : '—'}</td>
                        <td>{p.rateCard ? <ReviewTag status={p.rateCard.status} /> : '—'}</td>
                        <td className="r">
                          {p.known && (
                            <button className="small" onClick={() => setOpenProject(openProject === p.code ? null : p.code)}>
                              {openProject === p.code ? 'Close' : can.edit ? 'Rates & profile' : 'View'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {openProject === p.code && projectsByCode[p.code] && (
                        <tr>
                          <td colSpan={6} style={{ whiteSpace: 'normal', background: 'var(--bg)' }}>
                            <RateCardCard c={projectsByCode[p.code]} master={master} can={can} />
                            <ProfileCard c={projectsByCode[p.code]} master={master} can={can} pmsById={pmsById} />
                            {can.edit && (
                              <Act onClick={() => setCodes(projectCodesOf(a).filter((c) => c !== p.code))} confirm={`Unlink ${p.name} from ${a.name}?`}>
                                Unlink this project from {a.name}
                              </Act>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {can.edit && unlinked.length > 0 && (
            <div className="row">
              <select className="inline-in" value={linkCode} onChange={(e) => setLinkCode(e.target.value)} style={{ maxWidth: 300 }}>
                <option value="">Link another project…</option>
                {unlinked.map(({ project }) => (
                  <option key={project.code} value={project.code}>
                    {project.name}
                  </option>
                ))}
              </select>
              <Act disabled={!linkCode} onClick={async () => (await setCodes([...projectCodesOf(a), linkCode]), setLinkCode(''))}>
                Link
              </Act>
            </div>
          )}
        </div>
      )}
      {tab === 'billing' && <BillingHistory bill={bill} />}
      {tab === 'contracts' && <ContractsCard a={a} ctx={ctx} />}
      {tab === 'campaigns' && (
        <div className="card">
          <div className="title-row" style={{ marginBottom: 6 }}>
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
            <div className="muted">No special reach-outs logged yet (referral ask, rate revision, new-service offer).</div>
          )}
        </div>
      )}

      {editing === 'details' && <EditCustomer a={a} ops={ops} onClose={() => setEditing(null)} />}
      {editing === 'campaign' && <CampaignForm accounts={[a]} ops={ops} me={ctx.me} onClose={() => setEditing(null)} />}
    </>
  );
}

// Everything Matt keeps about a customer, in one window: contacts, contract name, terms, discount, notes.
function EditCustomer({ a, ops, onClose }) {
  const [contacts, setContacts] = useState(() => a.contacts || []);
  const [f, setF] = useState({
    legalName: a.legalName || '',
    paymentTermsDays: a.paymentTermsDays || 15,
    entity: a.entity || '',
    currency: a.currency || 'USD',
    active: a.active !== false,
    accountNotes: a.accountNotes || '',
    sdPct: a.specialDiscount?.pct ?? '',
    sdReason: a.specialDiscount?.reason || '',
    sdTill: a.specialDiscount?.validTill || '',
  });
  const set = (k, val) => setF((x) => ({ ...x, [k]: val }));
  const save = async () => {
    const { sdPct, sdReason, sdTill, ...rest } = f;
    await ops.saveAccount({
      ...a,
      ...rest,
      paymentTermsDays: Number(f.paymentTermsDays) || 15,
      specialDiscount: Number(sdPct) > 0 ? { pct: Number(sdPct), reason: sdReason.trim(), validTill: sdTill || null } : null,
      contacts: contacts.filter((c) => (c.name || '').trim() || (c.email || '').trim() || (c.phone || '').trim()).map(normalizeContact),
    });
    onClose();
  };
  return (
    <Modal
      title={`Edit ${a.name}`}
      wide
      onClose={onClose}
      footer={
        <>
          <button className="small" onClick={onClose}>
            Cancel
          </button>
          <Act className="primary" disabled={Number(f.sdPct) > 0 && !f.sdReason.trim()} onClick={save}>
            Save
          </Act>
        </>
      }
    >
      <h3 style={{ marginTop: 0 }}>1 · Contacts</h3>
      <ContactsEditor contacts={contacts} onChange={setContacts} />

      <h3>2 · Contract & terms</h3>
      <div className="form-grid">
        <label className="wide">
          Customer name exactly as in the contract
          <input value={f.legalName} onChange={(e) => set('legalName', e.target.value)} placeholder="Used to check who paid" />
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
      </div>

      <h3>3 · Special discount</h3>
      <div className="form-grid">
        <label>
          Discount %
          <input type="number" step="0.5" value={f.sdPct} onChange={(e) => set('sdPct', e.target.value)} placeholder="0 = none" />
        </label>
        <label>
          Valid till (optional)
          <input type="date" value={f.sdTill} onChange={(e) => set('sdTill', e.target.value)} />
        </label>
        <label className="wide">
          Reason {Number(f.sdPct) > 0 && '(required)'}
          <input value={f.sdReason} onChange={(e) => set('sdReason', e.target.value)} placeholder="e.g. volume above 20 seats, 2-year commitment" />
        </label>
      </div>

      <h3>4 · Notes</h3>
      <textarea className="inline-in" style={{ width: '100%' }} rows={3} value={f.accountNotes} onChange={(e) => set('accountNotes', e.target.value)} />
      <p className="hint">Rates and rate revision dates are set per project: Projects tab → “Rates & profile”.</p>
    </Modal>
  );
}

function ContractsCard({ a, ctx }) {
  const [adding, setAdding] = useState(false);
  const list = (ctx.contracts || []).filter((k) => k.customerId === a.id);
  const formCtx = { data: { contracts: ctx.contracts || [], customers: ctx.accounts.map((v) => v.account) }, byId: { customers: Object.fromEntries(ctx.accounts.map((v) => [v.account.id, v.account])) }, ops: ctx.ops, api: ctx.colApi };
  return (
    <div className="card">
      <div className="title-row" style={{ marginBottom: 6 }}>
        <span className="spacer" />
        {ctx.can.edit && (
          <button className="small" onClick={() => setAdding(true)}>
            + Upload contract
          </button>
        )}
      </div>
      {list.length ? (
        <ul className="activity">
          {list.map((k) => (
            <li key={k.id}>
              <strong>{k.title}</strong> <span className="flag">{k.type}</span>
              <div className="muted small-text">
                {k.legalName && `Signed as ${k.legalName} · `}
                {k.startDate && `${fmtDate(k.startDate)} → ${k.endDate ? fmtDate(k.endDate) : 'open-ended'} · `}
                {k.fileId && (
                  <FileLink api={ctx.colApi} fileId={k.fileId}>
                    {k.fileName}
                  </FileLink>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="muted">No contract uploaded.</div>
      )}
      {adding && <ContractForm {...formCtx} initial={{ customerId: a.id, legalName: a.legalName }} onClose={() => setAdding(false)} />}
    </div>
  );
}

function BillingHistory({ bill }) {
  const signed = (x, f = (y) => y) => (x == null ? '—' : x > 0 ? `+${f(x)}` : x < 0 ? `−${f(-x)}` : '0');
  const months = bill.months.slice(0, 18);
  return (
    <div className="card">
      {!months.length ? (
        <div className="muted">Nothing billed yet.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th className="r">Seats</th>
                <th className="r">Δ seats</th>
                <th className="r">Billing</th>
                <th className="r">Δ billing</th>
                <th className="r">Invoiced in Zoho</th>
                <th>Resource types · reason</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.period}>
                  <td>{monthName(m.period)}</td>
                  <td className="r">{m.seats ?? '—'}</td>
                  <td className="r">{m.seats == null ? '' : signed(m.seatDelta)}</td>
                  <td className="r">{m.amountUSD == null ? '—' : amt(m.amountUSD)}</td>
                  <td className="r">{m.amountUSD == null ? '' : signed(m.amountDelta, amt)}</td>
                  <td className="r">{m.invoicedUSD == null ? '—' : amt(m.invoicedUSD)}</td>
                  <td className="wrap-cell muted">
                    {m.lines
                      .map((l) => [(l.byRole || []).map((r) => `${r.seats} ${r.role}`).join(', '), l.remarks].filter(Boolean).join(' · '))
                      .filter(Boolean)
                      .join(' | ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {bill.changes.length > 0 && (
        <>
          <h3>Changes logged</h3>
          <ul className="activity">
            {bill.changes.slice(0, 20).map((c) => (
              <li key={c.id}>
                <span className="when">
                  {monthName(c.period)} · {c.name}
                </span>
                <div>
                  {c.seatDelta != null && `${signed(c.seatDelta)} seats`}
                  {c.amountDelta != null && ` · ${signed(c.amountDelta, amt)}`} {c.remarks && <span className="muted">· {c.remarks}</span>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
