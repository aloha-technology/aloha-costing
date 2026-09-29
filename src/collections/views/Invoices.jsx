import React, { useMemo, useState } from 'react';
import { useInvoiceFilters } from './Dashboard.jsx';
import InvoiceTable from './InvoiceTable.jsx';
import { amt } from './parts.jsx';
import { invoiceStage } from '../engine/reminders.js';

const VIEWS = [
  ['open', 'Open'],
  ['due', 'Reminder due'],
  ['dns', 'Do not send'],
  ['snoozed', 'Rescheduled'],
  ['unconfirmed', 'Not confirmed'],
  ['closed', 'Paid / closed'],
];

export default function Invoices(ctx) {
  const { data, byId, settings, on } = ctx;
  const f = useInvoiceFilters(data, byId);
  const [view, setView] = useState('open');
  const list = useMemo(() => {
    const base = view === 'closed' ? data.invoices.filter((i) => i.status !== 'open' || i.balance <= 0) : f.open;
    return base
      .filter((i) => view === 'closed' || f.test(i, on))
      .filter((i) => {
        if (view === 'due') return invoiceStage(i, settings, on).state === 'due';
        if (view === 'dns') return i.doNotSend;
        if (view === 'snoozed') return i.snoozeUntil && i.snoozeUntil > on;
        if (view === 'unconfirmed') return !i.confirmed;
        return true;
      })
      .sort((a, b) => (view === 'closed' ? b.date.localeCompare(a.date) : 0))
      .slice(0, view === 'closed' ? 300 : undefined);
  }, [view, data.invoices, f, settings, on]);
  const total = list.reduce((s, i) => s + (i.status === 'open' ? i.balance : 0), 0);
  return (
    <>
      <div className="tabs">
        {VIEWS.map(([k, l]) => (
          <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>
            {l}
          </button>
        ))}
      </div>
      {view !== 'closed' && f.bar}
      <div className="card">
        <div className="title-row" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>
            {list.length} invoice{list.length === 1 ? '' : 's'}
            {view !== 'closed' && <span className="muted"> · {amt(total)} pending</span>}
          </h2>
          <span className="hint">Click an invoice for its controls: mark paid, do not send, reschedule, skip a stage, notes.</span>
        </div>
        <InvoiceTable invoices={list} showCustomer {...ctx} empty={view === 'closed' ? 'Nothing here' : 'No invoices match'} />
        {view === 'closed' && <div className="hint">Showing the latest 300.</div>}
      </div>
    </>
  );
}
