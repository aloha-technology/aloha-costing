import React, { useMemo, useState } from 'react';
import { Kpi } from '../../views/ui.jsx';
import { Act, amt, fmtDate, Modal } from './parts.jsx';
import { payerCheck, autoAllocate, settledAmount, validatePayment } from '../engine/payments.js';
import { money, round2, CURRENCIES } from '../engine/money.js';
import { isOpen } from '../engine/aging.js';

const CHECK_TEXT = { match: 'Matches contract name', partial: 'Partly matches: please check', mismatch: 'Does not match the contract name', unknown: 'Enter the payer name from the bank' };

export default function Payments(ctx) {
  const { data, byId, focus, setFocus, can, ops, on } = ctx;
  const [month, setMonth] = useState(on.slice(0, 7));
  const prefill = focus?.startsWith('new:') ? focus.split(':') : null;
  const list = data.payments.filter((p) => !month || p.date?.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date));
  const months = [...new Set(data.payments.map((p) => p.date?.slice(0, 7)))].filter(Boolean).sort().reverse();
  const tot = (k) => list.reduce((s, p) => s + (Number(p[k]) || 0), 0);
  return (
    <>
      <div className="toolbar">
        {can.edit && (
          <button className="primary" onClick={() => setFocus('new:')}>
            + Record payment
          </button>
        )}
        <label>
          Month
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">All</option>
            {[...new Set([on.slice(0, 7), ...months])].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="kpis">
        <Kpi label="Payments" value={list.length} />
        <Kpi label="Settled against invoices" value={amt(tot('settled'))} note="received + bank charges, in USD" tone="good" />
        <Kpi label="Bank charges" value={amt(tot('bankCharges'))} tone="warn" />
        <Kpi label="Payer name issues" value={list.filter((p) => p.payerCheck === 'mismatch' || p.payerCheck === 'partial').length} note="payer ≠ contract name" />
      </div>
      <div className="card">
        {!list.length ? (
          <div className="empty small">No payments recorded{month ? ' this month' : ''}.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Payer (bank)</th>
                  <th className="r">Received</th>
                  <th className="r">Bank charges</th>
                  <th className="r">Settled (USD)</th>
                  <th>Invoices</th>
                  <th>Reference</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id}>
                    <td>{fmtDate(p.date)}</td>
                    <td>{byId.customers[p.customerId]?.name}</td>
                    <td className="wrap-cell">
                      {p.payerName || '—'} {p.payerCheck && <span className={`flag ${p.payerCheck === 'match' ? 'good' : p.payerCheck === 'partial' ? 'warn' : 'bad'}`}>{p.payerCheck}</span>}
                      {p.payerNote && <span className="sub">{p.payerNote}</span>}
                    </td>
                    <td className="r">{money(p.amountReceived, p.currency)}</td>
                    <td className="r">{Number(p.bankCharges) ? money(p.bankCharges, p.invoiceCurrency) : '—'}</td>
                    <td className="r">
                      <strong>{money(p.settled, p.invoiceCurrency)}</strong>
                      {p.currency !== p.invoiceCurrency && <span className="sub">@ {p.fxRate}</span>}
                    </td>
                    <td className="wrap-cell">{(p.allocations || []).map((a) => `${a.invoiceNumber || a.invoiceId} (${amt(a.amount)})`).join(', ') || <span className="flag warn">unapplied</span>}</td>
                    <td>{p.reference}</td>
                    <td>{can.edit && <Act onClick={() => ops.deletePayment(p)} confirm="Delete this payment? The invoices go back to their previous balances.">Delete</Act>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {prefill && can.edit && <PaymentForm {...ctx} customerId={prefill[1] || ''} invoiceId={prefill[2] || ''} onClose={() => setFocus('')} />}
    </>
  );
}

function PaymentForm({ data, byId, ops, on, customerId: initialCustomer, invoiceId, onClose, go }) {
  const [p, setP] = useState(() => {
    const inv = byId.invoices[invoiceId];
    return {
      customerId: initialCustomer,
      date: on,
      payerName: '',
      currency: 'USD',
      invoiceCurrency: inv?.currency || 'USD',
      amountReceived: inv ? String(inv.balance) : '',
      bankCharges: '',
      fxRate: '',
      reference: '',
      note: '',
      payerNote: '',
      rememberPayer: false,
      allocations: inv ? [{ invoiceId: inv.id, amount: inv.balance }] : [],
    };
  });
  const set = (k, v) => setP((x) => ({ ...x, [k]: v }));
  const customer = byId.customers[p.customerId];
  const openInv = useMemo(() => data.invoices.filter((i) => i.customerId === p.customerId && isOpen(i)).sort((a, b) => a.date.localeCompare(b.date)), [data.invoices, p.customerId]);
  const check = customer ? payerCheck(p.payerName, customer) : { result: 'unknown' };
  const settled = settledAmount(p);
  const allocated = round2(p.allocations.reduce((s, a) => s + (Number(a.amount) || 0), 0));
  const invById = Object.fromEntries(openInv.map((i) => [i.id, i]));
  const full = { ...p, payerCheck: check.result, amountReceived: Number(p.amountReceived) || 0, bankCharges: Number(p.bankCharges) || 0, fxRate: Number(p.fxRate) || null };
  const errs = validatePayment(full, invById);
  const setAlloc = (id, amount) => {
    const rest = p.allocations.filter((a) => a.invoiceId !== id);
    set('allocations', amount === null ? rest : [...rest, { invoiceId: id, amount }]);
  };
  const customers = [...data.customers].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Modal
      title="Record payment"
      wide
      onClose={onClose}
      footer={
        <>
          {errs.length > 0 && <span className="err" style={{ flexBasis: 'auto', marginRight: 'auto' }}>{errs[0]}</span>}
          <Act
            className="primary"
            disabled={errs.length > 0}
            onClick={async () => {
              await ops.recordPayment({
                ...full,
                allocations: p.allocations.filter((a) => a.amount > 0).map((a) => ({ ...a, amount: round2(a.amount), invoiceNumber: invById[a.invoiceId]?.number })),
                unapplied: round2(settled - allocated),
              });
              onClose();
              if (initialCustomer) go('customers', p.customerId);
            }}
          >
            Save payment
          </Act>
        </>
      }
    >
      <div className="form-grid">
        <label className="wide">
          Customer
          <select value={p.customerId} onChange={(e) => setP((x) => ({ ...x, customerId: e.target.value, allocations: [] }))}>
            <option value="">Choose…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date received
          <input type="date" value={p.date} onChange={(e) => set('date', e.target.value)} />
        </label>
        <label>
          Currency paid
          <select value={p.currency} onChange={(e) => set('currency', e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Amount received ({p.currency})
          <input type="number" step="0.01" value={p.amountReceived} onChange={(e) => set('amountReceived', e.target.value)} placeholder="as credited by the bank" />
        </label>
        <label>
          Bank charges deducted ({p.invoiceCurrency})
          <input type="number" step="0.01" value={p.bankCharges} onChange={(e) => set('bankCharges', e.target.value)} placeholder="0.00" />
        </label>
        {p.currency !== p.invoiceCurrency && (
          <label>
            Rate: 1 {p.currency} = ? {p.invoiceCurrency}
            <input type="number" step="0.0001" value={p.fxRate} onChange={(e) => set('fxRate', e.target.value)} />
          </label>
        )}
        <label>
          Bank reference / transaction ID
          <input value={p.reference} onChange={(e) => set('reference', e.target.value)} />
        </label>
        <label className="wide">
          Payer name as shown by the bank
          <input value={p.payerName} onChange={(e) => set('payerName', e.target.value)} placeholder="e.g. ACME SOFTWARE INC" />
        </label>
        {customer && (
          <div className="wide">
            <span className={`flag ${check.result === 'match' ? 'good' : check.result === 'partial' ? 'warn' : check.result === 'mismatch' ? 'bad' : ''}`}>{CHECK_TEXT[check.result]}</span>{' '}
            <span className="hint">
              Contract name: <strong>{customer.legalName || `${customer.name} (Zoho name; no contract name set)`}</strong>
              {check.against && check.against !== (customer.legalName || customer.name) && <> · matched “{check.against}”</>}
            </span>
          </div>
        )}
        {(check.result === 'mismatch' || check.result === 'partial') && (
          <>
            <label className="wide">
              Why is the payer different? {check.result === 'mismatch' && '(required)'}
              <input value={p.payerNote} onChange={(e) => set('payerNote', e.target.value)} placeholder="e.g. paid by parent company, confirmed with customer by email" />
            </label>
            <label className="check wide">
              <input type="checkbox" checked={p.rememberPayer} onChange={(e) => set('rememberPayer', e.target.checked)} /> Accept this payer name for {customer?.name} in future
            </label>
          </>
        )}
      </div>

      {customer && (
        <>
          <h3>
            Apply to invoices · settles {money(settled, p.invoiceCurrency)}
            {Number(p.bankCharges) > 0 && ` (${money(Number(p.amountReceived) * (p.currency === p.invoiceCurrency ? 1 : Number(p.fxRate) || 0), p.invoiceCurrency)} received + ${money(p.bankCharges, p.invoiceCurrency)} charges)`}
          </h3>
          <div className="row" style={{ marginTop: 0, marginBottom: 6 }}>
            <button className="small" onClick={() => set('allocations', autoAllocate(openInv, settled).allocations)} disabled={!settled}>
              Apply oldest first
            </button>
            <span className="hint">
              Allocated {money(allocated, p.invoiceCurrency)}
              {round2(settled - allocated) > 0 && ` · unapplied ${money(settled - allocated, p.invoiceCurrency)} (kept on the payment as credit)`}
            </span>
          </div>
          {openInv.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th />
                    <th>Invoice</th>
                    <th>Date</th>
                    <th className="r">Balance</th>
                    <th className="r">Apply</th>
                  </tr>
                </thead>
                <tbody>
                  {openInv.map((i) => {
                    const a = p.allocations.find((x) => x.invoiceId === i.id);
                    return (
                      <tr key={i.id}>
                        <td>
                          <input type="checkbox" checked={Boolean(a)} onChange={(e) => setAlloc(i.id, e.target.checked ? Math.min(i.balance, Math.max(0, round2(settled - allocated))) || i.balance : null)} />
                        </td>
                        <td>{i.number}</td>
                        <td>{fmtDate(i.date)}</td>
                        <td className="r">{money(i.balance, i.currency)}</td>
                        <td className="r">
                          {a && <input className="inline-in amt-in" type="number" step="0.01" value={a.amount} onChange={(e) => setAlloc(i.id, Number(e.target.value))} />}
                          {a && round2(a.amount) >= i.balance && <span className="flag good">paid in full</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="muted">This customer has no open invoices; the payment will be recorded as unapplied credit.</div>
          )}
          <label className="stack" style={{ marginTop: 10 }}>
            <span>Note (optional)</span>
            <input value={p.note} onChange={(e) => set('note', e.target.value)} />
          </label>
        </>
      )}
    </Modal>
  );
}
