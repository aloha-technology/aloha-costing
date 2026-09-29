import React, { useMemo, useState } from 'react';
import { Table } from '../../views/ui.jsx';
import { AgePill, Prio, Act, amt, fmtDate, monthLabel, FileLink, Modal } from './parts.jsx';
import InvoiceTable from './InvoiceTable.jsx';
import { ContractForm } from './Contracts.jsx';
import { addDays } from '../engine/dates.js';
import { contactsFor, normalizeContact } from '../engine/contacts.js';
import { ContactsEditor, ContactsList } from './Contacts.jsx';

const FILTERS = [
  ['dues', 'With dues'],
  ['all', 'All'],
  ['unconfirmed', 'Not confirmed'],
  ['nocontact', 'No billing email'],
  ['active', 'Active'],
];

export default function Customers(ctx) {
  const { focus, byId } = ctx;
  if (focus && byId.customers[focus]) return <CustomerDetail {...ctx} customer={byId.customers[focus]} />;
  return <CustomerList {...ctx} />;
}

function CustomerList({ summaries, go, can, ops }) {
  const [filter, setFilter] = useState('dues');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const rows = useMemo(
    () =>
      summaries
        .filter((s) => {
          const c = s.customer;
          if (q && !`${c.name} ${c.legalName} ${c.billingCode} ${c.pm?.name || ''}`.toLowerCase().includes(q.toLowerCase())) return false;
          if (filter === 'dues') return s.count > 0;
          if (filter === 'unconfirmed') return !c.confirmed;
          if (filter === 'nocontact') return !contactsFor(c, 'billing').length;
          if (filter === 'active') return c.active !== false;
          return true;
        })
        .map((s) => ({ ...s, id: s.customer.id, name: s.customer.name, pm: s.customer.pm?.name || '—' })),
    [summaries, filter, q]
  );
  return (
    <>
      <div className="toolbar">
        <div className="seg">
          {FILTERS.map(([k, l]) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
              {l}
            </button>
          ))}
        </div>
        <input type="text" placeholder="Search name, PM or billing code" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="spacer" />
        {can.edit && (
          <button className="small" onClick={() => setAdding(true)}>
            + Add customer
          </button>
        )}
      </div>
      <div className="card">
        <Table
          rowKey={(r) => r.id}
          onRowClick={(r) => go('customers', r.id)}
          initialSort={{ key: 'balance', dir: 'desc' }}
          columns={[
            {
              key: 'name',
              label: 'Customer',
              render: (r) => (
                <span className="wrap-cell">
                  {r.name}
                  {!r.customer.confirmed && <span className="flag warn">not confirmed</span>}
                  {r.customer.active === false && <span className="flag">closed</span>}
                </span>
              ),
            },
            { key: 'pm', label: 'PM' },
            {
              key: 'contact',
              label: 'Billing contact',
              sort: (r) => (r.customer.contacts || []).length,
              render: (r) => {
                const b = contactsFor(r.customer, 'billing')[0];
                return b ? <span className="muted">{b.email}</span> : <span className="flag bad">missing</span>;
              },
            },
            { key: 'count', label: 'Open', align: 'right' },
            { key: 'maxAge', label: 'Oldest', render: (r) => (r.count ? <AgePill age={r.maxAge} overdue={r.maxOverdue} /> : '') },
            { key: 'balance', label: 'Pending', align: 'right', render: (r) => (r.count ? <strong>{amt(r.balance)}</strong> : '—') },
            {
              key: 'next',
              label: 'Next action',
              sort: (r) => ['critical', 'high', 'medium', 'low'].indexOf(r.actions[0]?.priority ?? 'low'),
              render: (r) => (r.actions[0] ? <span className="wrap-cell"><Prio level={r.actions[0].priority} /> {r.actions[0].text}</span> : ''),
            },
          ]}
          rows={rows}
        />
      </div>
      {adding && <NewCustomer ops={ops} go={go} onClose={() => setAdding(false)} />}
    </>
  );
}

function NewCustomer({ ops, go, onClose }) {
  const [name, setName] = useState('');
  const id = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return (
    <Modal
      title="Add customer"
      onClose={onClose}
      footer={
        <Act
          className="primary"
          disabled={!id}
          onClick={async () => {
            await ops.saveCustomer({ id, name: name.trim(), zohoNames: [name.trim()], legalName: '', billingCode: '', entity: '', currency: 'USD', paymentTermsDays: 15, active: true, pm: null, otherPms: [], contacts: [], payerAliases: [], notes: [], confirmed: true, createdAt: new Date().toISOString() });
            onClose();
            go('customers', id);
          }}
        >
          Add
        </Act>
      }
    >
      <div className="stack">
        <label>
          Customer name exactly as in Zoho
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
      </div>
    </Modal>
  );
}

function CustomerDetail(ctx) {
  const { customer: c, data, summaries, go, can, ops, api, on } = ctx;
  const s = summaries.find((x) => x.customer.id === c.id);
  const invoices = data.invoices.filter((i) => i.customerId === c.id);
  const [showAll, setShowAll] = useState(false);
  const shownInv = showAll ? invoices : invoices.filter((i) => i.status === 'open' && i.balance > 0);
  const contracts = data.contracts.filter((k) => k.customerId === c.id);
  const payments = data.payments.filter((p) => p.customerId === c.id).sort((a, b) => b.date.localeCompare(a.date));
  const emails = data.outbox.filter((e) => e.customerId === c.id && e.status !== 'cancelled').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [editing, setEditing] = useState(false);
  const [addingContract, setAddingContract] = useState(false);
  const [noteText, setNote] = useState('');
  const [promise, setPromise] = useState(null);

  return (
    <>
      <button className="back" onClick={() => go('customers')}>
        ← All customers
      </button>
      <div className="title-row">
        <h2>{c.name}</h2>
        {c.confirmed ? <span className="flag good">confirmed</span> : <span className="flag warn">not confirmed</span>}
        {c.active === false && <span className="flag">closed account</span>}
        {c.doNotSend && <span className="flag bad">no reminders for this customer</span>}
        <span className="spacer" />
        {can.edit && !c.confirmed && (
          <Act className="primary" onClick={() => ops.confirmCustomer(c)} title="You checked name, PM, contacts and billing code">
            Confirm setup
          </Act>
        )}
        {can.edit && (
          <button className="small" onClick={() => setEditing(true)}>
            Edit details & contacts
          </button>
        )}
      </div>

      <div className="kpis compact-kpis">
        <div className="kpi">
          <div className="kpi-label">Pending</div>
          <div className="kpi-value">{amt(s?.balance || 0)}</div>
          <div className="kpi-note">{s?.count || 0} open invoices</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Oldest</div>
          <div className="kpi-value">{s?.count ? <AgePill age={s.maxAge} overdue={s.maxOverdue} /> : '—'}</div>
          <div className="kpi-note">{s?.months.map(monthLabel).join(', ')}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Last reminder</div>
          <div className="kpi-value" style={{ fontSize: 15 }}>
            {s?.lastReminder ? fmtDate(s.lastReminder) : '—'}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Promise to pay</div>
          <div className="kpi-value" style={{ fontSize: 15 }}>
            {c.promise?.date ? `${fmtDate(c.promise.date)}${c.promise.amount ? ` · ${amt(c.promise.amount)}` : ''}` : '—'}
          </div>
          {can.edit && (
            <div className="kpi-note">
              <a onClick={() => setPromise({ date: c.promise?.date || addDays(on, 7), amount: c.promise?.amount || '', text: '' })}>{c.promise ? 'change' : 'record a promise'}</a>
              {c.promise && (
                <>
                  {' · '}
                  <a onClick={() => ops.setPromise(c, null, '')}>clear</a>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h2>Suggested next actions</h2>
          {s?.actions.length ? (
            <ul className="actions-list">
              {s.actions.map((a, i) => (
                <li key={i}>
                  <Prio level={a.priority} /> <span>{a.text}</span>
                  {a.kind === 'reminder' && (
                    <a className="right" onClick={() => go('reminders', c.id)}>
                      open
                    </a>
                  )}
                  {a.kind === 'tax' && (
                    <a className="right" onClick={() => go('tax')}>
                      open
                    </a>
                  )}
                  {(a.kind === 'contact' || a.kind === 'pm') && can.edit && (
                    <a className="right" onClick={() => setEditing(true)}>
                      add
                    </a>
                  )}
                  {a.kind === 'contract' && can.edit && (
                    <a className="right" onClick={() => setAddingContract(true)}>
                      upload
                    </a>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="muted">Nothing to do.</div>
          )}
        </div>
        <div className="card">
          <h2>Details</h2>
          <div className="kv">
            <div>
              <div className="k">PM (copied from Day 16)</div>
              <div className="v">{c.pm ? `${c.pm.name} · ${c.pm.email}` : <span className="flag bad">missing</span>}</div>
              {c.otherPms?.length > 0 && <div className="hint">Also: {c.otherPms.map((p) => p.name).join(', ')}</div>}
            </div>
            <div>
              <div className="k">Name in contract</div>
              <div className="v">{c.legalName || <span className="muted">not set: payer check uses the Zoho name</span>}</div>
            </div>
            <div>
              <div className="k">Billing code</div>
              <div className="v">{c.billingCode || '—'}</div>
            </div>
            <div>
              <div className="k">Terms · entity</div>
              <div className="v">
                Net {c.paymentTermsDays || 15} · {c.entity || '—'} · {c.currency || 'USD'}
              </div>
            </div>
            <div className="wide" style={{ gridColumn: '1 / -1' }}>
              <div className="k">Contacts</div>
              {(c.contacts || []).length ? <ContactsList customer={c} /> : <span className="flag bad">No contacts: reminders cannot be sent</span>}
            </div>
            {c.comment && (
              <div style={{ gridColumn: '1 / -1' }}>
                <div className="k">Comment for Sid’s report</div>
                <div className="v">{c.comment}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="title-row" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>Invoices</h2>
          <label className="small-text muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> show paid & closed ({invoices.length})
          </label>
          <span className="spacer" />
          {can.edit && s?.count > 0 && (
            <button className="primary" onClick={() => go('payments', `new:${c.id}`)}>
              Record payment
            </button>
          )}
          {can.edit && shownInv.some((i) => !i.confirmed) && (
            <Act onClick={() => ops.confirmInvoices(shownInv.filter((i) => !i.confirmed))}>Confirm all {shownInv.filter((i) => !i.confirmed).length} shown</Act>
          )}
        </div>
        <InvoiceTable invoices={shownInv} {...ctx} empty="No open invoices" />
      </div>

      <div className="grid2">
        <div className="card">
          <h2>Notes & activity</h2>
          {can.edit && (
            <div className="row" style={{ marginTop: 0, marginBottom: 10 }}>
              <input className="inline-in" style={{ flex: 1 }} placeholder="Call notes, what the customer said, next step…" value={noteText} onChange={(e) => setNote(e.target.value)} />
              <Act disabled={!noteText.trim()} onClick={async () => (await ops.addCustomerNote(c, noteText.trim()), setNote(''))}>
                Add note
              </Act>
            </div>
          )}
          <Activity c={c} emails={emails} payments={payments} settings={ctx.settings} />
        </div>
        <div className="card">
          <div className="title-row" style={{ marginBottom: 6 }}>
            <h2 style={{ margin: 0 }}>Contracts</h2>
            <span className="spacer" />
            {can.edit && (
              <button className="small" onClick={() => setAddingContract(true)}>
                + Upload contract
              </button>
            )}
          </div>
          {contracts.length ? (
            <ul className="activity">
              {contracts.map((k) => (
                <li key={k.id}>
                  <strong>{k.title}</strong> <span className="flag">{k.type}</span>
                  <div className="muted small-text">
                    {k.legalName && `Signed as ${k.legalName} · `}
                    {k.startDate && `${fmtDate(k.startDate)} → ${k.endDate ? fmtDate(k.endDate) : 'open-ended'} · `}
                    {k.fileId && (
                      <FileLink api={api} fileId={k.fileId}>
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
          <h3>Payments</h3>
          {payments.length ? (
            <ul className="activity">
              {payments.slice(0, 10).map((p) => (
                <li key={p.id}>
                  <span className="when">{fmtDate(p.date)}</span> {amt(p.amountReceived, p.currency)} received
                  {Number(p.bankCharges) > 0 && ` + ${amt(p.bankCharges)} bank charges`}
                  {p.payerCheck && p.payerCheck !== 'match' && <span className={`flag ${p.payerCheck === 'mismatch' ? 'bad' : 'warn'}`}>payer {p.payerCheck}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <div className="muted">None recorded in the app yet.</div>
          )}
        </div>
      </div>

      {editing && <CustomerEditor c={c} ops={ops} onClose={() => setEditing(false)} />}
      {addingContract && <ContractForm {...ctx} initial={{ customerId: c.id, legalName: c.legalName }} onClose={() => setAddingContract(false)} />}
      {promise && (
        <Modal
          title={`Promise to pay: ${c.name}`}
          onClose={() => setPromise(null)}
          footer={
            <Act className="primary" disabled={!promise.date} onClick={async () => (await ops.setPromise(c, { date: promise.date, amount: Number(promise.amount) || null }, promise.text), setPromise(null))}>
              Save
            </Act>
          }
        >
          <div className="stack">
            <p className="hint" style={{ margin: 0 }}>
              Reminders to this customer are held until this date{ctx.settings.holdOnPromise ? '' : ' (holding is off in Settings)'}. If it passes unpaid, it shows as a critical action.
            </p>
            <label>
              Will pay by
              <input type="date" value={promise.date} onChange={(e) => setPromise({ ...promise, date: e.target.value })} />
            </label>
            <label>
              Amount (optional, USD)
              <input type="number" value={promise.amount} onChange={(e) => setPromise({ ...promise, amount: e.target.value })} />
            </label>
            <label>
              Who said it / how
              <input value={promise.text} onChange={(e) => setPromise({ ...promise, text: e.target.value })} placeholder="e.g. Dave on call, payment plan in 2 parts" />
            </label>
          </div>
        </Modal>
      )}
    </>
  );
}

function Activity({ c, emails, payments, settings }) {
  const stageLabel = (k) => settings.stages.find((s) => s.key === k)?.label || k;
  const items = [
    ...(c.notes || []).map((n) => ({ at: n.at, by: n.by, text: n.text, kind: 'note' })),
    ...emails.map((e) => ({
      at: e.sentAt || e.createdAt,
      by: e.createdBy,
      kind: 'email',
      text: `${e.kind === 'tax_invoice' ? 'Tax invoice email' : `${stageLabel(e.stage)} reminder`} ${e.status === 'sent' ? `sent${e.sentVia === 'manual' ? ' (from mailbox)' : ''}` : e.status} to ${e.to.join(', ')}${e.cc?.length ? `, cc ${e.cc.join(', ')}` : ''}`,
      subject: e.subject,
    })),
    ...payments.map((p) => ({ at: p.recordedAt || p.date, by: p.recordedBy, kind: 'payment', text: `Payment of ${amt(p.amountReceived, p.currency)} dated ${fmtDate(p.date)} recorded` })),
  ].sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  if (!items.length) return <div className="muted">No activity yet.</div>;
  return (
    <ul className="activity">
      {items.slice(0, 40).map((x, i) => (
        <li key={i}>
          <span className="when">
            {fmtDate((x.at || '').slice(0, 10))} · {x.by} · {x.kind}
          </span>
          <div>{x.text}</div>
          {x.subject && <div className="muted small-text">{x.subject}</div>}
        </li>
      ))}
    </ul>
  );
}

function CustomerEditor({ c, ops, onClose }) {
  const [f, setF] = useState({
    ...c,
    zohoNamesText: (c.zohoNames || []).join('\n'),
    aliasesText: (c.payerAliases || []).join('\n'),
    pmName: c.pm?.name || '',
    pmEmail: c.pm?.email || '',
    contacts: c.contacts || [],
  });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const lines = (t) => t.split('\n').map((x) => x.trim()).filter(Boolean);
  const save = async () => {
    const { zohoNamesText, aliasesText, pmName, pmEmail, ...rest } = f;
    await ops.saveCustomer({
      ...rest,
      zohoNames: lines(zohoNamesText).length ? lines(zohoNamesText) : [f.name],
      payerAliases: lines(aliasesText),
      pm: pmEmail.trim() ? { name: pmName.trim() || pmEmail.split('@')[0], email: pmEmail.trim().toLowerCase() } : null,
      contacts: f.contacts.filter((x) => (x.email || '').trim() || (x.name || '').trim() || (x.phone || '').trim()).map(normalizeContact),
      paymentTermsDays: Number(f.paymentTermsDays) || 15,
    });
    onClose();
  };
  return (
    <Modal title={`Edit ${c.name}`} onClose={onClose} wide footer={<Act className="primary" onClick={save}>Save</Act>}>
      <h3 style={{ marginTop: 0 }}>Contacts</h3>
      <ContactsEditor contacts={f.contacts} onChange={(list) => set('contacts', list)} />

      <h3>Aloha side</h3>
      <div className="form-grid">
        <label>
          PM name
          <input value={f.pmName} onChange={(e) => set('pmName', e.target.value)} />
        </label>
        <label>
          PM email (copied from Day 16)
          <input value={f.pmEmail} onChange={(e) => set('pmEmail', e.target.value)} />
        </label>
        <label>
          Billing code
          <input value={f.billingCode || ''} onChange={(e) => set('billingCode', e.target.value)} />
        </label>
        <label>
          Payment terms (days)
          <input type="number" value={f.paymentTermsDays || 15} onChange={(e) => set('paymentTermsDays', e.target.value)} />
        </label>
        <label>
          Entity
          <select value={f.entity || ''} onChange={(e) => set('entity', e.target.value)}>
            <option value="">—</option>
            <option value="IND">IND</option>
            <option value="SGP">SGP</option>
            <option value="US">US</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={f.active !== false} onChange={(e) => set('active', e.target.checked)} /> Active account
        </label>
        <label className="check">
          <input type="checkbox" checked={Boolean(f.doNotSend)} onChange={(e) => set('doNotSend', e.target.checked)} /> Do not send any reminders to this customer
        </label>
      </div>

      <h3>Names (for the payer check)</h3>
      <div className="form-grid">
        <label className="wide">
          Customer name in the contract
          <input value={f.legalName || ''} onChange={(e) => set('legalName', e.target.value)} placeholder="Exact legal name the contract was signed with" />
        </label>
        <label>
          Names in Zoho / QuickBooks (one per line)
          <textarea rows={3} value={f.zohoNamesText} onChange={(e) => set('zohoNamesText', e.target.value)} />
        </label>
        <label>
          Accepted payer names seen at the bank (one per line)
          <textarea rows={3} value={f.aliasesText} onChange={(e) => set('aliasesText', e.target.value)} />
        </label>
        <label className="wide">
          Comment for Sid’s report
          <textarea rows={2} value={f.comment || ''} onChange={(e) => set('comment', e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}
