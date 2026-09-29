-- Aloha Master data: the details Matt keeps by hand that both apps build on.
-- Run AFTER schema.sql and collections.sql. Safe to run again.
--
-- Where each kind of master data lives
--   Customer accounts (POCs, special discount, campaigns, linked projects)  col_customers (collections.sql)
--   Project profile / rate card / revision date                              customer_profiles, customer_rates (schema.sql)
--   Employees from the HR export and payroll                                 people, people_salaries (refreshed monthly)
--   Employee details entered here (team, joining date, prior experience…)    people_profiles (below; never overwritten by a refresh)
--   PM WhatsApp                                                             pm_contacts (schema.sql)
--
-- Access: admin (Matt) writes; leadership reads; PMs and the accounts team see none of it.

create table if not exists public.people_profiles (
  emp_id text primary key,
  team text,                            -- Development, QA, Design, DevOps, Data & AI, BA, PM, Support…
  joined_on date,                       -- joined Aloha: years at Aloha are counted from this
  prior_experience_years numeric,       -- experience before Aloha
  experience_years numeric,             -- total, only when the HR export's figure is wrong
  skills text,                          -- only when the HR export's skills are wrong or missing
  phone text,
  location text,
  incentive_plan text,                  -- e.g. "5% of new billing, paid quarterly"
  notes text not null default '',
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.people_profiles enable row level security;
drop policy if exists people_profiles_read on public.people_profiles;
create policy people_profiles_read on public.people_profiles for select to authenticated using (public.can_see_all());
drop policy if exists people_profiles_write on public.people_profiles;
create policy people_profiles_write on public.people_profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke all on public.people_profiles from anon;

-- The people directory (names, designations, skills) is for staff roles, not the accounts team.
drop policy if exists people_read on public.people;
create policy people_read on public.people for select to authenticated
  using (coalesce(public.my_role() in ('admin', 'leadership', 'pm'), false));

-- Monthly billing register: one row per invoicing line per month, logged changes (with reasons)
-- and company totals as reported. id = "line|YYYY-MM|key", "change|YYYY-MM|key", "month|YYYY-MM".
create table if not exists public.billing_records (
  id text primary key,
  data jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.billing_records enable row level security;
drop policy if exists billing_records_read on public.billing_records;
create policy billing_records_read on public.billing_records for select to authenticated using (public.can_see_all());
drop policy if exists billing_records_write on public.billing_records;
create policy billing_records_write on public.billing_records for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke all on public.billing_records from anon;
