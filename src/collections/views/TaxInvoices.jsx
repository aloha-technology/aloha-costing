// Tax invoices: the accounts team uploads the PDFs they issued; Matt checks each one by hand and
// sends it to the customer (queued with the PDF attached, or from his own mailbox).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Act, EmailEditor, Modal, mailtoHref, amt, fmtDate, FileLink } from './parts.jsx';
import { invoiceKey } from '../engine/importer.js';
import { taxInvoicesDue, unpaidWarning } from '../engine/taxinvoices.js';
import { today } from '../engine/dates.js';

// Best invoice for a file name: the longest invoice number contained in it.
export function matchFile(name, directory) {
  const key = invoiceKey(name.replace(/\.[^.]+$/, ''));
  let best = null;
  for (const d of directory) {
    const k = invoiceKey(d.number);
    if (k.length >= 5 && key.includes(k) && (!best || k.length > invoiceKey(best.number).length)) best = d;
  }
  return best;
}

const STATUS = { uploaded: ['To check', 'warn'], checked: ['Checked, ready to send', 'info'], queued: ['Queued to send', 'info'], sent: ['Sent', 'good'], rejected: ['Sent back to accounts', 'bad'] };

export default function TaxInvoices(ctx) {
  const { me } = ctx;
  return me.role === 'accounts' ? <AccountsPortal {...ctx} /> : <MattQueue {...ctx} />;
}

function useDirectory(api) {
  const [dir, setDir] = useState([]);
  useEffect(() => {
    api.directory().then(setDir, () => setDir([]));
  }, [api]);
  return dir;
}

function Uploader({ api, ops, directory, onDone, replace, preset }) {
  const [files, setFiles] = useState([]);
  const [over, setOver] = useState(false);
  const input = useRef(null);
  const add = (list) =>
    setFiles((cur) => [
      ...cur,
      ...[...list].map((file) => {
        const m = replace ? directory.find((d) => d.id === replace.invoiceId) : preset ? directory.find((d) => d.id === preset) : matchFile(file.name, directory);
        return { file, invoiceId: m?.id || '', taxInvoiceNo: replace?.taxInvoiceNo || file.name.replace(/\.[^.]+$/, ''), status: '' };
      }),
    ]);
  const set = (i, k, v) => setFiles((cur) => cur.map((f, j) => (j === i ? { ...f, [k]: v } : f)));
  const sorted = useMemo(() => [...directory].sort((a, b) => b.date.localeCompare(a.date)), [directory]);
  const uploadAll = async () => {
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f.status === 'done') continue;
      const d = directory.find((x) => x.id === f.invoiceId);
      set(i, 'status', 'uploading');
      try {
        await ops.uploadTaxInvoice(f.file, { invoiceId: f.invoiceId || null, customerId: d?.customerId || null, taxInvoiceNo: f.taxInvoiceNo, replaceId: replace?.id });
        set(i, 'status', 'done');
      } catch (e) {
        set(i, 'status', `error: ${e.message}`);
      }
    }
    onDone?.();
  };
  return (
    <>
      <div
        className={`drop ${over ? 'over' : ''}`}
        onClick={() => input.current.click()}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => (e.preventDefault(), setOver(false), add(e.dataTransfer.files))}
      >
        {replace ? 'Drop the corrected PDF here, or click to choose' : 'Drop tax invoice PDFs here, or click to choose. Name files with the invoice number (e.g. APTE-12386.pdf) and they match automatically.'}
        <input ref={input} type="file" accept=".pdf,application/pdf,image/*" multiple={!replace} hidden onChange={(e) => (add(e.target.files), (e.target.value = ''))} />
      </div>
      {files.length > 0 && (
        <>
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Against invoice</th>
                  <th>Tax invoice #</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {files.map((f, i) => (
                  <tr key={i}>
                    <td className="wrap-cell">{f.file.name}</td>
                    <td>
                      <select className="inline-in" value={f.invoiceId} onChange={(e) => set(i, 'invoiceId', e.target.value)} disabled={f.status === 'done'} style={{ maxWidth: 360 }}>
                        <option value="">Choose invoice…</option>
                        {sorted.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.number} · {d.customerName} · {fmtDate(d.date)} · {amt(d.amount, d.currency)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input className="inline-in" value={f.taxInvoiceNo} onChange={(e) => set(i, 'taxInvoiceNo', e.target.value)} disabled={f.status === 'done'} />
                    </td>
                    <td>{f.status === 'done' ? <span className="flag good">uploaded</span> : f.status ? <span className="muted">{f.status}</span> : <button className="linkish" onClick={() => setFiles(files.filter((_, j) => j !== i))}>remove</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row">
            <Act className="primary" disabled={files.some((f) => !f.invoiceId && f.status !== 'done') || files.every((f) => f.status === 'done')} onClick={uploadAll}>
              Upload {files.filter((f) => f.status !== 'done').length} file(s)
            </Act>
            {files.some((f) => !f.invoiceId) && <span className="hint">Choose the invoice for every file.</span>}
            {files.every((f) => f.status === 'done') && (
              <button className="small" onClick={() => setFiles([])}>
                Clear
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}

function DueList({ due, onUpload, extra }) {
  if (!due.length) return <div className="empty small">Every paid invoice has a tax invoice.</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Customer</th>
            <th className="r">Amount</th>
            <th>Paid on</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {due.map((d) => (
            <tr key={d.id}>
              <td>{d.number}</td>
              <td className="wrap-cell">{d.customerName}</td>
              <td className="r">{amt(d.amount, d.currency)}</td>
              <td>{fmtDate(d.paidAt)}</td>
              <td>
                {onUpload && (
                  <button className="small" onClick={() => onUpload(d)}>
                    Upload tax invoice
                  </button>
                )}
                {extra?.(d)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccountsPortal(ctx) {
  const { api, ops, data, reload } = ctx;
  const directory = useDirectory(api);
  const [replacing, setReplacing] = useState(null);
  const dirById = Object.fromEntries(directory.map((d) => [d.id, d]));
  const mine = [...data.taxInvoices].sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
  const rejected = mine.filter((t) => t.status === 'rejected');
  const due = taxInvoicesDue(directory, data.taxInvoices, today());
  const [presetFor, setPresetFor] = useState(null);
  return (
    <>
      <div className="infobox">
        Tax invoices go out after the customer pays. Upload the tax invoice for each paid invoice below; Matt checks it and sends it to the customer. If something needs fixing, it comes back here with a note.
      </div>
      <div className="card">
        <h2>Paid: tax invoice needed ({due.length})</h2>
        <DueList due={due} onUpload={setPresetFor} />
      </div>
      {presetFor && (
        <Modal title={`Tax invoice for ${presetFor.number} · ${presetFor.customerName}`} onClose={() => setPresetFor(null)}>
          <Uploader api={api} ops={ops} directory={directory} preset={presetFor.id} onDone={() => (reload(), setPresetFor(null))} />
        </Modal>
      )}
      <div className="card">
        <h2>Upload</h2>
        <Uploader api={api} ops={ops} directory={directory} onDone={reload} />
      </div>
      {rejected.length > 0 && (
        <div className="card">
          <h2>Sent back to you ({rejected.length})</h2>
          {rejected.map((t) => (
            <div key={t.id} className="q-card blocked">
              <div className="q-head">
                <strong>{t.fileName}</strong> <span className="muted">{dirById[t.invoiceId]?.number}</span>
                <span className="spacer" />
                <button className="primary" onClick={() => setReplacing(t)}>
                  Upload corrected file
                </button>
              </div>
              <div className="err">Matt’s note: {t.rejectNote}</div>
            </div>
          ))}
        </div>
      )}
      <div className="card">
        <h2>Uploaded</h2>
        <TaxTable list={mine} dirById={dirById} api={api} />
      </div>
      {replacing && (
        <Modal title={`Replace ${replacing.fileName}`} onClose={() => setReplacing(null)}>
          <Uploader api={api} ops={ops} directory={directory} replace={replacing} onDone={() => (reload(), setReplacing(null))} />
        </Modal>
      )}
    </>
  );
}

function TaxTable({ list, dirById, api, actions }) {
  if (!list.length) return <div className="empty small">Nothing here.</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>File</th>
            <th>Tax invoice #</th>
            <th>Invoice</th>
            <th>Customer</th>
            <th>Uploaded</th>
            <th>Status</th>
            {actions && <th />}
          </tr>
        </thead>
        <tbody>
          {list.map((t) => {
            const d = dirById[t.invoiceId];
            const [label, tone] = STATUS[t.status] || [t.status, ''];
            return (
              <tr key={t.id}>
                <td className="wrap-cell">
                  <FileLink api={api} fileId={t.fileId}>
                    {t.fileName}
                  </FileLink>
                </td>
                <td>{t.taxInvoiceNo}</td>
                <td>
                  {d ? `${d.number}` : <span className="flag warn">not matched</span>}
                  {d && <span className="sub">{amt(d.amount, d.currency)} · {fmtDate(d.date)}</span>}
                </td>
                <td className="wrap-cell">{d?.customerName || '—'}</td>
                <td>
                  {fmtDate((t.uploadedAt || '').slice(0, 10))}
                  <span className="sub">{t.uploadedByName}</span>
                </td>
                <td>
                  <span className={`flag ${tone}`}>{label}</span>
                  {t.sentAt && <span className="sub">{fmtDate(t.sentAt.slice(0, 10))}</span>}
                </td>
                {actions && <td>{actions(t)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MattQueue(ctx) {
  const { api, ops, data, byId, can, reload } = ctx;
  const directory = useDirectory(api);
  const dirById = useMemo(() => {
    const m = Object.fromEntries(directory.map((d) => [d.id, d]));
    // Fall back to the full invoice list (the directory only covers ~13 months).
    for (const i of data.invoices) if (!m[i.id]) m[i.id] = { id: i.id, number: i.number, customerId: i.customerId, customerName: byId.customers[i.customerId]?.name, date: i.date, amount: i.amount, currency: i.currency };
    return m;
  }, [directory, data.invoices, byId]);
  const due = useMemo(() => taxInvoicesDue(data.invoices, data.taxInvoices, today()).map((i) => ({ ...i, customerName: byId.customers[i.customerId]?.name || i.customerId })), [data.invoices, data.taxInvoices, byId]);
  const [tab, setTab] = useState('uploaded');
  const [rejecting, setRejecting] = useState(null);
  const [sending, setSending] = useState(null);
  const [uploading, setUploading] = useState(false);
  const counts = Object.fromEntries(Object.keys(STATUS).map((k) => [k, data.taxInvoices.filter((t) => t.status === k).length]));
  const list = data.taxInvoices.filter((t) => t.status === tab).sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));

  const actions = (t) =>
    can.edit && (
      <span className="row" style={{ marginTop: 0, flexWrap: 'nowrap' }}>
        {t.status === 'uploaded' && (
          <>
            <Act className="primary" onClick={() => ops.checkTaxInvoice(t)} title="You opened the PDF and it is correct">
              Checked OK
            </Act>
            <button className="small" onClick={() => setRejecting(t)}>
              Send back
            </button>
          </>
        )}
        {t.status === 'checked' && (
          <button className="primary" onClick={() => setSending(t)}>
            Send to customer
          </button>
        )}
        {t.status === 'checked' && (
          <button className="small" onClick={() => setRejecting(t)}>
            Send back
          </button>
        )}
        {!t.invoiceId && (
          <select
            className="inline-in"
            value=""
            onChange={(e) => {
              const d = dirById[e.target.value];
              ops.saveTaxInvoice({ ...t, invoiceId: d.id, customerId: d.customerId });
            }}
          >
            <option value="">Match to invoice…</option>
            {Object.values(dirById)
              .sort((a, b) => b.date.localeCompare(a.date))
              .slice(0, 400)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.number} · {d.customerName}
                </option>
              ))}
          </select>
        )}
      </span>
    );

  return (
    <>
      <div className="toolbar">
        <div className="tabs" style={{ marginBottom: 0, borderBottom: 0 }}>
          <button className={tab === 'due' ? 'on' : ''} onClick={() => setTab('due')}>
            Paid, awaiting tax invoice {due.length > 0 && <span className="badge good">{due.length}</span>}
          </button>
          {Object.entries(STATUS).map(([k, [label]]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {label} {counts[k] > 0 && <span className={`badge ${k === 'uploaded' ? '' : 'good'}`}>{counts[k]}</span>}
            </button>
          ))}
        </div>
        <span className="spacer" />
        {can.edit && (
          <button className="small" onClick={() => setUploading(true)}>
            Upload myself
          </button>
        )}
      </div>
      <div className="card">
        {tab === 'uploaded' && <p className="hint" style={{ marginTop: 0 }}>Open each PDF and check customer, invoice number, amount and tax details before marking it checked. Amounts and tax details are never edited here.</p>}
        {tab === 'due' ? (
          <>
            <p className="hint" style={{ marginTop: 0 }}>Invoices paid in the last 120 days (recorded here or closed by a Zoho import) that have no tax invoice yet. The accounts team sees the same list.</p>
            <DueList due={due} />
          </>
        ) : (
          <TaxTable list={list} dirById={dirById} api={api} actions={actions} />
        )}
      </div>
      {rejecting && <RejectDialog t={rejecting} ops={ops} onClose={() => setRejecting(null)} />}
      {sending && <SendTax t={sending} ctx={ctx} onClose={() => setSending(null)} />}
      {uploading && (
        <Modal title="Upload tax invoices" wide onClose={() => setUploading(false)}>
          <Uploader api={api} ops={ops} directory={Object.values(dirById)} onDone={reload} />
        </Modal>
      )}
    </>
  );
}

function RejectDialog({ t, ops, onClose }) {
  const [note, setNote] = useState('');
  return (
    <Modal
      title={`Send back: ${t.fileName}`}
      onClose={onClose}
      footer={
        <Act className="primary" disabled={!note.trim()} onClick={async () => (await ops.rejectTaxInvoice(t, note.trim()), onClose())}>
          Send back to accounts
        </Act>
      }
    >
      <div className="stack">
        <label>
          What needs fixing?
          <input value={note} onChange={(e) => setNote(e.target.value)} autoFocus placeholder="e.g. wrong GSTIN, amount differs from invoice" />
        </label>
      </div>
    </Modal>
  );
}

function SendTax({ t, ctx, onClose }) {
  const { ops, api, byId } = ctx;
  const [draft, setDraft] = useState(() => ({ ...ops.taxDraft(t), attachments: [{ fileId: t.fileId, name: t.fileName }] }));
  const c = byId.customers[t.customerId];
  return (
    <Modal
      title={`Send tax invoice: ${c?.name || ''}`}
      wide
      onClose={onClose}
      footer={
        <>
          <span className="hint" style={{ marginRight: 'auto' }}>
            <FileLink api={api} fileId={t.fileId}>
              Download PDF
            </FileLink>{' '}
            to attach it yourself if you send from your mailbox.
          </span>
          <a className="btn" href={mailtoHref(draft)} onClick={() => setTimeout(() => window.confirm('Sent it from your mailbox with the PDF attached? Click OK to record it as sent.') && ops.sendTaxInvoice(t, draft, { manual: true }).then(onClose), 400)}>
            Open in my email
          </a>
          <Act className="primary" disabled={!draft.to.length} onClick={async () => (await ops.sendTaxInvoice(t, draft), onClose())}>
            Queue with PDF attached
          </Act>
        </>
      }
    >
      {unpaidWarning(byId.invoices[t.invoiceId]) && <div className="warnbox" style={{ marginBottom: 10 }}>{unpaidWarning(byId.invoices[t.invoiceId])}</div>}
      {!draft.to.length && <div className="warnbox" style={{ marginBottom: 10 }}>Nobody is set to receive tax invoices for this customer. Tick “Receives tax invoices” on their contacts, or type the address below.</div>}
      <EmailEditor draft={draft} onChange={setDraft} />
    </Modal>
  );
}
