import React, { useMemo, useState } from 'react';
import { Table } from '../views/ui.jsx';
import { inr } from '../format.js';
import { Act, Modal, amt, fmtDate, MultiSelect } from '../collections/views/parts.jsx';
import { TEAMS } from './engine.js';
import { parseDate } from '../collections/engine/dates.js';
import { norm } from '../collections/engine/importer.js';

const yrs = (n) => (n == null ? '—' : `${n} yr${n === 1 ? '' : 's'}`);
const Src = ({ s }) => (s && s !== 'HR export' ? <span className="sub">{s}</span> : null);

export function Employees({ employees, profiles, ops, can, focus, setFocus, me }) {
  const missing = focus?.startsWith('?missing=') ? focus.slice(9) : '';
  const [q, setQ] = useState('');
  const [teams, setTeams] = useState([]);
  const [cat, setCat] = useState('');
  const [edit, setEdit] = useState(null);
  const [bulk, setBulk] = useState(false);
  const seeAll = me.role === 'admin' || me.role === 'leadership';
  const rows = useMemo(
    () =>
      employees
        .filter((e) => (!q || `${e.name} ${e.empId} ${e.designation} ${e.skills}`.toLowerCase().includes(q.toLowerCase())) && (!teams.length || teams.includes(e.team)) && (!cat || e.category === cat) && (!missing || e.missing.includes(missing)))
        .map((e) => ({ ...e, id: e.empId })),
    [employees, q, teams, cat, missing]
  );
  const teamCounts = Object.entries(employees.reduce((m, e) => ((m[e.team] = (m[e.team] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <div className="tags" style={{ marginBottom: 10 }}>
        {teamCounts.map(([t, n]) => (
          <a key={t} className="tag" onClick={() => setTeams(teams.includes(t) ? teams.filter((x) => x !== t) : [t])} style={teams.includes(t) ? { background: 'var(--accent-soft)', color: 'var(--accent)' } : undefined}>
            {t} · {n}
          </a>
        ))}
      </div>
      <div className="toolbar">
        <input type="text" placeholder="Search name, ID, designation, skill" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 260 }} />
        <MultiSelect label="Team" options={TEAMS} value={teams} onChange={setTeams} />
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {['engineering', 'pm', 'support', 'overhead', 'leaving'].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        {missing && (
          <span className="chip">
            missing: <strong>{missing}</strong>{' '}
            <a onClick={() => setFocus('')} style={{ marginLeft: 4 }}>
              ✕
            </a>
          </span>
        )}
        <span className="spacer" />
        {can.edit && (
          <button className="small" onClick={() => setBulk(true)}>
            Update from Excel
          </button>
        )}
      </div>
      <div className="card">
        <div className="hint" style={{ marginBottom: 8 }}>
          {rows.length} people. Name, designation, skills and total experience come from the HR export; pay from payroll. Anything you enter here takes priority and is kept through monthly refreshes.
        </div>
        <Table
          rowKey={(r) => r.id}
          onRowClick={(r) => setEdit(r)}
          initialSort={{ key: 'name', dir: 'asc' }}
          columns={[
            { key: 'name', label: 'Name', render: (r) => <span className="wrap-cell"><strong>{r.name}</strong><span className="sub">{r.empId} · {r.designation}</span></span> },
            { key: 'team', label: 'Team', render: (r) => <>{r.team}{r.teamSource !== 'entered' && <span className="sub">guessed</span>}</> },
            { key: 'skills', label: 'Skills', render: (r) => <span className="skills">{r.skills || <span className="flag warn">missing</span>}</span> },
            { key: 'totalExp', label: 'Total exp', align: 'right', render: (r) => <>{yrs(r.totalExp)}<Src s={r.expSource} />{r.conflict && <span className="flag warn" title={r.conflict}>check</span>}</> },
            { key: 'alohaYears', label: 'At Aloha', align: 'right', render: (r) => (r.alohaYears == null ? <span className="muted">no joining date</span> : yrs(r.alohaYears)) },
            { key: 'priorYears', label: 'Before Aloha', align: 'right', render: (r) => yrs(r.priorYears) },
            { key: 'allocatedPct', label: 'Allocated', align: 'right', render: (r) => `${Math.round(r.allocatedPct || 0)}%` },
            ...(seeAll
              ? [
                  { key: 'ctc', label: 'CTC / month', align: 'right', render: (r) => (r.ctc == null ? '—' : inr(r.ctc, { compact: false })) },
                  { key: 'incentive', label: 'Incentive / month', align: 'right', render: (r) => (r.incentive ? inr(r.incentive, { compact: false }) : r.incentivePlan ? <span className="muted">plan only</span> : '—') },
                ]
              : []),
          ]}
          rows={rows}
        />
      </div>
      {edit && <EmployeeEditor e={edit} profile={profiles[edit.empId]} ops={ops} can={can} onClose={() => setEdit(null)} />}
      {bulk && <BulkUpdate employees={employees} profiles={profiles} ops={ops} onClose={() => setBulk(false)} />}
    </>
  );
}

function EmployeeEditor({ e, profile = {}, ops, can, onClose }) {
  const p = profile || {};
  const [f, setF] = useState({
    team: p.team || '',
    joined_on: p.joined_on || '',
    prior_experience_years: p.prior_experience_years ?? '',
    experience_years: p.experience_years ?? '',
    skills: p.skills || '',
    phone: p.phone || '',
    location: p.location || '',
    incentive_plan: p.incentive_plan || '',
    notes: p.notes || '',
  });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const ro = !can.edit;
  return (
    <Modal title={`${e.name} · ${e.designation}`} wide onClose={onClose} footer={can.edit && <Act className="primary" onClick={async () => (await ops.saveProfiles([{ emp_id: e.empId, ...f }]), onClose())}>Save</Act>}>
      <div className="kv" style={{ marginBottom: 14 }}>
        <div>
          <div className="k">From the HR export</div>
          <div className="v small-text">
            {e.email}
            <br />
            Reports to {e.reportingManager || '—'}
          </div>
        </div>
        <div>
          <div className="k">Experience now</div>
          <div className="v">
            {yrs(e.totalExp)} total · {yrs(e.alohaYears)} at Aloha · {yrs(e.priorYears)} before
          </div>
          {e.conflict && <div className="warnbox" style={{ marginTop: 6 }}>{e.conflict}</div>}
        </div>
        <div>
          <div className="k">Pay (payroll)</div>
          <div className="v">
            {e.ctc == null ? '—' : `${inr(e.ctc, { compact: false })} CTC`}
            {e.base != null && <span className="sub">base {inr(e.base, { compact: false })} · incentive {inr(e.incentive || 0, { compact: false })}</span>}
          </div>
        </div>
        <div>
          <div className="k">Working on</div>
          <div className="v small-text">{e.projects.length ? e.projects.map((x) => `${x.name} ${x.utilPct}%${x.billable ? '' : ' (non-billable)'}`).join(', ') : 'Nothing allocated'}</div>
        </div>
      </div>
      <div className="form-grid">
        <label>
          Team
          <select value={f.team} disabled={ro} onChange={(ev) => set('team', ev.target.value)}>
            <option value="">{`Guess: ${e.teamSource === 'entered' ? '—' : e.team}`}</option>
            {TEAMS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Joined Aloha on
          <input type="date" value={f.joined_on} disabled={ro} onChange={(ev) => set('joined_on', ev.target.value)} />
        </label>
        <label>
          Experience before Aloha (yrs)
          <input type="number" step="0.5" value={f.prior_experience_years} disabled={ro} onChange={(ev) => set('prior_experience_years', ev.target.value)} placeholder="calculated if blank" />
        </label>
        <label>
          Total experience (yrs), only if HR’s is wrong
          <input type="number" step="0.5" value={f.experience_years} disabled={ro} onChange={(ev) => set('experience_years', ev.target.value)} placeholder={e.expSource === 'HR export' ? `HR: ${e.totalExp}` : ''} />
        </label>
        <label className="wide">
          Skills, only if HR’s are wrong or missing
          <input value={f.skills} disabled={ro} onChange={(ev) => set('skills', ev.target.value)} placeholder={e.skillsSource === 'HR export' ? `HR: ${e.skills}` : 'e.g. React, Node, AWS'} />
        </label>
        <label>
          Phone
          <input value={f.phone} disabled={ro} onChange={(ev) => set('phone', ev.target.value)} />
        </label>
        <label>
          Location
          <input value={f.location} disabled={ro} onChange={(ev) => set('location', ev.target.value)} placeholder="e.g. Pune, remote" />
        </label>
        <label className="wide">
          Incentive plan
          <input value={f.incentive_plan} disabled={ro} onChange={(ev) => set('incentive_plan', ev.target.value)} placeholder="e.g. 5% of new billing, paid quarterly" />
        </label>
        <label className="wide">
          Notes
          <textarea rows={2} value={f.notes} disabled={ro} onChange={(ev) => set('notes', ev.target.value)} />
        </label>
      </div>
      {p.updated_at && <div className="hint" style={{ marginTop: 8 }}>Last changed {fmtDate(p.updated_at.slice(0, 10))} by {p.updated_by}</div>}
    </Modal>
  );
}

// Fill many employees at once from an HR sheet: an ID (or email) column plus any of these.
const BULK_COLS = {
  team: ['team', 'team type', 'department'],
  joined_on: ['joining date', 'date of joining', 'doj', 'joined on', 'join date'],
  prior_experience_years: ['prior experience', 'experience before aloha', 'previous experience', 'past experience'],
  phone: ['phone', 'mobile', 'contact number', 'phone number'],
  location: ['location', 'city', 'base location'],
};
function BulkUpdate({ employees, profiles, ops, onClose }) {
  const [plan, setPlan] = useState(null);
  const [err, setErr] = useState('');
  const onFile = async (file) => {
    setErr('');
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
      if (!rows.length) throw new Error('The sheet is empty');
      const keys = Object.keys(rows[0]);
      const find = (names) => keys.find((k) => names.includes(norm(k)));
      const idCol = find(['id', 'emp id', 'employee id', 'emp code', 'employee code']);
      const emailCol = find(['email', 'email id', 'official email']);
      if (!idCol && !emailCol) throw new Error('Need an ID or Email column to match people');
      const cols = Object.fromEntries(Object.entries(BULK_COLS).map(([f, names]) => [f, find(names)]).filter(([, k]) => k));
      if (!Object.keys(cols).length) throw new Error(`No columns to update. Use any of: ${Object.values(BULK_COLS).map((n) => n[0]).join(', ')}`);
      const byId = Object.fromEntries(employees.map((e) => [String(e.empId), e]));
      const byEmail = Object.fromEntries(employees.filter((e) => e.email).map((e) => [e.email.toLowerCase(), e]));
      const changes = [];
      const unmatched = [];
      for (const r of rows) {
        const e = (idCol && byId[String(r[idCol]).trim()]) || (emailCol && byEmail[String(r[emailCol]).trim().toLowerCase()]);
        if (!e) {
          if (r[idCol] || r[emailCol]) unmatched.push(r[idCol] || r[emailCol]);
          continue;
        }
        const upd = {};
        for (const [f, k] of Object.entries(cols)) {
          let v = String(r[k] ?? '').trim();
          if (!v) continue;
          if (f === 'joined_on') v = parseDate(r[k]);
          if (f === 'prior_experience_years') v = parseFloat(v);
          if (f === 'team') v = TEAMS.find((t) => norm(t) === norm(v)) || v;
          if (v !== '' && !(typeof v === 'number' && Number.isNaN(v))) upd[f] = v;
        }
        if (Object.keys(upd).length) changes.push({ e, upd });
      }
      setPlan({ cols: Object.keys(cols), changes, unmatched, file: file.name });
    } catch (x) {
      setErr(x.message);
    }
  };
  return (
    <Modal
      title="Update employees from Excel"
      wide
      onClose={onClose}
      footer={
        plan && (
          <Act className="primary" disabled={!plan.changes.length} onClick={async () => (await ops.saveProfiles(plan.changes.map(({ e, upd }) => ({ emp_id: e.empId, ...(profiles[e.empId] || {}), ...upd }))), onClose())}>
            Update {plan.changes.length} people
          </Act>
        )
      }
    >
      <p className="hint" style={{ marginTop: 0 }}>
        One row per person with an <strong>ID</strong> (or Email) column and any of: Team, Joining Date, Prior Experience, Phone, Location. Blank cells leave the current value.
      </p>
      <input type="file" accept=".xlsx,.xls,.csv" onChange={(ev) => ev.target.files[0] && onFile(ev.target.files[0])} />
      {err && <div className="err">{err}</div>}
      {plan && (
        <>
          <h3>
            {plan.changes.length} people to update ({plan.cols.join(', ')}){plan.unmatched.length > 0 && ` · ${plan.unmatched.length} rows not matched`}
          </h3>
          <div className="table-wrap" style={{ maxHeight: 300, overflow: 'auto' }}>
            <table>
              <tbody>
                {plan.changes.slice(0, 300).map(({ e, upd }) => (
                  <tr key={e.empId}>
                    <td>{e.name}</td>
                    <td className="wrap-cell muted">
                      {Object.entries(upd)
                        .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
                        .join(' · ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {plan.unmatched.length > 0 && <div className="hint">Not matched: {plan.unmatched.slice(0, 20).join(', ')}</div>}
        </>
      )}
    </Modal>
  );
}

export function Pms({ pms, employees, profiles, ops, can, go }) {
  const [edit, setEdit] = useState(null);
  const empById = Object.fromEntries(employees.map((e) => [e.empId, e]));
  return (
    <>
      <div className="card">
        <div className="hint" style={{ marginBottom: 8 }}>
          Team = people on this PM’s projects plus the bench they hold. Seats and billing are this month’s, split by the PM’s share where a project has several PMs.
        </div>
        <Table
          rowKey={(r) => r.id}
          onRowClick={(r) => setEdit(r)}
          initialSort={{ key: 'revenueUSD', dir: 'desc' }}
          columns={[
            { key: 'name', label: 'PM', render: (r) => <span className="wrap-cell"><strong>{r.name}</strong><span className="sub">{r.email}</span></span> },
            { key: 'totalExp', label: 'Experience', align: 'right', render: (r) => <>{yrs(r.totalExp)}{r.alohaYears != null && <span className="sub">{yrs(r.alohaYears)} at Aloha</span>}</> },
            { key: 'customers', label: 'Projects', align: 'right' },
            { key: 'teamSize', label: 'Team size', align: 'right' },
            { key: 'benchPeople', label: 'On bench', align: 'right', render: (r) => (r.benchPeople ? <span className="flag warn">{r.benchPeople}</span> : 0) },
            { key: 'seats', label: 'Billed seats', align: 'right' },
            { key: 'revenueUSD', label: 'Billing / month', align: 'right', render: (r) => <strong>{amt(r.revenueUSD)}</strong> },
            { key: 'revenuePerSeat', label: 'Per seat', align: 'right', render: (r) => (r.revenuePerSeat ? amt(r.revenuePerSeat) : '—') },
            { key: 'contact', label: 'WhatsApp / phone', sort: (r) => (r.whatsapp || r.phone ? 1 : 0), render: (r) => (r.whatsapp || r.phone ? <span className="muted">{[r.whatsapp, r.phone].filter(Boolean).join(' · ')}</span> : <span className="flag warn">missing</span>) },
          ]}
          rows={pms}
        />
      </div>
      {edit && <PmEditor pm={edit} e={edit.empId ? empById[edit.empId] : null} profile={edit.empId ? profiles[edit.empId] : null} ops={ops} can={can} go={go} onClose={() => setEdit(null)} />}
    </>
  );
}

function PmEditor({ pm, e, profile, ops, can, onClose }) {
  const [f, setF] = useState({ whatsapp: pm.whatsapp || '', phone: profile?.phone || '', joined_on: profile?.joined_on || '', prior: profile?.prior_experience_years ?? '' });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Modal
      title={`${pm.name}`}
      onClose={onClose}
      footer={
        can.edit && (
          <Act
            className="primary"
            onClick={async () => {
              await ops.saveContact(pm.id, { whatsapp: f.whatsapp });
              if (pm.empId) await ops.saveProfiles([{ emp_id: pm.empId, ...(profile || {}), phone: f.phone, joined_on: f.joined_on, prior_experience_years: f.prior }]);
              onClose();
            }}
          >
            Save
          </Act>
        )
      }
    >
      <div className="kv" style={{ marginBottom: 12 }}>
        <div>
          <div className="k">Runs</div>
          <div className="v">
            {pm.customers} projects · {pm.teamSize} people · {pm.benchPeople} on bench
          </div>
        </div>
        <div>
          <div className="k">Billing</div>
          <div className="v">
            {pm.seats} seats · {amt(pm.revenueUSD)}/month
          </div>
        </div>
        <div>
          <div className="k">Skills</div>
          <div className="v small-text">{e?.skills || '—'}</div>
        </div>
      </div>
      <div className="form-grid">
        <label>
          WhatsApp (for PM digests)
          <input value={f.whatsapp} disabled={!can.edit} onChange={(ev) => set('whatsapp', ev.target.value)} placeholder="+91…" />
        </label>
        <label>
          Phone
          <input value={f.phone} disabled={!can.edit || !pm.empId} onChange={(ev) => set('phone', ev.target.value)} />
        </label>
        <label>
          Joined Aloha on
          <input type="date" value={f.joined_on} disabled={!can.edit || !pm.empId} onChange={(ev) => set('joined_on', ev.target.value)} />
        </label>
        <label>
          Experience before Aloha (yrs)
          <input type="number" step="0.5" value={f.prior} disabled={!can.edit || !pm.empId} onChange={(ev) => set('prior', ev.target.value)} />
        </label>
      </div>
      {!pm.empId && <div className="hint">This PM isn’t in the HR export, so only WhatsApp can be saved.</div>}
    </Modal>
  );
}
