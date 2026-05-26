-- 098_quotes.sql
-- Quotes (a.k.a. proposals) attached to a deal. Stored as a header row plus
-- a JSONB array of line items — line items don't need to be queried in
-- aggregate (totals are computed on the row) so keeping them inline keeps
-- this lean. Status moves: draft → sent → accepted/declined/expired.

create table if not exists public.quotes (
  quote_id         uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  deal_id          uuid references public.deals(deal_id) on delete set null,
  client_id        uuid references public.clients(client_id) on delete set null,
  workspace_id     uuid,                 -- denormalised from client.workspace_id at create-time

  quote_number     text not null,        -- per-org incrementing label, e.g. Q-000123
  title            text not null,
  status           text not null default 'draft',  -- draft | sent | accepted | declined | expired
  currency         text not null default 'USD',

  subtotal         numeric(14,2) not null default 0,
  tax_rate         numeric(6,3) not null default 0,        -- percent, e.g. 8.875
  tax_amount       numeric(14,2) not null default 0,
  discount         numeric(14,2) not null default 0,
  total            numeric(14,2) not null default 0,

  line_items       jsonb not null default '[]'::jsonb,    -- [{description, qty, unitPrice, lineTotal}]
  notes            text,
  terms            text,
  expires_at       date,
  sent_at          timestamptz,
  accepted_at      timestamptz,
  declined_at      timestamptz,

  created_by       uuid,
  created_by_name  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  check (status in ('draft','sent','accepted','declined','expired'))
);

create unique index if not exists ux_quotes_org_number
  on public.quotes (organization_id, lower(quote_number));
create index if not exists idx_quotes_org_status
  on public.quotes (organization_id, status, created_at desc);
create index if not exists idx_quotes_deal
  on public.quotes (deal_id) where deal_id is not null;
create index if not exists idx_quotes_client
  on public.quotes (client_id) where client_id is not null;

alter table public.quotes enable row level security;

grant select on table public.quotes to anon;
grant select, insert, update, delete on table public.quotes to authenticated;

drop policy if exists "anon_no_quotes"            on public.quotes;
drop policy if exists "members_view_quotes"       on public.quotes;
drop policy if exists "members_insert_quotes"     on public.quotes;
drop policy if exists "author_or_admin_update_quotes" on public.quotes;
drop policy if exists "author_or_admin_delete_quotes" on public.quotes;

create policy "anon_no_quotes"
  on public.quotes for select to anon using (false);
create policy "members_view_quotes"
  on public.quotes for select to authenticated
  using (public.is_org_member(organization_id));
create policy "members_insert_quotes"
  on public.quotes for insert to authenticated
  with check (
    public.is_org_member(organization_id)
    and (created_by = auth.uid() or created_by is null)
  );
create policy "author_or_admin_update_quotes"
  on public.quotes for update to authenticated
  using (
    public.is_org_member(organization_id)
    and (created_by = auth.uid() or public.is_org_admin_or_owner(organization_id))
  )
  with check (
    public.is_org_member(organization_id)
    and (created_by = auth.uid() or public.is_org_admin_or_owner(organization_id))
  );
create policy "author_or_admin_delete_quotes"
  on public.quotes for delete to authenticated
  using (
    public.is_org_member(organization_id)
    and (created_by = auth.uid() or public.is_org_admin_or_owner(organization_id))
  );

create or replace function public.quotes_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists quotes_set_updated_at on public.quotes;
create trigger quotes_set_updated_at
  before update on public.quotes
  for each row execute function public.quotes_set_updated_at();

-- Tiny RPC that hands the next per-org quote number atomically. Beats a
-- client-side count(*) race when two reps create quotes at once.
create or replace function public.next_quote_number(p_organization_id uuid)
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
           case when quote_number ~ '^Q-\d+$'
             then substring(quote_number from '\d+')::integer
             else 0
           end), 0) + 1
    into v_seq
  from public.quotes
  where organization_id = p_organization_id;
  return 'Q-' || lpad(v_seq::text, 6, '0');
end;
$$;

grant execute on function public.next_quote_number(uuid) to authenticated;
