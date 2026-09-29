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
then `supabase/master.sql`. Base salary and incentive per person appear after the next publish from
Data & validation (the model now carries them; PMs never receive them, checked by `views.test.js`).

Code: `src/master/` (engine.js is pure and tested in `engine.test.js`), `scripts/masterdata-api.js` (local
mode), `supabase/master.sql` (tested by `supabase/master.test.js`).
