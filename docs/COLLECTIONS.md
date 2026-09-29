# Aloha Collections

App #2 in the Aloha tool: pending-invoice follow-up, payments, contracts and tax invoices.
It sits next to Project Costing on the same site and the same sign-in (sidebar → "Switch to Collections").

| Who | Sees |
| --- | --- |
| Matt (admin) | Everything; the only one who can change anything or approve an email |
| Leadership | Everything, read-only |
| Accounts team (new `accounts` role) | Only the tax-invoice portal: upload PDFs, see their uploads and Matt's notes |
| PMs | Nothing in Collections (they are copied on customer emails from Day 16) |

The database enforces this (`supabase/collections.sql`, tested by `supabase/collections.test.js`).

## Pages

- **Dashboard**: pending by customer, PM and billing month; aging buckets (colour-coded, clickable);
  filters for PM and month(s); a suggested next action per customer.
- **Reminders**: today's emails, one per customer, drafted from your templates with invoice
  details filled in. Review & send, approve all, skip a stage, reschedule. Also Coming up (7 days),
  Outbox and Sent log.
- **Customers**: billing / escalation / cc contacts, PM, name in contract, billing code,
  promise to pay, invoices with controls, notes and activity, contracts, payments.
- **Invoices**: every invoice. Click one for its controls: record payment (Mark paid), Do not send,
  Reschedule, Skip stage, Bad debt / Void, Notes.
- **Payments**: date, currency paid, amount received, bank charges, FX rate, bank reference.
  The payer name from the bank is checked against the customer name in the contract; a mismatch
  needs a note. Split across invoices (oldest first by default). A fully paid invoice stops its reminders.
- **Tax invoices**: sent after payment. Invoices paid in the last 120 days without a tax invoice are listed
  for the accounts team ("Paid: tax invoice needed") and for Matt; sending one for an unpaid invoice warns.
  They go to contacts marked "Receives tax invoices" (else invoice recipients, else follow-up). Accounts upload PDFs (auto-matched to the invoice by file name). Matt opens each one,
  marks it Checked or sends it back with a note, then sends it to the customer with the PDF attached.
- **Contracts**: repository per customer (file, type, legal name, term, payment terms), with
  expiry warnings and a list of active customers without a contract.
- **Reports**: Excel for Sid in the layout of `New_File_AR_FY 22 - 26.xlsx`: **Pivot** (billing month →
  Sum of bcy_total / Sum of bcy_balance / Grand Total, void and bad debt left out, month range selectable) and
  **Dump** (every invoice with the Zoho columns, Matt's comment, true-void amount), then Pending by customer,
  Aging & collections, and Payments received with bank charges.
- **Setup & import**: confirm every customer and open invoice the first setup created; import the
  latest Zoho "Invoice Details" (or QuickBooks) export. The import shows a diff (new, paid, part-paid,
  unknown customers) before anything changes.
- **Settings**: timeline days, who is copied, templates with live preview, auto-send per stage,
  Nidhi Ma'am's email, signature, minimum gap between emails.

## Follow-up timeline

Days since the invoice date (Aloha invoices are net 15, so Day 16 is the first day overdue):

| Day | Stage | Copied |
| --- | --- | --- |
| 5 | Gentle reminder | |
| 10 | Follow-up | |
| 16 | Overdue | PM |
| 20 and 27 | Push | PM |
| 30 | Escalate | PM, Nidhi Ma'am, customer escalation contacts |
| 35 | Escalate more | same |
| 40 | Stop work notice | same |

- Only the latest stage reached is sent. An invoice first picked up on day 33 gets "Escalate", not
  five old emails.
- One email per customer. Invoices due the same day go together at the highest stage, with an invoice list.
- Held (shown under "On hold") when: no billing email, a promise-to-pay date is in the future,
  the customer had an email in the last 3 days, or the customer is set to Do not send.
- **Nothing goes to a customer without Matt's click** unless he switches a stage to Auto-send in Settings.

## Sending email

Aloha mail is on Yahoo Business Mail. Until SMTP is set up, use **Open in my email** (opens your
mail app with everything filled in) and then **Mark sent**. For tax invoices, download the PDF and attach it.

To let the app send (and attach PDFs):

1. Yahoo Business Mail → Account security → **Generate app password** (for "Aloha tool").
2. Local: add to `.env`
   ```
   SMTP_USER=matt@alohatechnology.com
   SMTP_PASS=<the app password>
   ```
   Then "Send queued now" in Reminders → Outbox works, or run `npm run col:send`.
   Emails go from SMTP_USER with a copy (bcc) to the sender email in Settings.
3. Cloud: GitHub repo → Settings → Secrets and variables → Actions:
   - Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SMTP_USER`, `SMTP_PASS`
   - Variable: `COLLECTIONS_SEND_ENABLED` = `true`

   `.github/workflows/collections-send.yml` then sends the outbox every 30 minutes on weekdays
   (9:00–19:30 IST). It is off until that variable is set.

## Going live (after Project Costing's Supabase setup in SETUP.md)

1. Supabase → SQL Editor: run `supabase/schema.sql` (if changed), then **`supabase/collections.sql`**.
   This creates the tables, the private `collections` storage bucket and the `accounts` role.
2. `npm run col:push -- --apply` uploads the local Collections data (customers, invoices, files).
3. Add the accounts team to `data/users.json`:
   `"accounts": [{ "email": "accounts@alohatechnology.com", "name": "Accounts" }]`,
   then `npm run users -- --apply` (starting passwords go to `data/new-passwords.txt`).
4. Leadership already in `users.json` see Collections automatically.

## Local use

- `npm run dev` (or `npm run dev:local`), then open `#c-dashboard` or use the sidebar switch.
- Preview other roles: `?as=leadership` or `?as=accounts`.
- Data: `data/collections/*.json` and uploaded files in `data/collections/files/` (git-ignored, confidential).
- First setup from Matt's spreadsheets: `npm run col:seed` (preview) / `-- --apply`. Source paths can be
  overridden in `data/collections-sources.json`. Everything seeded is "not confirmed" until Matt checks it.

## Code

- `src/collections/engine/`: pure JS, shared by the app and scripts (`collections.test.js`):
  `reminders.js` (timeline, grouping, templates), `aging.js`, `payments.js` (payer check, allocation,
  bank charges/FX), `importer.js` (Zoho/QB), `suggest.js` (next actions), `report.js` (Sid's Excel), `settings.js` (defaults + templates).
- `src/collections/views/`: pages. `useCollections.js`: every change as a named operation.
- `src/collections/data/api.js`: local (dev-server API) and cloud (Supabase) with the same methods.
- `scripts/collections-api.js` (dev server), `collections-store.mjs` (local/Supabase store + SMTP sender),
  `collections-seed.mjs`, `collections-push.mjs`, `collections-send.mjs`.
