import React from 'react';
import { inr, usd, pct } from '../format.js';
import { Kpi, Margin, Severity } from './ui.jsx';
import { summarize } from '../actions/logic.js';

export default function Overview({ model, pmsById, go, store }) {
  const t = model.totals;
  const s = summarize(store.actions);
  const target = model.target;
  const all = model.customers.flatMap((c) => c.findings.map((f) => ({ ...f, customer: c })));
  const bySev = ['critical', 'high', 'medium', 'low'].map((s) => [s, all.filter((f) => f.severity === s).length]);
  const topGaps = model.customers.filter((c) => c.gapINR > 0).slice(0, 10);
  const maxGap = topGaps[0]?.gapINR || 1;

  return (
    <>
      <section className="kpis">
        <Kpi label="Revenue" value={usd(t.revenueUSD)} note={inr(t.revenueINR)} />
        <Kpi label="Cost" value={inr(t.costINR)} note={`${pct(t.costINR / t.revenueINR)} of revenue`} />
        <Kpi
          label="Margin"
          value={pct(t.margin, 2)}
          note={`target ${pct(target, 0)}`}
          tone={t.margin >= target ? 'good' : 'bad'}
        />
        <Kpi label="Below target" value={`${t.belowTarget} / ${t.customers}`} note="customers" tone={t.belowTarget ? 'warn' : ''} />
        <Kpi label="Monthly gap to target" value={inr(t.gapINR)} note={usd(t.gapINR / model.fx)} tone="bad" />
        <Kpi
          label="Bench cost"
          value={inr(t.benchCostINR)}
          note={`${t.benchPeople} people · margin after bench ${pct(t.marginAfterBench)}`}
          tone="warn"
        />
        <Kpi label="Open actions" value={s.open} note={`${s.overdue} overdue · ${inr(s.openSavingINR)} in play`} tone={s.overdue ? 'bad' : ''} />
      </section>

      <div className="grid2">
        <section className="card">
          <h2>Biggest gaps to 70%</h2>
          <p className="muted">Monthly cost above the 30% cost line. Click a customer for the breakdown.</p>
          <ul className="bars">
            {topGaps.map((c) => (
              <li key={c.code} onClick={() => go('customers', c.code)}>
                <div className="bar-label">
                  <strong>{c.name}</strong>
                  <span className="muted">{c.pmIds.map((id) => pmsById[id]?.name.split(' ')[0]).join(', ')}</span>
                </div>
                <div className="bar-track">
                  <div className="bar" style={{ width: `${(100 * c.gapINR) / maxGap}%` }} />
                </div>
                <div className="bar-value">
                  {inr(c.gapINR)} <Margin value={c.margin} target={target} />
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2>Findings</h2>
          <div className="sev-counts">
            {bySev.map(([s, n]) => (
              <div key={s}>
                <Severity level={s} /> <strong>{n}</strong>
              </div>
            ))}
          </div>
          <h3>Critical</h3>
          <ul className="findings compact">
            {all
              .filter((f) => f.severity === 'critical')
              .map((f) => (
                <li key={f.id} onClick={() => go('customers', f.customer.code)}>
                  <strong>{f.customer.name}</strong> — {f.title}
                  <div className="muted">{f.action}</div>
                </li>
              ))}
          </ul>
        </section>
      </div>

      <section className="card">
        <h2>PMs</h2>
        <p className="muted">Revenue per PM is estimated from each PM's share of seats on shared customers.</p>
        <ul className="pm-strip">
          {model.pms
            .filter((p) => p.customers)
            .map((p) => (
              <li key={p.id} onClick={() => go('pms', p.id)}>
                <strong>{p.name}</strong>
                <span>
                  {p.customers} customers · {p.belowTarget} below
                </span>
                <span>
                  <Margin value={p.estMargin} target={target} /> gap {inr(p.gapINR)}
                </span>
              </li>
            ))}
        </ul>
      </section>
    </>
  );
}
