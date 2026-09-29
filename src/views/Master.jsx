import React, { useCallback, useEffect, useState } from 'react';
import { usd, pct } from '../format.js';
import { rateCard, DEFAULT_SETTINGS, REVIEW_LABEL } from '../engine/ratecard.js';
import { toISODate } from '../actions/logic.js';

// Customer master data: profiles (brief, technologies, teams), rate cards and settings.
// Matt edits; leadership reads; PMs read profiles of their own customers only.
export function useMaster(api) {
  const [state, setState] = useState({ profiles: {}, rates: {}, settings: DEFAULT_SETTINGS, loaded: false, error: null });
  useEffect(() => {
    if (!api?.getMaster) return;
    api
      .getMaster()
      .then((m) => setState({ profiles: m.profiles || {}, rates: m.rates || {}, settings: { ...DEFAULT_SETTINGS, ...(m.settings || {}) }, loaded: true, error: null }))
      .catch((e) => setState((s) => ({ ...s, loaded: true, error: e.message })));
  }, [api]);

  const saveProfile = useCallback(
    async (code, p) => {
      const saved = await api.saveProfile(code, p);
      setState((s) => ({ ...s, profiles: { ...s.profiles, [code]: { ...p, ...saved } } }));
    },
    [api]
  );
  const saveRates = useCallback(
    async (code, r) => {
      const saved = await api.saveRates(code, r);
      setState((s) => ({ ...s, rates: { ...s.rates, [code]: { ...r, ...saved } } }));
    },
    [api]
  );
  const saveSettings = useCallback(
    async (st) => {
      await api.saveSettings(st);
      setState((s) => ({ ...s, settings: { ...DEFAULT_SETTINGS, ...st } }));
    },
    [api]
  );
  return { ...state, saveProfile, saveRates, saveSettings };
}

export function ReviewTag({ status }) {
  const tone = { due: 'bad', soon: 'warn', ok: 'good', unknown: '' }[status];
  return <span className={`pill ${tone}`}>{REVIEW_LABEL[status]}</span>;
}

// ---------------- Profile ----------------
export function ProfileCard({ c, master, can, pmsById }) {
  const p = master.profiles[c.code] || {};
  const [editing, setEditing] = useState(false);
  const teams = p.teams ?? c.pmSplit?.length ?? c.pmIds.length;
  const people = c.people || [];
  const roles = Object.entries(people.reduce((a, x) => ((a[x.designation] = (a[x.designation] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1]);
  const exp = people.map((x) => x.experienceYears).filter((x) => x > 0);
  const avgExp = exp.length ? exp.reduce((a, b) => a + b, 0) / exp.length : null;

  if (editing) return <ProfileForm c={c} p={p} master={master} done={() => setEditing(false)} />;
  return (
    <section className="card">
      <div className="title-row">
        <h2 style={{ fontSize: 15 }}>Profile</h2>
        <span className="spacer" />
        {can.edit && (
          <button className="small" onClick={() => setEditing(true)}>
            {p.brief || p.technologies?.length ? 'Edit' : '+ Add details'}
          </button>
        )}
      </div>
      <div className="profile-grid">
        <div>
          <div className="k">Project brief</div>
          <div>{p.brief || <span className="muted">Not added yet.</span>}</div>
        </div>
        <div>
          <div className="k">Technologies</div>
          <div className="tags">{p.technologies?.length ? p.technologies.map((t) => <span key={t} className="tag">{t}</span>) : <span className="muted">—</span>}</div>
        </div>
        <div>
          <div className="k">Teams</div>
          <div>
            {teams} · {c.pmIds.map((id) => pmsById[id]?.name).filter(Boolean).join(', ')}
          </div>
        </div>
        <div>
          <div className="k">People involved</div>
          <div>
            {people.length} people{avgExp ? ` · avg ${avgExp.toFixed(1)} yrs experience` : ''}
            <div className="muted small-text">{roles.map(([r, n]) => `${n} ${r}`).join(' · ')}</div>
          </div>
        </div>
        {p.notes && (
          <div className="wide">
            <div className="k">Notes</div>
            <div>{p.notes}</div>
          </div>
        )}
      </div>
      {p.updatedAt && <div className="muted small-text" style={{ marginTop: 10 }}>Updated {new Date(p.updatedAt).toLocaleDateString()}{p.updatedBy ? ` by ${p.updatedBy}` : ''}</div>}
    </section>
  );
}

function ProfileForm({ c, p, master, done }) {
  const [f, setF] = useState({ name: p.name || c.name, brief: p.brief || '', technologies: (p.technologies || []).join(', '), teams: p.teams ?? '', notes: p.notes || '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    try {
      await master.saveProfile(c.code, {
        ...p,
        name: f.name.trim() || c.name,
        brief: f.brief.trim(),
        technologies: f.technologies.split(',').map((t) => t.trim()).filter(Boolean),
        teams: f.teams === '' ? null : Number(f.teams),
        notes: f.notes.trim(),
        pmIds: c.pmIds,
      });
      done();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card">
      <h2>Edit profile · {c.name}</h2>
      <div className="action-form">
        <label className="wide">
          Project brief
          <textarea rows={3} value={f.brief} onChange={set('brief')} placeholder="What we build and run for this customer" />
        </label>
        <label className="grow">
          Technologies (comma separated)
          <input value={f.technologies} onChange={set('technologies')} placeholder="React, .NET, Azure, Selenium" />
        </label>
        <label>
          Number of teams
          <input type="number" min="0" value={f.teams} onChange={set('teams')} placeholder={String(c.pmSplit?.length || c.pmIds.length)} />
        </label>
        <label className="wide">
          Notes
          <textarea rows={2} value={f.notes} onChange={set('notes')} placeholder="Contract, key contacts, anything else relevant" />
        </label>
        {err && <div className="err">{err}</div>}
        <div className="row">
          <button className="primary" disabled={busy} onClick={save}>
            Save profile
          </button>
          <button className="small" onClick={done}>
            Cancel
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------------- Rate card ----------------
export function RateCardCard({ c, master, can }) {
  const rec = master.rates[c.code] || {};
  const rc = rateCard(c, rec, master.settings);
  const [editing, setEditing] = useState(false);
  if (editing) return <RateForm c={c} rec={rec} rc={rc} master={master} done={() => setEditing(false)} />;
  return (
    <section className="card">
      <div className="title-row">
        <h2 style={{ fontSize: 15 }}>Rate card</h2>
        <ReviewTag status={rc.status} />
        <span className="muted small-text">
          {rc.lastRevised ? `Last revised ${rc.lastRevised} · due ${rc.dueDate}` : 'Last revision date not recorded'}
          {rc.discountPct != null && ` · overall ${vsStandard(rc.discountPct)}`}
        </span>
        <span className="spacer" />
        {can.edit && (
          <button className="small" onClick={() => setEditing(true)}>
            Edit rates
          </button>
        )}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Resource type</th>
              <th className="r">Seats</th>
              <th className="r">Bill rate / month</th>
              <th className="r">Aloha standard</th>
              <th className="r">vs standard</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {rc.rows.map((r) => (
              <tr key={r.role}>
                <td>
                  <strong>{r.role}</strong>
                </td>
                <td className="r">{fmt(r.seats)}</td>
                <td className="r">
                  {r.billed ? usd(r.billRateUSD, { compact: false }) : <span className="muted">not billed</span>}
                  {r.overridden && <div className="muted small-text">set manually</div>}
                </td>
                <td className="r muted">{usd(r.standardUSD, { compact: false })}</td>
                <td className="r">
                  {r.discountPct == null ? '—' : <span className={`pill ${r.discountPct > 0.15 ? 'bad' : r.discountPct > 0.0005 ? 'warn' : 'good'}`}>{Math.abs(r.discountPct) < 0.0005 ? 'at standard' : r.discountPct > 0 ? `${pct(r.discountPct)} off` : `${pct(-r.discountPct)} above`}</span>}
                </td>
                <td className="wrap-cell">{r.discountPct > 0 ? r.reason || <span className="muted">no reason recorded</span> : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rc.upliftAtStandardUSD > 0 && (
        <p className="muted small-text" style={{ marginBottom: 0 }}>
          At Aloha's standard rates these seats would bill {usd(rc.standardValueUSD)} a month instead of {usd(rc.billedValueUSD)} (+{usd(rc.upliftAtStandardUSD)}).
        </p>
      )}
    </section>
  );
}

function RateForm({ c, rec, rc, master, done }) {
  const [roles, setRoles] = useState(() => Object.fromEntries(rc.rows.map((r) => [r.role, { billRateUSD: rec.roles?.[r.role]?.billRateUSD ?? '', reason: rec.roles?.[r.role]?.reason ?? '' }])));
  const [reason, setReason] = useState(rec.reason || '');
  const [lastRevised, setLastRevised] = useState(rec.lastRevised || '');
  const [err, setErr] = useState(null);
  const base = new Map(rateCard(c, {}, master.settings).rows.map((r) => [r.role, r]));
  const setRole = (role, k, v) => setRoles((x) => ({ ...x, [role]: { ...x[role], [k]: v } }));
  const save = async () => {
    try {
      const clean = Object.fromEntries(
        Object.entries(roles)
          .map(([role, v]) => [role, { ...(v.billRateUSD !== '' ? { billRateUSD: Number(v.billRateUSD) } : {}), ...(v.reason ? { reason: v.reason.trim() } : {}) }])
          .filter(([, v]) => Object.keys(v).length)
      );
      await master.saveRates(c.code, { roles: clean, reason: reason.trim(), lastRevised: lastRevised || null });
      done();
    } catch (e) {
      setErr(e.message);
    }
  };
  return (
    <section className="card">
      <h2>Edit rate card · {c.name}</h2>
      <p className="muted small-text">Bill rates come from the project seat list. Enter a rate only to override it. Aloha's standard rates are in Settings.</p>
      <div className="fields">
        <label>
          Last revised
          <input type="date" value={lastRevised} max={toISODate(new Date())} onChange={(e) => setLastRevised(e.target.value)} />
        </label>
        <label style={{ gridColumn: 'span 2' }}>
          Discount reason (whole customer)
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Volume discount, long-term contract, strategic account" />
        </label>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Resource type</th>
              <th className="r">From seat list</th>
              <th className="r">Override bill rate</th>
              <th>Reason for this role (optional)</th>
            </tr>
          </thead>
          <tbody>
            {rc.rows.map((r) => (
              <tr key={r.role}>
                <td>{r.role}</td>
                <td className="r muted">{base.get(r.role)?.seats ? usd(base.get(r.role).billRateUSD, { compact: false }) : '—'}</td>
                <td className="r">
                  <input className="num wide-num" type="number" min="0" step="50" placeholder="—" value={roles[r.role]?.billRateUSD ?? ''} onChange={(e) => setRole(r.role, 'billRateUSD', e.target.value)} />
                </td>
                <td>
                  <input className="text-in" value={roles[r.role]?.reason ?? ''} onChange={(e) => setRole(r.role, 'reason', e.target.value)} placeholder={reason || 'Uses the customer reason'} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {err && <div className="err">{err}</div>}
      <div className="row">
        <button className="primary" onClick={save}>
          Save rate card
        </button>
        <button className="small" onClick={done}>
          Cancel
        </button>
      </div>
    </section>
  );
}

// ---------------- Add customer ----------------
export function AddCustomer({ model, master, onDone }) {
  const [f, setF] = useState({ name: '', code: '', pmId: '', brief: '', technologies: '' });
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const code = f.code.trim() || `NEW-${f.name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20)}`;
  const exists = model.customers.some((c) => c.code === code) || master.profiles[code];
  const save = async () => {
    if (!f.name.trim()) return setErr('Enter a customer name.');
    if (exists) return setErr(`A customer with code ${code} already exists.`);
    try {
      await master.saveProfile(code, { name: f.name.trim(), brief: f.brief.trim(), technologies: f.technologies.split(',').map((t) => t.trim()).filter(Boolean), manual: true, pmIds: f.pmId ? [f.pmId] : [] });
      onDone(code);
    } catch (e) {
      setErr(e.message);
    }
  };
  return (
    <div className="action-form">
      <div className="wide">
        <strong>Add customer</strong> <span className="muted small-text">Revenue and spend appear once the customer is in the billing and allocation data.</span>
      </div>
      <label className="grow">
        Customer name
        <input value={f.name} onChange={set('name')} autoFocus />
      </label>
      <label>
        Billing code (optional)
        <input value={f.code} onChange={set('code')} placeholder={code} />
      </label>
      <label>
        Account PM
        <select value={f.pmId} onChange={set('pmId')}>
          <option value="">—</option>
          {[...model.pms].sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="wide">
        Project brief
        <textarea rows={2} value={f.brief} onChange={set('brief')} />
      </label>
      <label className="wide">
        Technologies (comma separated)
        <input value={f.technologies} onChange={set('technologies')} />
      </label>
      {err && <div className="err">{err}</div>}
      <div className="row">
        <button className="primary" onClick={save}>
          Add customer
        </button>
        <button className="small" onClick={() => onDone(null)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------- Settings ----------------
export function Settings({ master, can }) {
  const s = master.settings;
  const [def, setDef] = useState(String(s.standardRates.default));
  const [roles, setRoles] = useState(() => Object.entries(s.standardRates.roles || {}).map(([role, rate]) => ({ role, rate: String(rate) })));
  const [months, setMonths] = useState(String(s.revisionMonths));
  const [msg, setMsg] = useState(null);
  const save = async () => {
    try {
      await master.saveSettings({
        standardRates: { default: Number(def) || 0, roles: Object.fromEntries(roles.filter((r) => r.role.trim()).map((r) => [r.role.trim(), Number(r.rate) || 0])) },
        revisionMonths: Math.max(1, Number(months) || 12),
      });
      setMsg({ ok: true, text: 'Settings saved.' });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    }
  };
  return (
    <section className="card" style={{ maxWidth: 760 }}>
      <h2>Aloha standard rates</h2>
      <p className="muted small-text">Monthly USD per seat. Every customer's bill rate is compared with these to show its discount.</p>
      <div className="fields">
        <label>
          Default (all resource types)
          <input type="number" min="0" step="50" value={def} disabled={!can.edit} onChange={(e) => setDef(e.target.value)} />
        </label>
      </div>
      <table>
        <thead>
          <tr>
            <th>Resource type with its own rate</th>
            <th className="r">USD / month</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {roles.map((r, i) => (
            <tr key={i}>
              <td>
                <input className="text-in" value={r.role} disabled={!can.edit} onChange={(e) => setRoles((x) => x.map((y, j) => (j === i ? { ...y, role: e.target.value } : y)))} placeholder="e.g. AI Engineer" />
              </td>
              <td className="r">
                <input className="num wide-num" type="number" min="0" step="50" value={r.rate} disabled={!can.edit} onChange={(e) => setRoles((x) => x.map((y, j) => (j === i ? { ...y, rate: e.target.value } : y)))} />
              </td>
              <td>
                {can.edit && (
                  <button className="linkish" onClick={() => setRoles((x) => x.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {can.edit && (
        <button className="small" style={{ marginTop: 8 }} onClick={() => setRoles((x) => [...x, { role: '', rate: def }])}>
          + Add resource type
        </button>
      )}
      <h2 style={{ marginTop: 22 }}>Rate revision</h2>
      <div className="fields">
        <label>
          A rate is due for revision after (months)
          <input type="number" min="1" value={months} disabled={!can.edit} onChange={(e) => setMonths(e.target.value)} />
        </label>
      </div>
      {can.edit && (
        <div className="row">
          <button className="primary" onClick={save}>
            Save settings
          </button>
          {msg && <span className={msg.ok ? 'good-text' : 'err'}>{msg.text}</span>}
        </div>
      )}
    </section>
  );
}

const vsStandard = (d) => (Math.abs(d) < 0.0005 ? 'at Aloha standard' : d > 0 ? `${pct(d)} below Aloha standard` : `${pct(-d)} above Aloha standard`);
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
