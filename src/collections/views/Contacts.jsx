// Customer contacts with several roles each. One editor and one list, used by Collections and Master data.
import React, { useRef, useState } from 'react';
import { CONTACT_ROLES, ROLE_LABEL, rolesOf, emailsFor } from '../engine/contacts.js';

const blank = () => ({ name: '', title: '', email: '', phone: '', roles: ['billing', 'invoice', 'tax_invoice'] });

export function ContactsEditor({ contacts, onChange }) {
  const list = contacts.length ? contacts : [blank()];
  // Work from the latest list even when several clicks land before the next render.
  const latest = useRef(list);
  latest.current = list;
  const update = (next) => {
    latest.current = next;
    onChange(next);
  };
  const set = (i, k, v) => update(latest.current.map((c, j) => (j === i ? { ...c, roles: rolesOf(c), [k]: v } : c)));
  const toggle = (i, role) => {
    const r = rolesOf(latest.current[i]);
    set(i, 'roles', r.includes(role) ? r.filter((x) => x !== role) : [...r, role]);
  };
  return (
    <div className="contacts-editor">
      {list.map((c, i) => (
        <div key={i} className="contact-card">
          <div className="contact-row" style={{ gridTemplateColumns: '1.1fr 1fr 1.5fr 1fr auto' }}>
            <input className="inline-in" placeholder="Name" value={c.name || ''} onChange={(e) => set(i, 'name', e.target.value)} />
            <input className="inline-in" placeholder="Title (AP, CFO, CTO…)" value={c.title || ''} onChange={(e) => set(i, 'title', e.target.value)} />
            <input className="inline-in" placeholder="email@customer.com" value={c.email || ''} onChange={(e) => set(i, 'email', e.target.value)} />
            <input className="inline-in" placeholder="Phone" value={c.phone || ''} onChange={(e) => set(i, 'phone', e.target.value)} />
            <button className="linkish" onClick={() => update(latest.current.filter((_, j) => j !== i))}>
              remove
            </button>
          </div>
          <div className="role-chips">
            {CONTACT_ROLES.map((r) => (
              <button key={r.key} type="button" className={`role-chip ${rolesOf(c).includes(r.key) ? 'on' : ''}`} title={r.hint} onClick={() => toggle(i, r.key)}>
                {rolesOf(c).includes(r.key) ? '✓ ' : ''}
                {r.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <button className="small" onClick={() => update([...latest.current, blank()])}>
        + Add contact
      </button>
      <p className="hint">Tick every role that applies. Several people can share a role, e.g. three people who receive invoices.</p>
    </div>
  );
}

export function ContactsList({ customer, compact }) {
  const contacts = customer.contacts || [];
  if (!contacts.length) return <div className="muted">No contacts yet.</div>;
  return (
    <>
      <div className="table-wrap">
        <table>
          <tbody>
            {contacts.map((c, i) => (
              <tr key={i}>
                <td className="wrap-cell">
                  <strong>{c.name || '—'}</strong>
                  <span className="sub">{c.title || ''}</span>
                </td>
                <td className="wrap-cell">
                  {c.email || <span className="muted">no email</span>}
                  <span className="sub">{c.phone || (compact ? '' : 'no phone')}</span>
                </td>
                <td className="wrap-cell">
                  {rolesOf(c).map((r) => (
                    <span key={r} className="flag info">
                      {ROLE_LABEL[r] || r}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!compact && <SendTo customer={customer} />}
    </>
  );
}

// Who gets what, with a copy button (e.g. to paste into Zoho when sending the monthly invoice).
export function SendTo({ customer }) {
  const [copied, setCopied] = useState('');
  const rows = [
    ['invoice', 'Invoices go to'],
    ['tax_invoice', 'Tax invoices go to'],
    ['billing', 'Payment reminders go to'],
  ].map(([role, label]) => ({ role, label, emails: emailsFor(customer, role) }));
  return (
    <div className="send-to">
      {rows.map((r) => (
        <div key={r.role}>
          <span className="muted">{r.label}:</span> {r.emails.length ? r.emails.join(', ') : <span className="flag warn">nobody</span>}
          {r.emails.length > 0 && (
            <button
              className="linkish"
              style={{ marginLeft: 6 }}
              onClick={() => navigator.clipboard?.writeText(r.emails.join(', ')).then(() => (setCopied(r.role), setTimeout(() => setCopied(''), 1500)))}
            >
              {copied === r.role ? 'copied' : 'copy'}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
