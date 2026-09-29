-- Aloha Project Costing: Supabase schema + row-level security.
-- Run this whole file in the Supabase SQL editor. It is safe to run again.
--
-- Roles (table app_users, keyed by login email):
--   admin      - Matt: everything, including writes
--   leadership - read everything (incl. salary-level detail), no writes
--   pm         - read only their own snapshot and actions; update actions via pm_action_update()

-- ---------------------------------------------------------------------------
-- Users and role helpers
-- ---------------------------------------------------------------------------
create table if not exists public.app_users (
  email text primary key check (email = lower(email)),
  role text not null check (role in ('admin', 'leadership', 'pm')),
  pm_id text,
  name text,
  created_at timestamptz not null default now(),
  check (role <> 'pm' or pm_id is not null)
);

create or replace function public.my_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.app_users where email = public.my_email()
$$;

create or replace function public.my_pm_id() returns text
language sql stable security definer set search_path = public as $$
  select pm_id from public.app_users where email = public.my_email() and role = 'pm'
$$;

create or replace function public.is_admin() returns boolean
language sql stable as $$ select coalesce(public.my_role() = 'admin', false) $$;

create or replace function public.can_see_all() returns boolean
language sql stable as $$ select coalesce(public.my_role() in ('admin', 'leadership'), false) $$;

alter table public.app_users enable row level security;
drop policy if exists app_users_read on public.app_users;
create policy app_users_read on public.app_users for select to authenticated
  using (email = public.my_email() or public.can_see_all());

-- ---------------------------------------------------------------------------
-- Snapshots: one row per import per audience.
--   audience = 'admin'      full model (salaries), for admin + leadership
--   audience = 'pm:<pm_id>' PM-safe model for that PM only
-- Written only by the publish script (service role bypasses RLS).
-- ---------------------------------------------------------------------------
create table if not exists public.snapshots (
  period text not null,
  audience text not null,
  generated_at timestamptz not null,
  data jsonb not null,
  primary key (period, audience)
);

alter table public.snapshots enable row level security;
drop policy if exists snapshots_read on public.snapshots;
create policy snapshots_read on public.snapshots for select to authenticated
  using (
    (audience = 'admin' and public.can_see_all())
    or (audience = 'pm:' || public.my_pm_id())
  );

-- ---------------------------------------------------------------------------
-- Actions
-- ---------------------------------------------------------------------------
create table if not exists public.actions (
  id text primary key,
  customer_code text not null,
  customer_name text not null default '',
  finding_id text,
  kind text not null default 'MANUAL',
  severity text not null default 'medium' check (severity in ('critical', 'high', 'medium', 'low')),
  title text not null,
  ask text not null default '',
  description text not null default '',
  owner_pm_id text not null,
  period text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'closure_requested', 'done', 'dropped')),
  created_at timestamptz not null default now(),
  created_by text not null,
  due_date date not null,
  original_due_date date not null,
  closed_at timestamptz,
  closure_note text,
  history jsonb not null default '[]'::jsonb
);
create index if not exists actions_owner on public.actions (owner_pm_id);
-- One open action per finding.
create unique index if not exists actions_one_open_per_finding on public.actions (finding_id)
  where finding_id is not null and status not in ('done', 'dropped');

alter table public.actions enable row level security;
drop policy if exists actions_read on public.actions;
create policy actions_read on public.actions for select to authenticated
  using (public.can_see_all() or owner_pm_id = public.my_pm_id());
drop policy if exists actions_admin_insert on public.actions;
create policy actions_admin_insert on public.actions for insert to authenticated with check (public.is_admin());
drop policy if exists actions_admin_update on public.actions;
create policy actions_admin_update on public.actions for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Estimated savings can reveal one person's cost, so they live apart from actions.
create table if not exists public.action_savings (
  action_id text primary key references public.actions (id) on delete cascade,
  saving_inr numeric not null default 0
);
alter table public.action_savings enable row level security;
drop policy if exists action_savings_read on public.action_savings;
create policy action_savings_read on public.action_savings for select to authenticated using (public.can_see_all());
drop policy if exists action_savings_write on public.action_savings;
create policy action_savings_write on public.action_savings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- PMs change their own actions only through this function:
--   op 'note'          add a note (text required)
--   op 'start'         open -> in progress
--   op 'request_close' -> closure requested (note required); Matt then closes or sends back
create or replace function public.pm_action_update(p_id text, p_op text, p_note text default null)
returns public.actions
language plpgsql security definer set search_path = public as $$
declare
  a public.actions;
  who text;
  note text := nullif(btrim(coalesce(p_note, '')), '');
  entry jsonb;
begin
  select * into a from public.actions where id = p_id for update;
  if not found then raise exception 'Action not found'; end if;
  if public.my_pm_id() is null or a.owner_pm_id <> public.my_pm_id() then
    raise exception 'You can only update your own actions';
  end if;
  if a.status in ('done', 'dropped') then raise exception 'This action is closed'; end if;
  select coalesce(name, email) into who from public.app_users where email = public.my_email();

  if p_op = 'note' then
    if note is null then raise exception 'A note is required'; end if;
    entry := jsonb_build_object('type', 'note', 'text', note);
  elsif p_op = 'start' then
    if a.status <> 'open' then raise exception 'Only open actions can be started'; end if;
    entry := jsonb_build_object('type', 'status', 'from', a.status, 'to', 'in_progress',
      'text', 'Open → In progress' || coalesce(': ' || note, ''));
    a.status := 'in_progress';
  elsif p_op = 'request_close' then
    if note is null then raise exception 'Say what was done before asking to close'; end if;
    if a.status = 'closure_requested' then raise exception 'Closure already requested'; end if;
    entry := jsonb_build_object('type', 'status', 'from', a.status, 'to', 'closure_requested',
      'text', 'Closure requested: ' || note);
    a.status := 'closure_requested';
  else
    raise exception 'Unknown operation %', p_op;
  end if;

  entry := entry || jsonb_build_object('at', now(), 'by', who);
  update public.actions set status = a.status, history = history || jsonb_build_array(entry)
    where id = p_id returning * into a;
  return a;
end $$;

revoke all on function public.pm_action_update(text, text, text) from public, anon;
grant execute on function public.pm_action_update(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- WhatsApp contacts and the log of messages sent (admin only)
-- ---------------------------------------------------------------------------
create table if not exists public.pm_contacts (
  pm_id text primary key,
  whatsapp text not null default '',
  group_link text not null default '',
  updated_at timestamptz not null default now()
);
create table if not exists public.comms_log (
  id text primary key,
  at timestamptz not null default now(),
  by text not null,
  pm_id text not null,
  type text not null,
  text text not null,
  action_ids text[] not null default '{}'
);
alter table public.pm_contacts enable row level security;
alter table public.comms_log enable row level security;
drop policy if exists pm_contacts_admin on public.pm_contacts;
create policy pm_contacts_admin on public.pm_contacts for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists comms_log_admin on public.comms_log;
create policy comms_log_admin on public.comms_log for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists comms_log_leadership_read on public.comms_log;
create policy comms_log_leadership_read on public.comms_log for select to authenticated using (public.can_see_all());

-- Nothing is readable without logging in.
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- Customer master data (step 2). Admin writes; leadership reads all; PMs read the
-- profile (brief, technologies, teams) of their own customers, never the rate card.
-- ---------------------------------------------------------------------------
create table if not exists public.customer_profiles (
  code text primary key,
  name text not null default '',
  brief text not null default '',
  technologies text[] not null default '{}',
  teams integer,
  notes text not null default '',
  manual boolean not null default false,       -- added in the app, not from an export
  pm_ids text[] not null default '{}',         -- kept in sync by the publish script
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.customer_profiles enable row level security;
drop policy if exists customer_profiles_read on public.customer_profiles;
create policy customer_profiles_read on public.customer_profiles for select to authenticated
  using (public.can_see_all() or public.my_pm_id() = any (pm_ids));
drop policy if exists customer_profiles_write on public.customer_profiles;
create policy customer_profiles_write on public.customer_profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create table if not exists public.customer_rates (
  code text primary key,
  roles jsonb not null default '{}'::jsonb,    -- { role: { billRateUSD?, reason? } }
  reason text not null default '',             -- default discount reason for the customer
  last_revised date,
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.customer_rates enable row level security;
drop policy if exists customer_rates_read on public.customer_rates;
create policy customer_rates_read on public.customer_rates for select to authenticated using (public.can_see_all());
drop policy if exists customer_rates_write on public.customer_rates;
create policy customer_rates_write on public.customer_rates for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings for select to authenticated using (true);
drop policy if exists app_settings_write on public.app_settings;
create policy app_settings_write on public.app_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke all on public.customer_profiles, public.customer_rates, public.app_settings from anon;

-- ---------------------------------------------------------------------------
-- Step 3: in-app uploads, validation, classification and corrections.
-- Raw uploaded rows (incl. salaries) and salary corrections are admin-only.
-- Validation stamps and revenue corrections are readable by leadership.
-- ---------------------------------------------------------------------------
create table if not exists public.import_files (
  period text not null,
  kind text not null,
  file_name text not null,
  sheet_name text,
  header jsonb not null default '[]'::jsonb,
  rows jsonb not null,
  uploaded_by text,
  uploaded_at timestamptz not null default now(),
  primary key (period, kind)
);
create table if not exists public.dataset_validations (
  period text not null,
  kind text not null,
  status text not null check (status in ('validated', 'rejected')),
  note text not null default '',
  checks jsonb not null default '[]'::jsonb,
  file_name text,
  validated_by text,
  validated_at timestamptz not null default now(),
  primary key (period, kind)
);
create table if not exists public.customer_validations (
  period text not null,
  code text not null,
  status text not null check (status in ('validated', 'rejected')),
  note text not null default '',
  validated_by text,
  validated_at timestamptz not null default now(),
  primary key (period, code)
);
create table if not exists public.people_categories (
  emp_id text primary key,
  category text not null check (category in ('engineering', 'pm', 'support', 'overhead', 'leaving', 'exclude')),
  name text,
  note text not null default '',
  updated_by text,
  updated_at timestamptz not null default now()
);
create table if not exists public.revenue_overrides (
  period text not null,
  code text not null,
  amount_usd numeric not null,
  reason text not null,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (period, code)
);
create table if not exists public.salary_overrides (
  emp_id text primary key,
  ctc_monthly_inr numeric not null,
  reason text not null,
  name text,
  updated_by text,
  updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['import_files', 'dataset_validations', 'customer_validations', 'people_categories', 'revenue_overrides', 'salary_overrides'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_admin', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
drop policy if exists dataset_validations_read on public.dataset_validations;
create policy dataset_validations_read on public.dataset_validations for select to authenticated using (public.can_see_all());
drop policy if exists customer_validations_read on public.customer_validations;
create policy customer_validations_read on public.customer_validations for select to authenticated using (public.can_see_all());
drop policy if exists revenue_overrides_read on public.revenue_overrides;
create policy revenue_overrides_read on public.revenue_overrides for select to authenticated using (public.can_see_all());

-- Matt publishes from the app (his browser builds the snapshots), so admin may write them.
drop policy if exists snapshots_admin_write on public.snapshots;
create policy snapshots_admin_write on public.snapshots for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Step 4: the app is the source of allocations. PMs edit allocations on their own
-- customers through functions; costs are computed in the database so salaries never
-- leave it. People directory is readable by all signed-in users (no salary).
-- ---------------------------------------------------------------------------
create table if not exists public.people (
  emp_id text primary key,
  name text not null,
  email text,
  designation text not null default '',
  category text not null default 'engineering' check (category in ('engineering', 'pm', 'support', 'overhead', 'leaving', 'exclude')),
  skills text not null default '',
  experience_years numeric,
  bench_pm text,                 -- PM who holds this person's free (bench) time; a PM holds their own
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
create table if not exists public.people_salaries (
  emp_id text primary key references public.people (emp_id) on delete cascade,
  ctc_monthly_inr numeric not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.allocations (
  id text primary key,
  emp_id text not null references public.people (emp_id),
  customer_code text not null,
  subproject text not null default '',
  owner_pm text,
  util_pct numeric not null check (util_pct > 0 and util_pct <= 100),
  billable boolean not null default false,
  updated_by text,
  updated_at timestamptz not null default now()
);
create index if not exists allocations_customer on public.allocations (customer_code);
create index if not exists allocations_emp on public.allocations (emp_id);
create table if not exists public.allocation_history (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  by text,
  emp_id text,
  customer_code text,
  action text not null check (action in ('add', 'set', 'remove', 'seed')),
  before jsonb,
  after jsonb,
  note text not null default ''
);
create table if not exists public.customer_revenue (
  code text primary key,
  name text not null default '',
  revenue_inr numeric not null default 0,
  revenue_usd numeric not null default 0,
  period text,
  updated_at timestamptz not null default now()
);

-- Customers the caller may see: everything for admin/leadership, own customers for a PM.
create or replace function public.is_my_customer(p_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_see_all() or exists (select 1 from public.customer_profiles where code = p_code and public.my_pm_id() = any (pm_ids))
$$;
-- Strict version for writes: the PM must actually be on the customer.
create or replace function public.pm_owns_customer(p_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_pm_id() is not null and exists (select 1 from public.customer_profiles where code = p_code and public.my_pm_id() = any (pm_ids))
$$;

alter table public.people enable row level security;
alter table public.people_salaries enable row level security;
alter table public.allocations enable row level security;
alter table public.allocation_history enable row level security;
alter table public.customer_revenue enable row level security;
drop policy if exists people_read on public.people;
create policy people_read on public.people for select to authenticated using (coalesce(public.my_role() in ('admin', 'leadership', 'pm'), false)); -- not the accounts team
drop policy if exists people_write on public.people;
create policy people_write on public.people for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists people_salaries_read on public.people_salaries;
create policy people_salaries_read on public.people_salaries for select to authenticated using (public.can_see_all());
drop policy if exists people_salaries_write on public.people_salaries;
create policy people_salaries_write on public.people_salaries for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists allocations_read on public.allocations;
create policy allocations_read on public.allocations for select to authenticated
  using (public.is_my_customer(customer_code) or exists (select 1 from public.people p where p.emp_id = allocations.emp_id and p.bench_pm = public.my_pm_id()));
drop policy if exists allocations_write on public.allocations;
create policy allocations_write on public.allocations for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists allocation_history_read on public.allocation_history;
create policy allocation_history_read on public.allocation_history for select to authenticated using (public.is_my_customer(customer_code));
drop policy if exists allocation_history_write on public.allocation_history;
create policy allocation_history_write on public.allocation_history for insert to authenticated with check (public.is_admin());
drop policy if exists customer_revenue_read on public.customer_revenue;
create policy customer_revenue_read on public.customer_revenue for select to authenticated using (public.is_my_customer(code));
drop policy if exists customer_revenue_write on public.customer_revenue;
create policy customer_revenue_write on public.customer_revenue for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.people, public.people_salaries, public.allocations, public.allocation_history, public.customer_revenue from anon;

-- Load per person (no salary): lets PMs see who has free time.
create or replace function public.person_load()
returns table (emp_id text, allocated_pct numeric)
language sql stable security definer set search_path = public as $$
  select a.emp_id, sum(a.util_pct) from public.allocations a group by a.emp_id
$$;
revoke all on function public.person_load() from public, anon;
grant execute on function public.person_load() to authenticated;

-- Allocations after a list of proposed changes (not saved). Internal.
--   changes: [{ op: 'add', emp_id, customer_code, util_pct, billable }
--             | { op: 'set', id, util_pct?, billable? } | { op: 'remove', id }]
create or replace function public._alloc_after(p_changes jsonb)
returns table (id text, emp_id text, customer_code text, util_pct numeric, billable boolean)
language sql stable security definer set search_path = public as $$
  with ch as (
    select * from jsonb_to_recordset(coalesce(p_changes, '[]'::jsonb))
      as x(op text, id text, emp_id text, customer_code text, util_pct numeric, billable boolean)
  )
  select a.id, a.emp_id, a.customer_code, a.util_pct, a.billable from public.allocations a
    where not exists (select 1 from ch where ch.id = a.id and ch.op in ('set', 'remove'))
  union all
  select a.id, a.emp_id, a.customer_code, coalesce(ch.util_pct, a.util_pct), coalesce(ch.billable, a.billable)
    from public.allocations a join ch on ch.id = a.id and ch.op = 'set'
  union all
  select 'new:' || row_number() over (), ch.emp_id, ch.customer_code, ch.util_pct, coalesce(ch.billable, false)
    from ch where ch.op = 'add'
$$;
revoke all on function public._alloc_after(jsonb) from public, anon, authenticated;

-- PMs may only propose changes on their own customers; admin may change anything.
create or replace function public._check_changes(p_changes jsonb) returns void
language plpgsql stable security definer set search_path = public as $$
declare c record; code text;
begin
  if public.is_admin() then return; end if;
  for c in select * from jsonb_to_recordset(coalesce(p_changes, '[]'::jsonb)) as x(op text, id text, customer_code text) loop
    if public.my_pm_id() is null then raise exception 'Only PMs and admins can change allocations'; end if;
    if c.op = 'add' then code := c.customer_code;
    elsif c.op in ('set', 'remove') then select a.customer_code into code from public.allocations a where a.id = c.id;
    else raise exception 'Unknown change %', c.op;
    end if;
    if code is null or not public.pm_owns_customer(code) then
      raise exception 'You can only change allocations on your own customers';
    end if;
  end loop;
end $$;
revoke all on function public._check_changes(jsonb) from public, anon, authenticated;

-- Live customer costs, before and after proposed changes. Returns totals only, never salaries.
create or replace function public.customer_costs(p_changes jsonb default '[]'::jsonb)
returns table (code text, name text, revenue_inr numeric, spend_before numeric, spend_after numeric,
               eng_before numeric, eng_after numeric, cost_before numeric, cost_after numeric,
               off_by_before numeric, off_by_after numeric, managed_before boolean, managed_after boolean)
language plpgsql stable security definer set search_path = public as $$
declare t numeric := coalesce((select (s.value ->> 'target')::numeric from public.app_settings s where s.key = 'live'), 0.7);
begin
  perform public._check_changes(p_changes);
  return query
  with b as (
    select a.customer_code, sum(coalesce(s.ctc_monthly_inr, 0) * a.util_pct / 100) as spend,
           sum(case when p.category <> 'pm' then coalesce(s.ctc_monthly_inr, 0) * a.util_pct / 100 else 0 end) as eng
    from public.allocations a join public.people p on p.emp_id = a.emp_id left join public.people_salaries s on s.emp_id = a.emp_id
    group by a.customer_code
  ), f as (
    select a.customer_code, sum(coalesce(s.ctc_monthly_inr, 0) * a.util_pct / 100) as spend,
           sum(case when p.category <> 'pm' then coalesce(s.ctc_monthly_inr, 0) * a.util_pct / 100 else 0 end) as eng
    from public._alloc_after(p_changes) a join public.people p on p.emp_id = a.emp_id left join public.people_salaries s on s.emp_id = a.emp_id
    group by a.customer_code
  )
  select r.code, r.name, r.revenue_inr,
         coalesce(b.spend, 0), coalesce(f.spend, 0), coalesce(b.eng, 0), coalesce(f.eng, 0),
         case when r.revenue_inr > 0 then (r.revenue_inr - coalesce(b.spend, 0)) / r.revenue_inr end,
         case when r.revenue_inr > 0 then (r.revenue_inr - coalesce(f.spend, 0)) / r.revenue_inr end,
         greatest(0, coalesce(b.spend, 0) - (1 - t) * r.revenue_inr),
         greatest(0, coalesce(f.spend, 0) - (1 - t) * r.revenue_inr),
         r.revenue_inr > 0 and (r.revenue_inr - coalesce(b.spend, 0)) / r.revenue_inr >= t,
         r.revenue_inr > 0 and (r.revenue_inr - coalesce(f.spend, 0)) / r.revenue_inr >= t
  from public.customer_revenue r left join b on b.customer_code = r.code left join f on f.customer_code = r.code
  where public.is_my_customer(r.code);
end $$;
revoke all on function public.customer_costs(jsonb) from public, anon;
grant execute on function public.customer_costs(jsonb) to authenticated;

-- Bench per PM, before and after: free time (100% minus allocations) x CTC of engineers held
-- by the PM, plus the PM's own free time (as the portal counts it).
-- A PM sees only their own bench; admin/leadership see every PM.
create or replace function public.team_bench(p_changes jsonb default '[]'::jsonb)
returns table (pm_id text, people integer, free_pct_before numeric, free_pct_after numeric, spend_before numeric, spend_after numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._check_changes(p_changes);
  return query
  with lb as (select a.emp_id, sum(a.util_pct) as u from public.allocations a group by a.emp_id),
       la as (select a.emp_id, sum(a.util_pct) as u from public._alloc_after(p_changes) a group by a.emp_id),
       x as (
         select p.bench_pm, p.emp_id, coalesce(s.ctc_monthly_inr, 0) as ctc,
                greatest(0, 100 - coalesce(lb.u, 0)) as fb, greatest(0, 100 - coalesce(la.u, 0)) as fa
         from public.people p left join public.people_salaries s on s.emp_id = p.emp_id
           left join lb on lb.emp_id = p.emp_id left join la on la.emp_id = p.emp_id
         where p.active and p.category in ('engineering', 'pm') and p.bench_pm is not null
       )
  select x.bench_pm, (count(*) filter (where x.fb > 0 or x.fa > 0))::integer, sum(x.fb), sum(x.fa), sum(x.ctc * x.fb / 100), sum(x.ctc * x.fa / 100)
  from x
  where public.can_see_all() or x.bench_pm = public.my_pm_id()
  group by x.bench_pm;
end $$;
revoke all on function public.team_bench(jsonb) from public, anon;
grant execute on function public.team_bench(jsonb) to authenticated;

-- Save changes (PM on own customers, or admin). All-or-nothing; history for every change;
-- rejects anyone ending up over 100%.
create or replace function public.apply_allocation_changes(p_changes jsonb, p_note text default '')
returns integer
language plpgsql security definer set search_path = public as $$
declare c record; a public.allocations; who text; n integer := 0; nid text; sp text; over text; owner text;
begin
  if not public.is_admin() and public.my_pm_id() is null then raise exception 'Only PMs and admins can change allocations'; end if;
  perform public._check_changes(p_changes);
  select coalesce(u.name, u.email) into who from public.app_users u where u.email = public.my_email();
  for c in select * from jsonb_to_recordset(coalesce(p_changes, '[]'::jsonb))
             as x(op text, id text, emp_id text, customer_code text, util_pct numeric, billable boolean, owner_pm text) loop
    if c.op = 'add' then
      if c.util_pct is null or c.util_pct <= 0 or c.util_pct > 100 then raise exception 'Time must be between 1 and 100%%'; end if;
      owner := coalesce(c.owner_pm, public.my_pm_id());
      select al.subproject into sp from public.allocations al where al.customer_code = c.customer_code and al.owner_pm = owner limit 1;
      nid := 'AL-' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
      insert into public.allocations (id, emp_id, customer_code, subproject, owner_pm, util_pct, billable, updated_by)
        values (nid, c.emp_id, c.customer_code, coalesce(sp, ''), owner, c.util_pct, coalesce(c.billable, false), who)
        returning * into a;
      insert into public.allocation_history (by, emp_id, customer_code, action, after, note)
        values (who, a.emp_id, a.customer_code, 'add', jsonb_build_object('util_pct', a.util_pct, 'billable', a.billable), coalesce(p_note, ''));
    elsif c.op = 'set' then
      select * into a from public.allocations al where al.id = c.id for update;
      if not found then raise exception 'Allocation not found'; end if;
      update public.allocations al set util_pct = coalesce(c.util_pct, al.util_pct), billable = coalesce(c.billable, al.billable), updated_by = who, updated_at = now() where al.id = c.id;
      insert into public.allocation_history (by, emp_id, customer_code, action, before, after, note)
        values (who, a.emp_id, a.customer_code, 'set', jsonb_build_object('util_pct', a.util_pct, 'billable', a.billable),
                jsonb_build_object('util_pct', coalesce(c.util_pct, a.util_pct), 'billable', coalesce(c.billable, a.billable)), coalesce(p_note, ''));
    elsif c.op = 'remove' then
      delete from public.allocations al where al.id = c.id returning * into a;
      if not found then raise exception 'Allocation not found'; end if;
      insert into public.allocation_history (by, emp_id, customer_code, action, before, note)
        values (who, a.emp_id, a.customer_code, 'remove', jsonb_build_object('util_pct', a.util_pct, 'billable', a.billable), coalesce(p_note, ''));
    end if;
    n := n + 1;
  end loop;
  select string_agg(p.name || ' (' || round(t.u) || '%)', ', ') into over
    from (select al.emp_id, sum(al.util_pct) as u from public.allocations al group by al.emp_id having sum(al.util_pct) > 100.5) t
    join public.people p on p.emp_id = t.emp_id;
  if over is not null then raise exception 'Over 100%% allocated: %', over; end if;
  return n;
end $$;
revoke all on function public.apply_allocation_changes(jsonb, text) from public, anon;
grant execute on function public.apply_allocation_changes(jsonb, text) to authenticated;

-- Admin sync, all-or-nothing: refresh people, salaries, revenue and live settings from the
-- month's build; with p.allocations, also replace every allocation (the one-time switch to the
-- app as the source, or a deliberate reset).
create or replace function public.admin_sync(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare who text; n_alloc integer := null;
begin
  if not public.is_admin() then raise exception 'Only an admin can sync'; end if;
  select coalesce(u.name, u.email) into who from public.app_users u where u.email = public.my_email();

  insert into public.people (emp_id, name, email, designation, category, skills, experience_years, bench_pm, active, updated_at)
    select x.emp_id, x.name, x.email, coalesce(x.designation, ''), x.category, coalesce(x.skills, ''), x.experience_years, x.bench_pm, coalesce(x.active, true), now()
    from jsonb_to_recordset(coalesce(p -> 'people', '[]'::jsonb))
      as x(emp_id text, name text, email text, designation text, category text, skills text, experience_years numeric, bench_pm text, active boolean)
  on conflict (emp_id) do update set name = excluded.name, email = excluded.email, designation = excluded.designation,
    category = excluded.category, skills = excluded.skills, experience_years = excluded.experience_years,
    bench_pm = excluded.bench_pm, active = excluded.active, updated_at = now();

  insert into public.people_salaries (emp_id, ctc_monthly_inr, updated_at)
    select x.emp_id, x.ctc_monthly_inr, now() from jsonb_to_recordset(coalesce(p -> 'salaries', '[]'::jsonb)) as x(emp_id text, ctc_monthly_inr numeric)
  on conflict (emp_id) do update set ctc_monthly_inr = excluded.ctc_monthly_inr, updated_at = now();

  insert into public.customer_revenue (code, name, revenue_inr, revenue_usd, period, updated_at)
    select x.code, x.name, x.revenue_inr, x.revenue_usd, p -> 'settings' ->> 'period', now()
    from jsonb_to_recordset(coalesce(p -> 'revenue', '[]'::jsonb)) as x(code text, name text, revenue_inr numeric, revenue_usd numeric)
  on conflict (code) do update set name = excluded.name, revenue_inr = excluded.revenue_inr, revenue_usd = excluded.revenue_usd, period = excluded.period, updated_at = now();

  if p ? 'settings' then
    insert into public.app_settings (key, value, updated_by, updated_at) values ('live', p -> 'settings', who, now())
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  end if;

  if p ? 'allocations' then
    delete from public.allocations where true; -- Supabase rejects DELETE without WHERE
    insert into public.allocations (id, emp_id, customer_code, subproject, owner_pm, util_pct, billable, updated_by)
      select x.id, x.emp_id, x.customer_code, coalesce(x.subproject, ''), x.owner_pm, x.util_pct, coalesce(x.billable, false), who
      from jsonb_to_recordset(p -> 'allocations')
        as x(id text, emp_id text, customer_code text, subproject text, owner_pm text, util_pct numeric, billable boolean);
    get diagnostics n_alloc = row_count;
    insert into public.allocation_history (by, action, note, after)
      values (who, 'seed', coalesce(p ->> 'note', 'Allocations loaded'), jsonb_build_object('allocations', n_alloc));
    insert into public.app_settings (key, value, updated_by, updated_at)
      values ('allocSource', jsonb_build_object('source', 'app', 'since', now(), 'by', who), who, now())
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  end if;

  return jsonb_build_object('people', jsonb_array_length(coalesce(p -> 'people', '[]'::jsonb)), 'allocations', n_alloc);
end $$;
revoke all on function public.admin_sync(jsonb) from public, anon;
grant execute on function public.admin_sync(jsonb) to authenticated;
