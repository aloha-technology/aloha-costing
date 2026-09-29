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
