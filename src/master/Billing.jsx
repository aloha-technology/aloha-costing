// Monthly billing register: company totals per month (Billing Count format), every line of a month with
// its change and reason (Delta every Month format), billed seats by resource type, export to Excel.
import React, { useMemo, useState } from 'react';
import { Act, Modal, amt } from '../collections/views/parts.jsx';
import { companyMonths, linesFromInvoicing, periodOf, monthName, roleCheck, sumSeats, roleValue } from './billing.js';
import { projectCodesOf } from './engine.js';

const n2 = (x) => (x == null ? '—' : Number(x).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const signed = (x, f = n2) => (x == null ? '—' : x > 0 ? `+${f(x)}` : x < 0 ? `−${f(-x)}` : '0');
const signedAmt = (x) => (x == null ? '—' : x > 0 ? `+${amt(x)}` : x < 0 ? `−${amt(-x)}` : '0');
const tone = (x) => (x > 0.001 ? 'good-text' : x < -0.001 ? 'warn-text' : '');

// Invoicing rows for the month the Costing data is for.
function invoicingRows(model) {
  if (model.invoicingLines?.length) return model.invoicingLines;
  return (model.customers || [])
    .filter((c) => c.invoicing)
    .map((c) => ({ name: (c.invoicing.lines || [c.name]).join(' + '), code: c.code, pmEmail: c.accountPm || '', seats: c.invoicing.seats, amountUSD: c.invoicing.amountUSD, diffSeats: c.invoicing.diffSeats, diffAmountUSD: c.invoicing.diffAmountUSD }));
}

export default function Billing(ctx) {
  const { billing, model, can, ops, focus, setFocus } = ctx;
  const months = useMemo(() => companyMonths(billing), [billing]);
  const modelPeriod = periodOf(model.period);
  const recorded = billing.some((x) => x.kind === 'line' && x.period === modelPeriod);
  const period = focus && /^\d{4}-\d{2}$/.test(focus) ? focus : null;

  const record = async () => {
    const fresh = linesFromInvoicing(invoicingRows(model), modelPeriod, billing, ctx.me.name);
    // Re-recording keeps what Matt added (remarks, term, resource types).
    const existing = Object.fromEntries(billing.filter((x) => x.kind === 'line' && x.period === modelPeriod).map((x) => [x.id, x]));
    await ops.saveBilling(fresh.map((l) => (existing[l.id] ? { ...l, remarks: existing[l.id].remarks, term: existing[l.id].term, byRole: existing[l.id].byRole?.length ? existing[l.id].byRole : l.byRole } : l)));
    setFocus(modelPeriod);
  };

  if (period) return <MonthView {...ctx} period={period} months={months} />;
  const exportAll = async () => {
    const XLSX = await import('xlsx');
    const rows = [['Month', 'Long Term Seat Count', 'Long Term Revenue ($)', 'Short Term Seat Count', 'Short Term Revenue ($)', 'Net Revenue ($)', 'Delta Seat Count', 'Delta Net Revenue ($)', 'Source'], ...months.map((m) => [monthName(m.period), m.longSeats, m.longRevenue, m.shortSeats, m.shortRevenue, m.revenue, m.seatDelta, m.revenueDelta, m.source])];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Billing Count');
    XLSX.writeFile(wb, 'Aloha Billing Count.xlsx');
  };
  return (
    <>
      <div className="toolbar">
        {can.edit && (
          <Act className="primary" onClick={record} confirm={recorded ? `Re-record ${monthName(modelPeriod)} from the latest invoicing sheet? Your remarks, terms and resource types are kept.` : undefined}>
            {recorded ? `Re-record ${monthName(modelPeriod)}` : `Record ${monthName(modelPeriod)} billing`} from the invoicing sheet
          </Act>
        )}
        <button className="small" onClick={exportAll}>
          Download Billing Count (Excel)
        </button>
        <span className="hint">
          Each month: upload the invoicing sheet in Project Costing → Data & validation, publish, then record it here. Months before the first recording show the totals you reported.
        </span>
      </div>
      <div className="card">
        <h2>Billing count by month</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th className="r">Long-term seats</th>
                <th className="r">Long-term revenue</th>
                <th className="r">Short-term seats</th>
                <th className="r">Short-term revenue</th>
                <th className="r">Net revenue</th>
                <th className="r">Δ seats</th>
                <th className="r">Δ revenue</th>
                <th className="r">Changes</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {[...months].reverse().map((m) => (
                <tr key={m.period} className="click" onClick={() => setFocus(m.period)}>
                  <td>
                    <strong>{monthName(m.period)}</strong>
                  </td>
                  <td className="r">{n2(m.longSeats)}</td>
                  <td className="r">{m.longRevenue == null ? '—' : amt(m.longRevenue)}</td>
                  <td className="r">{n2(m.shortSeats)}</td>
                  <td className="r">{m.shortRevenue == null ? '—' : amt(m.shortRevenue)}</td>
                  <td className="r">
                    {m.revenue == null ? <span className="muted">not reported</span> : <strong>{amt(m.revenue)}</strong>}
                    {m.seats != null && <span className="sub">{n2(m.seats)} seats</span>}
                  </td>
                  <td className={`r ${tone(m.seatDelta)}`}>{signed(m.seatDelta)}</td>
                  <td className={`r ${tone(m.revenueDelta)}`}>{signedAmt(m.revenueDelta)}</td>
                  <td className="r">{m.changed || '—'}</td>
                  <td>
                    <span className="flag">{m.source}</span>
                    {m.reported?.targetSeats ? <span className="sub">target {n2(m.reported.targetSeats)} seats</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function MonthView(ctx) {
  const { billing, period, months, setFocus, can, ops, accounts, pmsById, go } = ctx;
  const [view, setView] = useState('changed');
  const [edit, setEdit] = useState(null);
  const m = months.find((x) => x.period === period);
  const lines = billing.filter((x) => x.kind === 'line' && x.period === period);
  const changes = billing.filter((x) => x.kind === 'change' && x.period === period);
  const accountOf = useMemo(() => {
    const map = {};
    for (const v of accounts) for (const c of projectCodesOf(v.account)) map[c] = v.account;
    return map;
  }, [accounts]);
  const changed = lines.filter((l) => Math.abs(l.seatDelta || 0) > 0.001 || Math.abs(l.amountDelta || 0) > 0.5);
  const shown = (view === 'changed' ? changed : lines).sort((a, b) => Math.abs(b.amountDelta || 0) - Math.abs(a.amountDelta || 0) || b.amountUSD - a.amountUSD);
  const i = months.findIndex((x) => x.period === period);

  const exportMonth = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const delta = lines.length
      ? [['Customer Name', 'Seat Count this Month', 'Amount this Month', 'Count Delta', 'Amount Delta', 'Remarks'], ...changed.map((l) => [l.name, l.seats, l.amountUSD, l.seatDelta, l.amountDelta, l.remarks])]
      : [['Customer Name', 'Seat Count this Month', 'Amount this Month', 'Count Delta', 'Amount Delta', 'Remarks'], ...changes.map((c) => [c.name, c.seats, c.amountUSD, c.seatDelta, c.amountDelta, c.remarks])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(delta), monthName(period));
    if (lines.length)
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([['Customer Name', 'Project Code', 'PM', 'Term', 'Seats', 'Amount', 'Count Delta', 'Amount Delta', 'Resource types', 'Remarks'], ...lines.map((l) => [l.name, l.code, pmsById[l.pmEmail]?.name || l.pmEmail, l.term, l.seats, l.amountUSD, l.seatDelta, l.amountDelta, (l.byRole || []).map((r) => `${r.seats} ${r.role} @ ${r.rateUSD}`).join('; '), l.remarks])]),
        'All lines'
      );
    XLSX.writeFile(wb, `Aloha Billing Delta_${monthName(period)}.xlsx`);
  };

  return (
    <>
      <div className="title-row">
        <button className="back" style={{ margin: 0 }} onClick={() => setFocus('')}>
          ← All months
        </button>
        <span className="spacer" />
        {months[i - 1] && (
          <button className="small" onClick={() => setFocus(months[i - 1].period)}>
            ← {monthName(months[i - 1].period)}
          </button>
        )}
        {months[i + 1] && (
          <button className="small" onClick={() => setFocus(months[i + 1].period)}>
            {monthName(months[i + 1].period)} →
          </button>
        )}
        <button className="small" onClick={exportMonth}>
          Download delta (Excel)
        </button>
      </div>
      <div className="kpis compact-kpis">
        <div className="kpi">
          <div className="kpi-label">{monthName(period)} net revenue</div>
          <div className="kpi-value">{m?.revenue != null ? amt(m.revenue) : '—'}</div>
          <div className={`kpi-note ${tone(m?.revenueDelta)}`}>{signedAmt(m?.revenueDelta)} vs last month</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Seats</div>
          <div className="kpi-value">{n2(m?.seats)}</div>
          <div className={`kpi-note ${tone(m?.seatDelta)}`}>{signed(m?.seatDelta)} vs last month</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Long / short term</div>
          <div className="kpi-value" style={{ fontSize: 15 }}>
            {n2(m?.longSeats)} / {n2(m?.shortSeats)} seats
          </div>
          <div className="kpi-note">
            {m?.longRevenue != null ? `${amt(m.longRevenue)} / ${amt(m.shortRevenue)}` : ''}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Revenue per seat</div>
          <div className="kpi-value">{m?.seats ? amt(m.revenue / m.seats) : '—'}</div>
        </div>
      </div>

      {lines.length > 0 ? (
        <div className="card">
          <div className="tabs">
            <button className={view === 'changed' ? 'on' : ''} onClick={() => setView('changed')}>
              Changed ({changed.length})
            </button>
            <button className={view === 'all' ? 'on' : ''} onClick={() => setView('all')}>
              All lines ({lines.length})
            </button>
            {changes.length > 0 && (
              <button className={view === 'log' ? 'on' : ''} onClick={() => setView('log')}>
                Logged in delta sheet ({changes.length})
              </button>
            )}
          </div>
          {view === 'log' ? (
            <ChangeTable changes={changes} accountOf={accountOf} go={go} />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Billing line</th>
                    <th>PM</th>
                    <th>Term</th>
                    <th className="r">Seats</th>
                    <th className="r">Δ seats</th>
                    <th className="r">Amount</th>
                    <th className="r">Δ amount</th>
                    <th className="r">$/seat</th>
                    <th>Resource types</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((l) => {
                    const rc = roleCheck(l);
                    const acct = accountOf[l.code];
                    return (
                      <tr key={l.id} className="click" onClick={() => setEdit(l)}>
                        <td className="wrap-cell">
                          {l.name}
                          <span className="sub">
                            {acct ? (
                              <a onClick={(e) => (e.stopPropagation(), go('customers', acct.id))}>{acct.name}</a>
                            ) : (
                              'not linked to a customer'
                            )}
                            {l.code && ` · ${l.code}`}
                          </span>
                        </td>
                        <td>{pmsById[l.pmEmail]?.name || l.pmEmail?.split('@')[0] || '—'}</td>
                        <td>{l.term === 'short' ? <span className="flag warn">short</span> : 'long'}</td>
                        <td className="r">{n2(l.seats)}</td>
                        <td className={`r ${tone(l.seatDelta)}`}>{signed(l.seatDelta)}</td>
                        <td className="r">{amt(l.amountUSD)}</td>
                        <td className={`r ${tone(l.amountDelta)}`}>{signedAmt(l.amountDelta)}</td>
                        <td className="r">{l.seats ? amt(l.amountUSD / l.seats) : '—'}</td>
                        <td className="wrap-cell">
                          {rc.state === 'none' ? (
                            <span className="muted">—</span>
                          ) : (
                            <>
                              {l.byRole.map((r) => `${n2(r.seats)} ${r.role}`).join(', ')}
                              {rc.state === 'mismatch' && <span className="flag warn">doesn’t add up</span>}
                            </>
                          )}
                        </td>
                        <td className="wrap-cell">{l.remarks || ((Math.abs(l.seatDelta) > 0.001 || Math.abs(l.amountDelta) > 0.5) && <span className="flag warn">add reason</span>)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="card">
          <h2>Changes logged for {monthName(period)}</h2>
          <p className="hint" style={{ marginTop: 0 }}>This month was not recorded line by line; these are the changes from your “Delta every Month” sheet.</p>
          <ChangeTable changes={changes} accountOf={accountOf} go={go} />
        </div>
      )}
      {edit && <LineEditor line={edit} can={can} ops={ops} ratecardRoles={ctx.roleOptions} onClose={() => setEdit(null)} />}
    </>
  );
}

function ChangeTable({ changes, accountOf, go }) {
  if (!changes.length) return <div className="empty small">No changes logged.</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Customer / line</th>
            <th className="r">Seats this month</th>
            <th className="r">Δ seats</th>
            <th className="r">Amount this month</th>
            <th className="r">Δ amount</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c) => (
            <tr key={c.id}>
              <td className="wrap-cell">
                {c.name}
                {accountOf[c.code] && (
                  <span className="sub">
                    <a onClick={() => go('customers', accountOf[c.code].id)}>{accountOf[c.code].name}</a>
                  </span>
                )}
              </td>
              <td className="r">{n2(c.seats)}</td>
              <td className={`r ${tone(c.seatDelta)}`}>{signed(c.seatDelta)}</td>
              <td className="r">{c.amountUSD == null ? '—' : amt(c.amountUSD)}</td>
              <td className={`r ${tone(c.amountDelta)}`}>{signedAmt(c.amountDelta)}</td>
              <td className="wrap-cell">{c.remarks}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LineEditor({ line, can, ops, ratecardRoles = [], onClose }) {
  const [f, setF] = useState({ remarks: line.remarks || '', term: line.term || 'long', byRole: line.byRole?.length ? line.byRole : [{ role: '', seats: line.seats, rateUSD: line.seats ? Math.round(line.amountUSD / line.seats) : '' }] });
  const setRole = (i, k, v) => setF((x) => ({ ...x, byRole: x.byRole.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }));
  const byRole = f.byRole.filter((r) => r.role && Number(r.seats) > 0).map((r) => ({ role: r.role, seats: Number(r.seats), rateUSD: Number(r.rateUSD) || 0 }));
  const check = roleCheck({ ...line, byRole });
  return (
    <Modal
      title={`${line.name} · ${monthName(line.period)}`}
      wide
      onClose={onClose}
      footer={can.edit && <Act className="primary" onClick={async () => (await ops.saveBilling([{ ...line, remarks: f.remarks.trim(), term: f.term, byRole }]), onClose())}>Save</Act>}
    >
      <div className="kv" style={{ marginBottom: 12 }}>
        <div>
          <div className="k">Billed</div>
          <div className="v">
            {n2(line.seats)} seats · {amt(line.amountUSD)}
          </div>
        </div>
        <div>
          <div className="k">Change vs last month</div>
          <div className="v">
            {signed(line.seatDelta)} seats · {signedAmt(line.amountDelta)}
          </div>
        </div>
        <div>
          <div className="k">Rate per seat</div>
          <div className="v">{line.seats ? amt(line.amountUSD / line.seats) : '—'}</div>
        </div>
      </div>
      <div className="form-grid">
        <label className="wide">
          Reason for the change
          <input value={f.remarks} disabled={!can.edit} onChange={(e) => setF({ ...f, remarks: e.target.value })} placeholder="e.g. 1 Dev added from 06/01; prorated adjustment; seat reduced after notice" />
        </label>
        <label>
          Term
          <select value={f.term} disabled={!can.edit} onChange={(e) => setF({ ...f, term: e.target.value })}>
            <option value="long">Long term</option>
            <option value="short">Short term</option>
          </select>
        </label>
      </div>
      <h3>Billed seats by resource type</h3>
      <datalist id="role-options">
        {ratecardRoles.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      {f.byRole.map((r, i) => (
        <div key={i} className="contact-row" style={{ gridTemplateColumns: '2fr 1fr 1fr auto' }}>
          <input className="inline-in" list="role-options" placeholder="Resource type (Developer, QA…)" value={r.role} disabled={!can.edit} onChange={(e) => setRole(i, 'role', e.target.value)} />
          <input className="inline-in" type="number" step="0.01" placeholder="Seats" value={r.seats} disabled={!can.edit} onChange={(e) => setRole(i, 'seats', e.target.value)} />
          <input className="inline-in" type="number" placeholder="Rate $/month" value={r.rateUSD} disabled={!can.edit} onChange={(e) => setRole(i, 'rateUSD', e.target.value)} />
          {can.edit && (
            <button className="linkish" onClick={() => setF((x) => ({ ...x, byRole: x.byRole.filter((_, j) => j !== i) }))}>
              remove
            </button>
          )}
        </div>
      ))}
      {can.edit && (
        <button className="small" onClick={() => setF((x) => ({ ...x, byRole: [...x.byRole, { role: '', seats: '', rateUSD: '' }] }))}>
          + Add resource type
        </button>
      )}
      {byRole.length > 0 && (
        <div className={check.state === 'ok' ? 'good-text' : 'warnbox'} style={{ marginTop: 10 }}>
          {n2(sumSeats(byRole))} seats worth {amt(roleValue(byRole))}
          {check.state === 'ok' ? ' · matches the line' : ` · the line is ${n2(line.seats)} seats and ${amt(line.amountUSD)}`}
        </div>
      )}
      <p className="hint">Resource types carry over to next month, so you only update them when the team changes.</p>
    </Modal>
  );
}
