// Setup: Matt checks and confirms every customer and open invoice the initial setup created,
// and brings in the latest Zoho / QuickBooks export (a diff he reviews before anything changes).
import React, { useMemo, useState } from 'react';
import { Kpi } from '../../views/ui.jsx';
import { Act, AgePill, amt, fmtDate, Modal } from './parts.jsx';
import { parseInvoiceRows, diffImport, slug } from '../engine/importer.js';
import { ageDays, overdueDays, isOpen } from '../engine/aging.js';
import { monthOf } from '../engine/dates.js';

export default function Setup(ctx) {
  const { data, summaries, go, ops } = ctx;
  const withDues = summaries.filter((s) => s.count > 0);
  const unconfirmed = withDues.filter((s) => !s.customer.confirmed);
  const noContact = withDues.filter((s) => !(s.customer.contacts || []).some((x) => (x.role || 'billing') === 'billing' && x.email));
  const noPm = withDues.filter((s) => !s.customer.pm?.email);
  const openUnconf = data.invoices.filter((i) => isOpen(i) && !i.confirmed);
  const last = data.settings?.lastImport;
  const [adding, setAdding] = useState(false);

  return (
    <>
      <div className="kpis">
        <Kpi label="Customers with dues confirmed" value={`${withDues.length - unconfirmed.length} / ${withDues.length}`} tone={unconfirmed.length ? 'warn' : 'good'} />
        <Kpi label="Open invoices confirmed" value={`${data.invoices.filter(isOpen).length - openUnconf.length} / ${data.invoices.filter(isOpen).length}`} tone={openUnconf.length ? 'warn' : 'good'} />
        <Kpi label="No billing email" value={noContact.length} note="reminders cannot go" tone={noContact.length ? 'bad' : 'good'} />
        <Kpi label="No PM email" value={noPm.length} note="needed from Day 16" tone={noPm.length ? 'warn' : 'good'} />
      </div>

      <ImportCard {...ctx} last={last} />

      <div className="card">
        <div className="title-row" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>Check each customer ({unconfirmed.length} to go)</h2>
          <span className="hint">
            Set up from your spreadsheets: Zoho AR dump, Customer Info, Sep invoicing (PMs, billing codes), Pending Invoices (your comments). Open each one, fix anything wrong, add the billing contact, then Confirm.
          </span>
        </div>
        {!unconfirmed.length ? (
          <div className="empty small">All customers with dues are confirmed.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Customer (Zoho)</th>
                  <th>PM</th>
                  <th>Billing code</th>
                  <th>Billing contact</th>
                  <th className="r">Open</th>
                  <th className="r">Pending</th>
                  <th>Oldest</th>
                  <th>Your last comment</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {unconfirmed
                  .sort((a, b) => b.balance - a.balance)
                  .map((s) => {
                    const c = s.customer;
                    const billing = (c.contacts || []).find((x) => (x.role || 'billing') === 'billing' && x.email);
                    return (
                      <tr key={c.id}>
                        <td className="wrap-cell">
                          <a onClick={() => go('customers', c.id)}>{c.name}</a>
                          {c.active === false && <span className="flag">marked closed</span>}
                        </td>
                        <td>{c.pm?.name || <span className="flag bad">missing</span>}</td>
                        <td className="wrap-cell">{c.billingCode || '—'}</td>
                        <td>{billing ? billing.email : <span className="flag bad">missing</span>}</td>
                        <td className="r">{s.count}</td>
                        <td className="r">{amt(s.balance)}</td>
                        <td>
                          <AgePill age={s.maxAge} overdue={s.maxOverdue} />
                        </td>
                        <td className="wrap-cell" style={{ minWidth: 220 }}>
                          <span className="muted small-text">{c.comment || ''}</span>
                        </td>
                        <td className="nowrap">
                          <button className="small" onClick={() => go('customers', c.id)}>
                            Open
                          </button>{' '}
                          <Act onClick={() => ops.confirmCustomer(c)} title="Name, PM and billing code look right">
                            Confirm
                          </Act>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="title-row" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>Check open invoices ({openUnconf.length} to go)</h2>
          <span className="hint">Older than a year: set to “Do not send” until you decide (chase, bad debt or void).</span>
          <span className="spacer" />
          <button className="small" onClick={() => setAdding(true)}>
            + Add invoice by hand
          </button>
        </div>
        <UnconfirmedInvoices {...ctx} list={openUnconf} />
      </div>
      {adding && <AddInvoice {...ctx} onClose={() => setAdding(false)} />}
    </>
  );
}

function UnconfirmedInvoices({ list, byId, on, ops, go }) {
  const byCust = useMemo(() => {
    const m = {};
    for (const i of list) (m[i.customerId] ||= []).push(i);
    return Object.entries(m).sort((a, b) => b[1].reduce((s, i) => s + i.balance, 0) - a[1].reduce((s, i) => s + i.balance, 0));
  }, [list]);
  if (!list.length) return <div className="empty small">All open invoices are confirmed.</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Customer</th>
            <th>Invoices</th>
            <th className="r">Pending</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {byCust.map(([cid, invs]) => (
            <tr key={cid}>
              <td className="wrap-cell">
                <a onClick={() => go('customers', cid)}>{byId.customers[cid]?.name || cid}</a>
              </td>
              <td className="wrap-cell">
                {invs
                  .sort((a, b) => a.date.localeCompare(b.date))
                  .map((i) => (
                    <span key={i.id} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', marginRight: 10 }}>
                      {i.number} · {amt(i.balance)} <AgePill age={ageDays(i, on)} overdue={overdueDays(i, on)} />
                      {i.doNotSend && <span className="flag bad">do not send</span>}
                    </span>
                  ))}
              </td>
              <td className="r">{amt(invs.reduce((s, i) => s + i.balance, 0))}</td>
              <td className="nowrap">
                <Act onClick={() => ops.confirmInvoices(invs)}>Confirm {invs.length}</Act>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImportCard({ data, ops, last, byId }) {
  const [diff, setDiff] = useState(null);
  const [meta, setMeta] = useState(null);
  const [err, setErr] = useState('');
  const [result, setResult] = useState('');
  const onFile = async (file) => {
    setErr('');
    setResult('');
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      // Zoho "Invoice Details" is one sheet; older workbooks keep it in a sheet called Dump.
      const name = wb.SheetNames.find((n) => /dump|invoice/i.test(n)) || wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
      const source = /quick|qb/i.test(file.name) ? 'quickbooks' : 'zoho';
      const { invoices, errors } = parseInvoiceRows(rows, { source });
      if (!invoices.length) throw new Error(errors[0] || 'No invoices found in the file');
      const asOf = invoices.reduce((m, i) => (i.date > m ? i.date : m), '');
      setMeta({ source: file.name, asOf, rows: invoices.length, skipped: errors.length });
      setDiff(diffImport(data.invoices, invoices, data.customers));
    } catch (e) {
      setErr(e.message);
    }
  };
  return (
    <div className="card">
      <h2>Import the latest Zoho / QuickBooks export</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        Last import: {last ? `${fmtDate(last.at?.slice(0, 10))} · ${last.source} · invoices up to ${fmtDate(last.asOf)}` : 'none'}. In Zoho Books: Reports → Invoice Details → Export as XLSX (all
        statuses). Invoices match on invoice number; you see every change before it is applied. Payments you recorded here are never overwritten.
      </p>
      <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files[0] && onFile(e.target.files[0])} />
      {err && <div className="err">{err}</div>}
      {result && <div className="good-text" style={{ marginTop: 8 }}>{result}</div>}
      {diff && <ImportReview diff={diff} meta={meta} ops={ops} byId={byId} data={data} onDone={(r) => (setDiff(null), setResult(`Applied: ${r.added} new, ${r.changed} balance changes, ${r.closed} closed.`))} onCancel={() => setDiff(null)} />}
    </div>
  );
}

function ImportReview({ diff, meta, ops, byId, data, onDone, onCancel }) {
  const [addIds, setAdd] = useState(() => new Set(diff.added.map((x) => x.number)));
  const [closeIds, setClose] = useState(() => new Set(diff.closed.map((x) => x.current.id)));
  const [changeIds, setChange] = useState(() => new Set(diff.changed.map((x) => x.current.id)));
  // Unknown customer names: map to an existing customer or create a new one.
  const [mapping, setMapping] = useState(() => Object.fromEntries(diff.unknownCustomers.map((n) => [n, 'new'])));
  const toggle = (set, setter, id) => {
    const n = new Set(set);
    n.has(id) ? n.delete(id) : n.add(id);
    setter(n);
  };
  const customers = [...data.customers].sort((a, b) => a.name.localeCompare(b.name));
  const apply = async () => {
    const newCustomers = [];
    const resolved = { ...diff, added: diff.added.map((x) => ({ ...x })) };
    for (const [name, target] of Object.entries(mapping)) {
      let id = target;
      if (target === 'new' && byId.customers[slug(name)]) id = slug(name); // same name, different punctuation
      if (target === 'new' && id !== slug(name)) {
        id = slug(name);
        newCustomers.push({ id, name, zohoNames: [name], legalName: '', billingCode: '', entity: '', currency: 'USD', paymentTermsDays: 15, active: true, pm: null, otherPms: [], contacts: [], payerAliases: [], notes: [], confirmed: false, createdAt: new Date().toISOString() });
      } else {
        const c = byId.customers[id];
        if (c && !(c.zohoNames || []).includes(name)) newCustomers.push({ ...c, zohoNames: [...(c.zohoNames || []), name] });
      }
      for (const a of resolved.added) if (a.customerName === name) a.customerId = id;
    }
    const r = await ops.applyImport(resolved, { addIds, closeIds, changeIds, newCustomers }, { source: meta.source, asOf: meta.asOf });
    onDone(r);
  };
  const Check = ({ on, onChange }) => <input type="checkbox" checked={on} onChange={onChange} />;
  const nothing = !diff.added.length && !diff.closed.length && !diff.changed.length;
  return (
    <Modal
      title={`Review import: ${meta.source}`}
      wide
      onClose={onCancel}
      footer={
        <>
          <span className="hint" style={{ marginRight: 'auto' }}>
            {meta.rows} invoices read, up to {fmtDate(meta.asOf)}
            {meta.skipped ? ` · ${meta.skipped} rows skipped` : ''}
          </span>
          <button className="small" onClick={onCancel}>
            Cancel
          </button>
          <Act className="primary" disabled={nothing} onClick={apply}>
            Apply {addIds.size + closeIds.size + changeIds.size} changes
          </Act>
        </>
      }
    >
      {nothing && <div className="empty small">Everything already matches. Nothing to change.</div>}
      {diff.unknownCustomers.length > 0 && (
        <>
          <h3 style={{ marginTop: 0 }}>Customer names not in the app ({diff.unknownCustomers.length})</h3>
          {diff.unknownCustomers.map((n) => (
            <div key={n} className="row" style={{ marginTop: 4 }}>
              <span style={{ minWidth: 260 }}>{n}</span>
              <select className="inline-in" value={mapping[n]} onChange={(e) => setMapping({ ...mapping, [n]: e.target.value })}>
                <option value="new">Create as a new customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    Same as: {c.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </>
      )}
      {diff.added.length > 0 && (
        <>
          <h3>New open invoices ({diff.added.length})</h3>
          <ImportTable
            rows={diff.added.map((x) => ({ id: x.number, on: addIds.has(x.number), toggle: () => toggle(addIds, setAdd, x.number), cells: [x.customerName, x.number, fmtDate(x.date), amt(x.balance, x.currency)] }))}
            head={['Customer', 'Invoice', 'Date', 'Balance']}
            Check={Check}
          />
        </>
      )}
      {diff.closed.length > 0 && (
        <>
          <h3>Now paid / closed in {meta.source.match(/quick|qb/i) ? 'QuickBooks' : 'Zoho'} ({diff.closed.length}): reminders stop</h3>
          <ImportTable
            rows={diff.closed.map(({ current, incoming }) => ({ id: current.id, on: closeIds.has(current.id), toggle: () => toggle(closeIds, setClose, current.id), cells: [byId.customers[current.customerId]?.name, current.number, amt(current.balance), incoming.status] }))}
            head={['Customer', 'Invoice', 'Balance here', 'Now']}
            Check={Check}
          />
        </>
      )}
      {diff.changed.length > 0 && (
        <>
          <h3>Part-payments ({diff.changed.length})</h3>
          <ImportTable
            rows={diff.changed.map(({ current, incoming }) => ({ id: current.id, on: changeIds.has(current.id), toggle: () => toggle(changeIds, setChange, current.id), cells: [byId.customers[current.customerId]?.name, current.number, amt(current.balance), amt(incoming.balance)] }))}
            head={['Customer', 'Invoice', 'Balance here', 'Balance in export']}
            Check={Check}
          />
        </>
      )}
      {diff.conflicts.length > 0 && (
        <>
          <h3>Left unchanged ({diff.conflicts.length})</h3>
          <ul className="plain small-text">
            {diff.conflicts.map((x) => (
              <li key={x.current.id}>
                {x.current.number}: {x.text}
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}

function ImportTable({ rows, head, Check }) {
  return (
    <div className="table-wrap" style={{ maxHeight: 260, overflow: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th />
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <Check on={r.on} onChange={r.toggle} />
              </td>
              {r.cells.map((c, i) => (
                <td key={i} className="wrap-cell">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddInvoice({ data, ops, onClose, on }) {
  const [f, setF] = useState({ customerId: '', number: '', date: on, dueDate: '', amount: '', currency: 'USD' });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const exists = data.invoices.some((i) => i.number.replace(/\W/g, '').toLowerCase() === f.number.replace(/\W/g, '').toLowerCase());
  return (
    <Modal
      title="Add invoice by hand"
      onClose={onClose}
      footer={
        <Act
          className="primary"
          disabled={!f.customerId || !f.number.trim() || !(Number(f.amount) > 0) || exists}
          onClick={async () => {
            const due = f.dueDate || new Date(Date.parse(f.date) + 15 * 86400000).toISOString().slice(0, 10);
            await ops.addInvoice({ ...f, number: f.number.trim(), dueDate: due, period: monthOf(f.date), amount: Number(f.amount), balance: Number(f.amount), status: 'open', source: 'manual' });
            onClose();
          }}
        >
          Add
        </Act>
      }
    >
      <div className="form-grid">
        <label className="wide">
          Customer
          <select value={f.customerId} onChange={(e) => set('customerId', e.target.value)}>
            <option value="">Choose…</option>
            {[...data.customers]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Invoice #{exists && <span className="err">already exists</span>}
          <input value={f.number} onChange={(e) => set('number', e.target.value)} />
        </label>
        <label>
          Amount
          <input type="number" value={f.amount} onChange={(e) => set('amount', e.target.value)} />
        </label>
        <label>
          Invoice date
          <input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} />
        </label>
        <label>
          Due date (default +15 days)
          <input type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}
