# Aloha Technology

This repo is for **Aloha Technology** work only. It is a separate company from OptimizeBD —
do not reuse OptimizeBD code, branding, copy, keys, or hosting here.

## Company
Aloha builds IT solutions for small businesses.

## My role (Matt — finance & account operations)
- **Invoicing:** send invoices to clients; send tax invoices prepared by the accounts team
  (I send them, I don't create or alter them).
- **Collections:** follow up on unpaid invoices until payment is received.
- **Recording:** record payments received against the right invoice/client.
- **Project costing:** work with PMs on project cost estimates and tracking.
- **Bench:** track unallocated (bench) resources with PMs.
- **Account management:** join client account-management calls; prepare notes and follow-ups.

## How Claude should help
- Drafting emails (invoice sends, payment reminders, call follow-ups) — always show drafts
  to me first; never send anything to a client without my explicit OK.
- Never change amounts, tax details, or bank details on an invoice from the accounts team.
- Treat client names, invoice amounts, and bank details as confidential; keep them out of
  committed files unless I say otherwise.

## Project
- What we're building (app #1): **Project Costing tracker.**
  - ~80 customers, ~14 PMs. A customer has one or more PMs/teams.
  - Revenue = seats × per-seat revenue. Cost = Σ (resource salary × allocation %).
  - Target margin **70%** = (revenue − cost) / revenue. Flag anything below.
  - Recommendations to cut cost, action items per PM with a TAT (turnaround time),
    tracked to closure.
  - Users: Matt (admin), PMs (see only their own customers), leadership (all customers).
  - **PMs must never see individual salaries** — only total cost, margin, and actions for
    their customers. Salary-level detail is for Matt and leadership only; enforce this in
    the database access rules, not just by hiding it in the UI.
  - WhatsApp: the app drafts each PM's message; Matt clicks to open WhatsApp and posts
    it to that PM's group. Nothing is auto-sent.
  - Cadence: weekly cost digest per PM, plus alerts when an action passes its TAT.
  - Actions: one open action per finding; default TAT by severity (critical 3 days, high 7,
    medium 14, low 30); closing or dropping needs a note; every change is logged. Stored in
    `data/actions.json` via a dev-server API (`scripts/actions-api.js`) until Supabase.
  - WhatsApp (`src/whatsapp/messages.js`): weekly digest, overdue alert, new-action message.
    Built only from PM-safe fields (customer margin/gap, finding `pmText`/`ask`, action text);
    `messages.test.js` checks real data for salary leaks. Copy + "Mark as sent" logs to
    `data/comms.json` and notes each covered action. Contacts in `data/pm-contacts.json`.
- Stack: Vite + React (plain JS). Engine in `src/engine/` is pure JS shared by the import
  script and tests. Hosting: GitHub Pages (public repo, code only). Data + logins: Supabase
  (`supabase/schema.sql`, RLS tested in PGlite by `supabase/schema.test.js`). Setup: `docs/SETUP.md`.
- Two modes: local (no Supabase env vars; dev-server API over `data/*.json`; `?as=pm:<id>` or
  `?as=leadership` previews roles read-only) and cloud (Supabase). `npm run dev:local` forces local.
- Publishing: `npm run publish` uploads an `admin` snapshot + one `pm:<id>` snapshot per PM built
  by `pmView()` (`src/engine/views.js`, a whitelist). Salary data must never reach `dist/`:
  `scripts/check-dist.mjs` runs after every build and fails on data files or real names.
- Sign-in: email + password only (no SMTP / no emails). `npm run users -- --apply` creates logins
  with random starting passwords written to `data/new-passwords.txt` (never printed); Matt sends
  them on WhatsApp; the app forces a change on first sign-in. `npm run reset-password -- <email>`.
- Roles: admin (Matt, all writes), leadership (read all), pm (own data; notes / start / ask to
  close via `pm_action_update()`; only admin confirms closure).
- Commands: `npm run import` (reads `data/inbox/`, writes `data/model.json`, git-ignored and
  never in a build because it has salaries; served in dev by `/api/model`), `npm run dev` (http://localhost:5180), `npm test`.
- Revenue basis: the invoiced amount (invoicing file) when the customer is on it, else the costing
  sheet. The costing sheet double-counts some invoices across customers; differences are flagged
  (INVOICE_MISMATCH) and listed in Data checks.
- COST_DRIVER deliberately includes PMs (a PM can be flagged as the biggest cost driver on their
  own account). Matt chose to keep this on 2026-09-28; do not exclude PMs.
- Cost basis: margins use the costing sheet's Cost INR (official). Paysheet CTC x utilization
  is only used to explain cost drivers; it runs ~9% higher (July paysheet vs Sept costing).
- Source data: invoices are issued in **Zoho** and **QuickBooks**. Matt exports Excel dumps
  and drops them in `data/inbox/` (git-ignored, confidential). Treat Zoho and QB rows as
  possibly overlapping; match on invoice number + client before merging.

## Conventions
- Commit email for this repo: matt@alohatechnology.com (set in repo-local git config).
- Secrets live in `.env` files (git-ignored); never commit them or copy them from other projects.
