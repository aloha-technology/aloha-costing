import React, { useMemo, useState } from 'react';
import { Kpi, Table } from '../../views/ui.jsx';
import { AgePill, BucketLegend, MultiSelect, amt, monthLabel, Prio } from './parts.jsx';
import { BUCKETS, bucketOf, ageDays, overdueDays, isOpen } from '../engine/aging.js';
import { buildQueue } from '../engine/reminders.js';
import { monthOf } from '../engine/dates.js';

// Filters shared by Dashboard and Invoices.
export function useInvoiceFilters(data, byId) {
  const [pms, setPms] = useState([]);
  const [months, setMonths] = useState([]);
  const [bucket, setBucket] = useState('');
  const [q, setQ] = useState('');
  const open = useMemo(() => data.invoices.filter(isOpen), [data.invoices]);
  const pmOf = (inv) => byId.customers[inv.customerId]?.pm?.name || 'No PM';
  const allPms = useMemo(() => [...new Set(open.map(pmOf))].sort(), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const allMonths = useMemo(() => [...new Set(open.map((i) => i.period || monthOf(i.date)))].sort().reverse(), [open]);
  const test = (inv, on, { ignoreBucket = false } = {}) => {
    if (pms.length && !pms.includes(pmOf(inv))) return false;
    if (months.length && !months.includes(inv.period)) return false;
    if (bucket && !ignoreBucket && bucketOf(ageDays(inv, on)).key !== bucket) return false;
    if (q) {
      const c = byId.customers[inv.customerId];
      const hay = `${c?.name} ${inv.number} ${c?.billingCode || ''}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  };
  const bar = (
    <div className="toolbar">
      <input type="text" placeholder="Search customer, invoice or billing code" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 260 }} />
      <MultiSelect label="PM" options={allPms} value={pms} onChange={setPms} />
      <MultiSelect label="Month" options={allMonths} value={months} onChange={setMonths} render={monthLabel} />
      <select value={bucket} onChange={(e) => setBucket(e.target.value)} aria-label="Aging bucket">
        <option value="">All ages</option>
        {BUCKETS.map((b) => (
          <option key={b.key} value={b.key}>
            {b.label}
          </option>
        ))}
      </select>
      {(pms.length || months.length || bucket || q) && (
        <button className="linkish" onClick={() => (setPms([]), setMonths([]), setBucket(''), setQ(''))}>
          Clear filters
        </button>
      )}
    </div>
  );
  return { open, test, bar, bucket, setBucket, pmOf };
}

export default function Dashboard({ data, byId, summaries, settings, on, go }) {
  const f = useInvoiceFilters(data, byId);
  const shown = useMemo(() => f.open.filter((i) => f.test(i, on)), [f, on]);
  const total = shown.reduce((s, i) => s + i.balance, 0);
  const overdue = shown.filter((i) => overdueDays(i, on) > 0);
  const monthStart = on.slice(0, 7);
  const collected = data.payments.filter((p) => p.date?.startsWith(monthStart)).reduce((s, p) => s + (p.settled || 0), 0);
  const queue = useMemo(() => buildQueue(data.customers, data.invoices, settings, on), [data, settings, on]);
  const ready = queue.filter((x) => !x.blocked).length;

  // Bucket totals ignore the bucket filter itself so the strip always shows all six.
  const bucketTotals = useMemo(() => {
    const base = f.open.filter((i) => f.test(i, on, { ignoreBucket: true }));
    return BUCKETS.map((b) => {
      const list = base.filter((i) => bucketOf(ageDays(i, on)).key === b.key);
      return { ...b, count: list.length, amount: list.reduce((s, i) => s + i.balance, 0) };
    });
  }, [f, on]);

  const sumById = Object.fromEntries(summaries.map((s) => [s.customer.id, s]));
  const rows = useMemo(() => {
    const by = {};
    for (const i of shown) (by[i.customerId] ||= []).push(i);
    return Object.entries(by).map(([id, invs]) => {
      const s = sumById[id];
      const maxAge = Math.max(...invs.map((i) => ageDays(i, on)));
      return {
        id,
        name: byId.customers[id]?.name || id,
        pm: byId.customers[id]?.pm?.name || '—',
        count: invs.length,
        months: [...new Set(invs.map((i) => i.period))].sort(),
        amount: invs.reduce((x, i) => x + i.balance, 0),
        maxAge,
        maxOverdue: Math.max(...invs.map((i) => overdueDays(i, on))),
        action: s?.actions?.[0],
        comment: byId.customers[id]?.comment || '',
      };
    });
  }, [shown, on]); // eslint-disable-line react-hooks/exhaustive-deps

  const group = (key) => {
    const by = {};
    for (const i of shown) {
      const k = key(i);
      const g = (by[k] ||= { k, count: 0, amount: 0, customers: new Set(), maxAge: 0 });
      g.count++;
      g.amount += i.balance;
      g.customers.add(i.customerId);
      g.maxAge = Math.max(g.maxAge, ageDays(i, on));
    }
    return Object.values(by).map((g) => ({ ...g, customers: g.customers.size }));
  };
  const byPm = group(f.pmOf);
  const byMonth = group((i) => i.period);

  return (
    <>
      <div className="kpis">
        <Kpi label="Outstanding" value={amt(total)} note={`${shown.length} open invoices`} />
        <Kpi label="Overdue" value={amt(overdue.reduce((s, i) => s + i.balance, 0))} note={`${overdue.length} invoices past due date`} tone="bad" />
        <Kpi label="Customers with dues" value={new Set(shown.map((i) => i.customerId)).size} />
        <Kpi label="Reminders ready today" value={ready} note={`${queue.length - ready} on hold`} tone={ready ? 'warn' : 'good'} />
        <Kpi label="Collected this month" value={amt(collected)} note="recorded in Payments" tone="good" />
      </div>
      {f.bar}

      <div className="card">
        <div className="title-row" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Aging</h2>
          <span className="hint">Days since invoice date (net 15: day 16 = first day overdue). Click a bucket to filter.</span>
        </div>
        <div className="agebar">
          {bucketTotals.map((b) => (
            <button key={b.key} className={`${b.tone} ${f.bucket === b.key ? 'on' : ''}`} onClick={() => f.setBucket(f.bucket === b.key ? '' : b.key)}>
              <div className="ab-label">{b.label}</div>
              <div className="ab-amt">{amt(b.amount)}</div>
              <div className="ab-n">
                {b.count} invoice{b.count === 1 ? '' : 's'}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="title-row" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>Pending by customer</h2>
          <BucketLegend />
        </div>
        <Table
          rowKey={(r) => r.id}
          onRowClick={(r) => go('customers', r.id)}
          initialSort={{ key: 'amount', dir: 'desc' }}
          columns={[
            { key: 'name', label: 'Customer', render: (r) => <span className="wrap-cell">{r.name}</span> },
            { key: 'pm', label: 'PM' },
            { key: 'count', label: 'Invoices', align: 'right' },
            { key: 'months', label: 'Months', sort: (r) => r.months[0], render: (r) => <span className="wrap-cell">{r.months.map((m) => <span className="month-chip" key={m}>{monthLabel(m)}</span>)}</span> },
            { key: 'maxAge', label: 'Oldest', render: (r) => <AgePill age={r.maxAge} overdue={r.maxOverdue} /> },
            { key: 'amount', label: 'Pending', align: 'right', render: (r) => <strong>{amt(r.amount)}</strong> },
            {
              key: 'action',
              label: 'Suggested next action',
              sort: (r) => ['critical', 'high', 'medium', 'low'].indexOf(r.action?.priority ?? 'low'),
              render: (r) =>
                r.action ? (
                  <span className="wrap-cell" style={{ display: 'inline-block', minWidth: 260 }}>
                    <Prio level={r.action.priority} /> {r.action.text}
                  </span>
                ) : (
                  ''
                ),
            },
          ]}
          rows={rows}
        />
      </div>

      <div className="grid2">
        <div className="card">
          <h2>By PM</h2>
          <Table
            rowKey={(r) => r.k}
            initialSort={{ key: 'amount', dir: 'desc' }}
            columns={[
              { key: 'k', label: 'PM' },
              { key: 'customers', label: 'Customers', align: 'right' },
              { key: 'count', label: 'Invoices', align: 'right' },
              { key: 'maxAge', label: 'Oldest', render: (r) => <AgePill age={r.maxAge} overdue={Math.max(0, r.maxAge - 15)} /> },
              { key: 'amount', label: 'Pending', align: 'right', render: (r) => amt(r.amount) },
            ]}
            rows={byPm}
          />
        </div>
        <div className="card">
          <h2>By billing month</h2>
          <Table
            rowKey={(r) => r.k}
            initialSort={{ key: 'k', dir: 'desc' }}
            columns={[
              { key: 'k', label: 'Month', render: (r) => monthLabel(r.k) },
              { key: 'customers', label: 'Customers', align: 'right' },
              { key: 'count', label: 'Invoices', align: 'right' },
              { key: 'amount', label: 'Pending', align: 'right', render: (r) => amt(r.amount) },
            ]}
            rows={byMonth}
          />
        </div>
      </div>
    </>
  );
}
