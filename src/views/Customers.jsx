import React, { useMemo, useState } from 'react';
import { inr, usd, pct } from '../format.js';
import { Kpi, Margin, Severity, Table } from './ui.jsx';
import { FindingAction } from './ActionParts.jsx';

export default function Customers({ model, pmsById, focus, setFocus, store, go, can }) {
  const customer = model.customers.find((c) => c.code === focus);
  if (customer) return <CustomerDetail c={customer} model={model} pmsById={pmsById} store={store} go={go} can={can} back={() => setFocus('')} />;
  return <CustomerList model={model} pmsById={pmsById} open={setFocus} />;
}

function CustomerList({ model, pmsById, open }) {
  const [q, setQ] = useState('');
  const [pm, setPm] = useState('');
  const [onlyBelow, setOnlyBelow] = useState(false);
  const target = model.target;

  const rows = useMemo(
    () =>
      model.customers.filter(
        (c) =>
          (!q || c.name.toLowerCase().includes(q.toLowerCase())) &&
          (!pm || c.pmIds.includes(pm)) &&
          (!onlyBelow || c.belowTarget)
      ),
    [model, q, pm, onlyBelow]
  );

  const pmNames = (c) => c.pmIds.map((id) => pmsById[id]?.name.split(' ')[0]).join(', ');
  const columns = [
    { key: 'name', label: 'Customer', render: (c) => <strong>{c.name}</strong> },
    { key: 'pms', label: 'PMs', render: pmNames, sort: pmNames },
    { key: 'revenueUSD', label: 'Revenue', align: 'right', render: (c) => usd(c.revenueUSD) },
    { key: 'costINR', label: 'Cost', align: 'right', render: (c) => inr(c.costINR) },
    { key: 'margin', label: 'Margin', align: 'right', render: (c) => <Margin value={c.margin} target={target} />, sort: (c) => c.margin ?? -1 },
    { key: 'gapINR', label: 'Gap / month', align: 'right', render: (c) => (c.gapINR > 0 ? inr(c.gapINR) : '—') },
    { key: 'seats', label: 'Billed / allocated', align: 'right', render: (c) => `${c.billable} / ${c.allocated}`, sort: (c) => c.allocated - c.billable },
    {
      key: 'findings',
      label: 'Flags',
      render: (c) => (
        <span className="flag-dots">
          {c.findings.slice(0, 4).map((f) => (
            <Severity key={f.id} level={f.severity} />
          ))}
          {c.findings.length > 4 && <span className="muted">+{c.findings.length - 4}</span>}
        </span>
      ),
      sort: (c) => c.findings.filter((f) => f.severity === 'critical' || f.severity === 'high').length,
    },
  ];

  return (
    <section className="card">
      <div className="toolbar">
        <input placeholder="Search customers" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={pm} onChange={(e) => setPm(e.target.value)}>
          <option value="">All PMs</option>
          {[...model.pms]
            .filter((p) => p.customers)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
        <label>
          <input type="checkbox" checked={onlyBelow} onChange={(e) => setOnlyBelow(e.target.checked)} /> Below target only
        </label>
        <span className="muted">{rows.length} customers</span>
      </div>
      <Table columns={columns} rows={rows} initialSort={{ key: 'gapINR', dir: 'desc' }} onRowClick={(c) => open(c.code)} rowKey={(c) => c.code} />
    </section>
  );
}

function CustomerDetail({ c, model, pmsById, store, go, can, back }) {
  const target = model.target;
  const nonBillableCost = c.people.filter((p) => !p.billable).reduce((a, p) => a + p.costINR, 0);
  const seatsByRole = Object.values(
    c.seats.reduce((acc, s) => {
      const k = s.role + '|' + s.rateUSD;
      acc[k] = acc[k] || { role: s.role, rateUSD: s.rateUSD, count: 0 };
      acc[k].count += s.count;
      return acc;
    }, {})
  );

  return (
    <>
      <button className="back" onClick={back}>
        ← All customers
      </button>
      <div className="title-row">
        <h2>{c.name}</h2>
        <span className="muted">
          {c.code} · account PM {pmsById[c.accountPm]?.name || '—'}
        </span>
      </div>

      <section className="kpis">
        <Kpi
          label={c.revenueSource === 'invoicing' ? 'Revenue (invoiced)' : 'Revenue (costing sheet)'}
          value={usd(c.revenueUSD)}
          note={`${inr(c.revenueINR)}${Math.abs(c.revenueDiffUSD || 0) > 1 ? ` · costing sheet ${usd(c.costingRevenueUSD)}` : ''}`}
          tone={Math.abs(c.revenueDiffUSD || 0) > 1 ? 'warn' : ''}
        />
        <Kpi label="Cost" value={inr(c.costINR)} note={can.seeAll ? `paysheet estimate ${inr(c.computedCostINR)}` : `${pct(c.costINR / c.revenueINR)} of revenue`} />
        <Kpi label="Margin" value={c.margin == null ? 'no revenue' : pct(c.margin)} note={`target ${pct(target, 0)}`} tone={c.belowTarget ? 'bad' : 'good'} />
        <Kpi label="Gap / month" value={c.gapINR > 0 ? inr(c.gapINR) : '—'} note={c.gapUSD ? usd(c.gapUSD) : ''} tone={c.gapINR > 0 ? 'bad' : ''} />
        <Kpi label="Billed / allocated" value={`${c.billable} / ${c.allocated}`} note={can.seeAll ? `non-billable cost ${inr(nonBillableCost)}` : ''} />
        {c.invoicing && (
          <Kpi
            label="Invoiced this month"
            value={usd(c.invoicing.amountUSD)}
            note={`${c.invoicing.seats} seats · ${c.invoicing.diffAmountUSD >= 0 ? '+' : ''}${usd(c.invoicing.diffAmountUSD)} vs last month`}
          />
        )}
      </section>

      <section className="card">
        <h2>Findings & recommended actions</h2>
        {c.findings.length === 0 && <p className="muted">Nothing to flag.</p>}
        <ul className="findings">
          {c.findings.map((f) => (
            <li key={f.id}>
              <div className="f-head">
                <Severity level={f.severity} />
                <strong>{f.title}</strong>
                {f.savingINR > 0 && <span className="saving">up to {inr(f.savingINR)}/mo</span>}
              </div>
              <div>{can.seeAll ? f.detail : f.pmText}</div>
              <div className="action">→ {f.action}</div>
              {f.ownerPmIds.length > 0 && <div className="muted">Owner: {f.ownerPmIds.map((id) => pmsById[id]?.name).join(', ')}</div>}
              {f.pmText && <FindingAction finding={f} customer={c} model={model} pmsById={pmsById} store={store} go={go} can={can} />}
            </li>
          ))}
        </ul>
      </section>

      {c.pmSplit.length > 1 && (
        <section className="card">
          <h2>Split by PM</h2>
          <Table
            columns={[
              { key: 'pm', label: 'PM', render: (s) => pmsById[s.pmId]?.name, sort: (s) => pmsById[s.pmId]?.name },
              { key: 'people', label: 'People', align: 'right' },
              ...(can.seeAll ? [{ key: 'costShare', label: 'Share of cost', align: 'right', render: (s) => pct(s.costShare) }] : []),
              { key: 'revenueShare', label: 'Est. share of revenue', align: 'right', render: (s) => pct(s.revenueShare) },
              { key: 'subprojects', label: 'Projects', render: (s) => s.subprojects.join(', ') },
            ]}
            rows={c.pmSplit}
            initialSort={{ key: can.seeAll ? 'costShare' : 'people', dir: 'desc' }}
            rowKey={(s) => s.pmId}
          />
        </section>
      )}

      <section className="card">
        <h2>People on this account</h2>
        {can.seeAll && <p className="muted">Cost = monthly CTC × time on this account. Salaries are never shown to PMs.</p>}
        <Table
          columns={[
            { key: 'name', label: 'Name', render: (p) => <strong>{p.name}</strong> },
            { key: 'designation', label: 'Role' },
            { key: 'ownerPm', label: 'PM', render: (p) => pmsById[p.ownerPm]?.name.split(' ')[0], sort: (p) => pmsById[p.ownerPm]?.name },
            { key: 'utilPct', label: 'Time here', align: 'right', render: (p) => `${p.utilPct}%` },
            { key: 'billable', label: 'Billable', render: (p) => (p.billable ? 'Yes' : <span className="pill bad">No</span>), sort: (p) => (p.billable ? 1 : 0) },
            ...(can.seeAll
              ? [
                  { key: 'ctcMonthlyINR', label: 'Monthly CTC', align: 'right', render: (p) => (p.ctcMonthlyINR == null ? 'not on paysheet' : inr(p.ctcMonthlyINR, { compact: false })) },
                  { key: 'costINR', label: 'Cost here', align: 'right', render: (p) => inr(p.costINR, { compact: false }) },
                  { key: 'share', label: '% of revenue', align: 'right', render: (p) => (c.revenueINR ? pct(p.costINR / c.revenueINR) : '—'), sort: (p) => p.costINR },
                ]
              : []),
          ]}
          rows={c.people}
          initialSort={{ key: can.seeAll ? 'costINR' : 'utilPct', dir: 'desc' }}
          rowKey={(p) => p.empId + p.project}
        />
      </section>

      <section className="card">
        <h2>Seats & rates</h2>
        <Table
          columns={[
            { key: 'role', label: 'Role' },
            { key: 'count', label: 'Seats', align: 'right' },
            { key: 'rateUSD', label: 'Rate / month', align: 'right', render: (s) => usd(s.rateUSD, { compact: false }) },
            { key: 'value', label: 'Value at rate', align: 'right', render: (s) => usd(s.count * s.rateUSD, { compact: false }), sort: (s) => s.count * s.rateUSD },
          ]}
          rows={seatsByRole}
          initialSort={{ key: 'value', dir: 'desc' }}
          rowKey={(s) => s.role + s.rateUSD}
        />
      </section>
    </>
  );
}
