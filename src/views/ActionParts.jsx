import React, { useState } from 'react';
import { STATUS_LABEL, isOverdue, daysLate, isClosed } from '../actions/logic.js';
import { actionFromFinding, defaultOwner } from '../actions/fromFinding.js';

export { actionFromFinding };

export function StatusChip({ a }) {
  const late = isOverdue(a);
  return (
    <span className={`status ${a.status} ${late ? 'late' : ''}`}>
      {late ? `Overdue ${daysLate(a)}d` : STATUS_LABEL[a.status]}
    </span>
  );
}

// Badge next to a finding: shows the tracked action, or a button to create one.
export function FindingAction({ finding, customer, model, pmsById, store, go, can }) {
  const [open, setOpen] = useState(false);
  const existing = store.byFinding.get(finding.id);
  if (!can.edit && (!existing || isClosed(existing))) return null;
  if (existing && !isClosed(existing)) {
    return (
      <div className="fa">
        <StatusChip a={existing} /> <span className="muted">due {existing.dueDate} · {pmsById[existing.ownerPmId]?.name}</span>{' '}
        <a onClick={() => go('actions', existing.id)}>Open action</a>
      </div>
    );
  }
  if (!open) {
    return (
      <div className="fa">
        {existing && (
          <span className="muted">
            Previously <StatusChip a={existing} /> ·{' '}
          </span>
        )}
        <button className="small" onClick={() => setOpen(true)}>
          + Track as action
        </button>
      </div>
    );
  }
  return <ActionForm finding={finding} customer={customer} model={model} pmsById={pmsById} store={store} onDone={() => setOpen(false)} />;
}

function ActionForm({ finding, customer, model, pmsById, store, onDone }) {
  const [draft, setDraft] = useState(() => actionFromFinding(finding, customer, model));
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const owners = [...new Set([...finding.ownerPmIds, ...customer.pmIds])].filter((id) => pmsById[id]);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await store.create([draft]);
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="action-form">
      <label>
        Owner
        <select value={draft.ownerPmId} onChange={set('ownerPmId')}>
          {owners.map((id) => (
            <option key={id} value={id}>
              {pmsById[id].name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Due (TAT)
        <input type="date" value={draft.dueDate} onChange={set('dueDate')} />
      </label>
      <label className="wide">
        One-line ask (shown in WhatsApp lists)
        <input value={draft.ask} onChange={set('ask')} />
      </label>
      <label className="wide">
        What the PM should do (goes to the PM — no salaries)
        <textarea rows={3} value={draft.description} onChange={set('description')} />
      </label>
      {err && <div className="err">{err}</div>}
      <div className="row">
        <button className="primary" disabled={busy} onClick={save}>
          Create action
        </button>
        <button className="small" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// Create actions for every untracked finding at or above a severity.
// findings need a .customer; with forPmId only those this PM would own by default are included.
export function BulkCreate({ findings, model, store, forPmId, label }) {
  const [msg, setMsg] = useState(null);
  const untracked = findings.filter((f) => {
    const a = store.byFinding.get(f.id);
    return (
      (!a || isClosed(a)) &&
      (f.severity === 'critical' || f.severity === 'high') &&
      (!forPmId || defaultOwner(f, f.customer) === forPmId)
    );
  });
  if (!untracked.length) return msg ? <span className="muted">{msg}</span> : null;
  const run = async () => {
    if (!confirm(`Create ${untracked.length} actions (critical & high) with default TATs?`)) return;
    try {
      const created = await store.create(untracked.map((f) => actionFromFinding(f, f.customer, model)));
      setMsg(`Created ${created.length} actions.`);
    } catch (e) {
      setMsg(e.message);
    }
  };
  return (
    <button className="primary" onClick={run}>
      {label || 'Track all critical & high'} ({untracked.length})
    </button>
  );
}
