# Master data

The foundation both apps build on: one place to see and maintain customers, employees and PMs.
It is the third section of the site (sidebar → "Master data"), for Matt (edits) and leadership (reads).
PMs and the accounts team don't see it.

## One home per fact

Master data doesn't copy anything. Each field is stored where the app that uses it reads it, so an
edit here is what Costing and Collections see straight away.

| What | Stored in | Used by |
| --- | --- | --- |
| Paying customer (account): POCs with email/phone/role, name in contract, payment terms, entity, currency, special discount (+ reason, valid till), campaigns, notes, linked projects | `col_customers` | Collections (reminders, payer check, report) |
| Project profile (brief, technologies, teams) | `customer_profiles` | Costing (PMs see their own) |
| Rate card per project: bill rate per resource type, discount reason, **last revised** date | `customer_rates` | Costing rate card; revision due = last revised + 12 months (Settings) |
| Aloha standard rates, revision cycle | `app_settings` ('costing') | Both |
| Employees from HR export + payroll: name, designation, skills, total experience, allocations, CTC, base, incentive | `people`, `people_salaries`, admin snapshot | Costing; refreshed monthly |
| Employee details entered by Matt: team, joining date, experience before Aloha, total/skills corrections, phone, location, incentive plan, notes | **`people_profiles`** (new) | Master data; never overwritten by the monthly refresh |
| PM WhatsApp | `pm_contacts` | Costing WhatsApp digests |

## Contacts: several roles each

A customer contact can have any of these roles, and several people can share one:
Payment follow-up (To: on reminders) · Receives invoices · Receives tax invoices (sent after payment) ·
Escalation (copied from Day 30) · Account-management calls · Contract signed by · Cc on reminders.
The customer page shows who gets invoices, tax invoices and reminders, with a copy button.
Older contacts with a single role are read as: billing → follow-up + invoices + tax invoices.
Rules: `src/collections/engine/contacts.js`; one editor for both apps: `src/collections/views/Contacts.jsx`.

## Billing register (Master data → Billing)

Seats and revenue per invoicing line per month, the change from last month with its reason, long/short
term, and billed seats by resource type (seats × rate, checked against the line). Company view in the
"Billing Count" format; month view in the "Delta every Month" format; both download to Excel. Each
customer page shows its billing by month next to what was invoiced in Zoho, and its billing rate per seat.

- Each month: upload the invoicing sheet (Costing → Data & validation), publish, then **Record** the month
  on the Billing page. Deltas are against last month's recorded lines; term and resource types carry over;
  re-recording keeps remarks, term and resource types. Lines that stop billing are recorded at zero.
- History was seeded only from what the sheets say (`npm run billing:seed`): September 2026 line by line
  (invoicing sheet), every change Oct-25 to Aug-26 with its reason ("Delta every Month"), and company
  totals Apr-26 to Aug-26 (delta sheet summary rows and "Billing Count"). Earlier months show changes only.
  Seat history was not reconstructed: working back from September overshot reported totals by ~90 seats.
- Stored in `billing_records` (admin writes, leadership reads). Engine: `src/master/billing.js`.

## How values are combined

- **Employees:** the HR export and payroll are the base; what Matt enters wins and is labelled
  ("entered", "calculated", "guessed"). Team is guessed from the designation until confirmed.
  Years at Aloha come from the joining date; experience before Aloha is entered, or total minus years
  at Aloha. If the figures contradict each other (e.g. HR total less than years at Aloha) the row is flagged.
- **Customers:** the paying customer (Zoho) is linked to its Costing project codes. Billed seats and billing
  come from the invoicing sheet; "people assigned" is everyone on the project in the portal.
  Rates vs standard and the next revision date roll up from the project rate cards.
- **PMs:** team size = people on the PM's projects plus the bench they hold; billed seats and billing are
  split by the PM's revenue share where a project has several PMs.

## Pages

Overview (completeness + what to fill next) · Customers (list, projects not linked, detail with POCs,
commercial terms, projects + rate cards, campaigns) · Employees (filters by team/category/missing, editor,
**Update from Excel**: ID or Email + any of Team, Joining Date, Prior Experience, Phone, Location) · PMs ·
Campaigns (log a reach-out to one or many customers, results per campaign) · Standard rates.

## Going live

Supabase SQL Editor: run `supabase/schema.sql` (people directory no longer readable by the accounts team),
`supabase/collections.sql` (invoice directory shows paid invoices to the accounts team), then
`supabase/master.sql` (employee details, billing register). Base salary and incentive per person appear after the next publish from
Data & validation (the model now carries them; PMs never receive them, checked by `views.test.js`).

Code: `src/master/` (engine.js is pure and tested in `engine.test.js`), `scripts/masterdata-api.js` (local
mode), `supabase/master.sql` (tested by `supabase/master.test.js`).
