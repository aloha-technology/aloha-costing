import React from 'react';
import { inr, usd, pct } from '../format.js';
import { Table } from './ui.jsx';

export default function DataChecks({ model, go }) {
  const dq = model.dataQuality;
  const t = model.totals;
  const revDiffs = model.customers.filter((c) => Math.abs(c.revenueDiffUSD || 0) > Math.max(1, 0.01 * c.revenueUSD));
  // Customers whose costing-sheet excess matches another's: a sign of one invoice counted twice.
  const sameAs = (c) =>
    revDiffs
      .filter((o) => o.code !== c.code && c.revenueDiffUSD > 0 && Math.abs(o.revenueDiffUSD - c.revenueDiffUSD) < 1)
      .map((o) => o.name)
      .join(', ');
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
        <h2>Revenue: costing sheet vs invoiced</h2>
        <p>
          Revenue in this app is the <strong>invoiced</strong> amount: <strong>{usd(t.revenueUSD)}</strong>. The costing sheet shows{' '}
          <strong>{usd(t.costingRevenueUSD)}</strong> ({usd(t.costingRevenueUSD - t.revenueUSD)} more). {revDiffs.length} customers differ; the same
          amount appearing on several customers usually means one invoice was counted more than once.
        </p>
        <Table
          columns={[
            { key: 'name', label: 'Customer', render: (c) => <strong>{c.name}</strong> },
            { key: 'costingRevenueUSD', label: 'Costing sheet', align: 'right', render: (c) => usd(c.costingRevenueUSD, { compact: false }) },
            { key: 'revenueUSD', label: 'Invoiced', align: 'right', render: (c) => usd(c.revenueUSD, { compact: false }) },
            { key: 'revenueDiffUSD', label: 'Difference', align: 'right', render: (c) => usd(c.revenueDiffUSD, { compact: false }), sort: (c) => Math.abs(c.revenueDiffUSD) },
            { key: 'same', label: 'Same amount also on', render: (c) => sameAs(c) || '—' },
          ]}
          rows={revDiffs}
          initialSort={{ key: 'revenueDiffUSD', dir: 'desc' }}
          onRowClick={(c) => go('customers', c.code)}
          rowKey={(c) => c.code}
        />
      </section>

      <section className="card">
        <h2>Payroll coverage</h2>
        <p>
          Payroll this month: <strong>{inr(t.payrollINR)}</strong>. Of that, spend on customers (engineering + PMs) is{' '}
          <strong>{inr(t.costINR)}</strong>, bench <strong>{inr(t.benchCostINR)}</strong>, support (HR, Admin, Accounts, MIS){' '}
          <strong>{inr(t.supportINR)}</strong>. Not in any layer yet: <strong>{inr(t.unassignedINR)}</strong> of engineers' and PMs' time not assigned to a
          customer or bench, and <strong>{inr(t.unclassifiedPayrollINR)}</strong> for {t.unclassifiedPeople} people on payroll who aren't in the portal's
          employee list.
        </p>
        <h3>On payroll, not in the employee list ({model.unclassified?.length || 0})</h3>
        <p className="muted small-text">
          These need a category (support, leadership/sales, leaving, other) before their cost can be placed. Classification comes with data validation (next
          step).
        </p>
        <Table
          columns={[
            { key: 'empId', label: 'ID' },
            { key: 'name', label: 'Name', render: (u) => <strong>{u.name}</strong> },
            { key: 'ctcMonthlyINR', label: 'Monthly CTC', align: 'right', render: (u) => inr(u.ctcMonthlyINR, { compact: false }) },
          ]}
          rows={model.unclassified || []}
          initialSort={{ key: 'ctcMonthlyINR', dir: 'desc' }}
          rowKey={(u) => u.empId}
        />
      </section>

      <section className="card">
        <h2>Spend cross-check: payroll vs costing sheet</h2>
        <p>
          Spend in this app is payroll CTC × allocation: <strong>{inr(t.computedCostINR)}</strong>. The portal's costing sheet shows{' '}
          <strong>{inr(t.sheetCostINR)}</strong> ({pct(t.computedCostINR / t.sheetCostINR - 1)} difference, usually because the paysheet is from a different
          month or includes incentives).
        </p>
        <h3>Customers more than 15% apart ({offRecon.length})</h3>
        <Table
          columns={[
            { key: 'name', label: 'Customer', render: (c) => <strong>{c.name}</strong> },
            { key: 'computedCostINR', label: 'Payroll spend', align: 'right', render: (c) => inr(c.computedCostINR) },
            { key: 'sheetCostINR', label: 'Costing sheet', align: 'right', render: (c) => inr(c.sheetCostINR) },
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
