// Directory overview: headline numbers (click to open), a short "Do next" list in priority order,
// and how complete each kind of information is ("x of y", click to see who is missing it).
import React from 'react';
import { amt, fmtDate } from '../collections/views/parts.jsx';

function Stat({ label, value, note, tone, onClick }) {
  return (
    <button className={`kpi kpi-btn ${tone || ''}`} onClick={onClick}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {note && <div className="kpi-note">{note}</div>}
    </button>
  );
}

function Progress({ label, c, hint, onClick }) {
  const pct = c.total ? c.done / c.total : 0;
  const tone = pct >= 0.9 ? 'var(--good)' : pct >= 0.5 ? 'var(--warn)' : 'var(--bad)';
  return (
    <button className="progress-row" onClick={onClick} title="Show who is missing it">
      <span className="p-label">
        <strong>{label}</strong>
        {hint && <span className="muted small-text">{hint}</span>}
      </span>
      <span className="bar-track">
        <span className="bar" style={{ width: `${Math.round(pct * 100)}%`, background: tone }} />
      </span>
      <span className="p-count">
        {c.done} <span className="muted">of {c.total}</span>
      </span>
    </button>
  );
}

export default function MasterOverview({ accounts, employees, pms, unlinked, completeness: c, go }) {
  const active = accounts.filter((a) => a.account.active !== false);
  const noEmail = active.filter((a) => !a.billingContact && a.revenueUSD > 0).sort((a, b) => b.revenueUSD - a.revenueUSD);
  const revisionsDue = active.filter((a) => a.revisionStatus === 'due' || a.revisionStatus === 'soon').sort((a, b) => (a.nextRevision?.date || '').localeCompare(b.nextRevision?.date || ''));
  const noRevision = active.filter((a) => a.projects.some((p) => p.rateCard && !p.rateCard.lastRevised)).sort((a, b) => b.revenueUSD - a.revenueUSD);
  const anyRevision = c.revisionDate.done > 0;

  // Do next: the few things that matter most, biggest customers first.
  const steps = [];
  if (noEmail.length)
    steps.push({
      title: `Add billing contacts for ${noEmail.length} paying customer${noEmail.length > 1 ? 's' : ''}`,
      why: 'Payment reminders, invoices and tax invoices can’t go out without them.',
      top: noEmail.slice(0, 4),
      all: () => go('customers', '?missing=billing email'),
    });
  if (unlinked.length)
    steps.push({
      title: `Link ${unlinked.length} project${unlinked.length > 1 ? 's' : ''} to the customer who pays for ${unlinked.length > 1 ? 'them' : 'it'}`,
      why: 'Joins Costing (projects) to Invoices (who pays) so seats, rates and dues line up.',
      action: ['Link now', () => go('customers')],
      items: unlinked.map((u) => u.project.name),
    });
  if (revisionsDue.length)
    steps.push({
      title: `${revisionsDue.length} rate revision${revisionsDue.length > 1 ? 's' : ''} due`,
      why: 'Due now or within 60 days.',
      top: revisionsDue.slice(0, 4),
      note: (a) => `${a.nextRevision.project} · ${fmtDate(a.nextRevision.date)}`,
      all: () => go('customers', '?missing=rate revision date'),
    });
  if (noRevision.length)
    steps.push({
      title: `Record when rates were last revised (${c.revisionDate.done} of ${c.revisionDate.total} projects done)`,
      why: 'Then the app tells you when each customer is due for a rate revision.',
      top: noRevision.slice(0, 4),
      all: () => go('customers', '?missing=rate revision date'),
    });
  if (c.joinDate.done < c.joinDate.total)
    steps.push({
      title: `Add joining dates (${c.joinDate.done} of ${c.joinDate.total} employees)`,
      why: 'Gives years at Aloha vs before. One HR sheet fills everyone at once.',
      action: ['Update from Excel', () => go('employees')],
    });

  return (
    <>
      <div className="kpis">
        <Stat label="Active customers" value={c.accounts} note={`${accounts.length - c.accounts} closed`} onClick={() => go('customers')} />
        <Stat label="Employees" value={c.employees} note={`${employees.filter((e) => e.category === 'engineering').length} engineering`} onClick={() => go('employees')} />
        <Stat label="Teams" value={pms.length} note={`PMs · ${pms.reduce((s, p) => s + p.teamSize, 0)} people`} onClick={() => go('pms')} />
        {anyRevision ? (
          <Stat label="Rate revisions due" value={revisionsDue.length} note="now or within 60 days" tone={revisionsDue.length ? 'warn' : 'good'} onClick={() => go('customers', '?missing=rate revision date')} />
        ) : (
          <Stat label="Rate revision dates" value={`0 of ${c.revisionDate.total}`} note="projects with a date recorded" tone="warn" onClick={() => go('customers', '?missing=rate revision date')} />
        )}
        <Stat label="Projects not linked" value={unlinked.length} note="to a paying customer" tone={unlinked.length ? 'warn' : 'good'} onClick={() => go('customers')} />
      </div>

      {steps.length > 0 && (
        <div className="card">
          <h2>Do next</h2>
          <ol className="steps">
            {steps.map((s, i) => (
              <li key={i}>
                <div className="step-head">
                  <strong>{s.title}</strong>
                  <span className="spacer" />
                  {s.action && (
                    <button className="small" onClick={s.action[1]}>
                      {s.action[0]}
                    </button>
                  )}
                  {s.all && (
                    <button className="linkish" onClick={s.all}>
                      See all →
                    </button>
                  )}
                </div>
                <div className="muted small-text">{s.why}</div>
                {s.top && (
                  <div className="step-items">
                    {s.top.map((a) => (
                      <a key={a.account.id} className="tag" onClick={() => go('customers', a.account.id)}>
                        {a.account.name}
                        <span className="muted"> · {s.note ? s.note(a) : a.revenueUSD ? `${amt(a.revenueUSD)}/mo` : ''}</span>
                      </a>
                    ))}
                  </div>
                )}
                {s.items && (
                  <div className="step-items">
                    {s.items.map((n) => (
                      <span key={n} className="tag">
                        {n}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="card">
        <h2>How complete</h2>
        <div className="grid2" style={{ gap: 28 }}>
          <div>
            <h3 style={{ marginTop: 0 }}>Customers</h3>
            <Progress label="Billing contact" hint="for reminders and invoices" c={c.billingEmail} onClick={() => go('customers', '?missing=billing email')} />
            <Progress label="Contact phone" c={c.phone} onClick={() => go('customers', '?missing=phone')} />
            <Progress label="Projects linked" hint="Costing ↔ Invoices" c={c.projectsLinked} onClick={() => go('customers', '?missing=linked projects')} />
            <Progress label="Rate revision date" hint="per project" c={c.revisionDate} onClick={() => go('customers', '?missing=rate revision date')} />
          </div>
          <div>
            <h3 style={{ marginTop: 0 }}>Employees</h3>
            <Progress label="Joining date" hint="years at Aloha vs before" c={c.joinDate} onClick={() => go('employees', '?missing=joining date')} />
            <Progress label="Team confirmed" hint="else guessed from title" c={c.team} onClick={() => go('employees', '?missing=team (guessed)')} />
            <Progress label="Skills" c={c.skills} onClick={() => go('employees', '?missing=skills')} />
          </div>
        </div>
      </div>
    </>
  );
}
