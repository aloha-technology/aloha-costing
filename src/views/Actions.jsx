import React, { useMemo, useState } from 'react';
import { inr } from '../format.js';
import { Kpi, Severity, Table } from './ui.jsx';
import { StatusChip, BulkCreate } from './ActionParts.jsx';
import { STATUS_LABEL, isClosed, isOverdue, daysLate, stillFlagged, summarize } from '../actions/logic.js';
import { newActionMessage } from '../whatsapp/messages.js';
import { copyText } from '../whatsapp/useComms.js';

export default function Actions({ model, pmsById, store, comms, focus, setFocus, go, can }) {
  const action = store.actions.find((a) => a.id === focus);
  if (action) return <ActionDetail a={action} model={model} pmsById={pmsById} store={store} comms={comms} can={can} back={() => setFocus('')} go={go} />;
  return <ActionList model={model} pmsById={pmsById} store={store} can={can} open={setFocus} />;
}

function ActionList({ model, pmsById, store, can, open }) {
  const [status, setStatus] = useState('active');
  const [pm, setPm] = useState('');
  const s = summarize(store.actions);
  const allFindings = model.customers.flatMap((c) => c.findings.map((f) => ({ ...f, customer: c })));

  const rows = useMemo(
    () =>
      store.actions.filter(
        (a) =>
          (!pm || a.ownerPmId === pm) &&
          (status === 'all' ||
            (status === 'active' && !isClosed(a)) ||
            (status === 'overdue' && isOverdue(a)) ||
            (status === 'closure' && a.status === 'closure_requested') ||
            (status === 'closed' && isClosed(a)))
      ),
    [store.actions, pm, status]
  );

  const flagText = (a) => {
    const v = stillFlagged(a, model);
    return v == null ? '—' : v ? 'Still flagged' : 'Cleared in data';
  };

  return (
    <>
      <section className="kpis">
        <Kpi label="Open actions" value={s.open} />
        <Kpi label="Overdue" value={s.overdue} tone={s.overdue ? 'bad' : ''} />
        <Kpi label="Due in 7 days" value={s.dueThisWeek} tone={s.dueThisWeek ? 'warn' : ''} />
        <Kpi label="Closed this month" value={s.closedThisMonth} tone="good" />
        {can.seeAll && <Kpi label="Savings in play" value={inr(s.openSavingINR)} note="estimated, per month, open actions" />}
      </section>

      <section className="card">
        <div className="toolbar">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Open & in progress</option>
            <option value="closure">Closure requested</option>
            <option value="overdue">Overdue only</option>
            <option value="closed">Closed & dropped</option>
            <option value="all">All</option>
          </select>
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
          <span className="muted">{rows.length} actions</span>
          <span className="spacer" />
          {can.edit && <BulkCreate findings={allFindings} model={model} store={store} label="Track all critical & high findings" />}
        </div>
        {store.error && <div className="err">{store.error}</div>}
        {store.actions.length === 0 ? (
          <p className="muted">
            {can.edit
              ? 'No actions yet. Open a customer or PM and use “Track as action” on a finding, or track all critical & high findings at once.'
              : 'No actions assigned yet.'}
          </p>
        ) : (
          <Table
            columns={[
              { key: 'dueDate', label: 'Due', render: (a) => a.dueDate },
              { key: 'status', label: 'Status', render: (a) => <StatusChip a={a} />, sort: (a) => (isOverdue(a) ? 100 + daysLate(a) : isClosed(a) ? -1 : 0) },
              { key: 'severity', label: 'Severity', render: (a) => <Severity level={a.severity} />, sort: (a) => ({ critical: 3, high: 2, medium: 1, low: 0 })[a.severity] },
              { key: 'customerName', label: 'Customer', render: (a) => <strong>{a.customerName}</strong> },
              { key: 'title', label: 'Action', render: (a) => <span className="wrap">{a.title}</span> },
              { key: 'owner', label: 'Owner', render: (a) => pmsById[a.ownerPmId]?.name || a.ownerPmId, sort: (a) => pmsById[a.ownerPmId]?.name },
              ...(can.seeAll ? [{ key: 'savingINR', label: 'Est. saving', align: 'right', render: (a) => (a.savingINR ? inr(a.savingINR) : '—') }] : []),
              { key: 'flag', label: 'Latest data', render: flagText, sort: flagText },
            ]}
            rows={rows}
            initialSort={{ key: 'dueDate', dir: 'asc' }}
            onRowClick={(a) => open(a.id)}
            rowKey={(a) => a.id}
          />
        )}
      </section>
    </>
  );
}

function ActionDetail({ a, model, pmsById, store, comms, can, back, go }) {
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState('');
  const [closure, setClosure] = useState('');
  const [closing, setClosing] = useState(null); // 'done' | 'dropped'
  const [err, setErr] = useState(null);
  const flagged = stillFlagged(a, model);
  const customer = model.customers.find((c) => c.code === a.customerCode);
  const owners = customer ? customer.pmIds.filter((id) => pmsById[id]) : [a.ownerPmId];

  const change = async (c) => {
    setErr(null);
    try {
      await store.update(a.id, c);
      return true;
    } catch (e) {
      setErr(e.message);
      return false;
    }
  };

  return (
    <>
      <button className="back" onClick={back}>
        ← All actions
      </button>
      <div className="title-row">
        <h2>{a.title}</h2>
        <StatusChip a={a} />
        <Severity level={a.severity} />
      </div>
      <p className="muted">
        <a onClick={() => go('customers', a.customerCode)}>{a.customerName}</a> · created {a.createdAt.slice(0, 10)} by {a.createdBy}
        {a.period ? ` from ${a.period} data` : ''} · {a.id}
      </p>

      <div className="grid2">
        <section className="card">
          <h2>Details</h2>
          <p>{a.description || <span className="muted">No description.</span>}</p>
          <div className="fields">
            <label>
              Owner
              <select value={a.ownerPmId} disabled={isClosed(a) || !can.edit} onChange={(e) => change({ ownerPmId: e.target.value })}>
                {owners.map((id) => (
                  <option key={id} value={id}>
                    {pmsById[id]?.name || id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Due date (TAT)
              <input type="date" value={a.dueDate} disabled={isClosed(a) || !can.edit} onChange={(e) => e.target.value && change({ dueDate: e.target.value })} />
            </label>
            <div>
              <div className="muted">Original due</div>
              {a.originalDueDate}
              {a.dueDate !== a.originalDueDate && <span className="pill warn"> moved</span>}
            </div>
            {can.seeAll && (
              <div>
                <div className="muted">Est. saving</div>
                {a.savingINR ? `${inr(a.savingINR)} / month` : '—'}
              </div>
            )}
            <div>
              <div className="muted">In latest data</div>
              {flagged == null ? '—' : flagged ? <span className="pill bad">Still flagged</span> : <span className="pill good">No longer flagged</span>}
            </div>
          </div>

          {!isClosed(a) && can.pmUpdate ? (
            <PmButtons a={a} setClosing={setClosing} change={change} />
          ) : !isClosed(a) && can.edit ? (
            <div className="row">
              {a.status === 'open' && (
                <button className="small" onClick={() => change({ status: 'in_progress' })}>
                  Mark in progress
                </button>
              )}
              {a.status === 'closure_requested' && (
                <button className="small" onClick={() => setClosing('in_progress')}>
                  Send back…
                </button>
              )}
              <button className="primary" onClick={() => setClosing('done')}>
                {a.status === 'closure_requested' ? 'Confirm closure…' : 'Close…'}
              </button>
              <button className="small" onClick={() => setClosing('dropped')}>
                Drop…
              </button>
              {pmsById[a.ownerPmId] && (
                <button
                  className="small"
                  onClick={async () => {
                    const msg = newActionMessage(pmsById[a.ownerPmId], a);
                    if (await copyText(msg.text)) {
                      await comms.markSent({ pmId: a.ownerPmId, type: 'action', text: msg.text, actionIds: [a.id] });
                      await store.reload();
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2500);
                    }
                  }}
                >
                  {copied ? 'Copied & logged ✓' : 'Copy WhatsApp message for PM'}
                </button>
              )}
            </div>
          ) : !isClosed(a) ? null : (
            <div className="closed-box">
              <strong>{STATUS_LABEL[a.status]}</strong> on {a.closedAt?.slice(0, 10)}: {a.closureNote}
              {can.edit && (
                <div className="row">
                  <button className="small" onClick={() => change({ status: 'open', note: 'Reopened' })}>
                    Reopen
                  </button>
                </div>
              )}
            </div>
          )}

          {closing && (
            <div className="action-form">
              <label className="wide">
                {CLOSING_PROMPT[closing]}
                <textarea rows={3} value={closure} onChange={(e) => setClosure(e.target.value)} />
              </label>
              {closing === 'done' && flagged && (
                <div className="warnbox">The latest data still flags this issue. Close anyway only if the fix will show in next month's export.</div>
              )}
              <div className="row">
                <button
                  className="primary"
                  onClick={async () => {
                    const payload = closing === 'in_progress' ? { status: 'in_progress', note: `Sent back: ${closure}` } : { status: closing, closureNote: closure };
                    if (closing === 'in_progress' && !closure.trim()) return setErr('Say why it is being sent back.');
                    if (await change(payload)) {
                      setClosing(null);
                      setClosure('');
                    }
                  }}
                >
                  {CLOSING_BUTTON[closing]}
                </button>
                <button className="small" onClick={() => setClosing(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {err && <div className="err">{err}</div>}
        </section>

        <section className="card">
          <h2>History</h2>
          <ul className="timeline">
            {[...a.history].reverse().map((h, i) => (
              <li key={i}>
                <div className="muted">
                  {new Date(h.at).toLocaleString()} · {h.by}
                </div>
                <div>{h.type === 'owner' ? `Owner: ${pmsById[h.from]?.name || h.from} → ${pmsById[h.to]?.name || h.to}` : h.text}</div>
              </li>
            ))}
          </ul>
          {(can.edit || (can.pmUpdate && !isClosed(a))) && <div className="action-form">
            <label className="wide">
              {can.edit ? 'Add a note (PM reply, call outcome, follow-up)' : 'Add an update'}
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="row">
              <button
                className="small"
                disabled={!note.trim()}
                onClick={async () => {
                  if (await change({ note })) setNote('');
                }}
              >
                Add note
              </button>
            </div>
          </div>}
        </section>
      </div>
    </>
  );
}

const CLOSING_PROMPT = {
  done: 'What was done? (required)',
  dropped: 'Why is this being dropped? (required)',
  in_progress: 'Why is it being sent back? (required)',
  closure_requested: 'What was done? Matt will confirm the closure. (required)',
};
const CLOSING_BUTTON = { done: 'Close action', dropped: 'Drop action', in_progress: 'Send back to PM', closure_requested: 'Ask to close' };

// PMs: start work, then ask Matt to close with a note.
function PmButtons({ a, setClosing, change }) {
  return (
    <div className="row">
      {a.status === 'open' && (
        <button className="small" onClick={() => change({ status: 'in_progress' })}>
          Mark in progress
        </button>
      )}
      {a.status !== 'closure_requested' ? (
        <button className="primary" onClick={() => setClosing('closure_requested')}>
          Ask to close…
        </button>
      ) : (
        <span className="muted">Waiting for Matt to confirm closure.</span>
      )}
    </div>
  );
}
