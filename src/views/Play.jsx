import React, { useMemo, useState } from 'react';
import { inr, pct } from '../format.js';
import { Kpi, Margin, Table } from './ui.jsx';
import { simulate, merge, splitParts, contributions, pmRollup } from '../engine/scenario.js';
import { planToTarget, MAX_RATE_PCT } from '../engine/levers.js';
import { useScenarios } from './useScenarios.js';
import { ScenarioReview } from './People.jsx';

// Play: switch ready-made levers on and off, let the app plan the way to 70%, see what each
// change contributes, compare saved scenarios, and read the before/after. Admin + leadership.
const SECTIONS = [
  ['levers', 'Levers'],
  ['reach', 'Reach 70%'],
  ['effects', 'Effect of each change'],
  ['compare', 'Compare scenarios'],
  ['beforeafter', 'Before / after'],
];

const money = (n) => `${n >= 0 ? '' : '−'}${inr(Math.abs(n))}`;
const pts = (x) => (x == null ? '—' : `${x >= 0 ? '+' : ''}${x.toFixed(1)} pts`);
const arrow = (a, b, fmt) => (Math.abs((b ?? 0) - (a ?? 0)) < 1e-9 ? fmt(a) : `${fmt(a)} → ${fmt(b)}`);

export default function Play({ model, pmsById, go, store, can }) {
  const scen = useScenarios(model);
  const [section, setSection] = useState('levers');
  const [reviewing, setReviewing] = useState(false);
  const sim = useMemo(() => simulate(model, scen.effective), [model, scen.effective]);

  return (
    <>
      <section className="card sim-bar">
        <div className="sim-head">
          <h2>Play</h2>
          <select value={scen.active.id} onChange={(e) => scen.setActive(e.target.value)}>
            {scen.list.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button className="small" onClick={() => scen.create(prompt('Name for the new scenario:', `Scenario ${scen.list.length + 1}`) || undefined)}>
            New
          </button>
          <button className="small" onClick={scen.duplicate}>
            Duplicate
          </button>
          <button className="small" onClick={() => scen.rename(prompt('Rename scenario:', scen.active.name))}>
            Rename
          </button>
          <button className="small" onClick={() => confirm(`Delete "${scen.active.name}"?`) && scen.remove()}>
            Delete
          </button>
          <span className="muted small-text">
            {sim.changes ? `${sim.changes} changes · ${scen.active.levers.length} levers on` : 'No changes yet'} · only in this browser
          </span>
          <span className="spacer" />
          <button className="small" disabled={!sim.changes} onClick={() => confirm('Clear all changes and levers in this scenario?') && scen.reset()}>
            Reset
          </button>
          {can.edit && (
            <button className="primary" disabled={!sim.changes} onClick={() => setReviewing((r) => !r)}>
              Turn into actions…
            </button>
          )}
        </div>
        {reviewing && sim.changes > 0 && (
          <ScenarioReview model={model} sim={sim} scenario={scen.effective} store={store} pmsById={pmsById} go={go} close={() => setReviewing(false)} />
        )}
        <ImpactKpis sim={sim} />
        <nav className="subnav">
          {SECTIONS.map(([id, label]) => (
            <button key={id} className={section === id ? 'on' : ''} onClick={() => setSection(id)}>
              {label}
            </button>
          ))}
        </nav>
      </section>

      {section === 'levers' && <Levers model={model} scen={scen} />}
      {section === 'reach' && <Reach model={model} scen={scen} go={go} />}
      {section === 'effects' && <Effects model={model} scen={scen} go={go} />}
      {section === 'compare' && <Compare model={model} scen={scen} />}
      {section === 'beforeafter' && <BeforeAfter model={model} sim={sim} go={go} />}
    </>
  );
}

export function ImpactKpis({ sim }) {
  const b = sim.before;
  const a = sim.after;
  const tone = (better, worse) => (better ? 'good' : worse ? 'bad' : '');
  return (
    <div className="kpis compact-kpis">
      <Kpi label="COST (project)" value={arrow(b.margin * 100, a.margin * 100, (v) => v.toFixed(1) + '%')} tone={tone(a.margin > b.margin + 1e-9, a.margin < b.margin - 1e-9)} />
      <Kpi label="COST after bench" value={arrow(b.marginAfterBench * 100, a.marginAfterBench * 100, (v) => v.toFixed(1) + '%')} tone={tone(a.marginAfterBench > b.marginAfterBench + 1e-9, a.marginAfterBench < b.marginAfterBench - 1e-9)} />
      <Kpi label="Not managed" value={arrow(b.belowTarget, a.belowTarget, String)} tone={tone(a.belowTarget < b.belowTarget, a.belowTarget > b.belowTarget)} />
      <Kpi label="Cost off by" value={arrow(Math.round(b.gapINR), Math.round(a.gapINR), inr)} tone={tone(a.gapINR < b.gapINR - 1, a.gapINR > b.gapINR + 1)} />
      <Kpi label="Bench cost" value={arrow(Math.round(b.benchCostINR), Math.round(a.benchCostINR), inr)} tone={tone(a.benchCostINR < b.benchCostINR - 1, a.benchCostINR > b.benchCostINR + 1)} />
      <Kpi label="Company saves / month" value={money(sim.netMonthlyINR)} note="cost + bench saved, plus billing added" tone={tone(sim.netMonthlyINR > 1, sim.netMonthlyINR < -1)} />
    </div>
  );
}

// ---------------- Levers ----------------
function Levers({ model, scen }) {
  const [group, setGroup] = useState('');
  const [q, setQ] = useState('');
  const [onlyOn, setOnlyOn] = useState(false);
  const target = model.target;
  const stats = useMemo(
    () =>
      new Map(
        scen.levers.map((l) => {
          const s = simulate(model, merge([l.part]));
          const c = l.code && s.customers.find((x) => x.code === l.code);
          return [l.id, { net: s.netMonthlyINR, gap: s.after.gapINR - s.before.gapINR, below: s.after.belowTarget - s.before.belowTarget, cust: c }];
        })
      ),
    [model, scen.levers]
  );
  const groups = [...new Set(scen.levers.map((l) => l.group))];
  const on = new Set(scen.active.levers);
  const rows = scen.levers
    .filter((l) => (!group || l.group === group) && (!onlyOn || on.has(l.id)) && (!q || l.label.toLowerCase().includes(q.toLowerCase())))
    .sort((x, y) => stats.get(y.id).net - stats.get(x.id).net || stats.get(x.id).gap - stats.get(y.id).gap);

  return (
    <section className="card">
      <p className="muted">
        Each lever is a ready-made move. The numbers show its effect <strong>on its own</strong>; switch several on and the bar above shows the combined
        result. Customer levers are listed for customers below {Math.round(target * 100)}%.
      </p>
      <div className="toolbar">
        <input placeholder="Search levers or customers" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="">All kinds</option>
          {groups.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={onlyOn} onChange={(e) => setOnlyOn(e.target.checked)} /> On only
        </label>
        <span className="muted">
          {rows.length} levers · {on.size} on
        </span>
      </div>
      <ul className="levers">
        {rows.slice(0, 200).map((l) => {
          const st = stats.get(l.id);
          return (
            <li key={l.id} className={on.has(l.id) ? 'on' : ''}>
              <label className="switch">
                <input type="checkbox" checked={on.has(l.id)} onChange={() => scen.toggleLever(l.id)} />
                <span />
              </label>
              <div className="lever-body">
                <div>
                  <span className="muted small-text">{l.group}</span> <strong>{l.label}</strong>
                </div>
                <div className="muted small-text lever-detail">{l.detail}</div>
              </div>
              <div className="lever-fx">
                <div className={st.net > 1 ? 'good-text' : st.net < -1 ? 'err' : 'muted'}>{Math.abs(st.net) < 1 ? 'no company saving' : `${money(st.net)}/mo`}</div>
                {st.cust && (
                  <div className="small-text">
                    <Margin value={st.cust.before.margin} target={target} /> → <Margin value={st.cust.after.margin} target={target} />
                  </div>
                )}
                {st.below < 0 && <div className="good-text small-text">{-st.below} fewer below 70%</div>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------- Reach 70% ----------------
function Reach({ model, scen, go }) {
  const [targetCode, setTargetCode] = useState('__all__');
  const current = useMemo(() => simulate(model, scen.effective), [model, scen.effective]);
  const belowNow = current.customers.filter((c) => c.after.belowTarget);
  const plans = useMemo(() => {
    const codes = targetCode === '__all__' ? belowNow.map((c) => c.code) : [targetCode];
    return codes.map((code) => planToTarget(model, code, scen.effective));
  }, [model, scen.effective, targetCode]); // eslint-disable-line react-hooks/exhaustive-deps
  const withPlans = useMemo(() => simulate(model, merge([scen.effective, ...plans.map((p) => p.part)])), [model, scen.effective, plans]);
  const reached = plans.filter((p) => p.reached).length;
  const pctTarget = Math.round(model.target * 100);

  return (
    <section className="card">
      <p className="muted">
        For each customer below {pctTarget}%, the app looks for the fewest people changes that get it there (billing or taking off non-billable
        people), then adds the smallest rate increase needed, up to {MAX_RATE_PCT}%. Plans start from your current scenario.
      </p>
      <div className="toolbar">
        <select value={targetCode} onChange={(e) => setTargetCode(e.target.value)}>
          <option value="__all__">All customers below {pctTarget}% ({belowNow.length})</option>
          {belowNow
            .map((c) => model.customers.find((x) => x.code === c.code))
            .sort((a, b) => b.gapINR - a.gapINR)
            .map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
        </select>
        {plans.length > 1 && (
          <span className="muted">
            {reached} of {plans.length} can reach {pctTarget}% · all plans together: margin {pct(withPlans.before.margin)} → {pct(withPlans.after.margin)}, company saves{' '}
            {money(withPlans.netMonthlyINR)}/mo
          </span>
        )}
        <span className="spacer" />
        {plans.some((p) => p.steps.length) && (
          <button className="primary" onClick={() => plans.forEach((p) => p.steps.length && scen.addPart(p.part))}>
            Add {plans.length > 1 ? 'all plans' : 'this plan'} to scenario
          </button>
        )}
      </div>
      {plans.length === 0 && <p className="muted">Every customer is at or above {pctTarget}% in this scenario.</p>}
      <div className="plans">
        {plans.map((p) => (
          <div key={p.code} className={`plan ${p.reached ? 'ok' : 'short'}`}>
            <div className="f-head">
              <a onClick={() => go('customers', p.code)}>
                <strong>{p.name}</strong>
              </a>
              <Margin value={p.start.margin} target={model.target} /> → <Margin value={p.end.margin} target={model.target} />
              <span className="muted small-text">{p.reached ? `${p.steps.length} step${p.steps.length === 1 ? '' : 's'}` : 'cannot reach 70% with these moves'}</span>
              <span className="spacer" />
              {p.steps.length > 0 && (
                <button className="small" onClick={() => scen.addPart(p.part)}>
                  Add to scenario
                </button>
              )}
            </div>
            <ol>
              {p.steps.map((s, i) => (
                <li key={i}>
                  {s.label} <span className="muted small-text">→ {pct(s.marginAfter)}</span>
                </li>
              ))}
            </ol>
            {p.note && <div className="warn-text small-text">{p.note}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------- Effect of each change ----------------
function Effects({ model, scen }) {
  const items = useMemo(
    () => [
      ...scen.active.levers.map((id) => ({ id: `lever:${id}`, label: `Lever: ${scen.leverById.get(id)?.label || id}`, part: scen.leverById.get(id)?.part || {} })),
      ...splitParts(model, scen.active.manual),
    ],
    [model, scen.active, scen.leverById]
  );
  const rows = useMemo(() => (items.length <= 120 ? contributions(model, items) : []), [model, items]);
  if (!items.length) return <section className="card"><p className="muted">No changes yet. Switch on levers, add a plan, or edit people on the People tab.</p></section>;
  if (items.length > 120) return <section className="card"><p className="muted">{items.length} changes: too many to break down. Remove some or use levers.</p></section>;

  return (
    <section className="card">
      <p className="muted">
        <strong>On its own</strong> is what the change would do if it were the only one. <strong>In this scenario</strong> is what it adds on top of
        everything else, which can differ (e.g. taking someone off and billing them overlap). Sorted by what matters most.
      </p>
      <Table
        columns={[
          { key: 'label', label: 'Change', render: (r) => <span className="wrap">{r.label}</span> },
          { key: 'aloneINR', label: 'On its own', align: 'right', render: (r) => `${money(r.aloneINR)}/mo` },
          { key: 'inCombinationINR', label: 'In this scenario', align: 'right', render: (r) => <strong>{money(r.inCombinationINR)}/mo</strong> },
          { key: 'marginPts', label: 'COST change', align: 'right', render: (r) => pts(r.marginPts) },
          { key: 'gapChangeINR', label: 'Cost off by change', align: 'right', render: (r) => money(r.gapChangeINR), sort: (r) => -r.gapChangeINR },
          { key: 'x', label: '', render: (r) => <button className="linkish" onClick={() => scen.removeItem(r.id)}>Remove</button> },
        ]}
        rows={rows}
        initialSort={{ key: 'inCombinationINR', dir: 'desc' }}
        rowKey={(r) => r.id}
      />
    </section>
  );
}

// ---------------- Compare scenarios ----------------
function Compare({ model, scen }) {
  const cols = useMemo(() => scen.list.map((s) => ({ s, sim: simulate(model, scen.effectiveOf(s)) })), [model, scen.list, scen.effectiveOf]);
  const base = cols[0]?.sim.before;
  const metrics = [
    ['COST (project)', (x) => pct(x.after.margin), (x) => pct(base.margin)],
    ['COST after bench', (x) => pct(x.after.marginAfterBench), () => pct(base.marginAfterBench)],
    ['Not managed', (x) => x.after.belowTarget, () => base.belowTarget],
    ['Cost off by', (x) => inr(x.after.gapINR), () => inr(base.gapINR)],
    ['Bench cost', (x) => inr(x.after.benchCostINR), () => inr(base.benchCostINR)],
    ['Company saves / month', (x) => money(x.netMonthlyINR), () => '₹0'],
    ['Changes', (x) => x.changes, () => 0],
  ];
  return (
    <section className="card">
      <p className="muted">Each column is one of your saved scenarios. Click a name to make it the active scenario.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th />
              <th className="r">No changes</th>
              {cols.map(({ s }) => (
                <th key={s.id} className={`r ${s.id === scen.active.id ? 'active-col' : ''}`}>
                  <a onClick={() => scen.setActive(s.id)}>{s.name}</a>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map(([label, f, b]) => (
              <tr key={label}>
                <td>{label}</td>
                <td className="r muted">{b()}</td>
                {cols.map(({ s, sim }) => (
                  <td key={s.id} className={`r ${s.id === scen.active.id ? 'active-col' : ''}`}>
                    {f(sim)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------- Before / after ----------------
function BeforeAfter({ model, sim, go }) {
  const [allPms, setAllPms] = useState(false);
  const b = sim.before;
  const a = sim.after;
  const company = [
    ['Revenue', inr(b.revenueINR), inr(a.revenueINR), money(a.revenueINR - b.revenueINR)],
    ['Project spend', inr(b.costINR), inr(a.costINR), money(a.costINR - b.costINR)],
    ['Bench cost', inr(b.benchCostINR), inr(a.benchCostINR), money(a.benchCostINR - b.benchCostINR)],
    ['COST (project)', pct(b.margin), pct(a.margin), pts((a.margin - b.margin) * 100)],
    ['COST after bench', pct(b.marginAfterBench), pct(a.marginAfterBench), pts((a.marginAfterBench - b.marginAfterBench) * 100)],
    ['Not managed customers', b.belowTarget, a.belowTarget, a.belowTarget - b.belowTarget],
    ['Cost off by', inr(b.gapINR), inr(a.gapINR), money(a.gapINR - b.gapINR)],
  ];
  const changed = sim.customers.filter((c) => c.changed);
  const pms = pmRollup(model, sim).filter((p) => allPms || Math.abs(p.after.cost - p.before.cost) > 1 || Math.abs(p.after.rev - p.before.rev) > 1);
  const target = model.target;

  return (
    <>
      <section className="card">
        <h2>Company</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th />
                <th className="r">Before</th>
                <th className="r">After</th>
                <th className="r">Change</th>
              </tr>
            </thead>
            <tbody>
              {company.map(([l, x, y, d]) => (
                <tr key={l}>
                  <td>{l}</td>
                  <td className="r">{x}</td>
                  <td className="r">
                    <strong>{y}</strong>
                  </td>
                  <td className="r muted">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Customers changed ({changed.length})</h2>
        {changed.length === 0 ? (
          <p className="muted">No customer is affected yet.</p>
        ) : (
          <Table
            columns={[
              { key: 'name', label: 'Customer', render: (c) => <a onClick={() => go('customers', c.code)}><strong>{c.name}</strong></a> },
              { key: 'rev', label: 'Revenue', align: 'right', render: (c) => arrow(c.before.revenueINR, c.after.revenueINR, inr), sort: (c) => c.after.revenueINR - c.before.revenueINR },
              { key: 'cost', label: 'Spend', align: 'right', render: (c) => arrow(c.before.costINR, c.after.costINR, inr), sort: (c) => c.after.costINR - c.before.costINR },
              {
                key: 'margin',
                label: 'COST',
                align: 'right',
                render: (c) => (
                  <>
                    <Margin value={c.before.margin} target={target} /> → <Margin value={c.after.margin} target={target} />
                  </>
                ),
                sort: (c) => (c.after.margin ?? -9) - (c.before.margin ?? -9),
              },
              { key: 'gap', label: 'Cost off by', align: 'right', render: (c) => arrow(Math.round(c.before.gapINR), Math.round(c.after.gapINR), inr), sort: (c) => c.before.gapINR - c.after.gapINR },
              { key: 'status', label: '', render: (c) => (c.before.belowTarget && !c.after.belowTarget ? <span className="pill good">now managed</span> : !c.before.belowTarget && c.after.belowTarget ? <span className="pill bad">becomes not managed</span> : '') },
            ]}
            rows={changed}
            initialSort={{ key: 'gap', dir: 'desc' }}
            rowKey={(c) => c.code}
          />
        )}
      </section>

      <section className="card">
        <div className="title-row">
          <h2>PMs (estimated)</h2>
          <label className="small-text">
            <input type="checkbox" checked={allPms} onChange={(e) => setAllPms(e.target.checked)} /> Show all PMs
          </label>
        </div>
        <Table
          columns={[
            { key: 'name', label: 'PM', render: (p) => <strong>{p.name}</strong> },
            { key: 'rev', label: 'Est. revenue', align: 'right', render: (p) => arrow(p.before.rev, p.after.rev, inr) },
            { key: 'cost', label: 'Est. spend', align: 'right', render: (p) => arrow(p.before.cost, p.after.cost, inr) },
            {
              key: 'margin',
              label: 'Est. COST',
              align: 'right',
              render: (p) => (
                <>
                  <Margin value={p.before.margin} target={target} />
                  {Math.abs((p.after.margin ?? 0) - (p.before.margin ?? 0)) > 1e-6 && (
                    <>
                      {' '}
                      → <Margin value={p.after.margin} target={target} />
                    </>
                  )}
                </>
              ),
              sort: (p) => (p.after.margin ?? -9) - (p.before.margin ?? -9),
            },
            { key: 'gap', label: 'Cost off by', align: 'right', render: (p) => arrow(Math.round(p.before.gap), Math.round(p.after.gap), inr), sort: (p) => p.before.gap - p.after.gap },
          ]}
          rows={pms}
          initialSort={{ key: 'gap', dir: 'desc' }}
          rowKey={(p) => p.id}
        />
      </section>
    </>
  );
}
