import React, { useMemo, useState } from 'react';
import { inr, usd, pct } from '../format.js';
import { Kpi, Margin, Severity, Table, Status, Layers } from './ui.jsx';
import { FindingAction } from './ActionParts.jsx';
import { ProfileCard, RateCardCard, AddCustomer, ReviewTag } from './Master.jsx';
import { rateCard } from '../engine/ratecard.js';

export default function Customers({ model, pmsById, focus, setFocus, store, go, can, master }) {
  const customer = model.customers.find((c) => c.code === focus);
  if (customer) return <CustomerDetail c={customer} model={model} pmsById={pmsById} store={store} go={go} can={can} master={master} back={() => setFocus('')} />;
  const manual = master?.profiles[focus]?.manual && master.profiles[focus];
  if (manual) return <ManualCustomer code={focus} p={manual} model={model} master={master} can={can} pmsById={pmsById} back={() => setFocus('')} />;
  return <CustomerList model={model} pmsById={pmsById} open={setFocus} master={master} can={can} />;
}

function CustomerList({ model, pmsById, open, master, can }) {
  const [q, setQ] = useState('');
  const [pm, setPm] = useState('');
  const [onlyBelow, setOnlyBelow] = useState(false);
  const [review, setReview] = useState('');
  const [adding, setAdding] = useState(false);
  const target = model.target;
  const reviewOf = (c) => rateCard(c, master?.rates[c.code], master?.settings).status;

  const rows = useMemo(
    () =>
      model.customers.filter(
        (c) =>
          (!q || c.name.toLowerCase().includes(q.toLowerCase())) &&
          (!pm || c.pmIds.includes(pm)) &&
          (!onlyBelow || c.belowTarget) &&
          (!review || (review === 'attention' ? ['due', 'soon', 'unknown'].includes(reviewOf(c)) : reviewOf(c) === review))
      ),
    [model, q, pm, onlyBelow, review, master] // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Customers added in the app that aren't in the billing/allocation data yet.
  const manualOnly = Object.entries(master?.profiles || {}).filter(([code, p]) => p.manual && !model.customers.some((c) => c.code === code));

  const pmNames = (c) => c.pmIds.map((id) => pmsById[id]?.name.split(' ')[0]).join(', ');
  const columns = [
    { key: 'name', label: 'Customer', render: (c) => <strong>{c.name}</strong> },
    { key: 'pms', label: 'Team', render: pmNames, sort: pmNames },
    { key: 'billedSeats', label: 'Seats billed', align: 'right', render: (c) => fmtSeats(c.invoicing?.seats), sort: (c) => c.invoicing?.seats || 0 },
    { key: 'revenueUSD', label: 'Revenue $', align: 'right', render: (c) => usd(c.revenueUSD) },
    { key: 'revenueINR', label: 'Revenue ₹', align: 'right', render: (c) => inr(c.revenueINR) },
    { key: 'costINR', label: 'Spend', align: 'right', render: (c) => inr(c.costINR) },
    { key: 'margin', label: 'COST', align: 'right', render: (c) => <Margin value={c.margin} target={target} />, sort: (c) => c.margin ?? -1 },
    { key: 'managed', label: 'Status', render: (c) => <Status managed={!c.belowTarget} />, sort: (c) => (c.belowTarget ? 0 : 1) },
    { key: 'gapINR', label: 'Cost off by', align: 'right', render: (c) => (c.gapINR > 0 ? inr(c.gapINR) : '—') },
    { key: 'seats', label: 'Billed / allocated', align: 'right', render: (c) => `${c.billable} / ${c.allocated}`, sort: (c) => c.allocated - c.billable },
    ...(can?.seeAll ? [{ key: 'review', label: 'Rate review', render: (c) => <ReviewTag status={reviewOf(c)} />, sort: (c) => ({ due: 3, soon: 2, unknown: 1, ok: 0 })[reviewOf(c)] }] : []),
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
          <option value="">All teams</option>
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
          <input type="checkbox" checked={onlyBelow} onChange={(e) => setOnlyBelow(e.target.checked)} /> Not managed only
        </label>
        {can?.seeAll && (
          <select value={review} onChange={(e) => setReview(e.target.value)}>
            <option value="">Any rate review status</option>
            <option value="attention">Needs attention (due, soon or not recorded)</option>
            <option value="due">Due for revision</option>
            <option value="soon">Due within 60 days</option>
            <option value="unknown">Not recorded</option>
            <option value="ok">Up to date</option>
          </select>
        )}
        <span className="muted">{rows.length} customers</span>
        <span className="spacer" />
        {can?.edit && (
          <button className="primary" onClick={() => setAdding((a) => !a)}>
            + Add customer
          </button>
        )}
      </div>
      {adding && <AddCustomer model={model} master={master} onDone={(code) => { setAdding(false); if (code) open(code); }} />}
      <Table columns={columns} rows={rows} initialSort={{ key: 'gapINR', dir: 'desc' }} onRowClick={(c) => open(c.code)} rowKey={(c) => c.code} />
      {manualOnly.length > 0 && (
        <>
          <h3>Added in the app, no billing or allocation data yet ({manualOnly.length})</h3>
          <ul className="plain">
            {manualOnly.map(([code, p]) => (
              <li key={code}>
                <a onClick={() => open(code)}>{p.name}</a> <span className="muted small-text">· {code}{p.pmIds?.[0] ? ` · ${pmsById[p.pmIds[0]]?.name || ''}` : ''}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function CustomerDetail({ c, model, pmsById, store, go, can, master, back }) {
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
        <Status managed={!c.belowTarget} />
        <span className="muted">
          {c.code} · account PM {pmsById[c.accountPm]?.name || '—'} · team {c.pmIds.map((id) => pmsById[id]?.name.split(' ')[0]).join(', ')}
        </span>
      </div>

      <section className="kpis">
        <Kpi
          label={c.revenueSource === 'invoicing' ? 'Revenue (invoiced)' : 'Revenue (costing sheet)'}
          value={usd(c.revenueUSD)}
          note={`${inr(c.revenueINR)} at ₹${(c.fx || model.fx).toFixed(2)}/US$${Math.abs(c.revenueDiffUSD || 0) > 1 ? ` · costing sheet ${usd(c.costingRevenueUSD)}` : ''}`}
          tone={Math.abs(c.revenueDiffUSD || 0) > 1 ? 'warn' : ''}
        />
        <Kpi label="Project spend" value={inr(c.costINR)} note={can.seeAll && c.sheetCostINR ? `costing sheet ${inr(c.sheetCostINR)}` : `${pct(c.costINR / c.revenueINR)} of revenue`} />
        <Kpi label="COST (profit)" value={c.margin == null ? 'no revenue' : pct(c.margin)} note={`target ${pct(target, 0)}`} tone={c.belowTarget ? 'bad' : 'good'} />
        <Kpi label="Cost off by" value={c.gapINR > 0 ? inr(c.gapINR) : '—'} note={c.gapUSD ? `${usd(c.gapUSD)} a month` : 'within the spend limit'} tone={c.gapINR > 0 ? 'bad' : 'good'} />
        <Kpi label="Billed / allocated" value={`${c.billable} / ${c.allocated}`} note={can.seeAll ? `non-billable spend ${inr(nonBillableCost)}` : ''} />
        {c.invoicing && (
          <Kpi
            label={`Billing · ${model.period}`}
            value={`${fmtSeats(c.invoicing.seats)} ${c.invoicing.seats === 1 ? "seat" : "seats"}`}
            note={`${usd(c.invoicing.amountUSD)} invoiced · ${c.invoicing.diffAmountUSD >= 0 ? '+' : ''}${usd(c.invoicing.diffAmountUSD)} vs last month`}
          />
        )}
      </section>

      {master && <ProfileCard c={c} master={master} can={can} pmsById={pmsById} />}
      {master && can.seeAll && <RateCardCard c={c} master={master} can={can} />}

      <section className="card">
        <h2>Spend layers</h2>
        <Layers layers={c.layers} target={target} revenueINR={c.revenueINR} />
        <p className="muted small-text" style={{ marginBottom: 0 }}>
          Engineering {inr(c.layers?.engineering.spendINR || 0)} · PMs {inr(c.pmSpendINR || 0)} · bench share {inr(c.benchShareINR || 0)} (the team's bench, split
          across their customers) · support share {inr(c.supportShareINR || 0)} (split by engineering spend).
        </p>
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
              ...(can.seeAll ? [{ key: 'costShare', label: 'Share of spend', align: 'right', render: (s) => pct(s.costShare) }] : []),
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
            { key: 'experienceYears', label: 'Exp (yrs)', align: 'right', render: (p) => p.experienceYears ?? '—' },
            { key: 'skills', label: 'Skills', render: (p) => <span className="skills">{p.skills || '—'}</span> },
            { key: 'ownerPm', label: 'PM', render: (p) => pmsById[p.ownerPm]?.name.split(' ')[0], sort: (p) => pmsById[p.ownerPm]?.name },
            { key: 'utilPct', label: 'Time here', align: 'right', render: (p) => `${p.utilPct}%` },
            { key: 'billable', label: 'Billable', render: (p) => (p.billable ? 'Yes' : <span className="pill bad">No</span>), sort: (p) => (p.billable ? 1 : 0) },
            ...(can.seeAll
              ? [
                  { key: 'ctcMonthlyINR', label: 'Monthly CTC', align: 'right', render: (p) => (p.ctcMonthlyINR == null ? 'not on paysheet' : inr(p.ctcMonthlyINR, { compact: false })) },
                  { key: 'costINR', label: 'Spend here', align: 'right', render: (p) => inr(p.costINR, { compact: false }) },
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

const fmtSeats = (n) => (n == null ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(2));

// A customer added in the app before it appears in billing/allocation data: profile only.
function ManualCustomer({ code, p, model, master, can, pmsById, back }) {
  const c = { code, name: p.name, pmIds: p.pmIds || [], pmSplit: [], people: [], seats: [] };
  return (
    <>
      <button className="back" onClick={back}>
        ← All customers
      </button>
      <div className="title-row">
        <h2>{p.name}</h2>
        <span className="pill warn">No billing or allocation data yet</span>
        <span className="muted">{code}</span>
      </div>
      <ProfileCard c={c} master={master} can={can} pmsById={pmsById} />
      {can.seeAll && <RateCardCard c={c} master={master} can={can} />}
    </>
  );
}
