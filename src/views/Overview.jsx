import React from 'react';
import { inr, usd, pct } from '../format.js';
import { Kpi, Margin, Severity, Layers } from './ui.jsx';
import { summarize } from '../actions/logic.js';

export default function Overview({ model, pmsById, go, store, can }) {
  const t = model.totals;
  const s = summarize(store.actions);
  const target = model.target;
  const all = model.customers.flatMap((c) => c.findings.map((f) => ({ ...f, customer: c })));
  const bySev = ['critical', 'high', 'medium', 'low'].map((sv) => [sv, all.filter((f) => f.severity === sv).length]);
  const offBy = model.customers.filter((c) => c.gapINR > 0).slice(0, 10);
  const maxGap = offBy[0]?.gapINR || 1;
  const billedSeats = model.customers.reduce((a, c) => a + (c.invoicing?.seats || 0), 0);
  const managed = t.customers - t.belowTarget;

  return (
    <>
      <section className="kpis">
        <Kpi label="Revenue (invoiced)" value={usd(t.revenueUSD)} note={`${inr(t.revenueINR)} · ${Math.round(billedSeats)} seats billed`} />
        <Kpi label="Project spend" value={inr(t.costINR)} note="engineering + PMs, from payroll" />
        <Kpi label="COST (profit)" value={pct(t.margin)} note={`target ${pct(target, 0)}`} tone={t.margin >= target ? 'good' : 'bad'} />
        <Kpi label="Managed" value={`${managed} / ${t.customers}`} note={`${t.belowTarget} not managed`} tone={managed / t.customers >= 0.5 ? 'good' : 'warn'} />
        <Kpi label="Cost off by" value={inr(t.gapINR)} note={`${usd(t.gapINR / model.fx)} a month`} tone="bad" />
        <Kpi label="Open actions" value={s.open} note={`${s.overdue} overdue${can.seeAll ? ` · ${inr(s.openSavingINR)} in play` : ''}`} tone={s.overdue ? 'bad' : ''} />
      </section>

      <section className="card">
        <h2>Spend layers and COST</h2>
        <p className="muted small-text">
          Managed / Not managed is judged on <strong>project</strong> spend (engineering + PMs). Bench and support show the fuller picture.
        </p>
        <Layers layers={t.layers} target={target} revenueINR={t.revenueINR} />
        {can.seeAll && (t.unassignedINR > 0 || t.unclassifiedPayrollINR > 0) && (
          <div className="infobox" style={{ marginTop: 12, marginBottom: 0 }}>
            Not in any layer yet: <strong>{inr(t.unassignedINR)}</strong>/month of engineers' and PMs' time not assigned to a customer or bench, and{' '}
            <strong>{inr(t.unclassifiedPayrollINR)}</strong>/month for {t.unclassifiedPeople} people on payroll who aren't in the portal's employee list.{' '}
            <a onClick={() => go('checks')}>Review in Data & validation</a>
          </div>
        )}
      </section>

      <div className="grid2">
        <section className="card">
          <h2>Largest cost off by</h2>
          <p className="muted small-text">Monthly spend above the {100 - Math.round(target * 100)}% limit. Click a customer for the breakdown.</p>
          <ul className="bars">
            {offBy.map((c) => (
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
            {bySev.map(([sv, n]) => (
              <div key={sv}>
                <Severity level={sv} /> <strong>{n}</strong>
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
                  <div className="muted small-text">{f.action}</div>
                </li>
              ))}
          </ul>
        </section>
      </div>

      <section className="card">
        <h2>Teams</h2>
        <p className="muted small-text">Revenue per team is estimated from each PM's share of seats on shared customers.</p>
        <ul className="pm-strip">
          {model.pms
            .filter((p) => p.customers)
            .map((p) => (
              <li key={p.id} onClick={() => go('pms', p.id)}>
                <strong>{p.name}</strong>
                <span className="muted">
                  {p.customers} customers · {p.customers - p.belowTarget} managed
                </span>
                <span>
                  COST <Margin value={p.estMargin} target={target} /> · off by {inr(p.gapINR)}
                </span>
              </li>
            ))}
        </ul>
      </section>
    </>
  );
}
