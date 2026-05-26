-- 099_invoices.sql
-- Invoices linked to a client (and optionally a deal or accepted quote).
-- Status: draft -> sent -> paid (or void / overdue). Paid amount lets you
-- record partial payments. Line items inline like quotes — same trade-off.

create table if not exists public.invoices (
  invoice_id        uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  client_id         uuid not null references public.clients(client_id) on delete restrict,
  deal_id           uuid references public.deals(deal_id) on delete set null,
  quote_id          uuid references public.quotes(quote_id) on delete set null,
  workspace_id      uuid,

  invoice_number    text not null,          -- per-org INV-000001
  title             text,
  status            text not null default 'draft',
  currency          text not null default 'USD',

  subtotal          numeric(14,2) not null default 0,
  tax_rate          numeric(6,3) not null default 0,
  tax_amount        numeric(14,2) not null default 0,
  discount          numeric(14,2) not null default 0,
  total             numeric(14,2) not null default 0,
  amount_paid       numeric(14,2) not null default 0,

  line_items        jsonb not null default '[]'::jsonb,
  notes             text,
  terms             text,

  issued_at         date not null default current_date,
  due_at            date,
  sent_at           timestamptz,
  paid_at           timestamptz,
  voided_at         timestamptz,

  created_by        uuid,
  created_by_name   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  check (status in ('draft','sent','paid','overdue','void'))
);

create unique index if not exists ux_invoices_org_number
  on public.invoices (organization_id, lower(invoice_number));
create index if not exists idx_invoices_org_status_time
  on public.invoices (organization_id, status, issued_at desc);
create index if not exists idx_invoices_client
  on public.invoices (client_id, issued_at desc);
create index if not exists idx_invoices_deal
  on public.invoices (deal_id) where deal_id is not null;

alter table public.invoices enable row level security;

grant select on table public.invoices to anon;
grant select, insert, update, delete on table public.invoices to authenticated;

drop policy if exists "anon_no_invoices"            on public.invoices;
drop policy if exists "members_view_invoices"       on public.invoices;
drop policy if exists "members_insert_invoices"     on public.invoices;
drop policy if exists "members_update_invoices"     on public.invoices;
drop policy if exists "admin_delete_invoices"       on public.invoices;

create policy "anon_no_invoices"
  on public.invoices for select to anon using (false);
create policy "members_view_invoices"
  on public.invoices for select to authenticated
  using (public.is_org_member(organization_id));
create policy "members_insert_invoices"
  on public.invoices for insert to authenticated
  with check (
    public.is_org_member(organization_id)
    and (created_by = auth.uid() or created_by is null)
  );
-- Anyone in the org can mark an invoice paid/sent (Finance often isn't
-- the same person who created it). Delete is admin-only because it
-- erases history.
create policy "members_update_invoices"
  on public.invoices for update to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
create policy "admin_delete_invoices"
  on public.invoices for delete to authenticated
  using (public.is_org_admin_or_owner(organization_id));

create or replace function public.invoices_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.invoices_set_updated_at();

create or replace function public.next_invoice_number(p_organization_id uuid)
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
           case when invoice_number ~ '^INV-\d+$'
             then substring(invoice_number from '\d+')::integer
             else 0
           end), 0) + 1
    into v_seq
  from public.invoices
  where organization_id = p_organization_id;
  return 'INV-' || lpad(v_seq::text, 6, '0');
end;
$$;

grant execute on function public.next_invoice_number(uuid) to authenticated;
