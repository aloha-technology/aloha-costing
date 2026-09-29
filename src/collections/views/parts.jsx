import React, { useEffect, useState } from 'react';
import { bucketOf, BUCKETS } from '../engine/aging.js';
import { amt } from '../engine/money.js';
import { monthLabel, fmtDate } from '../engine/dates.js';

export { amt, fmtDate, monthLabel };

// Aging colour: days since invoice date, shown as days overdue when past due.
export function AgePill({ age, overdue, title }) {
  const b = bucketOf(age);
  return (
    <span className={`age ${b.tone}`} title={title || `${age} days since invoice · ${b.label}`}>
      {overdue > 0 ? `${overdue}d overdue` : age >= 0 ? `day ${age}` : 'future'}
    </span>
  );
}

export function BucketLegend() {
  return (
    <span className="bucket-legend">
      {BUCKETS.map((b) => (
        <span key={b.key}>
          <i className={`dot ${b.tone}`} /> {b.label}
        </span>
      ))}
    </span>
  );
}

const STATUS_TEXT = { open: 'Open', paid: 'Paid', void: 'Void', bad_debt: 'Bad debt', draft: 'Draft' };
export function InvStatus({ inv }) {
  const part = inv.status === 'open' && inv.balance < inv.amount - 0.005;
  return <span className={`status inv-${inv.status}`}>{part ? 'Part-paid' : STATUS_TEXT[inv.status] || inv.status}</span>;
}

export function Prio({ level }) {
  return <span className={`sev ${level}`}>{level}</span>;
}

export function Modal({ title, onClose, children, wide, footer }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="linkish" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// Button that shows progress and errors for an async action.
export function Act({ onClick, children, className = 'small', disabled, title, confirm }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <>
      <button
        className={className}
        title={err || title}
        disabled={disabled || busy}
        onClick={async (e) => {
          e.stopPropagation();
          if (confirm && !window.confirm(confirm)) return;
          setBusy(true);
          setErr('');
          try {
            await onClick();
          } catch (x) {
            setErr(x.message);
            window.alert(x.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? '…' : children}
      </button>
    </>
  );
}

// Editable email: to/cc/subject/body.
export function EmailEditor({ draft, onChange, readOnly }) {
  const set = (k, v) => onChange({ ...draft, [k]: v });
  const list = (v) => v.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  return (
    <div className="email-editor">
      <label>
        To
        <input value={draft.to.join(', ')} onChange={(e) => set('to', list(e.target.value))} readOnly={readOnly} placeholder="billing contact email" />
      </label>
      <label>
        Cc
        <input value={draft.cc.join(', ')} onChange={(e) => set('cc', list(e.target.value))} readOnly={readOnly} />
      </label>
      <label>
        Subject
        <input value={draft.subject} onChange={(e) => set('subject', e.target.value)} readOnly={readOnly} />
      </label>
      <label>
        Message
        <textarea rows={14} value={draft.body} onChange={(e) => set('body', e.target.value)} readOnly={readOnly} />
      </label>
      {draft.attachments?.length > 0 && <div className="muted small-text">Attachment: {draft.attachments.map((a) => a.name).join(', ')}</div>}
    </div>
  );
}

// Opens the user's mail app with the email filled in (no attachments possible this way).
export function mailtoHref(d) {
  const q = new URLSearchParams();
  if (d.cc?.length) q.set('cc', d.cc.join(','));
  q.set('subject', d.subject);
  q.set('body', d.body);
  return `mailto:${d.to.map(encodeURIComponent).join(',')}?${q.toString().replace(/\+/g, '%20')}`;
}

export function Empty({ children }) {
  return <div className="empty small">{children}</div>;
}

export function MultiSelect({ label, options, value, onChange, render = (x) => x }) {
  const [open, setOpen] = useState(false);
  const toggle = (o) => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  return (
    <span className="multi">
      <button className="small" onClick={() => setOpen((x) => !x)} aria-expanded={open}>
        {label}: {value.length ? (value.length > 2 ? `${value.length} selected` : value.map(render).join(', ')) : 'All'} ▾
      </button>
      {open && (
        <div className="multi-pop" onMouseLeave={() => setOpen(false)}>
          <button className="linkish" onClick={() => onChange([])}>
            Clear
          </button>
          {options.map((o) => (
            <label key={o}>
              <input type="checkbox" checked={value.includes(o)} onChange={() => toggle(o)} /> {render(o)}
            </label>
          ))}
        </div>
      )}
    </span>
  );
}

export function FileLink({ api, fileId, children }) {
  return (
    <a
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const url = await api.fileUrl(fileId);
        window.open(url, '_blank', 'noopener');
      }}
      href="#"
    >
      {children}
    </a>
  );
}
