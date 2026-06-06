-- ============================================================================
-- BILLING HUB — one-shot deploy SQL (migrations 128 + 129 + 130, in order)
-- Paste this whole file into the Supabase SQL editor and Run.
-- Safe to re-run: every statement is IF NOT EXISTS / OR REPLACE / drop-if-exists.
-- Wrapped in a transaction so it's all-or-nothing.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 128: invoice public_token + get_public_invoice RPC (Phase 2 — public page + email)
-- ----------------------------------------------------------------------------
alter table public.invoices
  add column if not exists public_token uuid not null default gen_random_uuid(),
  add column if not exists last_sent_at timestamptz;

update public.invoices set public_token = gen_random_uuid() where public_token is null;

create unique index if not exists ux_invoices_public_token on public.invoices (public_token);

-- Public, unauthenticated, read-only view of a single ISSUED invoice by token.
-- SECURITY DEFINER so it bypasses RLS, but returns only client-facing fields
-- (no internal notes / ids) and only for issued invoices (drafts/voids excluded).
create or replace function public.get_public_invoice(p_token uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'invoice_number', i.invoice_number,
    'status', i.status,
    'currency', i.currency,
    'subtotal', i.subtotal,
    'tax_rate', i.tax_rate,
    'tax_amount', i.tax_amount,
    'discount', i.discount,
    'total', i.total,
    'amount_paid', i.amount_paid,
    'line_items', i.line_items,
    'terms', i.terms,
    'issued_at', i.issued_at,
    'due_at', i.due_at,
    'org_name', o.name,
    'client_name', c.name
  )
  from public.invoices i
  join public.organizations o on o.organization_id = i.organization_id
  left join public.clients c on c.client_id = i.client_id
  where i.public_token = p_token
    and i.status not in ('void', 'draft')
  limit 1;
$$;

grant execute on function public.get_public_invoice(uuid) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 129: invoice_schedules (Phase 4 — recurring invoices)
-- ----------------------------------------------------------------------------
create table if not exists public.invoice_schedules (
  schedule_id       uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  client_id         uuid not null references public.clients(client_id) on delete cascade,
  workspace_id      uuid,

  title             text,
  currency          text not null default 'USD',
  tax_rate          numeric(6,3) not null default 0,   -- percent, e.g. 8 = 8%
  discount          numeric(14,2) not null default 0,  -- flat, applied before tax
  line_items        jsonb not null default '[]'::jsonb,
  notes             text,
  terms             text,

  frequency         text not null default 'monthly',
  due_days          integer not null default 14,       -- due_at = issued_at + due_days
  next_run_date     date not null,
  enabled           boolean not null default true,

  last_invoice_id   uuid,
  last_run_at       timestamptz,

  created_by        uuid,
  created_by_name   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  check (frequency in ('weekly','monthly','quarterly','yearly'))
);

create index if not exists idx_invoice_schedules_org
  on public.invoice_schedules (organization_id, enabled, next_run_date);
create index if not exists idx_invoice_schedules_due
  on public.invoice_schedules (next_run_date) where enabled;

alter table public.invoice_schedules enable row level security;

drop policy if exists "anon_no_invoice_schedules" on public.invoice_schedules;
create policy "anon_no_invoice_schedules"
  on public.invoice_schedules for select to anon using (false);

drop policy if exists "members_view_invoice_schedules" on public.invoice_schedules;
create policy "members_view_invoice_schedules"
  on public.invoice_schedules for select to authenticated
  using (public.is_org_member(organization_id));

drop policy if exists "admins_insert_invoice_schedules" on public.invoice_schedules;
create policy "admins_insert_invoice_schedules"
  on public.invoice_schedules for insert to authenticated
  with check (public.is_org_admin_or_owner(organization_id));

drop policy if exists "admins_update_invoice_schedules" on public.invoice_schedules;
create policy "admins_update_invoice_schedules"
  on public.invoice_schedules for update to authenticated
  using (public.is_org_admin_or_owner(organization_id))
  with check (public.is_org_admin_or_owner(organization_id));

drop policy if exists "admins_delete_invoice_schedules" on public.invoice_schedules;
create policy "admins_delete_invoice_schedules"
  on public.invoice_schedules for delete to authenticated
  using (public.is_org_admin_or_owner(organization_id));

-- ----------------------------------------------------------------------------
-- 130: bills (Phase 5 — accounts payable) + next_bill_number RPC
-- ----------------------------------------------------------------------------
create table if not exists public.bills (
  bill_id           uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  workspace_id      uuid,

  vendor_name       text not null,
  vendor_email      text,

  bill_number       text not null,          -- per-org BILL-000001
  reference         text,                   -- the vendor's own invoice no.
  status            text not null default 'draft',
  currency          text not null default 'USD',

  subtotal          numeric(14,2) not null default 0,
  tax_rate          numeric(6,3) not null default 0,   -- percent
  tax_amount        numeric(14,2) not null default 0,
  discount          numeric(14,2) not null default 0,  -- flat, pre-tax
  total             numeric(14,2) not null default 0,
  amount_paid       numeric(14,2) not null default 0,

  line_items        jsonb not null default '[]'::jsonb,
  notes             text,

  issued_at         date not null default current_date,
  due_at            date,
  paid_at           timestamptz,
  voided_at         timestamptz,

  created_by        uuid,
  created_by_name   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  check (status in ('draft','open','paid','overdue','void'))
);

create unique index if not exists ux_bills_org_number
  on public.bills (organization_id, lower(bill_number));
create index if not exists idx_bills_org_status_time
  on public.bills (organization_id, status, issued_at desc);

alter table public.bills enable row level security;

drop policy if exists "anon_no_bills" on public.bills;
create policy "anon_no_bills" on public.bills for select to anon using (false);

drop policy if exists "members_view_bills" on public.bills;
create policy "members_view_bills" on public.bills for select to authenticated
  using (public.is_org_member(organization_id));

drop policy if exists "members_insert_bills" on public.bills;
create policy "members_insert_bills" on public.bills for insert to authenticated
  with check (public.is_org_member(organization_id) and (created_by = auth.uid() or created_by is null));

drop policy if exists "members_update_bills" on public.bills;
create policy "members_update_bills" on public.bills for update to authenticated
  using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

drop policy if exists "admin_delete_bills" on public.bills;
create policy "admin_delete_bills" on public.bills for delete to authenticated
  using (public.is_org_admin_or_owner(organization_id));

create or replace function public.next_bill_number(p_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_seq integer;
begin
  if not public.is_org_member(p_organization_id) then
    raise exception 'Not a member' using errcode = '42501';
  end if;
  select coalesce(max(
           case when bill_number ~ '^BILL-\d+$'
             then substring(bill_number from '\d+')::integer
             else 0
           end), 0) + 1
    into v_seq
  from public.bills
  where organization_id = p_organization_id;
  return 'BILL-' || lpad(v_seq::text, 6, '0');
end;
$$;

grant execute on function public.next_bill_number(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 131: scope invoices / bills / recurring schedules to a project (optional)
-- ----------------------------------------------------------------------------
alter table public.invoices          add column if not exists project_id uuid references public.projects(project_id) on delete set null;
alter table public.bills             add column if not exists project_id uuid references public.projects(project_id) on delete set null;
alter table public.invoice_schedules add column if not exists project_id uuid references public.projects(project_id) on delete set null;

create index if not exists idx_invoices_project          on public.invoices (project_id)          where project_id is not null;
create index if not exists idx_bills_project             on public.bills (project_id)             where project_id is not null;
create index if not exists idx_invoice_schedules_project on public.invoice_schedules (project_id) where project_id is not null;

commit;
