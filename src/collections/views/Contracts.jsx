import React, { useMemo, useState } from 'react';
import { Act, Modal, FileLink, fmtDate } from './parts.jsx';
import { daysBetween } from '../engine/dates.js';

const TYPES = ['MSA', 'SOW', 'Amendment', 'NDA', 'Order form', 'Other'];

export default function Contracts(ctx) {
  const { data, byId, api, can, ops, on, go } = ctx;
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null);
  const list = useMemo(
    () =>
      data.contracts
        .filter((k) => !q || `${byId.customers[k.customerId]?.name} ${k.title} ${k.legalName}`.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => (byId.customers[a.customerId]?.name || '').localeCompare(byId.customers[b.customerId]?.name || '')),
    [data.contracts, q, byId]
  );
  const missing = data.customers.filter((c) => c.active !== false && !data.contracts.some((k) => k.customerId === c.id));
  return (
    <>
      <div className="toolbar">
        <input type="text" placeholder="Search customer or contract" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="spacer" />
        {can.edit && (
          <button className="primary" onClick={() => setForm({})}>
            + Upload contract
          </button>
        )}
      </div>
      <div className="card">
        {!list.length ? (
          <div className="empty small">No contracts uploaded yet.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Contract</th>
                  <th>Signed as</th>
                  <th>Term</th>
                  <th>Payment terms</th>
                  <th>File</th>
                  {can.edit && <th />}
                </tr>
              </thead>
              <tbody>
                {list.map((k) => {
                  const left = k.endDate ? daysBetween(on, k.endDate) : null;
                  return (
                    <tr key={k.id}>
                      <td className="wrap-cell">
                        <a onClick={() => go('customers', k.customerId)}>{byId.customers[k.customerId]?.name || k.customerId}</a>
                      </td>
                      <td className="wrap-cell">
                        {k.title} <span className="flag">{k.type}</span>
                        {k.notes && <span className="sub">{k.notes}</span>}
                      </td>
                      <td className="wrap-cell">{k.legalName || '—'}</td>
                      <td>
                        {k.startDate ? fmtDate(k.startDate) : '—'} → {k.endDate ? fmtDate(k.endDate) : 'open'}
                        {left != null && left < 0 && <span className="flag bad">expired</span>}
                        {left != null && left >= 0 && left <= 60 && <span className="flag warn">ends in {left}d</span>}
                      </td>
                      <td>{k.paymentTermsDays ? `Net ${k.paymentTermsDays}` : '—'}</td>
                      <td className="wrap-cell">
                        {k.fileId ? (
                          <FileLink api={api} fileId={k.fileId}>
                            {k.fileName}
                          </FileLink>
                        ) : (
                          '—'
                        )}
                      </td>
                      {can.edit && (
                        <td>
                          <button className="small" onClick={() => setForm(k)}>
                            Edit
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="card">
        <h2>Active customers without a contract ({missing.length})</h2>
        <div className="tags">
          {missing.map((c) => (
            <a key={c.id} className="tag" onClick={() => (can.edit ? setForm({ customerId: c.id, legalName: c.legalName }) : go('customers', c.id))}>
              {c.name}
            </a>
          ))}
        </div>
      </div>
      {form && <ContractForm {...ctx} initial={form} onClose={() => setForm(null)} />}
    </>
  );
}

export function ContractForm({ data, ops, byId, initial, onClose, api }) {
  const [k, setK] = useState({ type: 'MSA', title: '', legalName: '', startDate: '', endDate: '', paymentTermsDays: '', notes: '', ...initial });
  const [file, setFile] = useState(null);
  const set = (f, v) => setK((x) => ({ ...x, [f]: v }));
  const customers = [...data.customers].sort((a, b) => a.name.localeCompare(b.name));
  const [syncName, setSyncName] = useState(true);
  const save = async () => {
    let doc = { ...k, paymentTermsDays: Number(k.paymentTermsDays) || null };
    if (file) {
      const f = await api.uploadFile('contracts', file);
      doc = { ...doc, fileId: f.fileId, fileName: f.name, size: f.size, uploadedAt: new Date().toISOString() };
    }
    await ops.saveContract(doc);
    // The contract's legal name drives the payer-name check on payments.
    const c = byId.customers[k.customerId];
    if (syncName && c && k.legalName && k.legalName !== c.legalName) await ops.saveCustomer({ ...c, legalName: k.legalName });
    onClose();
  };
  return (
    <Modal
      title={k.id ? 'Edit contract' : 'Upload contract'}
      wide
      onClose={onClose}
      footer={
        <>
          {k.id && (
            <Act onClick={async () => (await ops.deleteContract(k), onClose())} confirm="Remove this contract from the repository?">
              Delete
            </Act>
          )}
          <Act className="primary" disabled={!k.customerId || !k.title.trim() || (!k.id && !file)} onClick={save}>
            Save
          </Act>
        </>
      }
    >
      <div className="form-grid">
        <label className="wide">
          Customer
          <select value={k.customerId || ''} onChange={(e) => set('customerId', e.target.value)}>
            <option value="">Choose…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Title
          <input value={k.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Master Services Agreement 2025" />
        </label>
        <label>
          Type
          <select value={k.type} onChange={(e) => set('type', e.target.value)}>
            {TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="wide">
          Customer name exactly as signed in the contract
          <input value={k.legalName} onChange={(e) => set('legalName', e.target.value)} />
        </label>
        <label className="check wide">
          <input type="checkbox" checked={syncName} onChange={(e) => setSyncName(e.target.checked)} /> Use this name for the payer check on this customer’s payments
        </label>
        <label>
          Start date
          <input type="date" value={k.startDate} onChange={(e) => set('startDate', e.target.value)} />
        </label>
        <label>
          End / renewal date
          <input type="date" value={k.endDate} onChange={(e) => set('endDate', e.target.value)} />
        </label>
        <label>
          Payment terms (days)
          <input type="number" value={k.paymentTermsDays || ''} onChange={(e) => set('paymentTermsDays', e.target.value)} />
        </label>
        <label className="wide">
          Notes (rates, notice period, late-payment clause…)
          <textarea rows={2} value={k.notes} onChange={(e) => set('notes', e.target.value)} />
        </label>
        <label className="wide">
          {k.fileId ? `File: ${k.fileName} (choose a file to replace it)` : 'Contract file (PDF)'}
          <input type="file" accept=".pdf,.doc,.docx,image/*" onChange={(e) => setFile(e.target.files[0] || null)} />
        </label>
      </div>
    </Modal>
  );
}
