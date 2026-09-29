// Invoice list with a drawer of controls per invoice (used on Invoices and on a customer's page).
import React, { useState } from 'react';
import { AgePill, InvStatus, Act, amt, fmtDate, monthLabel, Modal } from './parts.jsx';
import { ageDays, overdueDays, isOpen } from '../engine/aging.js';
import { invoiceStage } from '../engine/reminders.js';
import { addDays } from '../engine/dates.js';

const STATE_TEXT = {
  due: (s) => <span className="flag warn">{s.stage.label} due today</span>,
  waiting: (s) => (s.next ? <span className="flag">Next: {s.next.label} on {fmtDate(s.nextOn)}</span> : null),
  'do-not-send': () => <span className="flag bad">Do not send</span>,
  snoozed: (s) => <span className="flag info">Rescheduled to {fmtDate(s.until)}</span>,
  finished: () => <span className="flag bad">Timeline finished: call / escalate</span>,
  closed: () => null,
};

export function ReminderState({ inv, settings, on }) {
  const s = invoiceStage(inv, settings, on);
  return STATE_TEXT[s.state]?.(s) || null;
}

export default function InvoiceTable({ invoices, showCustomer, byId, settings, on, ops, can, go, empty = 'No invoices' }) {
  const [openId, setOpenId] = useState(null);
  if (!invoices.length) return <div className="empty small">{empty}</div>;
  const sorted = [...invoices].sort((a, b) => isOpen(b) - isOpen(a) || (isOpen(a) ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)));
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {showCustomer && <th>Customer</th>}
            <th>Invoice</th>
            <th>Month</th>
            <th>Due</th>
            <th>Age</th>
            <th className="r">Amount</th>
            <th className="r">Balance</th>
            <th>Status / next reminder</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((inv) => {
            const c = byId.customers[inv.customerId];
            const open = openId === inv.id;
            return (
              <React.Fragment key={inv.id}>
                <tr className="click" onClick={() => setOpenId(open ? null : inv.id)}>
                  {showCustomer && (
                    <td className="wrap-cell">
                      <a onClick={(e) => (e.stopPropagation(), go('customers', inv.customerId))}>{c?.name || inv.customerId}</a>
                      <span className="sub">{c?.pm?.name || 'No PM'}</span>
                    </td>
                  )}
                  <td>
                    <strong>{inv.number}</strong>
                    {!inv.confirmed && isOpen(inv) && <span className="flag warn">not confirmed</span>}
                    <span className="sub">{fmtDate(inv.date)}</span>
                  </td>
                  <td>{monthLabel(inv.period)}</td>
                  <td>{fmtDate(inv.dueDate)}</td>
                  <td>{isOpen(inv) ? <AgePill age={ageDays(inv, on)} overdue={overdueDays(inv, on)} /> : ''}</td>
                  <td className="r">{amt(inv.amount, inv.currency)}</td>
                  <td className="r">
                    <strong>{isOpen(inv) ? amt(inv.balance, inv.currency) : '—'}</strong>
                  </td>
                  <td>
                    <InvStatus inv={inv} /> <ReminderState inv={inv} settings={settings} on={on} />
                    {(inv.notes || []).length > 0 && <span className="flag" title={inv.notes[inv.notes.length - 1].text}>✎ {inv.notes.length}</span>}
                  </td>
                </tr>
                {open && (
                  <tr className="drawer">
                    <td colSpan={showCustomer ? 8 : 7}>
                      <InvoiceDrawer inv={inv} settings={settings} on={on} ops={ops} can={can} go={go} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function InvoiceDrawer({ inv, settings, on, ops, can, go }) {
  const [noteText, setNote] = useState('');
  const [dialog, setDialog] = useState(null);
  const st = invoiceStage(inv, settings, on);
  const stageLabel = (k) => settings.stages.find((s) => s.key === k)?.label || k;
  return (
    <div className="drawer-body" style={{ whiteSpace: 'normal' }}>
      {can.edit && (
        <div className="row" style={{ marginTop: 0 }}>
          {isOpen(inv) && (
            <button className="primary" onClick={() => go('payments', `new:${inv.customerId}:${inv.id}`)}>
              Mark paid / record payment
            </button>
          )}
          {isOpen(inv) &&
            (inv.doNotSend ? (
              <Act onClick={() => ops.setDoNotSend(inv, false)}>Switch reminders back on</Act>
            ) : (
              <button className="small" onClick={() => setDialog('dns')}>
                Do not send
              </button>
            ))}
          {isOpen(inv) && (
            <button className="small" onClick={() => setDialog('snooze')}>
              {inv.snoozeUntil ? 'Change reschedule' : 'Reschedule reminders'}
            </button>
          )}
          {st.state === 'due' && (
            <button className="small" onClick={() => setDialog('skip')}>
              Skip “{st.stage.label}”
            </button>
          )}
          {!inv.confirmed && <Act onClick={() => ops.confirmInvoices([inv])}>Confirm invoice</Act>}
          {isOpen(inv) && (
            <button className="small" onClick={() => setDialog('status')}>
              Bad debt / void…
            </button>
          )}
          {!isOpen(inv) && inv.status !== 'paid' && <Act onClick={() => ops.setStatus(inv, 'open', 'Reopened')}>Reopen</Act>}
        </div>
      )}
      <div className="grid2" style={{ marginTop: 12, gap: 20 }}>
        <div>
          <h3 style={{ marginTop: 0 }}>Reminders</h3>
          <ul className="activity">
            {(inv.reminders || []).map((r, i) => (
              <li key={i}>
                <span className="when">{fmtDate(r.at?.slice(0, 10))}</span> {stageLabel(r.stage)}: <strong>{r.action}</strong>
                {r.note ? ` (${r.note})` : ''} {r.by ? <span className="muted">· {r.by}</span> : null}
              </li>
            ))}
            {st.next && isOpen(inv) && (
              <li className="muted">
                Next: {st.next.label} on {fmtDate(st.nextOn)}
              </li>
            )}
            {!(inv.reminders || []).length && !st.next && <li className="muted">None yet</li>}
          </ul>
          {inv.doNotSendReason && <div className="hint">Do not send: {inv.doNotSendReason}</div>}
          {(inv.payments || []).length > 0 && (
            <>
              <h3>Payments</h3>
              <ul className="activity">
                {inv.payments.map((p) => (
                  <li key={p.paymentId}>
                    <span className="when">{fmtDate(p.date)}</span> {amt(p.amount, inv.currency)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div>
          <h3 style={{ marginTop: 0 }}>Notes</h3>
          <ul className="activity">
            {(inv.notes || []).map((n, i) => (
              <li key={i}>
                <span className="when">
                  {fmtDate(n.at?.slice(0, 10))} · {n.by}
                </span>
                <div>{n.text}</div>
              </li>
            ))}
            {!(inv.notes || []).length && <li className="muted">No notes</li>}
          </ul>
          {can.edit && (
            <div className="row">
              <input className="inline-in" style={{ flex: 1, minWidth: 200 }} placeholder="Add a note (call outcome, promise, dispute…)" value={noteText} onChange={(e) => setNote(e.target.value)} />
              <Act disabled={!noteText.trim()} onClick={async () => (await ops.addInvoiceNote(inv, noteText.trim()), setNote(''))}>
                Add note
              </Act>
            </div>
          )}
        </div>
      </div>
      {dialog && <ControlDialog kind={dialog} inv={inv} st={st} on={on} ops={ops} onClose={() => setDialog(null)} />}
    </div>
  );
}

function ControlDialog({ kind, inv, st, on, ops, onClose }) {
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(inv.snoozeUntil || addDays(on, 7));
  const [status, setStatus] = useState('bad_debt');
  const titles = { dns: `Do not send: ${inv.number}`, snooze: `Reschedule reminders: ${inv.number}`, skip: `Skip “${st.stage?.label}”: ${inv.number}`, status: `Close ${inv.number} without payment` };
  const run = {
    dns: () => ops.setDoNotSend(inv, true, reason),
    snooze: () => ops.snooze(inv, date, reason),
    skip: () => ops.skipStage([inv], { [inv.id]: st.stage.key }, reason),
    status: () => ops.setStatus(inv, status, reason),
  };
  return (
    <Modal
      title={titles[kind]}
      onClose={onClose}
      footer={
        <>
          {kind === 'snooze' && inv.snoozeUntil && (
            <Act onClick={async () => (await ops.snooze(inv, null, ''), onClose())}>Clear reschedule</Act>
          )}
          <button className="small" onClick={onClose}>
            Cancel
          </button>
          <Act className="primary" disabled={(kind === 'dns' || kind === 'status') && !reason.trim()} onClick={async () => (await run[kind](), onClose())}>
            Save
          </Act>
        </>
      }
    >
      <div className="stack">
        {kind === 'snooze' && (
          <>
            <p className="hint" style={{ margin: 0 }}>
              No reminder goes for this invoice before this date. The timeline then continues from where it is.
            </p>
            <label>
              Hold reminders until
              <input type="date" value={date} min={on} onChange={(e) => setDate(e.target.value)} />
            </label>
          </>
        )}
        {kind === 'skip' && (
          <p className="hint" style={{ margin: 0 }}>
            This stage will not be sent for this invoice. The next stage follows on its own day.
          </p>
        )}
        {kind === 'dns' && (
          <p className="hint" style={{ margin: 0 }}>
            Stops all reminders for this invoice until you switch them back on. It stays in the pending totals.
          </p>
        )}
        {kind === 'status' && (
          <label>
            New status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="bad_debt">Bad debt (written off)</option>
              <option value="void">Void (cancelled invoice)</option>
            </select>
          </label>
        )}
        <label>
          {kind === 'dns' || kind === 'status' ? 'Reason (required)' : 'Reason (optional)'}
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === 'dns' ? 'e.g. disputed, PM handling directly' : 'e.g. customer asked to wait for month-end'} />
        </label>
      </div>
    </Modal>
  );
}
