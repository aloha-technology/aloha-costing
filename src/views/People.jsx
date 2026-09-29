import React, { useEffect, useMemo, useState } from 'react';
import { inr, pct } from '../format.js';
import { Kpi, Margin } from './ui.jsx';
import { simulate, allocKey } from '../engine/scenario.js';
import { scenarioActions } from '../actions/fromScenario.js';
import { isClosed } from '../actions/logic.js';
import { useScenarios } from './useScenarios.js';

// Employees, their allocations and salaries, plus a what-if scenario. Admin + leadership only.
// Scenarios live in this browser only (useScenarios) and never change real data. Edits here go
// into the active scenario's manual changes; levers switched on in Play also apply.

export default function People({ model, pmsById, go, store, can }) {
  const scen = useScenarios(model);
  const scenario = scen.effective; // manual edits + levers
  const manual = scen.active.manual;
  const setScenario = scen.updateManual;
  const [q, setQ] = useState('');
  const [customer, setCustomer] = useState('');
  const [pm, setPm] = useState('');
  const [roleF, setRoleF] = useState('');
  const [onlyNonBillable, setOnlyNonBillable] = useState(false);
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [assigning, setAssigning] = useState(null); // empId with the Assign form open


  const sim = useMemo(() => simulate(model, scenario), [model, scenario]);
  const custAfter = useMemo(() => new Map(sim.customers.map((c) => [c.code, c])), [sim]);
  const changedKeys = useMemo(() => new Set(sim.rows.map((r) => r.key)), [sim]);
  const target = model.target;

  // One row per person per customer, plus bench-only rows.
  const empById = useMemo(() => new Map((model.employees || []).map((e) => [e.empId, e])), [model]);
  const custByCode = useMemo(() => new Map(model.customers.map((c) => [c.code, c])), [model]);
  const allRows = useMemo(() => {
    const out = [];
    for (const e of model.employees || []) {
      for (const a of e.allocations) out.push({ e, a, key: allocKey(a.code, e.empId, a.project) });
      if (!e.allocations.length || e.benchPct > 0) out.push({ e, a: null, key: `free|${e.empId}` });
    }
    for (const add of scenario.added || []) {
      const e = empById.get(add.empId);
      const c = custByCode.get(add.code);
      if (e && c) out.push({ e, a: { code: c.code, customer: c.name, project: null, utilPct: 0, billable: false, ownerPm: c.accountPm }, key: `add|${add.id}`, added: add });
    }
    return out;
  }, [model, scenario.added, empById, custByCode]);

  // Free time left per person after this scenario (bench + unallocated, minus time added elsewhere).
  const freeAfter = (e) => {
    if (scenario.released[e.empId]) return 0;
    const used = sim.rows.filter((r) => r.empId === e.empId && !r.released).reduce((t, r) => t + (r.to.utilPct - r.from.utilPct), 0);
    return Math.max(0, Math.round(e.benchPct + e.idlePct - used));
  };

  const roles = useMemo(() => [...new Set((model.employees || []).map((e) => e.designation))].sort(), [model]);
  const rows = allRows.filter(({ e, a, key }) => {
    if (q && !`${e.name} ${e.designation} ${a?.customer || ''}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (customer === '__free__' ? a : customer && a?.code !== customer) return false;
    if (pm && a?.ownerPm !== pm && !(!a && pmForBench(model, e) === pm)) return false;
    if (roleF && e.designation !== roleF) return false;
    if (onlyNonBillable && (!a || a.billable)) return false;
    if (onlyChanged && !changedKeys.has(key) && !scenario.released[e.empId]) return false;
    if (customer === '__free__' && freeAfter(e) <= 0 && !scenario.released[e.empId]) return false;
    return true;
  });
  const group = (r) => (r.a ? 0 : r.e.benchPct > 0 ? 1 : 2);
  rows.sort(
    (x, y) =>
      group(x) - group(y) ||
      (custByCode.get(y.a?.code)?.gapINR || 0) - (custByCode.get(x.a?.code)?.gapINR || 0) ||
      (x.a?.customer || '').localeCompare(y.a?.customer || '') ||
      (x.added ? 1 : 0) - (y.added ? 1 : 0) ||
      cost(y) - cost(x) ||
      x.e.name.localeCompare(y.e.name)
  );

  const setAlloc = (key, patch) =>
    setScenario((s) => {
      const next = { ...s.alloc, [key]: { ...s.alloc[key], ...patch } };
      return { ...s, alloc: next };
    });
  const undoAlloc = (key) =>
    setScenario((s) => {
      const next = { ...s.alloc };
      delete next[key];
      return { ...s, alloc: next };
    });
  const addAssign = (empId, code, utilPct, billable) =>
    setScenario((s) => ({ ...s, added: [...(s.added || []), { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, empId, code, utilPct, billable }] }));
  const updateAdded = (id, patch) => setScenario((s) => ({ ...s, added: s.added.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  const removeAdded = (id) => setScenario((s) => ({ ...s, added: s.added.filter((x) => x.id !== id) }));
  const toggleRelease = (id) => setScenario((s) => ({ ...s, released: { ...s.released, [id]: !s.released[id] } }));

  const selected = customer && model.customers.find((c) => c.code === customer);
  const takeOffNonBillable = () => {
    if (!selected) return;
    setScenario((s) => {
      const next = { ...s.alloc };
      for (const p of selected.people) if (!p.billable && !p.isPm) next[allocKey(selected.code, p.empId, p.project)] = { ...next[allocKey(selected.code, p.empId, p.project)], utilPct: 0 };
      return { ...s, alloc: next };
    });
  };
  const resetCustomer = () =>
    setScenario((s) => ({
      ...s,
      alloc: Object.fromEntries(Object.entries(s.alloc).filter(([k]) => !k.startsWith(`${customer}|`))),
      added: (s.added || []).filter((x) => x.code !== customer),
    }));

  const seen = new Set(); // first visible row per person gets the Assign button
  const b = sim.before;
  const a = sim.after;
  const delta = (x, y, fmt, eps = 0.5) => (Math.abs(y - x) < eps ? fmt(x) : `${fmt(x)} → ${fmt(y)}`);

  return (
    <>
      <section className="card sim-bar">
        <div className="sim-head">
          <h2>What-if</h2>
          <span className="pill scen-pill" title="Switch or compare scenarios on the Play tab">
            <a onClick={() => go('play')}>{scen.active.name}</a>
            {scen.active.levers.length ? ` · ${scen.active.levers.length} lever${scen.active.levers.length === 1 ? '' : 's'} on` : ''}
          </span>
          <span className="muted">
            {sim.changes ? `${sim.changes} change${sim.changes === 1 ? '' : 's'} · only in this browser, real data unchanged` : 'Change time, billable or release below to see the effect.'}
          </span>
          <span className="spacer" />
          <label>
            <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} /> Show changes only
          </label>
          <button className="small" disabled={!sim.changes} onClick={scen.reset}>
            Reset all
          </button>
          {can.edit && (
            <button className="primary" disabled={!sim.changes} onClick={() => setReviewing((r) => !r)}>
              Turn into actions…
            </button>
          )}
        </div>
        {reviewing && sim.changes > 0 && (
          <ScenarioReview model={model} sim={sim} scenario={scenario} store={store} pmsById={pmsById} go={go} close={() => setReviewing(false)} />
        )}
        <div className="kpis compact-kpis">
          <Kpi label="COST (project)" value={delta(b.margin * 100, a.margin * 100, (v) => v.toFixed(1) + '%', 0.05)} tone={a.margin > b.margin + 1e-9 ? 'good' : a.margin < b.margin - 1e-9 ? 'bad' : ''} />
          <Kpi label="COST after bench" value={delta(b.marginAfterBench * 100, a.marginAfterBench * 100, (v) => v.toFixed(1) + '%', 0.05)} tone={a.marginAfterBench > b.marginAfterBench + 1e-9 ? 'good' : a.marginAfterBench < b.marginAfterBench - 1e-9 ? 'bad' : ''} />
          <Kpi label="Not managed" value={delta(b.belowTarget, a.belowTarget, String)} tone={a.belowTarget < b.belowTarget ? 'good' : a.belowTarget > b.belowTarget ? 'bad' : ''} />
          <Kpi label="Cost off by" value={delta(b.gapINR, a.gapINR, inr)} tone={a.gapINR < b.gapINR - 1 ? 'good' : a.gapINR > b.gapINR + 1 ? 'bad' : ''} />
          <Kpi label="Bench cost" value={delta(b.benchCostINR, a.benchCostINR, inr)} tone={a.benchCostINR > b.benchCostINR + 1 ? 'warn' : a.benchCostINR < b.benchCostINR - 1 ? 'good' : ''} />
          <Kpi label="Company saves / month" value={inr(sim.netMonthlyINR)} note="cost + bench saved, plus billing added" tone={sim.netMonthlyINR > 1 ? 'good' : sim.netMonthlyINR < -1 ? 'bad' : ''} />
        </div>
        {sim.overAllocated.length > 0 && (
          <div className="warnbox">Over 100% allocated: {sim.overAllocated.map((o) => `${o.name} (${Math.round(o.totalPct)}%)`).join(', ')}</div>
        )}
        <details className="muted small-text">
          <summary>How this is calculated</summary>
          Cost changes by monthly CTC × change in time, on top of the costing sheet's cost. Time taken off a customer goes to bench unless the person is
          released, so the company only saves when people are released or their time is reused on another customer. Billing follows billable time at
          the person's seat rate on that project (their role's rate, else the customer's average seat rate), calibrated so each customer's current billable time adds up to what it was actually invoiced.
        </details>
      </section>

      {selected && (
        <section className="card">
          <div className="title-row">
            <h2>
              <a onClick={() => go('customers', selected.code)}>{selected.name}</a>
            </h2>
            <Margin value={custAfter.get(selected.code).before.margin} target={target} />
            {custAfter.get(selected.code).changed && (
              <>
                → <Margin value={custAfter.get(selected.code).after.margin} target={target} />
              </>
            )}
            <span className="muted">
              gap {delta(custAfter.get(selected.code).before.gapINR, custAfter.get(selected.code).after.gapINR, inr)}
            </span>
            <span className="spacer" />
            <button className="small" onClick={takeOffNonBillable}>
              Take off all non-billable
            </button>
            <button className="small" onClick={resetCustomer}>
              Reset this customer
            </button>
          </div>
        </section>
      )}

      <section className="card">
        <div className="toolbar">
          <input placeholder="Search people or customers" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={customer} onChange={(e) => setCustomer(e.target.value)}>
            <option value="">All customers</option>
            <option value="__free__">Bench & unallocated (free time)</option>
            {[...model.customers]
              .sort((x, y) => x.name.localeCompare(y.name))
              .map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({pct(c.margin, 0)})
                </option>
              ))}
          </select>
          <select value={pm} onChange={(e) => setPm(e.target.value)}>
            <option value="">All PMs</option>
            {[...model.pms]
              .filter((p) => p.customers)
              .sort((x, y) => x.name.localeCompare(y.name))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
          <select value={roleF} onChange={(e) => setRoleF(e.target.value)}>
            <option value="">All roles</option>
            {roles.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <label>
            <input type="checkbox" checked={onlyNonBillable} onChange={(e) => setOnlyNonBillable(e.target.checked)} /> Non-billable only
          </label>
          <span className="muted">{rows.length} rows</span>
        </div>

        <div className="table-wrap">
          <table className="people">
            <thead>
              <tr>
                <th>Person</th>
                <th className="r">Monthly CTC</th>
                <th>Customer</th>
                <th>PM</th>
                <th className="r">Time here</th>
                <th>Billable</th>
                <th className="r">Spend here</th>
                <th className="r">Total time</th>
                <th>Release</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(seen.clear(), null)}
              {rows.slice(0, 600).map(({ e, a: al, key, added }) => {
                const ch = added ? { utilPct: added.utilPct, billable: added.billable } : scenario.alloc[key] || {};
                const gone = Boolean(scenario.released[e.empId]);
                const util = gone ? 0 : ch.utilPct ?? al?.utilPct ?? 0;
                const billable = gone ? false : ch.billable ?? al?.billable ?? false;
                const free = freeAfter(e);
                const showAssign = true; // what-if only; creating actions still needs admin
                const firstOfPerson = !seen.has(e.empId) && seen.add(e.empId);
                const ctc = e.ctcMonthlyINR || 0;
                const changed = changedKeys.has(key) || gone || Boolean(added);
                return (
                  <React.Fragment key={key}>
                  <tr className={changed ? 'changed' : ''}>
                    <td>
                      <strong>{e.name}</strong>
                      <div className="muted small-text">{e.designation}</div>
                    </td>
                    <td className="r">{e.ctcMonthlyINR == null ? <span className="muted">not on paysheet</span> : inr(ctc, { compact: false })}</td>
                    <td>
                      {al ? (
                        <>
                          <a onClick={() => setCustomer(al.code)}>{al.customer}</a>
                          {added && <div className="good-text small-text">new assignment</div>}
                        </>
                      ) : (
                        <span className="muted">{e.benchPct > 0 ? `Bench ${e.benchPct}%` : 'Unallocated'}</span>
                      )}
                    </td>
                    <td>{al ? pmsById[al.ownerPm]?.name.split(' ')[0] || '—' : pmsById[pmForBench(model, e)]?.name.split(' ')[0] || '—'}</td>
                    <td className="r">
                      {al ? (
                        <input
                          className="num"
                          type="number"
                          min="0"
                          max="100"
                          step="5"
                          value={util}
                          disabled={gone}
                          onChange={(ev) => {
                            const v = Math.max(0, Math.min(100, Number(ev.target.value) || 0));
                            added ? updateAdded(added.id, { utilPct: v }) : setAlloc(key, { utilPct: v });
                          }}
                        />
                      ) : (
                        '—'
                      )}
                      {al && !added && util !== al.utilPct && <div className="muted small-text">was {al.utilPct}%</div>}
                    </td>
                    <td>
                      {al ? (
                        <input
                          type="checkbox"
                          checked={billable}
                          disabled={gone}
                          onChange={(ev) => (added ? updateAdded(added.id, { billable: ev.target.checked }) : setAlloc(key, { billable: ev.target.checked }))}
                        />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="r">
                      {al ? (
                        <>
                          {inr((ctc * util) / 100, { compact: false })}
                          {!added && util !== al.utilPct && <div className="muted small-text">was {inr((ctc * al.utilPct) / 100, { compact: false })}</div>}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="r">
                      {Math.round(e.allocatedPct)}%{e.benchPct ? <div className="muted small-text">+{e.benchPct}% bench</div> : null}
                      {firstOfPerson && free > 0 && <div className="good-text small-text">{free}% free</div>}
                    </td>
                    <td>
                      <input type="checkbox" title="Release (leaves the company)" checked={gone} onChange={() => toggleRelease(e.empId)} />
                    </td>
                    <td className="nowrap">
                      {added ? (
                        <button className="linkish" onClick={() => removeAdded(added.id)}>
                          Remove
                        </button>
                      ) : (
                        manual.alloc[key] &&
                        !gone && (
                          <button className="linkish" onClick={() => undoAlloc(key)}>
                            Undo
                          </button>
                        )
                      )}
                      {showAssign && firstOfPerson && free > 0 && !gone && (
                        <button className="linkish assign" onClick={() => setAssigning(assigning === e.empId ? null : e.empId)}>
                          Assign…
                        </button>
                      )}
                    </td>
                  </tr>
                  {assigning === e.empId && firstOfPerson && (
                    <tr className="assign-row">
                      <td colSpan={10}>
                        <AssignForm
                          e={e}
                          free={free}
                          model={model}
                          defaultCode={customer && customer !== '__free__' ? customer : ''}
                          onAdd={(code, pctV, bill) => {
                            addAssign(e.empId, code, pctV, bill);
                            setAssigning(null);
                          }}
                          onCancel={() => setAssigning(null)}
                        />
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length > 600 && <p className="muted">Showing the first 600 rows. Filter to see more.</p>}
      </section>
    </>
  );
}

const cost = ({ e, a }) => ((e.ctcMonthlyINR || 0) * (a?.utilPct || 0)) / 100;
const pmForBench = (model, e) => model.bench.find((b) => b.empId === e.empId)?.pmId || null;

// Review list: one proposed action per change; tick which to create.
export function ScenarioReview({ model, sim, scenario, store, pmsById, go, close }) {
  const proposals = useMemo(() => scenarioActions(model, sim, scenario), [model, sim, scenario]);
  const tracked = (p) => {
    const a = store.byFinding.get(p.input.findingId);
    return a && !isClosed(a) ? a : null;
  };
  // Changes are ticked by default; releases are sensitive (the PM sees them), so they start unticked.
  const [picked, setPicked] = useState(() => new Set(proposals.filter((p) => p.kind === 'change' && !tracked(p)).map((p) => p.id)));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const toggle = (id) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const chosen = proposals.filter((p) => picked.has(p.id) && !tracked(p));

  const create = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const created = await store.create(chosen.map((p) => p.input));
      setMsg({ ok: true, text: `Created ${created.length} action${created.length === 1 ? '' : 's'}.` });
      setPicked(new Set());
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="action-form review">
      <div className="wide">
        <strong>Actions from this scenario</strong>{' '}
        <span className="muted">PMs will see the action text (no salaries or costs). Estimated savings stay admin-only.</span>
      </div>
      <table className="wide">
        <tbody>
          {proposals.map((p) => {
            const t = tracked(p);
            return (
              <tr key={p.id} className={p.kind === 'release' ? 'release' : ''}>
                <td>
                  <input type="checkbox" disabled={Boolean(t)} checked={!t && picked.has(p.id)} onChange={() => toggle(p.id)} />
                </td>
                <td>
                  {p.input.title}
                  {p.kind === 'release' && <div className="warn-text small-text">Sensitive: the PM will see this, including in their WhatsApp digest.</div>}
                </td>
                <td>{pmsById[p.input.ownerPmId]?.name || p.input.ownerPmId}</td>
                <td className="muted">due {p.input.dueDate}</td>
                <td className="r">{p.input.savingINR ? inr(p.input.savingINR) + '/mo' : '—'}</td>
                <td>{t ? <a onClick={() => go('actions', t.id)}>already an action</a> : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="row">
        <button className="primary" disabled={busy || !chosen.length} onClick={create}>
          Create {chosen.length} action{chosen.length === 1 ? '' : 's'}
        </button>
        <button className="small" onClick={close}>
          Close
        </button>
        {msg && (msg.ok ? <span className="good-text">{msg.text} <a onClick={() => go('actions')}>View actions</a></span> : <span className="err">{msg.text}</span>)}
      </div>
    </div>
  );
}

function AssignForm({ e, free, model, defaultCode, onAdd, onCancel }) {
  const [code, setCode] = useState(defaultCode);
  const [pctV, setPctV] = useState(free);
  const [bill, setBill] = useState(true);
  return (
    <div className="assign-form">
      <strong>Assign {e.name}</strong> <span className="muted">({free}% free)</span>
      <select value={code} onChange={(ev) => setCode(ev.target.value)}>
        <option value="">Choose a customer…</option>
        {[...model.customers]
          .sort((x, y) => y.gapINR - x.gapINR)
          .map((c) => (
            <option key={c.code} value={c.code}>
              {c.name} ({pct(c.margin, 0)})
            </option>
          ))}
      </select>
      <label>
        Time <input className="num" type="number" min="5" max={free} step="5" value={pctV} onChange={(ev) => setPctV(Math.max(0, Math.min(free, Number(ev.target.value) || 0)))} />%
      </label>
      <label>
        <input type="checkbox" checked={bill} onChange={(ev) => setBill(ev.target.checked)} /> Billable
      </label>
      <button className="primary" disabled={!code || !(pctV > 0)} onClick={() => onAdd(code, pctV, bill)}>
        Add
      </button>
      <button className="small" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
