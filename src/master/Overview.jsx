import React from 'react';
import { Kpi } from '../views/ui.jsx';
import { amt, fmtDate } from '../collections/views/parts.jsx';

const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);

function Bar({ label, value, onClick, hint }) {
  const v = value ?? 0;
  const tone = v >= 0.9 ? 'var(--good)' : v >= 0.5 ? 'var(--warn)' : 'var(--bad)';
  return (
    <li onClick={onClick} style={{ cursor: onClick ? 'pointer' : undefined }}>
      <div className="bar-label">
        <strong>{label}</strong>
        {hint && <span className="muted">{hint}</span>}
      </div>
      <div className="bar-track">
        <div className="bar" style={{ width: `${Math.round(v * 100)}%`, background: tone }} />
      </div>
      <div className="bar-value">{pct(value)}</div>
    </li>
  );
}

export default function MasterOverview({ accounts, employees, pms, unlinked, completeness: c, go }) {
  const active = accounts.filter((a) => a.account.active !== false);
  const revisionsDue = active.filter((a) => a.revisionStatus === 'due' || a.revisionStatus === 'soon').sort((a, b) => (a.nextRevision?.date || '').localeCompare(b.nextRevision?.date || ''));
  const noEmail = active.filter((a) => !a.billingContact && a.revenueUSD > 0).sort((a, b) => b.revenueUSD - a.revenueUSD);
  return (
    <>
      <div className="kpis">
        <Kpi label="Active customers" value={c.accounts} note={`${accounts.length - c.accounts} closed`} />
        <Kpi label="Employees" value={c.employees} note={`${employees.filter((e) => e.category === 'engineering').length} engineering`} />
        <Kpi label="PMs" value={pms.length} note={`${pms.reduce((s, p) => s + p.teamSize, 0)} people in PM teams`} />
        <Kpi label="Rate revisions due" value={revisionsDue.length} note="due now or within 60 days" tone={revisionsDue.length ? 'warn' : 'good'} />
        <Kpi label="Projects not linked" value={unlinked.length} note="to a paying customer" tone={unlinked.length ? 'warn' : 'good'} />
      </div>
      <div className="grid2">
        <div className="card">
          <h2>Customers: how complete</h2>
          <ul className="bars">
            <Bar label="Billing email (POC)" value={c.billingEmail} hint="needed for Collections reminders" onClick={() => go('customers', '?missing=billing email')} />
            <Bar label="POC phone" value={c.phone} onClick={() => go('customers', '?missing=phone')} />
            <Bar label="Projects linked" value={c.projectsLinked} hint="ties Collections to Costing" onClick={() => go('customers', '?missing=linked projects')} />
            <Bar label="Rate revision date" value={c.revisionDate} onClick={() => go('customers', '?missing=rate revision date')} />
          </ul>
        </div>
        <div className="card">
          <h2>Employees: how complete</h2>
          <ul className="bars">
            <Bar label="Joining date" value={c.joinDate} hint="gives years at Aloha vs before" onClick={() => go('employees', '?missing=joining date')} />
            <Bar label="Team confirmed" value={c.team} hint="otherwise guessed from designation" onClick={() => go('employees', '?missing=team (guessed)')} />
            <Bar label="Skills" value={c.skills} onClick={() => go('employees', '?missing=skills')} />
          </ul>
          <p className="hint" style={{ marginBottom: 0 }}>Tip: Employees → “Update from Excel” fills joining dates and teams for everyone from one HR sheet.</p>
        </div>
      </div>
      <div className="grid2">
        <div className="card">
          <h2>Rate revisions coming up</h2>
          {revisionsDue.length ? (
            <ul className="actions-list">
              {revisionsDue.slice(0, 12).map((a) => (
                <li key={a.account.id}>
                  <span className={`flag ${a.revisionStatus === 'due' ? 'bad' : 'warn'}`}>{a.revisionStatus === 'due' ? 'due' : 'soon'}</span>
                  <a onClick={() => go('customers', a.account.id)}>{a.account.name}</a>
                  <span className="muted right">
                    {a.nextRevision.project} · {fmtDate(a.nextRevision.date)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="muted">None recorded. Add “last revised” dates on each project’s rate card.</div>
          )}
        </div>
        <div className="card">
          <h2>Billing customers without a billing email</h2>
          {noEmail.length ? (
            <ul className="actions-list">
              {noEmail.slice(0, 12).map((a) => (
                <li key={a.account.id}>
                  <a onClick={() => go('customers', a.account.id)}>{a.account.name}</a>
                  <span className="muted right">{amt(a.revenueUSD)}/month</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="muted">All billing customers have one.</div>
          )}
        </div>
      </div>
    </>
  );
}
