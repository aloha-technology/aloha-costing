// Salary rules: people paid above the cap for their level, project teams breaking the group-of-3 rule,
// and whose reviews are on hold until it is fixed. Admin + leadership only (individual salaries).
import React, { useMemo, useState } from 'react';
import { Kpi } from './ui.jsx';
import { inr } from '../format.js';
import { withRuleDefaults, peopleOverCap, teamChecks, reviewsOnHold, DEFAULT_SALARY_RULES } from '../engine/salaryRules.js';

const rs = (n) => inr(n, { compact: false });

export default function SalaryRules({ model, master, can, pmsById }) {
  const rules = withRuleDefaults(master.settings?.salaryRules);
  const [tab, setTab] = useState('projects');
  const [open, setOpen] = useState(null);
  const res = useMemo(() => {
    const over = peopleOverCap(model.employees || [], rules);
    const teams = teamChecks(model.employees || [], model.customers || [], rules);
    const scoped = (model.employees || []).filter((e) => rules.scope.some((s) => (e.designation || '').toLowerCase().includes(s.toLowerCase())) && e.ctcMonthlyINR > 0);
    return { over, teams, bad: teams.filter((t) => t.issues.length), hold: reviewsOnHold(over, teams), scoped };
  }, [model, JSON.stringify(rules)]); // eslint-disable-line react-hooks/exhaustive-deps

  const download = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Project', 'PM', 'Devs', 'Freshers', 'Mid-level', 'Senior', 'Dev FTE', 'Allocated CTC (₹)', 'Limit (₹)', 'Over by (₹)', 'Issues'],
        ...res.bad.map((t) => [t.name, t.pms.map((p) => pmsById[p]?.name || p).join(', '), t.heads, t.freshers, t.mids, t.seniors, t.fte, Math.round(t.allocatedINR), Math.round(t.budgetINR), Math.round(t.overINR), t.issues.map((i) => i.text).join(' | ')]),
      ]),
      'Projects breaking rule'
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['Emp ID', 'Name', 'Designation', 'Level', 'Why', 'Experience (yrs)', 'CTC / month (₹)', 'Cap (₹)', 'Over by (₹)'], ...res.over.map((p) => [p.empId, p.name, p.designation, p.levelLabel, p.why, p.experienceYears, p.ctcMonthlyINR, p.capINR, p.overINR])]),
      'Above role cap'
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Emp ID', 'Name', 'Reason'], ...res.hold.map((h) => [h.empId, h.name, h.reasons.join('; ')])]), 'Reviews on hold');
    XLSX.writeFile(wb, 'Aloha salary rules check.xlsx');
  };

  return (
    <>
      <div className="kpis">
        <Kpi label="Projects breaking the team rule" value={`${res.bad.length} of ${res.teams.length}`} note={`${res.bad.filter((t) => t.issues.some((i) => i.kind === 'mix')).length} on mix, ${res.bad.filter((t) => t.issues.some((i) => i.kind === 'cost')).length} on cost`} tone={res.bad.length ? 'bad' : 'good'} />
        <Kpi label="People above their role cap" value={`${res.over.length} of ${res.scoped.length}`} note={rules.levels.map((l) => `${res.over.filter((p) => p.level === l.key).length} ${l.label.toLowerCase()}`).join(' · ')} tone={res.over.length ? 'bad' : 'good'} />
        <Kpi label="Reviews on hold" value={res.hold.length} note="until their project or pay is within the rules" tone={res.hold.length ? 'warn' : 'good'} />
      </div>

      <div className="card">
        <div className="title-row" style={{ marginBottom: 6 }}>
          <div className="tabs" style={{ marginBottom: 0, borderBottom: 0 }}>
            {[
              ['projects', `Projects (${res.bad.length})`],
              ['people', `Above cap (${res.over.length})`],
              ['hold', `Reviews on hold (${res.hold.length})`],
              ['rules', 'Rules'],
            ].map(([k, l]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                {l}
              </button>
            ))}
          </div>
          <span className="spacer" />
          <button className="small" onClick={download}>
            Download Excel
          </button>
        </div>

        {tab === 'projects' && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>PM</th>
                  <th className="r">Devs</th>
                  <th>Fresher / mid / senior</th>
                  <th className="r">Allocated</th>
                  <th className="r">Limit</th>
                  <th className="r">Over by</th>
                  <th>What breaks the rule</th>
                </tr>
              </thead>
              <tbody>
                {res.bad.map((t) => (
                  <React.Fragment key={t.code}>
                    <tr className="click" onClick={() => setOpen(open === t.code ? null : t.code)}>
                      <td className="wrap-cell">
                        <strong>{t.name}</strong>
                      </td>
                      <td className="wrap-cell">{t.pms.map((p) => pmsById[p]?.name || p.split('@')[0]).join(', ')}</td>
                      <td className="r">
                        {t.heads}
                        <span className="muted small-text"> ({t.fte} FTE)</span>
                      </td>
                      <td>
                        {t.freshers} / {t.mids} / {t.seniors}
                        {t.freshers <= 1 && <span className="pill warn" style={{ marginLeft: 6 }}>{t.freshers === 0 ? 'no fresher' : 'one fresher'}</span>}
                      </td>
                      <td className="r">{rs(t.allocatedINR)}</td>
                      <td className="r muted">{rs(t.budgetINR)}</td>
                      <td className="r">{t.overINR > 0 ? <strong className="warn-text">{rs(t.overINR)}</strong> : '—'}</td>
                      <td className="wrap-cell small-text">{t.issues.map((i) => i.text).join(' · ')}</td>
                    </tr>
                    {open === t.code && (
                      <tr>
                        <td colSpan={8} style={{ whiteSpace: 'normal', background: 'var(--bg)' }}>
                          <table>
                            <tbody>
                              {t.people
                                .sort((a, b) => b.allocatedINR - a.allocatedINR)
                                .map((p) => (
                                  <tr key={p.empId}>
                                    <td>{p.name}</td>
                                    <td className="muted">{p.designation}</td>
                                    <td>{p.levelLabel}</td>
                                    <td className="r muted">{p.experienceYears ?? '—'} yrs</td>
                                    <td className="r">{rs(p.ctcMonthlyINR)}</td>
                                    <td className="r muted">{p.utilPct}%</td>
                                    <td className="r">{rs(p.allocatedINR)}</td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
            {!res.bad.length && <div className="empty">Every project is within the rules.</div>}
          </div>
        )}

        {tab === 'people' && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Designation</th>
                  <th>Level</th>
                  <th className="r">CTC / month</th>
                  <th className="r">Cap</th>
                  <th className="r">Over by</th>
                  <th>Working on</th>
                </tr>
              </thead>
              <tbody>
                {res.over.map((p) => (
                  <tr key={p.empId}>
                    <td>
                      <strong>{p.name}</strong>
                      <span className="muted small-text"> {p.empId}</span>
                    </td>
                    <td>{p.designation}</td>
                    <td>
                      {p.levelLabel}
                      <div className="muted small-text">{p.why}</div>
                    </td>
                    <td className="r">{rs(p.ctcMonthlyINR)}</td>
                    <td className="r muted">{rs(p.capINR)}</td>
                    <td className="r">
                      <strong className="warn-text">{rs(p.overINR)}</strong>
                    </td>
                    <td className="wrap-cell small-text">{(p.allocations || []).filter((a) => a.code).map((a) => `${a.customer || a.code} ${a.utilPct}%`).join(', ') || <span className="muted">bench</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'hold' && (
          <div className="table-wrap">
            <table>
              <tbody>
                {res.hold.map((h) => (
                  <tr key={h.empId}>
                    <td>
                      <strong>{h.name}</strong>
                      <span className="muted small-text"> {h.empId}</span>
                    </td>
                    <td className="wrap-cell small-text">{h.reasons.join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'rules' && <RulesEditor rules={rules} master={master} can={can} />}
      </div>
    </>
  );
}

function RulesEditor({ rules, master, can }) {
  const [r, setR] = useState(rules);
  const [msg, setMsg] = useState('');
  const setLevel = (i, k, v) => setR((x) => ({ ...x, levels: x.levels.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
  const ro = !can.edit;
  const save = async () => {
    const clean = {
      ...r,
      scope: String(r.scope).split(',').map((s) => s.trim()).filter(Boolean),
      levels: r.levels.map((l) => ({ ...l, maxYears: l.maxYears === '' || l.maxYears == null ? null : Number(l.maxYears), capINR: Number(l.capINR) || 0 })),
      groupSize: Number(r.groupSize) || 3,
      groupBudgetINR: Number(r.groupBudgetINR) || 0,
      maxSeniorsPerGroup: Number(r.maxSeniorsPerGroup) || 1,
    };
    await master.saveSettings({ ...master.settings, salaryRules: clean });
    setMsg('Saved.');
  };
  return (
    <div style={{ maxWidth: 760 }}>
      <p className="hint" style={{ marginTop: 0 }}>
        Level comes from the title first (e.g. “Senior” in the designation), else from total experience in the HR export. Team cost counts each developer’s CTC × their % on the project.
      </p>
      <div className="form-grid">
        <label className="wide">
          Applies to designations containing (comma-separated)
          <input value={Array.isArray(r.scope) ? r.scope.join(', ') : r.scope} disabled={ro} onChange={(e) => (setR({ ...r, scope: e.target.value }), setMsg(''))} />
        </label>
      </div>
      <h3>Levels and caps (monthly CTC)</h3>
      {r.levels.map((l, i) => (
        <div key={l.key} className="contact-row" style={{ gridTemplateColumns: '1.2fr 1fr 1fr' }}>
          <input className="inline-in" value={l.label} disabled={ro} onChange={(e) => setLevel(i, 'label', e.target.value)} />
          <label className="small-text muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            under
            <input className="inline-in" type="number" step="0.5" style={{ width: 70 }} value={l.maxYears ?? ''} placeholder="∞" disabled={ro} onChange={(e) => setLevel(i, 'maxYears', e.target.value)} /> yrs
          </label>
          <label className="small-text muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            cap ₹
            <input className="inline-in" type="number" step="1000" style={{ width: 100 }} value={l.capINR} disabled={ro} onChange={(e) => setLevel(i, 'capINR', e.target.value)} />
          </label>
        </div>
      ))}
      <h3>Team rule</h3>
      <div className="form-grid">
        <label>
          Group size (devs)
          <input type="number" value={r.groupSize} disabled={ro} onChange={(e) => setR({ ...r, groupSize: e.target.value })} />
        </label>
        <label>
          Mid-level + senior allowed per group
          <input type="number" value={r.maxSeniorsPerGroup} disabled={ro} onChange={(e) => setR({ ...r, maxSeniorsPerGroup: e.target.value })} />
        </label>
        <label>
          Group cost limit (₹ / month)
          <input type="number" step="1000" value={r.groupBudgetINR} disabled={ro} onChange={(e) => setR({ ...r, groupBudgetINR: e.target.value })} />
        </label>
      </div>
      {can.edit && (
        <div className="row">
          <button className="primary" onClick={save}>
            Save rules
          </button>
          <button className="small" onClick={() => (setR(DEFAULT_SALARY_RULES), setMsg(''))}>
            Reset to leadership’s rules
          </button>
          {msg && <span className="good-text">{msg}</span>}
        </div>
      )}
    </div>
  );
}
