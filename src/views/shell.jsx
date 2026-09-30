import React, { useEffect, useRef, useState } from 'react';
import { inr, pct } from '../format.js';

// Small line icons for the navigation (stroke = currentColor).
const PATHS = {
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  building: 'M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M8 7h4M8 11h4M8 15h4M2 21h20',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  pause: 'M10 4H6v16h4zM18 4h-4v16h4z',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  check: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  chat: 'M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 8.4-8.5h.5a8.5 8.5 0 0 1 8 8z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
  swap: 'M16 3l4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z',
  chart: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  receipt: 'M5 2h14v20l-3-2-2 2-2-2-2 2-2-2-3 2zM9 7h6M9 11h6M9 15h4',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5',
  megaphone: 'M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15 9a3 3 0 0 1 0 6M18 6a7 7 0 0 1 0 12',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  card: 'M2 5h20v14H2zM2 10h20M6 15h4',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  cog: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
};

export function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] || PATHS.grid} />
    </svg>
  );
}

// Aloha terminology, one click away on every page.
export function Glossary({ target }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const t = Math.round(target * 100);
  return (
    <span className="glossary" ref={ref}>
      <button className="chip" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        ⓘ Terms
      </button>
      {open && (
        <div className="glossary-pop" role="dialog" aria-label="Terms">
          <dl>
            <dt>COST</dt>
            <dd>
              Actual <strong>profit %</strong>: (revenue − spend) ÷ revenue. Aloha calls this COST internally; it is the profit figure, not the amount
              spent.
            </dd>
            <dt>Spend</dt>
            <dd>Rupees paid for people's time on a customer: monthly CTC × allocation %, from payroll.</dd>
            <dt>Managed / Not managed</dt>
            <dd>
              Managed = COST at or above {t}% on project spend (engineering + PMs). Not managed = below {t}%.
            </dd>
            <dt>Cost off by</dt>
            <dd>How much monthly spend is above the {100 - t}% spend limit: the amount to cut (or bill) to be Managed.</dd>
            <dt>Spend layers</dt>
            <dd>Engineering → + PMs (project) → + bench share (the PM's bench, split across their customers) → + support share (HR, Admin, Accounts, MIS, split by engineering spend).</dd>
            <dt>Revenue</dt>
            <dd>This month's invoiced amount, converted at the US$ rate shown at the top.</dd>
          </dl>
        </div>
      )}
    </span>
  );
}

// PMs see their bench impact on every page.
export function BenchBanner({ model, me }) {
  const self = model.pms.find((p) => p.id === me.pmId);
  if (!self) return null;
  const rev = self.estRevenueINR || 0;
  const pts = rev > 0 ? (self.benchCostINR / rev) * 100 : null;
  return (
    <div className="bench-banner" role="status">
      <span>
        <strong>Your bench:</strong> {self.benchPeople} {self.benchPeople === 1 ? 'person' : 'people'} · {inr(self.benchCostINR)}/month
      </span>
      {pts != null && (
        <span>
          Lowers your team's COST by <strong>{pts.toFixed(1)} pts</strong> ({pct(self.teamLayers?.project?.cost)} → {pct(self.teamLayers?.withOwnBench?.cost)})
        </span>
      )}
      <span>Place bench people on billable work to recover it.</span>
    </div>
  );
}

// Links to the other Aloha apps (Project Costing, Collections, Master data) at the top of the sidebar.
export function AppSwitch({ items }) {
  if (!items?.length) return null;
  return (
    <div className="app-switches">
      {items.map((x) => (
        <a key={x.label} className="app-switch" onClick={x.go}>
          ⇄ {x.label}
        </a>
      ))}
    </div>
  );
}

// The three areas of the Aloha tool, shown as a switch at the top of the sidebar.
export const AREAS = {
  directory: { label: 'Directory', icon: 'book', home: '#m-overview', hint: 'Customers, teams, employees' },
  costing: { label: 'Costing', icon: 'chart', home: '#overview', hint: 'COST, spend and actions' },
  invoices: { label: 'Invoices', icon: 'receipt', home: '#c-dashboard', hint: 'Dues, payments, billing' },
};

// One layout for every area: brand, area switch, the area's navigation, the signed-in user, top bar.
// groups: [[title, [[id, label, icon], …]], …]; badges: { [id]: [{ n, tone, title }] }
export function AppShell({ area, areas = [], onArea, groups, tab, onTab, badges = {}, title, sub, chips, me, account, preview, footer, children }) {
  const [navOpen, setNavOpen] = useState(false);
  const pick = (fn) => (...a) => {
    setNavOpen(false);
    fn(...a);
  };
  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''}`} onClick={(e) => navOpen && e.target === e.currentTarget && setNavOpen(false)}>
      <aside className="side">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <div className="brand-name">Aloha Technology</div>
            <div className="brand-sub">{AREAS[area]?.label}</div>
          </div>
        </div>
        {areas.length > 1 && (
          <div className="areas" role="tablist" aria-label="Area">
            {areas.map((a) => (
              <button key={a} role="tab" aria-selected={a === area} className={`area ${a === area ? 'on' : ''}`} title={AREAS[a].hint} onClick={pick(() => onArea(a))}>
                <Icon name={AREAS[a].icon} />
                <span>{AREAS[a].label}</span>
              </button>
            ))}
          </div>
        )}
        <nav className="side-nav">
          {groups.map(([gTitle, list]) => (
            <div className="nav-group" key={gTitle}>
              {gTitle && <div className="nav-title">{gTitle}</div>}
              {list.map(([id, label, icon]) => (
                <button key={id} className={`nav-item ${tab === id ? 'on' : ''}`} onClick={pick(() => onTab(id))}>
                  <Icon name={icon} />
                  {label}
                  {(badges[id] || [])
                    .filter((b) => b.n > 0)
                    .map((b, i) => (
                      <span key={i} className={`badge ${b.tone || ''}`} title={b.title} style={i ? { marginLeft: 4 } : undefined}>
                        {b.n}
                      </span>
                    ))}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <div className="who-name">{me.name}</div>
          <div className="who-role">{me.role}</div>
          {account}
        </div>
      </aside>
      <div className="main-col">
        <header className="topbar">
          <button className="menu-btn" aria-label="Menu" onClick={() => setNavOpen((o) => !o)}>
            ☰
          </button>
          <div className="topbar-title">
            <h1>{title}</h1>
            {sub && <div className="page-sub">{sub}</div>}
          </div>
          {chips && <div className="chips">{chips}</div>}
        </header>
        <main className="content">{children}</main>
        {preview}
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}
