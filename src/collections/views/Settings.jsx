import React, { useState } from 'react';
import { Act } from './parts.jsx';
import { DEFAULT_STAGES } from '../engine/settings.js';
import { fillTemplate } from '../engine/reminders.js';

const SAMPLE = {
  customer: { name: 'Sample Customer Inc', pm: { name: 'Priya (PM)' }, contacts: [{ name: 'Dana Smith', email: 'ap@sample.com', role: 'billing' }] },
  invoices: [{ number: 'APTE -12345', date: '2026-09-01', dueDate: '2026-09-16', balance: 6000, currency: 'USD' }],
};

export default function Settings({ settings, ops, can }) {
  const [s, setS] = useState(settings);
  const [open, setOpen] = useState(null);
  const [saved, setSaved] = useState('');
  const set = (k, v) => (setS((x) => ({ ...x, [k]: v })), setSaved(''));
  const setStage = (key, k, v) => (setS((x) => ({ ...x, stages: x.stages.map((st) => (st.key === key ? { ...st, [k]: v } : st)) })), setSaved(''));
  const toggleAuto = (key) => set('autoSend', s.autoSend.includes(key) ? s.autoSend.filter((k) => k !== key) : [...s.autoSend, key]);
  const esc = s.internalEscalation || [];
  const ro = !can.edit;
  return (
    <>
      <div className="card">
        <h2>Follow-up timeline</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          Day = days since the {s.basis === 'due' ? 'due date' : 'invoice date'}. Only the latest stage reached is sent, so an invoice picked up late gets the right email, not a pile of old ones.
          <strong> Auto-send</strong> lets the scheduler send that stage without your click; leave it off to approve every email yourself.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Stage</th>
                <th>Copy PM</th>
                <th>Copy escalation</th>
                <th>Auto-send</th>
                <th>Subject</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {s.stages.map((st) => (
                <React.Fragment key={st.key}>
                  <tr>
                    <td>
                      <input className="inline-in" type="number" style={{ width: 64 }} value={st.day} disabled={ro} onChange={(e) => setStage(st.key, 'day', Number(e.target.value))} />
                    </td>
                    <td>
                      <input className="inline-in" value={st.label} disabled={ro} onChange={(e) => setStage(st.key, 'label', e.target.value)} />
                    </td>
                    <td>
                      <input type="checkbox" checked={Boolean(st.addPm)} disabled={ro} onChange={(e) => setStage(st.key, 'addPm', e.target.checked)} />
                    </td>
                    <td>
                      <input type="checkbox" checked={Boolean(st.addEscalation)} disabled={ro} onChange={(e) => setStage(st.key, 'addEscalation', e.target.checked)} />
                    </td>
                    <td>
                      <label className="switch">
                        <input type="checkbox" checked={s.autoSend.includes(st.key)} disabled={ro} onChange={() => toggleAuto(st.key)} />
                        <span />
                      </label>
                    </td>
                    <td className="wrap-cell">{st.subject}</td>
                    <td>
                      <button className="linkish" onClick={() => setOpen(open === st.key ? null : st.key)}>
                        {open === st.key ? 'Close' : 'Edit template'}
                      </button>
                    </td>
                  </tr>
                  {open === st.key && (
                    <tr>
                      <td colSpan={7} style={{ whiteSpace: 'normal' }}>
                        <TemplateEditor tpl={st} ro={ro} onChange={(k, v) => setStage(st.key, k, v)} settings={s} reset={DEFAULT_STAGES.find((d) => d.key === st.key)} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h2>Rules</h2>
          <div className="stack">
            <label>
              Count days from
              <select value={s.basis} disabled={ro} onChange={(e) => set('basis', e.target.value)}>
                <option value="invoice">Invoice date (net 15: Day 16 = overdue)</option>
                <option value="due">Due date</option>
              </select>
            </label>
            <label>
              Minimum days between reminders to the same customer
              <input type="number" value={s.minGapDays} disabled={ro} onChange={(e) => set('minGapDays', Number(e.target.value))} />
            </label>
            <label className="check">
              <input type="checkbox" checked={s.holdOnPromise} disabled={ro} onChange={(e) => set('holdOnPromise', e.target.checked)} /> Hold reminders while a promise-to-pay date is in the future
            </label>
            <label>
              On import, park invoices older than (days) as “Do not send”
              <input type="number" value={s.staleDays} disabled={ro} onChange={(e) => set('staleDays', Number(e.target.value))} />
            </label>
          </div>
        </div>
        <div className="card">
          <h2>People</h2>
          <div className="stack">
            <label>
              Sender name
              <input value={s.senderName} disabled={ro} onChange={(e) => set('senderName', e.target.value)} />
            </label>
            <label>
              Sender email (a copy of every email comes here)
              <input value={s.senderEmail} disabled={ro} onChange={(e) => set('senderEmail', e.target.value)} />
            </label>
            <label>
              Signature ([Your Name] in templates)
              <textarea rows={3} value={s.signature} disabled={ro} onChange={(e) => set('signature', e.target.value)} />
            </label>
            <div>
              <div className="muted small-text" style={{ marginBottom: 4 }}>
                Aloha escalation contacts (copied from Day 30)
              </div>
              {esc.map((x, i) => (
                <div className="contact-row" key={i} style={{ gridTemplateColumns: '1fr 1.6fr auto' }}>
                  <input className="inline-in" value={x.name} disabled={ro} onChange={(e) => set('internalEscalation', esc.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} placeholder="Name" />
                  <input className="inline-in" value={x.email} disabled={ro} onChange={(e) => set('internalEscalation', esc.map((y, j) => (j === i ? { ...y, email: e.target.value.trim() } : y)))} placeholder="email@alohatechnology.com" />
                  {!ro && (
                    <button className="linkish" onClick={() => set('internalEscalation', esc.filter((_, j) => j !== i))}>
                      remove
                    </button>
                  )}
                </div>
              ))}
              {!ro && (
                <button className="small" onClick={() => set('internalEscalation', [...esc, { name: '', email: '' }])}>
                  + Add
                </button>
              )}
              {esc.some((x) => !x.email) && <div className="warnbox" style={{ marginTop: 8 }}>Add Nidhi Ma’am’s email so Day 30+ emails copy her.</div>}
            </div>
            <label>
              Always copy (comma-separated, optional)
              <input value={(s.alwaysCc || []).map((x) => (typeof x === 'string' ? x : x.email)).join(', ')} disabled={ro} onChange={(e) => set('alwaysCc', e.target.value.split(/[,;\s]+/).filter(Boolean))} />
            </label>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Tax invoice email</h2>
        <TemplateEditor tpl={s.taxInvoice} ro={ro} onChange={(k, v) => (setS((x) => ({ ...x, taxInvoice: { ...x.taxInvoice, [k]: v } })), setSaved(''))} settings={s} tax />
      </div>

      {can.edit && (
        <div className="toolbar">
          <Act className="primary" onClick={async () => (await ops.saveSettings({ ...s, lastImport: settings.lastImport }), setSaved('Saved.'))}>
            Save settings
          </Act>
          {saved && <span className="good-text">{saved}</span>}
        </div>
      )}
    </>
  );
}

function TemplateEditor({ tpl, onChange, settings, ro, reset, tax }) {
  const preview = fillTemplate(tpl, { ...SAMPLE, settings, extra: { taxInvoiceNo: 'TI/26-27/0123' } });
  return (
    <div className="grid2" style={{ gap: 16, marginTop: 6 }}>
      <div className="stack">
        <label>
          Subject
          <input value={tpl.subject} disabled={ro} onChange={(e) => onChange('subject', e.target.value)} />
        </label>
        <label>
          Message
          <textarea rows={12} value={tpl.body} disabled={ro} onChange={(e) => onChange('body', e.target.value)} style={{ font: '13px/1.5 var(--font)' }} />
        </label>
        <div className="hint">
          Placeholders: [Name] [Invoice #] [Amount] [Due Date] [PM Name] [Your Name] [Customer] [Invoice Table]{tax ? ' [Tax Invoice #]' : ''}. With several invoices, the wording switches to plural and a list of invoices is added.
        </div>
        {reset && !ro && (
          <button className="linkish" onClick={() => (onChange('subject', reset.subject), onChange('body', reset.body))}>
            Reset to Matt’s original template
          </button>
        )}
      </div>
      <div>
        <div className="muted small-text">Preview</div>
        <pre className="mail">
          <strong>{preview.subject}</strong>
          {'\n\n'}
          {preview.body}
        </pre>
      </div>
    </div>
  );
}
