import React from 'react';
import { inr, pct } from '../format.js';
import { Kpi, Margin, Severity, Table, Status, Layers } from './ui.jsx';
import { SEVERITY_ORDER } from '../engine/rules.js';
import { FindingAction, BulkCreate, StatusChip } from './ActionParts.jsx';
import { isClosed } from '../actions/logic.js';

export default function Pms({ model, pmsById, focus, setFocus, go, store, can, me }) {
  const pm = pmsById[focus];
  const target = model.target;
  if (!pm) {
    return (
      <section className="card">
        <p className="muted small-text">Team figures are estimates: spend from the people on each PM's projects, revenue from their share of seats on shared customers. COST is measured on project spend; the last columns add the team's own bench.</p>
        <Table
          columns={[
            { key: 'name', label: 'Team (PM)', render: (p) => <strong>{p.name}</strong> },
            { key: 'customers', label: 'Customers', align: 'right' },
            { key: 'managed', label: 'Managed', align: 'right', render: (p) => `${p.customers - p.belowTarget} / ${p.customers}`, sort: (p) => p.customers - p.belowTarget },
            { key: 'estRevenueINR', label: 'Est. revenue', align: 'right', render: (p) => (p.customers ? inr(p.estRevenueINR) : '—') },
            { key: 'estCostINR', label: 'Project spend', align: 'right', render: (p) => (p.customers ? inr(p.estCostINR) : '—') },
            { key: 'estMargin', label: 'COST', align: 'right', render: (p) => <Margin value={p.estMargin} target={target} />, sort: (p) => p.estMargin ?? -1 },
            { key: 'gapINR', label: 'Cost off by', align: 'right', render: (p) => inr(p.gapINR) },
            { key: 'benchCostINR', label: 'Bench', align: 'right', render: (p) => (p.benchPeople ? `${p.benchPeople} · ${inr(p.benchCostINR)}` : '—') },
            { key: 'withBench', label: 'COST with bench', align: 'right', render: (p) => <Margin value={p.teamLayers?.withOwnBench?.cost} target={target} />, sort: (p) => p.teamLayers?.withOwnBench?.cost ?? -9 },
          ]}
          rows={model.pms}
          initialSort={{ key: 'gapINR', dir: 'desc' }}
          onRowClick={(p) => setFocus(p.id)}
          rowKey={(p) => p.id}
        />
      </section>
    );
  }

  const customers = model.customers.filter((c) => c.pmIds.includes(pm.id));
  const findings = customers
    .flatMap((c) => c.findings.filter((f) => f.ownerPmIds.includes(pm.id)).map((f) => ({ ...f, customer: c })))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.savingINR - a.savingINR);
  const bench = model.bench.filter((b) => b.pmId === pm.id);
  const myActions = store.actions.filter((a) => a.ownerPmId === pm.id && !isClosed(a)).sort((x, y) => x.dueDate.localeCompare(y.dueDate));

  return (
    <>
      {me.role !== 'pm' && (
        <button className="back" onClick={() => setFocus('')}>
          ← All teams
        </button>
      )}
      <div className="title-row">
        <h2>{pm.name}</h2>
        <span className="muted">{pm.email}</span>
        <span className="spacer" />
        {can.edit && (
          <a className="btn" href={`?as=pm:${encodeURIComponent(pm.id)}#mine`}>
            Preview as {pm.name.split(' ')[0]}
          </a>
        )}
        {can.edit && (
          <button className="primary" onClick={() => go('whatsapp', pm.id)}>
            WhatsApp digest
          </button>
        )}
      </div>
      <section className="kpis">
        <Kpi label="Customers" value={pm.customers} note={`${pm.accountOwnerOf.length} as account owner`} />
        <Kpi label="Managed" value={`${pm.customers - pm.belowTarget} / ${pm.customers}`} note={`${pm.belowTarget} not managed`} tone={pm.belowTarget ? 'warn' : 'good'} />
        <Kpi label="COST (profit)" value={pct(pm.estMargin)} note={`target ${pct(target, 0)}`} tone={pm.estMargin >= target ? 'good' : 'bad'} />
        <Kpi label="Cost off by" value={inr(pm.gapINR)} tone={pm.gapINR ? 'bad' : 'good'} />
        <Kpi label="Bench" value={`${pm.benchPeople} people`} note={`${inr(pm.benchCostINR)}/month`} tone={pm.benchPeople ? 'warn' : ''} />
      </section>

      <section className="card">
        <h2>Team spend layers</h2>
        <Layers
          layers={pm.teamLayers}
          target={target}
          revenueINR={pm.estRevenueINR}
          names={[
            ['project', 'Project (eng + PMs)'],
            ['withOwnBench', "+ Team's own bench"],
            ['full', '+ Bench & support shares'],
          ]}
        />
      </section>

      {myActions.length > 0 && (
        <section className="card">
          <h2>Open actions ({myActions.length})</h2>
          <Table
            columns={[
              { key: 'dueDate', label: 'Due' },
              { key: 'status', label: 'Status', render: (a) => <StatusChip a={a} /> },
              { key: 'customerName', label: 'Customer', render: (a) => <strong>{a.customerName}</strong> },
              { key: 'title', label: 'Action', render: (a) => <span className="wrap">{a.title}</span> },
              ...(can.seeAll ? [{ key: 'savingINR', label: 'Est. saving', align: 'right', render: (a) => (a.savingINR ? inr(a.savingINR) : '—') }] : []),
            ]}
            rows={myActions}
            initialSort={{ key: 'dueDate', dir: 'asc' }}
            onRowClick={(a) => go('actions', a.id)}
            rowKey={(a) => a.id}
          />
        </section>
      )}

      <section className="card">
        <div className="title-row">
          <h2>Findings for {pm.name.split(' ')[0]}</h2>
          <span className="spacer" />
          {can.edit && <BulkCreate findings={findings} model={model} store={store} forPmId={pm.id} label={`Track ${pm.name.split(' ')[0]}'s critical & high`} />}
        </div>
        {can.edit && <p className="muted">Open actions go into this PM's weekly WhatsApp digest.</p>}
        <ul className="findings">
          {findings.map((f) => (
            <li key={f.id}>
              <div className="f-head">
                <Severity level={f.severity} />
                <a onClick={() => go('customers', f.customer.code)}>{f.customer.name}</a>
                <strong>{f.title}</strong>
                {f.savingINR > 0 && <span className="saving">up to {inr(f.savingINR)}/mo</span>}
              </div>
              {!can.seeAll && <div>{f.pmText}</div>}
              <div className="action">→ {f.action}</div>
              {f.pmText && <FindingAction finding={f} customer={f.customer} model={model} pmsById={pmsById} store={store} go={go} can={can} />}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Customers</h2>
        <Table
          columns={[
            { key: 'name', label: 'Customer', render: (c) => <strong>{c.name}</strong> },
            { key: 'revenueINR', label: 'Revenue ₹', align: 'right', render: (c) => inr(c.revenueINR) },
            { key: 'margin', label: 'COST', align: 'right', render: (c) => <Margin value={c.margin} target={target} />, sort: (c) => c.margin ?? -1 },
            { key: 'gapINR', label: 'Cost off by', align: 'right', render: (c) => (c.gapINR > 0 ? inr(c.gapINR) : '—') },
            can.seeAll
              ? { key: 'share', label: 'Their share of spend', align: 'right', render: (c) => pct(c.pmSplit.find((s) => s.pmId === pm.id)?.costShare ?? 0), sort: (c) => c.pmSplit.find((s) => s.pmId === pm.id)?.costShare ?? 0 }
              : { key: 'share', label: 'Their people', align: 'right', render: (c) => c.pmSplit.find((s) => s.pmId === pm.id)?.people ?? 0, sort: (c) => c.pmSplit.find((s) => s.pmId === pm.id)?.people ?? 0 },
            { key: 'others', label: 'Other PMs', render: (c) => c.pmIds.filter((id) => id !== pm.id).map((id) => pmsById[id]?.name.split(' ')[0]).join(', ') },
          ]}
          rows={customers}
          initialSort={{ key: 'gapINR', dir: 'desc' }}
          onRowClick={(c) => go('customers', c.code)}
          rowKey={(c) => c.code}
        />
      </section>

      {bench.length > 0 && (
        <section className="card">
          <h2>Bench</h2>
          <BenchTable rows={bench} showCost={can.seeAll} />
        </section>
      )}
    </>
  );
}

export function BenchTable({ rows, showPm, showCost = true }) {
  return (
    <Table
      columns={[
        { key: 'name', label: 'Name', render: (b) => <strong>{b.name}</strong> },
        { key: 'designation', label: 'Role' },
        ...(showPm ? [{ key: 'pmName', label: 'PM' }] : []),
        { key: 'allocPct', label: 'On bench', align: 'right', render: (b) => `${b.allocPct}%` },
        { key: 'experienceYears', label: 'Exp (yrs)', align: 'right' },
        { key: 'skills', label: 'Skills', render: (b) => <span className="skills">{b.skills}</span> },
        { key: 'relievingDate', label: 'Relieving', render: (b) => b.relievingDate || '—' },
        ...(showCost ? [{ key: 'costINR', label: 'Cost / month', align: 'right', render: (b) => inr(b.costINR, { compact: false }) }] : []),
      ]}
      rows={rows}
      initialSort={{ key: showCost ? 'costINR' : 'allocPct', dir: 'desc' }}
      rowKey={(b) => b.empId}
    />
  );
}
