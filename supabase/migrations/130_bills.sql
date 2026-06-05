-- Billing Phase 5: accounts-payable bills (money the org owes). Mirrors invoices
-- but keyed to a free-text vendor instead of a client. Re-runnable.

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
