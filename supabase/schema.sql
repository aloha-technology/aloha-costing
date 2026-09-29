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
