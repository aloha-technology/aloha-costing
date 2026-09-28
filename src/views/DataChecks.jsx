import React from 'react';
import { inr, usd, pct } from '../format.js';
import { Table } from './ui.jsx';

export default function DataChecks({ model, go }) {
  const dq = model.dataQuality;
  const t = model.totals;
  const offRecon = model.customers.filter((c) => c.reconciliation != null && Math.abs(c.reconciliation - 1) > 0.15);

  return (
    <>
      <section className="card">
        <h2>Source files</h2>
        <ul className="plain">
          {Object.entries(model.sources).map(([k, f]) => (
            <li key={k}>
              <strong>{k}</strong>: {f}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Cost reconciliation</h2>
        <p>
          Paysheet CTC × allocation gives <strong>{inr(t.computedCostINR)}</strong> against <strong>{inr(t.costINR)}</strong> on the costing sheet (
          {pct(t.computedCostINR / t.costINR - 1)} difference). Margins use the costing sheet; the paysheet explains who drives the cost.
        </p>
        <h3>Customers more than 15% off ({offRecon.length})</h3>
        <Table
          columns={[
            { key: 'name', label: 'Customer', render: (c) => <strong>{c.name}</strong> },
            { key: 'costINR', label: 'Costing sheet', align: 'right', render: (c) => inr(c.costINR) },
            { key: 'computedCostINR', label: 'Paysheet estimate', align: 'right', render: (c) => inr(c.computedCostINR) },
            { key: 'reconciliation', label: 'Ratio', align: 'right', render: (c) => c.reconciliation.toFixed(2) },
          ]}
          rows={offRecon}
          initialSort={{ key: 'reconciliation', dir: 'desc' }}
          onRowClick={(c) => go('customers', c.code)}
          rowKey={(c) => c.code}
        />
      </section>

      <div className="grid2">
        <section className="card">
          <h2>Allocated but not on the paysheet ({dq.employeesWithoutSalary.length})</h2>
          <ul className="plain">
            {dq.employeesWithoutSalary.map((e) => (
              <li key={e.id + e.name}>
                {e.name} <span className="muted">· {e.designation || 'no role'} · {e.project}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card">
          <h2>Invoiced but not in costing ({dq.invoicedNotInCosting.length})</h2>
          <ul className="plain">
            {dq.invoicedNotInCosting.map((e) => (
              <li key={e.code}>
                {e.lines.join('; ')} <span className="muted">· {e.code} · {usd(e.amountUSD)}</span>
              </li>
            ))}
          </ul>
          {dq.costingNotInvoiced.length > 0 && (
            <>
              <h3>In costing but not invoiced</h3>
              <ul className="plain">
                {dq.costingNotInvoiced.map((e) => (
                  <li key={e.code}>{e.name}</li>
                ))}
              </ul>
            </>
          )}
          {dq.unknownProjects.length > 0 && (
            <>
              <h3>Projects in the employee list with no seat data</h3>
              <ul className="plain">
                {dq.unknownProjects.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </>
  );
}
