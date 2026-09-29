import React, { useMemo, useState } from 'react';
import { Act, EmailEditor, Modal, mailtoHref, amt, fmtDate, AgePill } from './parts.jsx';
import { buildQueue, draftFor, invoiceStage } from '../engine/reminders.js';
import { ageDays, overdueDays, isOpen } from '../engine/aging.js';
import { addDays } from '../engine/dates.js';

export default function Reminders(ctx) {
  const { data, settings, on, can } = ctx;
  const queue = useMemo(() => buildQueue(data.customers, data.invoices, settings, on), [data, settings, on]);
  const outbox = data.outbox.filter((e) => e.status === 'queued' || e.status === 'failed');
  const sent = data.outbox.filter((e) => e.status === 'sent').sort((a, b) => (b.sentAt || '').localeCompare(a.sentAt || ''));
  const [tab, setTab] = useState('today');
  const ready = queue.filter((q) => !q.blocked);

  return (
    <>
      <div className="infobox">
        Timeline (days since invoice date):{' '}
        {settings.stages.map((s, i) => (
          <span key={s.key}>
            {i > 0 && ' → '}
            <strong>Day {s.day}</strong> {s.label}
          </span>
        ))}
        . PM is copied from Day 16; Nidhi and the customer’s escalation contact from Day 30. One email per customer at a time, at least {settings.minGapDays} days apart.{' '}
        {settings.autoSend.length ? (
          <strong>Auto-send is on for: {settings.autoSend.map((k) => settings.stages.find((s) => s.key === k)?.label).join(', ')}.</strong>
        ) : (
          'Every email waits for your approval.'
        )}
      </div>
      <div className="tabs">
        <button className={tab === 'today' ? 'on' : ''} onClick={() => setTab('today')}>
          Due today {ready.length > 0 && <span className="badge">{ready.length}</span>}
        </button>
        <button className={tab === 'upcoming' ? 'on' : ''} onClick={() => setTab('upcoming')}>
          Coming up (7 days)
        </button>
        <button className={tab === 'outbox' ? 'on' : ''} onClick={() => setTab('outbox')}>
          Outbox {outbox.length > 0 && <span className={`badge ${outbox.some((e) => e.status === 'failed') ? '' : 'good'}`}>{outbox.length}</span>}
        </button>
        <button className={tab === 'sent' ? 'on' : ''} onClick={() => setTab('sent')}>
          Sent log
        </button>
      </div>
      {tab === 'today' && <Today {...ctx} queue={queue} />}
      {tab === 'upcoming' && <Upcoming {...ctx} />}
      {tab === 'outbox' && <Outbox {...ctx} list={outbox} />}
      {tab === 'sent' && <SentLog {...ctx} list={sent} />}
      {!can.edit && <div className="hint">Read-only view.</div>}
    </>
  );
}

function Today(ctx) {
  const { queue, settings, ops, can, focus } = ctx;
  const [edit, setEdit] = useState(null); // { q, draft }
  const ready = queue.filter((q) => !q.blocked);
  const held = queue.filter((q) => q.blocked);
  const queueAll = async () => {
    for (const q of ready) await ops.queueEmail(q.customer, q.due.map((r) => r.inv), draftFor(q, settings));
  };
  return (
    <>
      {ready.length > 0 && can.edit && (
        <div className="toolbar">
          <strong>{ready.length} reminder{ready.length === 1 ? '' : 's'} ready</strong>
          <Act className="primary" onClick={queueAll} confirm={`Approve all ${ready.length} reminders as drafted and put them in the outbox?`}>
            Approve all {ready.length} as drafted
          </Act>
          <span className="hint">Or review them one by one below.</span>
        </div>
      )}
      {!queue.length && <div className="card empty">Nothing due today. 🎉</div>}
      {ready.map((q) => (
        <QueueCard key={q.customer.id} q={q} {...ctx} highlight={focus === q.customer.id} onEdit={() => setEdit({ q, draft: draftFor(q, settings) })} />
      ))}
      {held.length > 0 && (
        <>
          <h3>On hold ({held.length})</h3>
          {held.map((q) => (
            <QueueCard key={q.customer.id} q={q} {...ctx} highlight={focus === q.customer.id} onEdit={() => setEdit({ q, draft: draftFor(q, settings) })} />
          ))}
        </>
      )}
      {edit && <ReviewEmail {...ctx} q={edit.q} draft={edit.draft} onClose={() => setEdit(null)} />}
    </>
  );
}

function QueueCard({ q, on, ops, can, go, onEdit, highlight, settings }) {
  const [skipping, setSkipping] = useState(false);
  const total = q.due.reduce((s, r) => s + r.inv.balance, 0);
  const d = draftFor(q, settings);
  return (
    <div className={`q-card ${q.blocked ? 'blocked' : ''}`} style={highlight ? { outline: '2px solid var(--accent)' } : undefined}>
      <div className="q-head">
        <span className={`stage ${q.stage.tone}`}>
          Day {q.stage.day} · {q.stage.label}
        </span>
        <strong>
          <a onClick={() => go('customers', q.customer.id)}>{q.customer.name}</a>
        </strong>
        <span className="muted">{amt(total)}</span>
        {q.customer.pm && <span className="muted">· PM {q.customer.pm.name}</span>}
        {q.blocked && <span className="flag bad">{q.blocked.text}</span>}
        <span className="spacer" />
        {can.edit && (
          <>
            {q.blocked?.reason === 'no-contact' ? (
              <button className="small" onClick={() => go('customers', q.customer.id)}>
                Add contact
              </button>
            ) : (
              <button className={q.blocked ? 'small' : 'primary'} onClick={onEdit}>
                {q.blocked ? 'Send anyway…' : 'Review & send'}
              </button>
            )}
            <button className="small" onClick={() => setSkipping(true)}>
              Skip
            </button>
          </>
        )}
      </div>
      <ul className="q-inv">
        {q.due.map((r) => (
          <li key={r.inv.id}>
            <strong>{r.inv.number}</strong> {amt(r.inv.balance, r.inv.currency)} <AgePill age={ageDays(r.inv, on)} overdue={overdueDays(r.inv, on)} />
            {r.stage.key !== q.stage.key && <span className="muted">(its own stage: {r.stage.label})</span>}
          </li>
        ))}
      </ul>
      <div className="q-meta">
        To: {d.to.join(', ') || '—'}
        {d.cc.length > 0 && <> · Cc: {d.cc.join(', ')}</>} · <em>{d.subject}</em>
      </div>
      {skipping && <SkipDialog q={q} ops={ops} on={on} onClose={() => setSkipping(false)} />}
    </div>
  );
}

function SkipDialog({ q, ops, on, onClose }) {
  const [mode, setMode] = useState('skip');
  const [date, setDate] = useState(addDays(on, 3));
  const [reason, setReason] = useState('');
  const invs = q.due.map((r) => r.inv);
  return (
    <Modal
      title={`Skip or reschedule: ${q.customer.name}`}
      onClose={onClose}
      footer={
        <Act
          className="primary"
          onClick={async () => {
            if (mode === 'skip') await ops.skipStage(invs, Object.fromEntries(q.due.map((r) => [r.inv.id, r.stage.key])), reason);
            else for (const i of invs) await ops.snooze(i, date, reason);
            onClose();
          }}
        >
          Save
        </Act>
      }
    >
      <div className="stack">
        <label className="check">
          <input type="radio" checked={mode === 'skip'} onChange={() => setMode('skip')} /> Skip this stage ({q.stage.label}); the next stage comes on its own day
        </label>
        <label className="check">
          <input type="radio" checked={mode === 'snooze'} onChange={() => setMode('snooze')} /> Reschedule: hold these invoices until a date
        </label>
        {mode === 'snooze' && (
          <label>
            Hold until
            <input type="date" value={date} min={on} onChange={(e) => setDate(e.target.value)} />
          </label>
        )}
        <label>
          Reason (optional)
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. spoke on call, paying Friday" />
        </label>
      </div>
    </Modal>
  );
}

function ReviewEmail({ q, draft: initial, ops, api, onClose }) {
  const [draft, setDraft] = useState(initial);
  const invs = q.due.map((r) => r.inv);
  const valid = draft.to.length > 0 && draft.subject.trim();
  return (
    <Modal
      title={`${q.stage.label}: ${q.customer.name}`}
      wide
      onClose={onClose}
      footer={
        <>
          <span className="hint" style={{ marginRight: 'auto' }}>
            {api.canSendNow ? 'Queued emails go when you press “Send queued now” in the Outbox.' : 'Queued emails go out automatically within 30 minutes.'} A copy is sent to you.
          </span>
          <a
            className="btn"
            href={mailtoHref(draft)}
            onClick={() => setTimeout(() => window.confirm('Did you send it from your mailbox? Click OK to record it as sent.') && ops.queueEmail(q.customer, invs, draft, { manual: true }).then(onClose), 400)}
          >
            Open in my email
          </a>
          <Act className="primary" disabled={!valid} onClick={async () => (await ops.queueEmail(q.customer, invs, draft), onClose())}>
            Approve & queue
          </Act>
        </>
      }
    >
      {q.blocked && <div className="warnbox" style={{ marginBottom: 10 }}>On hold: {q.blocked.text}. Sending anyway is allowed.</div>}
      <EmailEditor draft={draft} onChange={setDraft} />
    </Modal>
  );
}

function Upcoming({ data, settings, on, byId, go }) {
  const rows = useMemo(() => {
    const out = [];
    for (const inv of data.invoices) {
      if (!isOpen(inv)) continue;
      const s = invoiceStage(inv, settings, on);
      if (s.state === 'waiting' && s.nextOn && s.nextOn > on && s.nextOn <= addDays(on, 7)) out.push({ inv, s });
    }
    return out.sort((a, b) => a.s.nextOn.localeCompare(b.s.nextOn));
  }, [data.invoices, settings, on]);
  if (!rows.length) return <div className="card empty">Nothing scheduled in the next 7 days.</div>;
  return (
    <div className="card">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Stage</th>
              <th>Customer</th>
              <th>Invoice</th>
              <th className="r">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ inv, s }) => (
              <tr key={inv.id} className="click" onClick={() => go('customers', inv.customerId)}>
                <td>{fmtDate(s.nextOn)}</td>
                <td>
                  <span className={`stage ${s.next.tone}`}>{s.next.label}</span>
                </td>
                <td>{byId.customers[inv.customerId]?.name}</td>
                <td>{inv.number}</td>
                <td className="r">{amt(inv.balance, inv.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Outbox({ list, ops, can, api, byId }) {
  const [open, setOpen] = useState(null);
  const [result, setResult] = useState('');
  return (
    <>
      <div className="toolbar">
        {can.edit && api.canSendNow && list.some((e) => e.status === 'queued') && (
          <Act
            className="primary"
            onClick={async () => {
              const r = await ops.sendNow();
              setResult(`Sent ${r.sent}${r.failed ? `, ${r.failed} failed` : ''}.`);
            }}
          >
            Send queued now
          </Act>
        )}
        {!api.canSendNow && <span className="hint">Queued emails are sent by the scheduler every 30 minutes on weekdays.</span>}
        {result && <strong>{result}</strong>}
      </div>
      {!list.length && <div className="card empty">Outbox is empty.</div>}
      {list.map((e) => (
        <div key={e.id} className="q-card">
          <div className="q-head">
            <span className={`flag ${e.status === 'failed' ? 'bad' : 'info'}`}>{e.status}</span>
            <strong>{byId.customers[e.customerId]?.name || e.customerId}</strong>
            <span className="muted">{e.subject}</span>
            {e.auto && <span className="flag">auto</span>}
            <span className="spacer" />
            <button className="small" onClick={() => setOpen(open === e.id ? null : e.id)}>
              {open === e.id ? 'Hide' : 'View'}
            </button>
            {can.edit && (
              <>
                {e.status === 'failed' && <Act onClick={() => ops.retryEmail(e)}>Retry</Act>}
                <a className="btn" href={mailtoHref(e)} title="Send it from your own mailbox instead">
                  Open in email
                </a>
                <Act onClick={() => ops.markEmailSent(e)} title="You sent it yourself">
                  Mark sent
                </Act>
                <Act onClick={() => ops.cancelEmail(e)} confirm="Cancel this email? The reminder goes back to Due today.">
                  Cancel
                </Act>
              </>
            )}
          </div>
          {e.error && <div className="err">{e.error}</div>}
          <div className="q-meta">
            To: {e.to.join(', ')}
            {e.cc?.length > 0 && <> · Cc: {e.cc.join(', ')}</>} · queued {fmtDate(e.createdAt.slice(0, 10))} by {e.createdBy}
            {e.attachments?.length > 0 && <> · 📎 {e.attachments.map((a) => a.name).join(', ')}</>}
          </div>
          {open === e.id && <pre className="mail">{e.body}</pre>}
        </div>
      ))}
    </>
  );
}

function SentLog({ list, byId, settings }) {
  const [open, setOpen] = useState(null);
  const stageLabel = (k) => settings.stages.find((s) => s.key === k)?.label || k;
  if (!list.length) return <div className="card empty">Nothing sent yet.</div>;
  return (
    <div className="card">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Sent</th>
              <th>Customer</th>
              <th>Type</th>
              <th>To / Cc</th>
              <th>Subject</th>
              <th>How</th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, 300).map((e) => (
              <React.Fragment key={e.id}>
                <tr className="click" onClick={() => setOpen(open === e.id ? null : e.id)}>
                  <td>{fmtDate((e.sentAt || '').slice(0, 10))}</td>
                  <td>{byId.customers[e.customerId]?.name || e.customerId}</td>
                  <td>{e.kind === 'tax_invoice' ? 'Tax invoice' : stageLabel(e.stage)}</td>
                  <td className="wrap-cell">
                    {e.to.join(', ')}
                    {e.cc?.length > 0 && <span className="sub">cc {e.cc.join(', ')}</span>}
                  </td>
                  <td className="wrap-cell">{e.subject}</td>
                  <td>{e.sentVia === 'manual' ? 'from mailbox' : e.auto ? 'auto' : 'app'}</td>
                </tr>
                {open === e.id && (
                  <tr>
                    <td colSpan={6}>
                      <pre className="mail">{e.body}</pre>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
