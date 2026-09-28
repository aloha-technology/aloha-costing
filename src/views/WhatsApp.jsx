import React, { useState } from 'react';
import { weeklyDigest, overdueAlert, waChatLink, isGroupLink } from '../whatsapp/messages.js';
import { copyText } from '../whatsapp/useComms.js';
import { daysBetween, today } from '../actions/logic.js';

export default function WhatsApp({ model, store, comms, focus, setFocus, go }) {
  const [mode, setMode] = useState('digest');
  const on = today();
  const pms = model.pms
    .filter((p) => p.customers)
    .filter((p) => !focus || p.id === focus)
    .map((pm) => ({ pm, msg: mode === 'digest' ? weeklyDigest(pm, model, store.actions, { on }) : overdueAlert(pm, store.actions, { on }) }))
    .filter((x) => x.msg)
    .sort((a, b) => (b.msg.counts.overdue || 0) - (a.msg.counts.overdue || 0) || a.pm.name.localeCompare(b.pm.name));

  const sentThisWeek = model.pms.filter((p) => {
    const l = comms.lastSent(p.id, 'digest');
    return l && daysBetween(l.at.slice(0, 10), on) < 7;
  }).length;

  return (
    <>
      <section className="card">
        <div className="toolbar">
          <div className="seg">
            <button className={mode === 'digest' ? 'on' : ''} onClick={() => setMode('digest')}>
              Weekly digest
            </button>
            <button className={mode === 'overdue' ? 'on' : ''} onClick={() => setMode('overdue')}>
              Overdue alerts
            </button>
          </div>
          {focus && (
            <button className="small" onClick={() => setFocus('')}>
              Show all PMs
            </button>
          )}
          <span className="muted">
            {mode === 'digest'
              ? `Digests sent in the last 7 days: ${sentThisWeek} / ${model.pms.filter((p) => p.customers).length}`
              : `${pms.length} ${pms.length === 1 ? 'PM' : 'PMs'} with overdue actions`}
          </span>
        </div>
        <p className="muted">
          Copy the message and paste it into the PM's WhatsApp group, then click <strong>Mark as sent</strong> so it's logged against each action. Messages
          never include salaries or anyone's individual cost.
        </p>
        {comms.error && <div className="err">{comms.error}</div>}
      </section>

      {pms.length === 0 && <p className="muted empty">{mode === 'overdue' ? 'No overdue actions. 🎉' : 'No PMs to message.'}</p>}

      <div className="wa-grid">
        {pms.map(({ pm, msg }) => (
          <PmCard key={pm.id} pm={pm} msg={msg} type={mode} comms={comms} store={store} go={go} on={on} />
        ))}
      </div>
    </>
  );
}

function PmCard({ pm, msg, type, comms, store, go, on }) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const contact = comms.contacts[pm.id] || {};
  const last = comms.lastSent(pm.id, type);
  const daysSince = last ? daysBetween(last.at.slice(0, 10), on) : null;
  const due = type === 'digest' && (daysSince == null || daysSince >= 7);
  const chat = waChatLink(contact.whatsapp, msg.text);

  const copy = async () => {
    if (await copyText(msg.text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  const markSent = async () => {
    setBusy(true);
    try {
      await comms.markSent({ pmId: pm.id, type, text: msg.text, actionIds: msg.actionIds });
      await store.reload(); // actions got a "sent" note in their history
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card wa-card">
      <div className="wa-head">
        <div>
          <a onClick={() => go('pms', pm.id)}>
            <strong>{pm.name}</strong>
          </a>
          <div className="muted small-text">
            {type === 'digest'
              ? `${msg.counts.below} below target · ${msg.counts.open} open · ${msg.counts.overdue} overdue`
              : `${msg.counts.overdue} overdue`}
          </div>
        </div>
        <div className="wa-last">
          {due && <span className="pill warn">{last ? 'Digest due' : 'Never sent'}</span>}
          {last && <div className="muted small-text">Last sent {daysSince === 0 ? 'today' : `${daysSince}d ago`}</div>}
        </div>
      </div>

      <pre className="wa-msg">{msg.text}</pre>

      <div className="row">
        <button className="primary" onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy message'}
        </button>
        {isGroupLink(contact.groupLink) && (
          <a className="btn" href={contact.groupLink} target="_blank" rel="noreferrer">
            Open group
          </a>
        )}
        {chat && (
          <a className="btn" href={chat} target="_blank" rel="noreferrer">
            Open chat with {pm.name.split(' ')[0]}
          </a>
        )}
        <button className="small" disabled={busy} onClick={markSent}>
          Mark as sent
        </button>
        <span className="spacer" />
        <button className="linkish" onClick={() => setEditing((e) => !e)}>
          {contact.whatsapp || contact.groupLink ? 'Edit contact' : '+ Add WhatsApp contact'}
        </button>
      </div>
      {editing && <ContactForm pm={pm} contact={contact} comms={comms} done={() => setEditing(false)} />}
    </section>
  );
}

function ContactForm({ pm, contact, comms, done }) {
  const [whatsapp, setWhatsapp] = useState(contact.whatsapp || '');
  const [groupLink, setGroupLink] = useState(contact.groupLink || '');
  const [err, setErr] = useState(null);
  const save = async () => {
    if (groupLink && !isGroupLink(groupLink)) return setErr('Group link should look like https://chat.whatsapp.com/…');
    try {
      await comms.saveContact(pm.id, { whatsapp, groupLink });
      done();
    } catch (e) {
      setErr(e.message);
    }
  };
  return (
    <div className="action-form">
      <label>
        WhatsApp number (with country code)
        <input value={whatsapp} placeholder="+91 98xxxxxxxx" onChange={(e) => setWhatsapp(e.target.value)} />
      </label>
      <label className="grow">
        Group invite link
        <input value={groupLink} placeholder="https://chat.whatsapp.com/…" onChange={(e) => setGroupLink(e.target.value)} />
      </label>
      {err && <div className="err">{err}</div>}
      <div className="row">
        <button className="primary" onClick={save}>
          Save
        </button>
        <button className="small" onClick={done}>
          Cancel
        </button>
      </div>
    </div>
  );
}
