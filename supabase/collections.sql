-- Aloha Collections: tables, file storage and row-level security.
-- Run AFTER schema.sql (it uses app_users, my_role(), is_admin(), can_see_all()). Safe to run again.
--
-- Who sees what
--   admin (Matt)   everything, all writes
--   leadership     read everything, no writes
--   accounts       only the tax-invoice portal: upload files, see their uploads and an
--                  invoice directory (number, customer, date, amount) to match files against
--   pm             nothing in Collections

-- The accounts role is new: widen the app_users check.
alter table public.app_users drop constraint if exists app_users_role_check;
alter table public.app_users add constraint app_users_role_check check (role in ('admin', 'leadership', 'pm', 'accounts'));

create or replace function public.is_accounts() returns boolean
language sql stable as $$ select coalesce(public.my_role() = 'accounts', false) $$;

-- ---------------------------------------------------------------------------
-- Documents: one table per kind, each row = id + the app's JSON document.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['col_customers', 'col_invoices', 'col_payments', 'col_contracts', 'col_outbox', 'col_settings'] loop
    execute format('create table if not exists public.%I (
      id text primary key,
      data jsonb not null,
      updated_by text,
      updated_at timestamptz not null default now())', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.can_see_all())', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_write', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Every change Matt makes, for the record.
create table if not exists public.col_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  by text not null,
  kind text not null,
  doc_ids text[] not null default '{}',
  summary text not null default ''
);
alter table public.col_audit enable row level security;
drop policy if exists col_audit_read on public.col_audit;
create policy col_audit_read on public.col_audit for select to authenticated using (public.can_see_all());
drop policy if exists col_audit_insert on public.col_audit;
create policy col_audit_insert on public.col_audit for insert to authenticated with check (public.is_admin());
revoke all on public.col_audit from anon;

-- ---------------------------------------------------------------------------
-- Tax invoices: uploaded by the accounts team, checked and sent by Matt.
-- status: uploaded -> checked -> sent, or rejected (back to accounts with a note).
-- ---------------------------------------------------------------------------
create table if not exists public.col_tax_invoices (
  id text primary key,
  data jsonb not null,
  uploaded_by text not null default public.my_email(),
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.col_tax_invoices enable row level security;
drop policy if exists col_tax_read on public.col_tax_invoices;
create policy col_tax_read on public.col_tax_invoices for select to authenticated
  using (public.can_see_all() or public.is_accounts());
drop policy if exists col_tax_admin on public.col_tax_invoices;
create policy col_tax_admin on public.col_tax_invoices for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- Accounts can add uploads, and replace their own while not yet checked.
drop policy if exists col_tax_accounts_insert on public.col_tax_invoices;
create policy col_tax_accounts_insert on public.col_tax_invoices for insert to authenticated
  with check (public.is_accounts() and uploaded_by = public.my_email() and data ->> 'status' = 'uploaded');
drop policy if exists col_tax_accounts_update on public.col_tax_invoices;
create policy col_tax_accounts_update on public.col_tax_invoices for update to authenticated
  using (public.is_accounts() and uploaded_by = public.my_email() and data ->> 'status' in ('uploaded', 'rejected'))
  with check (public.is_accounts() and uploaded_by = public.my_email() and data ->> 'status' = 'uploaded');
revoke all on public.col_tax_invoices from anon;

-- What the accounts team needs to match a file to an invoice: no balances, notes or contacts.
create or replace function public.col_invoice_directory()
returns table (id text, number text, customer_id text, customer_name text, date text, amount numeric, currency text)
language sql stable security definer set search_path = public as $$
  select i.id, i.data ->> 'number', i.data ->> 'customerId', coalesce(c.data ->> 'name', i.data ->> 'customerId'),
         i.data ->> 'date', (i.data ->> 'amount')::numeric, coalesce(i.data ->> 'currency', 'USD')
  from public.col_invoices i left join public.col_customers c on c.id = i.data ->> 'customerId'
  where (public.can_see_all() or public.is_accounts())
    and coalesce(i.data ->> 'status', 'open') <> 'void'
    and (i.data ->> 'date') >= to_char(now() - interval '400 days', 'YYYY-MM-DD')
$$;
revoke all on function public.col_invoice_directory() from public, anon;
grant execute on function public.col_invoice_directory() to authenticated;

-- ---------------------------------------------------------------------------
-- Files (contracts, tax invoices): private bucket "collections".
--   contracts/...     admin writes, leadership reads
--   tax-invoices/...  admin + accounts write, leadership + accounts read
-- Skipped automatically when the storage schema isn't there (local tests).
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  insert into storage.buckets (id, name, public) values ('collections', 'collections', false) on conflict (id) do nothing;
  drop policy if exists col_files_read on storage.objects;
  create policy col_files_read on storage.objects for select to authenticated using (
    bucket_id = 'collections' and (public.can_see_all() or (public.is_accounts() and name like 'tax-invoices/%')));
  drop policy if exists col_files_insert on storage.objects;
  create policy col_files_insert on storage.objects for insert to authenticated with check (
    bucket_id = 'collections' and (public.is_admin() or (public.is_accounts() and name like 'tax-invoices/%')));
  drop policy if exists col_files_admin on storage.objects;
  create policy col_files_admin on storage.objects for all to authenticated
    using (bucket_id = 'collections' and public.is_admin()) with check (bucket_id = 'collections' and public.is_admin());
end $$;
