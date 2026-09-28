import React, { useState } from 'react';
import { inr, pct } from '../format.js';
import { Kpi } from './ui.jsx';
import { BenchTable } from './Pms.jsx';

export default function Bench({ model, can }) {
  const [pm, setPm] = useState('');
  const t = model.totals;
  const rows = model.bench.filter((b) => !pm || b.pmId === pm);
  const leaving = model.bench.filter((b) => b.relievingDate);
  const owners = [...new Set(model.bench.map((b) => b.pmId))].map((id) => model.pms.find((p) => p.id === id)).filter(Boolean);

  return (
    <>
      {can.seeAll && (
      <section className="kpis">
        <Kpi label="People on bench" value={t.benchPeople} />
        <Kpi label="Bench cost / month" value={inr(t.benchCostINR)} tone="warn" />
        <Kpi label="Margin after bench" value={pct(t.marginAfterBench)} note={`vs ${pct(t.margin)} before`} tone={t.marginAfterBench < model.target ? 'bad' : 'good'} />
        <Kpi label="Confirmed relieving" value={leaving.length} note={inr(leaving.reduce((a, b) => a + b.costINR, 0)) + ' / month'} />
      </section>
      )}
      <section className="card">
        <div className="toolbar">
          <select value={pm} onChange={(e) => setPm(e.target.value)}>
            <option value="">All PMs</option>
            {owners
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.benchPeople})
                </option>
              ))}
          </select>
          <span className="muted">
            {rows.length} people{can.seeAll && ` · ${inr(rows.reduce((a, b) => a + b.costINR, 0))} / month`}
          </span>
        </div>
        <BenchTable rows={rows} showPm showCost={can.seeAll} />
      </section>
    </>
  );
}
