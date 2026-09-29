import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { inr, usd, pct } from '../format.js';
import { Kpi, Table } from './ui.jsx';
import DataChecks from './DataChecks.jsx';
import { KIND_LABEL, REQUIRED_KINDS, periodKey } from '../engine/kinds.js';
import { buildModel, CATEGORIES } from '../engine/model.js';
import { validateInputs, summarizeChecks } from '../engine/validate.js';

const ORDER = ['summary', 'invoicing', 'paysheet', 'employees', 'projects', 'bench'];
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

// State for uploads, validation stamps, classifications and corrections.
export function useImports(api, enabled) {
  const [st, setSt] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(() => {
    if (!enabled || !api?.getImports) return Promise.resolve();
    return api.getImports().then((x) => setSt(x), (e) => setError(e.message));
  }, [api, enabled]);
  useEffect(() => {
    reload();
  }, [reload]);

  const setRecord = useCallback(
    async (type, key, value) => {
      const map = { validation: 'validations', customer: 'customerValidations', category: 'categories', revenue: 'revenueOverrides', salary: 'salaryOverrides' }[type];
      const saved = await api.setImportRecord(type, st?.period, key, value);
      setSt((s) => {
        const next = { ...s[map] };
        if (value == null) delete next[key];
        else next[key] = { ...value, ...saved };
        return { ...s, [map]: next };
      });
    },
    [api, st?.period]
  );

  const upload = useCallback(
    async (fileList) => {
      const results = [];
      const parsed = [];
      const { parseWorkbook } = await import('../engine/parse.js'); // Excel reader loads only when uploading
      for (const f of fileList) {
        try {
          const p = parseWorkbook(new Uint8Array(await f.arrayBuffer()), f.name);
          if (!p.kind) results.push({ file: f.name, ok: false, text: "Not recognised (columns don't match any export)" });
          else parsed.push(p);
        } catch (e) {
          results.push({ file: f.name, ok: false, text: `Could not read: ${e.message}` });
        }
      }
      // The costing sheet names the period; other files belong to that period.
      const summary = parsed.find((p) => p.kind === 'summary');
      const period = summary ? periodKey(summary.sheetName) : st?.period;
      if (!period) return [...results, { file: '', ok: false, text: 'Upload the costing sheet first: it sets the month.' }];
      for (const p of parsed) {
        const { kind, ...file } = p;
        await api.saveImportFile(period, kind, file);
        results.push({ file: p.file, ok: true, text: `${KIND_LABEL[kind]} · ${p.rows.length} rows` });
      }
      await reload();
      return results;
    },
    [api, st?.period, reload]
  );

  return { st, error, reload, setRecord, upload };
}

// Build the model from the uploaded files with Matt's classifications and corrections.
export function useBuild(st) {
  return useMemo(() => {
    if (!st?.files || !REQUIRED_KINDS.every((k) => st.files[k])) return { model: null, checks: validateInputs(st?.files || {}, null), error: null };
    try {
      const categories = Object.fromEntries(Object.entries(st.categories || {}).map(([id, c]) => [id, c.category]));
      const model = buildModel(st.files, { categories, revenueOverrides: st.revenueOverrides, salaryOverrides: st.salaryOverrides });
      return { model, checks: validateInputs(st.files, model), error: null };
    } catch (e) {
      return { model: null, checks: {}, error: e.message };
    }
  }, [st]);
}

const isFresh = (v, f) => v && v.status === 'validated' && f && v.file === f.file && (!f.uploadedAt || v.at >= f.uploadedAt);

export default function DataValidation(ctx) {
  const { can, imports } = ctx;
  const [section, setSection] = useState(can.edit ? 'import' : 'checks');
  const built = useBuild(imports?.st);
  const unclassified = built.model?.unclassified?.length || 0;
  const sections = [
    ...(can.seeAll ? [['import', 'Import & validate']] : []),
    ...(can.edit ? [['classify', `Classify payroll${unclassified ? ` (${unclassified})` : ''}`], ['corrections', 'Corrections']] : []),
    ['checks', 'Cross-checks'],
  ];
  return (
    <>
      <nav className="subnav" style={{ marginTop: 0, marginBottom: 14 }}>
        {sections.map(([id, label]) => (
          <button key={id} className={section === id ? 'on' : ''} onClick={() => setSection(id)}>
            {label}
          </button>
        ))}
      </nav>
      {imports?.error && <div className="warnbox" style={{ marginBottom: 12 }}>{imports.error}</div>}
      {section === 'import' && <ImportValidate {...ctx} built={built} />}
      {section === 'classify' && <Classify {...ctx} built={built} />}
      {section === 'corrections' && <Corrections {...ctx} built={built} />}
      {section === 'checks' && <DataChecks {...ctx} />}
    </>
  );
}

// ---------------- Import & validate ----------------
function ImportValidate({ model: live, imports, built, can, api, reloadModel }) {
  const st = imports.st;
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState({});
  const [pubMsg, setPubMsg] = useState(null);
  if (!st) return <p className="muted">Loading…</p>;
  const files = st.files || {};
  const kinds = ORDER.filter((k) => files[k] || REQUIRED_KINDS.includes(k) || st.validations?.[k]);
  const statusOf = (k) => (isFresh(st.validations?.[k], files[k]) ? 'validated' : st.validations?.[k]?.status === 'rejected' ? 'rejected' : files[k] ? 'pending' : can.edit ? 'missing' : st.validations?.[k] ? 'validated' : 'missing');
  const needed = kinds.filter((k) => files[k]);
  const allValidated = REQUIRED_KINDS.every((k) => files[k]) && needed.every((k) => statusOf(k) === 'validated');

  const onFiles = async (e) => {
    const list = [...e.target.files];
    e.target.value = '';
    if (!list.length) return;
    setBusy(true);
    setResults(await imports.upload(list));
    setBusy(false);
  };
  const stampDataset = (k, status) =>
    imports.setRecord('validation', k, { status, note: notes[k] || '', checks: built.checks[k]?.checks || [], file: files[k]?.file });
  const publish = async () => {
    setBusy(true);
    setPubMsg(null);
    try {
      await api.publishModel({ ...built.model, generatedAt: new Date().toISOString() }, st.period);
      await reloadModel();
      setPubMsg({ ok: true, text: `Published ${built.model.period}. Everyone sees the new numbers on their next refresh.` });
    } catch (e) {
      setPubMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };
  const m = built.model;

  return (
    <>
      <section className="card">
        <div className="title-row">
          <h2 style={{ fontSize: 15 }}>Monthly import · {st.period || 'no month yet'}</h2>
          <span className="spacer" />
          {can.edit && (
            <>
              {api.mode === 'local' && (
                <button className="small" disabled={busy} onClick={async () => (setBusy(true), await api.loadFromInbox(), await imports.reload(), setBusy(false))}>
                  Load from data/inbox
                </button>
              )}
              <label className="primary upload-btn">
                {busy ? 'Working…' : 'Upload exports…'}
                <input type="file" accept=".xlsx,.xls" multiple onChange={onFiles} disabled={busy} hidden />
              </label>
            </>
          )}
        </div>
        <p className="muted small-text">
          Upload the month's exports together or one at a time (costing sheet first: it sets the month). Each file is recognised by its columns and read in
          your browser; only you can see the stored rows. Validate every dataset to unlock publishing.
        </p>
        {results && (
          <ul className="plain small-text">
            {results.map((r, i) => (
              <li key={i} className={r.ok ? 'good-text' : 'err'}>
                {r.file ? `${r.file}: ` : ''}
                {r.text}
              </li>
            ))}
          </ul>
        )}
        {built.error && <div className="warnbox">Could not build: {built.error}</div>}
      </section>

      {kinds.map((k) => {
        const f = files[k];
        const v = st.validations?.[k];
        const c = built.checks[k];
        const status = statusOf(k);
        const counts = c ? summarizeChecks(c) : { errors: 0, warnings: 0 };
        const checks = c?.checks || v?.checks || [];
        return (
          <section key={k} className={`card dataset ${status}`}>
            <div className="f-head">
              <strong>{KIND_LABEL[k]}</strong>
              <span className={`pill ${{ validated: 'good', rejected: 'bad', pending: 'warn', missing: 'bad' }[status]}`}>
                {{ validated: 'Validated', rejected: 'Needs fixing', pending: 'Awaiting validation', missing: REQUIRED_KINDS.includes(k) ? 'Missing' : 'Optional, not uploaded' }[status]}
              </span>
              {f && <span className="muted small-text">{f.file} · {f.rows?.length} rows · uploaded {when(f.uploadedAt)}</span>}
              <span className="spacer" />
              {counts.errors > 0 && <span className="sev critical">{counts.errors} error{counts.errors > 1 ? 's' : ''}</span>}
              {counts.warnings > 0 && <span className="sev medium">{counts.warnings} to review</span>}
            </div>
            {c?.facts?.length > 0 && <div className="muted small-text">{c.facts.join(' · ')}</div>}
            {checks.length > 0 && (
              <ul className="checks">
                {checks.map((ch, i) => (
                  <li key={i} className={ch.level}>
                    <span className="lvl">{ch.level === 'error' ? '✕' : ch.level === 'warning' ? '!' : 'i'}</span>
                    <div>
                      {ch.text}
                      {ch.items?.length > 0 && (
                        <details>
                          <summary className="small-text">Show {ch.items.length}</summary>
                          <div className="small-text muted items">{ch.items.slice(0, 60).join(' · ')}{ch.items.length > 60 ? ` · +${ch.items.length - 60} more` : ''}</div>
                        </details>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {v && (
              <div className="muted small-text" style={{ marginTop: 6 }}>
                {v.status === 'validated' ? 'Validated' : 'Marked as needing fixes'} by {v.by} on {when(v.at)}
                {v.note ? ` · “${v.note}”` : ''}
                {status !== 'validated' && v.status === 'validated' && ' (for an earlier file: validate again)'}
              </div>
            )}
            {can.edit && f && (
              <div className="row">
                <input className="text-in" style={{ maxWidth: 420 }} placeholder="Note (optional), e.g. 'checked totals with accounts'" value={notes[k] || ''} onChange={(e) => setNotes((n) => ({ ...n, [k]: e.target.value }))} />
                <button className="primary" disabled={status === 'validated'} onClick={() => stampDataset(k, 'validated')}>
                  {counts.errors ? 'Validate with errors' : 'Validate'}
                </button>
                <button className="small" onClick={() => stampDataset(k, 'rejected')}>
                  Needs fixing
                </button>
              </div>
            )}
          </section>
        );
      })}

      {can.edit && m && (
        <section className="card">
          <h2>Build & publish</h2>
          <p className="muted small-text">What everyone will see after publishing, against what's live now.</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th />
                  <th className="r">Live now ({live.period})</th>
                  <th className="r">New ({m.period})</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Revenue (invoiced)', usd(live.totals.revenueUSD), usd(m.totals.revenueUSD)],
                  ['Project spend', inr(live.totals.costINR), inr(m.totals.costINR)],
                  ['COST (profit)', pct(live.totals.margin), pct(m.totals.margin)],
                  ['Managed', `${live.totals.customers - live.totals.belowTarget} / ${live.totals.customers}`, `${m.totals.customers - m.totals.belowTarget} / ${m.totals.customers}`],
                  ['Cost off by', inr(live.totals.gapINR), inr(m.totals.gapINR)],
                  ['Support shared out', inr(live.totals.supportINR), inr(m.totals.supportINR)],
                  ['Unclassified payroll', inr(live.totals.unclassifiedPayrollINR || 0), inr(m.totals.unclassifiedPayrollINR)],
                  ['Corrections applied', '—', `${m.corrections.revenue} revenue · ${m.corrections.salary} salary`],
                ].map(([l, a, b]) => (
                  <tr key={l}>
                    <td>{l}</td>
                    <td className="r muted">{a}</td>
                    <td className="r">
                      <strong>{b}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row">
            <button className="primary" disabled={!allValidated || busy} onClick={publish}>
              Publish {m.period}
            </button>
            {!allValidated && <span className="muted small-text">Validate every uploaded dataset first.</span>}
            {pubMsg && <span className={pubMsg.ok ? 'good-text' : 'err'}>{pubMsg.text}</span>}
          </div>
        </section>
      )}
    </>
  );
}

// ---------------- Classify payroll ----------------
function Classify({ imports, built }) {
  const st = imports.st;
  const [show, setShow] = useState('unclassified');
  const [q, setQ] = useState('');
  const [bulk, setBulk] = useState('');
  const [picked, setPicked] = useState(new Set());
  const m = built.model;
  if (!m) return <section className="card"><p className="muted">Upload and build the month's data first.</p></section>;
  const rows = (m.payOnly || [])
    .filter((u) => (show === 'unclassified' ? !u.category : show === 'all' ? true : u.category === show))
    .filter((u) => !q || `${u.name} ${u.empId}`.toLowerCase().includes(q.toLowerCase()));
  const setCat = (u, category) => imports.setRecord('category', u.empId, category ? { category, name: u.name, note: st.categories?.[u.empId]?.note || '' } : null);
  const applyBulk = async () => {
    for (const id of picked) {
      const u = m.payOnly.find((x) => x.empId === id);
      if (u) await setCat(u, bulk);
    }
    setPicked(new Set());
  };
  const t = m.totals;
  return (
    <section className="card">
      <p className="muted small-text">
        These people are on payroll but not in the portal's employee list, so their cost isn't placed anywhere. <strong>Support</strong> and{' '}
        <strong>Leadership / sales overhead</strong> are shared across customers by engineering spend. <strong>Engineering / PM</strong> counts as paid
        but unassigned time. <strong>Leaving</strong> and <strong>Exclude</strong> are left out. Classifications are remembered for future months.
      </p>
      <div className="kpis compact-kpis">
        <Kpi label="Unclassified" value={m.unclassified.length} note={`${inr(t.unclassifiedPayrollINR)}/month`} tone={m.unclassified.length ? 'warn' : 'good'} />
        <Kpi label="Shared (support + overhead)" value={inr(t.supportINR)} note="per month" />
        <Kpi label="Unassigned engineering" value={inr(t.unassignedINR)} note="per month" />
        <Kpi label="Excluded" value={inr(t.excludedINR || 0)} note="leaving / excluded" />
      </div>
      <div className="toolbar">
        <input placeholder="Search name or ID" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={show} onChange={(e) => setShow(e.target.value)}>
          <option value="unclassified">Unclassified</option>
          <option value="all">Everyone on this list</option>
          {Object.entries(CATEGORIES).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <span className="muted">{rows.length} people</span>
        <span className="spacer" />
        {picked.size > 0 && (
          <>
            <select value={bulk} onChange={(e) => setBulk(e.target.value)}>
              <option value="">Set {picked.size} selected to…</option>
              {Object.entries(CATEGORIES).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <button className="primary" disabled={!bulk} onClick={applyBulk}>
              Apply
            </button>
          </>
        )}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Select all shown"
                  checked={rows.length > 0 && rows.every((u) => picked.has(u.empId))}
                  onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((u) => u.empId)) : new Set())}
                />
              </th>
              <th>ID</th>
              <th>Name</th>
              <th className="r">Monthly CTC</th>
              <th>Category</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .sort((a, b) => b.ctcMonthlyINR - a.ctcMonthlyINR)
              .map((u) => (
                <tr key={u.empId}>
                  <td>
                    <input type="checkbox" checked={picked.has(u.empId)} onChange={(e) => setPicked((s) => { const n = new Set(s); e.target.checked ? n.add(u.empId) : n.delete(u.empId); return n; })} />
                  </td>
                  <td className="muted">{u.empId}</td>
                  <td>
                    <strong>{u.name || '—'}</strong>
                  </td>
                  <td className="r">{inr(u.ctcMonthlyINR, { compact: false })}</td>
                  <td>
                    <select className="cat-select" value={u.category || ''} onChange={(e) => setCat(u, e.target.value || null)}>
                      <option value="">Unclassified</option>
                      {Object.entries(CATEGORIES).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------- Corrections ----------------
function Corrections({ imports, built }) {
  const st = imports.st;
  const m = built.model;
  const [rev, setRev] = useState({ code: '', amountUSD: '', reason: '' });
  const [sal, setSal] = useState({ empId: '', ctcMonthlyINR: '', reason: '' });
  const [err, setErr] = useState(null);
  if (!m) return <section className="card"><p className="muted">Upload and build the month's data first.</p></section>;
  const cust = new Map(m.customers.map((c) => [c.code, c]));
  const people = [...m.employees.map((e) => ({ empId: e.empId, name: e.name, ctc: e.ctcMonthlyINR, payrollCtc: e.ctcMonthlyINR })), ...m.payOnly.map((u) => ({ empId: u.empId, name: u.name, ctc: u.ctcMonthlyINR }))].sort((a, b) => a.name.localeCompare(b.name));
  const saveRev = async () => {
    setErr(null);
    if (!rev.code || rev.amountUSD === '' || !rev.reason.trim()) return setErr('Choose a customer, enter the amount and a reason.');
    await imports.setRecord('revenue', rev.code, { amountUSD: Number(rev.amountUSD), reason: rev.reason.trim() });
    setRev({ code: '', amountUSD: '', reason: '' });
  };
  const saveSal = async () => {
    setErr(null);
    if (!sal.empId || sal.ctcMonthlyINR === '' || !sal.reason.trim()) return setErr('Choose a person, enter the monthly CTC and a reason.');
    await imports.setRecord('salary', sal.empId, { ctcMonthlyINR: Number(sal.ctcMonthlyINR), reason: sal.reason.trim(), name: people.find((p) => p.empId === sal.empId)?.name });
    setSal({ empId: '', ctcMonthlyINR: '', reason: '' });
  };
  return (
    <div className="grid2">
      <section className="card">
        <h2>Revenue corrections · {st.period}</h2>
        <p className="muted small-text">Replaces the invoiced amount for this month, e.g. a credit note or an invoice raised outside the invoicing file.</p>
        <div className="action-form">
          <label className="grow">
            Customer
            <select value={rev.code} onChange={(e) => setRev((r) => ({ ...r, code: e.target.value, amountUSD: e.target.value ? String(cust.get(e.target.value)?.invoicing?.amountUSD ?? cust.get(e.target.value)?.revenueUSD ?? '') : '' }))}>
              <option value="">Choose…</option>
              {[...m.customers].sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Revenue (US$)
            <input type="number" min="0" value={rev.amountUSD} onChange={(e) => setRev((r) => ({ ...r, amountUSD: e.target.value }))} />
          </label>
          <label className="wide">
            Reason
            <input value={rev.reason} onChange={(e) => setRev((r) => ({ ...r, reason: e.target.value }))} placeholder="e.g. Credit note CN-104 for downtime" />
          </label>
          <div className="row">
            <button className="primary" onClick={saveRev}>
              Save correction
            </button>
          </div>
        </div>
        <CorrectionList
          rows={Object.entries(st.revenueOverrides || {}).map(([code, o]) => ({ key: code, label: cust.get(code)?.name || code, from: usd(cust.get(code)?.invoicing?.amountUSD ?? cust.get(code)?.costingRevenueUSD ?? 0), to: usd(o.amountUSD), ...o }))}
          onRemove={(k) => imports.setRecord('revenue', k, null)}
        />
      </section>
      <section className="card">
        <h2>Salary corrections</h2>
        <p className="muted small-text">Replaces payroll CTC for a person in every build until removed, e.g. a raise not yet in the paysheet.</p>
        <div className="action-form">
          <label className="grow">
            Person
            <select value={sal.empId} onChange={(e) => setSal((x) => ({ ...x, empId: e.target.value, ctcMonthlyINR: e.target.value ? String(people.find((p) => p.empId === e.target.value)?.ctc ?? '') : '' }))}>
              <option value="">Choose…</option>
              {people.map((p) => (
                <option key={p.empId} value={p.empId}>
                  {p.name || p.empId} ({p.empId})
                </option>
              ))}
            </select>
          </label>
          <label>
            Monthly CTC (₹)
            <input type="number" min="0" value={sal.ctcMonthlyINR} onChange={(e) => setSal((x) => ({ ...x, ctcMonthlyINR: e.target.value }))} />
          </label>
          <label className="wide">
            Reason
            <input value={sal.reason} onChange={(e) => setSal((x) => ({ ...x, reason: e.target.value }))} placeholder="e.g. Revised from 1 Sep, letter dated 28 Aug" />
          </label>
          <div className="row">
            <button className="primary" onClick={saveSal}>
              Save correction
            </button>
          </div>
        </div>
        <CorrectionList
          rows={Object.entries(st.salaryOverrides || {}).map(([id, o]) => ({ key: id, label: o.name || id, to: inr(o.ctcMonthlyINR, { compact: false }), ...o }))}
          onRemove={(k) => imports.setRecord('salary', k, null)}
        />
      </section>
      {err && <div className="err">{err}</div>}
    </div>
  );
}

function CorrectionList({ rows, onRemove }) {
  if (!rows.length) return <p className="muted small-text">No corrections.</p>;
  return (
    <ul className="findings" style={{ marginTop: 10 }}>
      {rows.map((r) => (
        <li key={r.key}>
          <div className="f-head">
            <strong>{r.label}</strong>
            <span>
              {r.from ? `${r.from} → ` : ''}
              <strong>{r.to}</strong>
            </span>
            <span className="spacer" />
            <button className="linkish" onClick={() => onRemove(r.key)}>
              Remove
            </button>
          </div>
          <div className="muted small-text">
            {r.reason} · {r.by} {when(r.at)}
          </div>
        </li>
      ))}
    </ul>
  );
}
