import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { inr, pct } from '../format.js';
import { Kpi, Margin, Status } from './ui.jsx';
import { modelToLive } from '../engine/liveSync.js';

// Allocations: the app is the source. PMs add/remove people and set % on their own customers;
// every change is staged first (play), previewed with live costs from the database, then saved
// with a note. Admin can do the same anywhere and sees salaries; leadership reads.
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

export default function Allocations({ model, api, me, can, pmsById, focus, setFocus, go }) {
  const [live, setLive] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(() => api.getLive().then(setLive, (e) => setError(e.message)), [api]);
  useEffect(() => {
    reload();
  }, [reload]);

  if (error) return <div className="warnbox">{error}</div>;
  if (!live) return <p className="muted">Loading…</p>;
  if (live.source !== 'app') return <NotEnabled model={model} api={api} can={can} onDone={reload} />;
  return <Workspace live={live} reload={reload} model={model} api={api} me={me} can={can} pmsById={pmsById} focus={focus} setFocus={setFocus} go={go} />;
}

function NotEnabled({ model, api, can, onDone }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const seed = useMemo(() => (can.edit ? modelToLive(model) : null), [model, can.edit]);
  if (!can.edit) return <section className="card"><p className="muted">Allocations aren't managed in the app yet. Matt will switch this on.</p></section>;
  const go = async () => {
    if (!confirm(`Load ${seed.allocations.length} allocations for ${seed.people.length} people from ${model.period} into the app? From then on, allocations are edited here and the portal export becomes a cross-check.`)) return;
    setBusy(true);
    try {
      const profiles = Object.fromEntries(model.customers.map((c) => [c.code, { pm_ids: c.pmIds }]));
      await api.adminSync({ ...seed, profiles, note: `Loaded from the ${model.period} portal export` });
      onDone();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card" style={{ maxWidth: 820 }}>
      <h2>Manage allocations in the app</h2>
      <p>
        Right now allocations come from the portal's employee export each month. Switching loads the <strong>{model.period}</strong> allocations (
        {seed.allocations.length} allocations, {seed.people.length} people) into the app. After that:
      </p>
      <ul className="plain">
        <li>PMs add or remove people and set % on their own customers; you can change any customer.</li>
        <li>Every change is recorded (who, when, from → to, note). Nobody can go over 100%.</li>
        <li>Changes can be tried first (play) and are only saved when confirmed.</li>
        <li>Costs are worked out in the database, so PMs never receive salaries.</li>
        <li>Engineers' free time is bench held by a PM, and so is a PM's own free time.</li>
        <li>Monthly publishing uses these allocations; the portal export is shown as a cross-check.</li>
      </ul>
      {msg && <div className="err">{msg}</div>}
      <div className="row">
        <button className="primary" disabled={busy} onClick={go}>
          {busy ? 'Loading…' : `Switch to app allocations (${model.period})`}
        </button>
      </div>
    </section>
  );
}

function Workspace({ live, reload, model, api, me, can, pmsById }) {
  const [changes, setChanges] = useState([]);
  const [costs, setCosts] = useState([]);
  const [bench, setBench] = useState([]);
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const target = model.target;
  const canChange = (c) => can.edit || (me.role === 'pm' && (model.customers.find((x) => x.code === c)?.pmIds || []).includes(me.pmId));

  // Live preview: costs and bench before/after the staged changes, from the database.
  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const [c, b] = await Promise.all([api.liveCosts(changes), api.liveBench(changes)]);
        if (n === seq.current) {
          setCosts(c);
          setBench(b);
          setErr(null);
        }
      } catch (e) {
        if (n === seq.current) setErr(e.message);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [changes, api, live]);

  const people = useMemo(() => new Map(live.people.map((p) => [p.emp_id, p])), [live.people]);
  const customers = useMemo(() => [...costs].sort((a, b) => (b.off_by_after || 0) - (a.off_by_after || 0) || a.name.localeCompare(b.name)), [costs]);
  useEffect(() => {
    if (!code && customers.length) setCode(customers[0].code);
  }, [customers, code]);
  const cur = costs.find((c) => c.code === code);

  const loadAfter = useMemo(() => {
    const m = { ...live.load };
    for (const ch of changes) {
      if (ch.op === 'add') m[ch.emp_id] = (m[ch.emp_id] || 0) + ch.util_pct;
      else {
        const a = live.allocations.find((x) => x.id === ch.id);
        if (!a) continue;
        m[a.emp_id] = (m[a.emp_id] || 0) - a.util_pct + (ch.op === 'remove' ? 0 : ch.util_pct ?? a.util_pct);
      }
    }
    return m;
  }, [live, changes]);

  const rows = live.allocations.filter((a) => a.customer_code === code);
  const staged = (id) => changes.find((c) => c.id === id);
  const stage = (ch) => setChanges((all) => [...all.filter((c) => !(ch.id && c.id === ch.id)), ch]);
  const unstage = (id) => setChanges((all) => all.filter((c) => c.id !== id));
  const adds = changes.filter((c) => c.op === 'add' && c.customer_code === code);

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      await api.applyLive(changes, note.trim());
      setChanges([]);
      setNote('');
      await reload();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const myBench = me.role === 'pm' ? bench.find((b) => b.pm_id === me.pmId) : null;
  const benchTotal = bench.reduce((a, b) => ({ before: a.before + b.spend_before, after: a.after + b.spend_after }), { before: 0, after: 0 });
  const arrow = (a, b, f) => (Math.abs((b ?? 0) - (a ?? 0)) < 0.5 ? f(a) : `${f(a)} → ${f(b)}`);

  return (
    <>
      <section className="card sim-bar">
        <div className="sim-head">
          <h2>Allocations</h2>
          <span className="muted small-text">Managed in the app since {when(live.since)} · changes are tried first and saved only when you confirm</span>
          <span className="spacer" />
          {changes.length > 0 && <span className="pill warn">{changes.length} unsaved change{changes.length === 1 ? '' : 's'}</span>}
        </div>
        <div className="kpis compact-kpis">
          {cur && (
            <>
              <Kpi label={`${cur.name} · COST`} value={arrow(cur.cost_before * 100, cur.cost_after * 100, (v) => (v == null || isNaN(v) ? '—' : v.toFixed(1) + '%'))} tone={cur.managed_after ? 'good' : 'bad'} note={`target ${pct(target, 0)}`} />
              <Kpi label="Status" value={<Status managed={cur.managed_after} />} note={cur.managed_before !== cur.managed_after ? `was ${cur.managed_before ? 'Managed' : 'Not managed'}` : ''} />
              <Kpi label="Cost off by" value={arrow(cur.off_by_before, cur.off_by_after, inr)} tone={cur.off_by_after > 0 ? 'bad' : 'good'} />
              <Kpi label="Project spend" value={arrow(cur.spend_before, cur.spend_after, inr)} note={`revenue ${inr(cur.revenue_inr)}`} />
            </>
          )}
          {myBench ? (
            <Kpi label="Your bench" value={arrow(myBench.spend_before, myBench.spend_after, inr)} note={`${(myBench.free_pct_after / 100).toFixed(1)} people's worth of free time (${myBench.people} people)`} tone={myBench.spend_after > myBench.spend_before + 1 ? 'bad' : myBench.spend_after < myBench.spend_before - 1 ? 'good' : 'warn'} />
          ) : (
            <Kpi label="Bench (all teams)" value={arrow(benchTotal.before, benchTotal.after, inr)} tone={benchTotal.after > benchTotal.before + 1 ? 'bad' : benchTotal.after < benchTotal.before - 1 ? 'good' : 'warn'} />
          )}
        </div>
        {err && <div className="warnbox">{err}</div>}
        {changes.length > 0 && (can.edit || me.role === 'pm') && (
          <div className="row">
            <input className="text-in" style={{ maxWidth: 460 }} placeholder="Note for the history (e.g. 'Released QA after release 3.2')" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="primary" disabled={saving} onClick={save}>
              {saving ? 'Saving…' : `Save ${changes.length} change${changes.length === 1 ? '' : 's'}`}
            </button>
            <button className="small" onClick={() => setChanges([])}>
              Discard
            </button>
          </div>
        )}
      </section>

      <div className="alloc-grid">
        <section className="card">
          <h2>Customers</h2>
          <ul className="cust-pick">
            {customers.map((c) => (
              <li key={c.code} className={c.code === code ? 'on' : ''} onClick={() => setCode(c.code)}>
                <span className="name">{c.name}</span>
                <Margin value={c.cost_after} target={target} />
                {changes.some((ch) => ch.customer_code === c.code || live.allocations.find((a) => a.id === ch.id)?.customer_code === c.code) && <span className="dot" title="Unsaved changes" />}
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          {cur ? (
            <>
              <div className="title-row">
                <h2 style={{ fontSize: 16 }}>{cur.name}</h2>
                <span className="muted small-text">{rows.length} allocations</span>
                <span className="spacer" />
                {canChange(code) && (
                  <button className="primary" onClick={() => setAdding((a) => !a)}>
                    + Add person
                  </button>
                )}
              </div>
              {adding && canChange(code) && (
                <AddPerson
                  live={live}
                  loadAfter={loadAfter}
                  pmsById={pmsById}
                  already={new Set(rows.map((r) => r.emp_id))}
                  onAdd={(emp, util, billable) => {
                    stage({ op: 'add', emp_id: emp, customer_code: code, util_pct: util, billable, key: `${emp}-${Date.now()}` });
                    setAdding(false);
                  }}
                />
              )}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>PM</th>
                      <th className="r">Time here</th>
                      <th>Billable</th>
                      <th className="r">Total load</th>
                      {can.seeAll && <th className="r">Spend here</th>}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((a) => {
                      const p = people.get(a.emp_id) || { name: a.emp_id };
                      const s = staged(a.id);
                      const removed = s?.op === 'remove';
                      const util = removed ? 0 : s?.util_pct ?? a.util_pct;
                      const billable = s?.billable ?? a.billable;
                      const editable = canChange(code);
                      return (
                        <tr key={a.id} className={s ? (removed ? 'removed' : 'changed') : ''}>
                          <td>
                            <strong>{p.name}</strong>
                            <div className="muted small-text">
                              {p.designation}
                              {p.experience_years ? ` · ${p.experience_years} yrs` : ''}
                              {p.skills ? ` · ${p.skills.slice(0, 60)}` : ''}
                            </div>
                          </td>
                          <td>{pmsById[a.owner_pm]?.name.split(' ')[0] || '—'}</td>
                          <td className="r">
                            {editable && !removed ? (
                              <input className="num" type="number" min="1" max="100" step="5" value={util} onChange={(e) => stage({ op: 'set', id: a.id, util_pct: Math.max(1, Math.min(100, Number(e.target.value) || 1)), billable })} />
                            ) : (
                              `${util}%`
                            )}
                            {s && !removed && util !== a.util_pct && <div className="muted small-text">was {a.util_pct}%</div>}
                          </td>
                          <td>
                            <input type="checkbox" checked={billable} disabled={!editable || removed} onChange={(e) => stage({ op: 'set', id: a.id, util_pct: util, billable: e.target.checked })} />
                          </td>
                          <td className={`r ${loadAfter[a.emp_id] > 100.5 ? 'err' : ''}`}>{Math.round(loadAfter[a.emp_id] || 0)}%</td>
                          {can.seeAll && <td className="r">{inr(((live.salaries[a.emp_id] || 0) * util) / 100, { compact: false })}</td>}
                          <td className="nowrap">
                            {s ? (
                              <button className="linkish" onClick={() => unstage(a.id)}>
                                Undo
                              </button>
                            ) : (
                              editable && (
                                <button className="linkish" onClick={() => stage({ op: 'remove', id: a.id })}>
                                  Remove
                                </button>
                              )
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {adds.map((ch) => {
                      const p = people.get(ch.emp_id) || { name: ch.emp_id };
                      return (
                        <tr key={ch.key} className="added">
                          <td>
                            <strong>{p.name}</strong> <span className="good-text small-text">new</span>
                            <div className="muted small-text">{p.designation}</div>
                          </td>
                          <td>{pmsById[me.pmId]?.name.split(' ')[0] || '—'}</td>
                          <td className="r">{ch.util_pct}%</td>
                          <td>{ch.billable ? 'Yes' : 'No'}</td>
                          <td className={`r ${loadAfter[ch.emp_id] > 100.5 ? 'err' : ''}`}>{Math.round(loadAfter[ch.emp_id] || 0)}%</td>
                          {can.seeAll && <td className="r">{inr(((live.salaries[ch.emp_id] || 0) * ch.util_pct) / 100, { compact: false })}</td>}
                          <td>
                            <button className="linkish" onClick={() => setChanges((all) => all.filter((c) => c !== ch))}>
                              Undo
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <History live={live} code={code} people={people} />
            </>
          ) : (
            <p className="muted">No customers to show.</p>
          )}
        </section>
      </div>
    </>
  );
}

function AddPerson({ live, loadAfter, already, onAdd, pmsById }) {
  const [q, setQ] = useState('');
  const [pick, setPick] = useState(null);
  const [util, setUtil] = useState(50);
  const [billable, setBillable] = useState(true);
  const list = live.people
    .filter((p) => p.active && (p.category === 'engineering' || p.category === 'pm') && !already.has(p.emp_id))
    .map((p) => ({ ...p, free: Math.max(0, 100 - (loadAfter[p.emp_id] || 0)) }))
    .filter((p) => !q || `${p.name} ${p.designation} ${p.skills}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.free - a.free || a.name.localeCompare(b.name))
    .slice(0, 40);
  return (
    <div className="action-form">
      <label className="grow">
        Find a person (name, role or skill)
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. React, Manual QA, Rupali" />
      </label>
      <ul className="people-pick wide">
        {list.map((p) => (
          <li key={p.emp_id} className={pick?.emp_id === p.emp_id ? 'on' : ''} onClick={() => (setPick(p), setUtil(Math.min(50, p.free) || 10))}>
            <span>
              <strong>{p.name}</strong> <span className="muted small-text">{p.designation}{p.experience_years ? ` · ${p.experience_years} yrs` : ''}{p.bench_pm ? ` · bench: ${pmsById[p.bench_pm]?.name.split(' ')[0] || ''}` : ''}</span>
            </span>
            <span className={`pill ${p.free >= 50 ? 'good' : p.free > 0 ? 'warn' : 'bad'}`}>{Math.round(p.free)}% free</span>
          </li>
        ))}
      </ul>
      {pick && (
        <div className="row wide">
          <span>
            Add <strong>{pick.name}</strong> at
          </span>
          <input className="num" type="number" min="1" max="100" step="5" value={util} onChange={(e) => setUtil(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />%
          <label>
            <input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} /> Billable
          </label>
          <button className="primary" onClick={() => onAdd(pick.emp_id, util, billable)}>
            Add (unsaved)
          </button>
          {util > pick.free && <span className="warn-text small-text">This would take {pick.name} over 100%.</span>}
        </div>
      )}
    </div>
  );
}

function History({ live, code, people }) {
  const rows = live.history.filter((h) => h.customer_code === code).slice(0, 30);
  if (!rows.length) return <p className="muted small-text" style={{ marginTop: 12 }}>No changes yet for this customer.</p>;
  const desc = (h) => {
    const who = people.get(h.emp_id)?.name || h.emp_id;
    const b = h.before && `${h.before.util_pct}%${h.before.billable ? ' billable' : ''}`;
    const a = h.after && `${h.after.util_pct}%${h.after.billable ? ' billable' : ''}`;
    return h.action === 'add' ? `Added ${who} at ${a}` : h.action === 'remove' ? `Removed ${who} (was ${b})` : `${who}: ${b} → ${a}`;
  };
  return (
    <>
      <h3>History</h3>
      <ul className="timeline">
        {rows.map((h, i) => (
          <li key={h.id || i}>
            <div className="muted small-text">
              {when(h.at)} · {h.by}
            </div>
            <div>
              {desc(h)}
              {h.note ? <span className="muted"> · “{h.note}”</span> : ''}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
