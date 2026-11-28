-- 220_income.sql
-- Income: money the company received that is not on an invoice.
--
-- The app already knows two kinds of money coming in: the payments recorded
-- on invoices, and the payments written on a client's services (CRM,
-- Accounts). The new Income page adds those up, and shows what is still to
-- come from invoices that were issued and not paid yet.
--
-- What it could not hold is money that has no invoice and no service: a cash
-- sale, a refund from a supplier, interest, a grant. This file adds one
-- table for that:
--
--   income_entries   one row for each such amount: what it was for, who paid,
--                    how much and in which currency, the day it arrived, how
--                    it was paid and its reference
--
-- An entry can be typed in, or read from a photo of the receipt. The photo
-- itself is not kept: only what the person saved after checking it.
--
-- Who can read and change it: the organisation's owner and admins, for the
-- workspaces of their own organisation. Nobody else, and nobody who is not
-- signed in.
--
-- Safe to run more than once.

set search_path = public;

create table if not exists public.income_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  workspace_id uuid not null references public.workspaces(workspace_id) on delete cascade,
  -- What the money was for.
  title text not null check (char_length(btrim(title)) between 1 and 160),
  -- Who paid it.
  payer text not null default '' check (char_length(payer) <= 160),
  amount numeric(14,2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  received_on date not null,
  method text check (method is null or char_length(method) <= 40),
  reference text check (reference is null or char_length(reference) <= 80),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_income_entries_workspace on public.income_entries(workspace_id, received_on desc);

alter table public.income_entries enable row level security;
revoke all on public.income_entries from public, anon;
grant select, insert, update, delete on public.income_entries to authenticated;
grant all on public.income_entries to service_role;

drop policy if exists income_entries_read on public.income_entries;
create policy income_entries_read on public.income_entries for select to authenticated
  using (public.is_org_admin_or_owner(organization_id));

-- A row must name a workspace of the same organisation: an owner of one
-- organisation can never write into another one's workspace.
drop policy if exists income_entries_add on public.income_entries;
create policy income_entries_add on public.income_entries for insert to authenticated
  with check (
    public.is_org_admin_or_owner(organization_id)
    and exists (select 1 from public.workspaces w where w.workspace_id = income_entries.workspace_id and w.organization_id = income_entries.organization_id)
  );

drop policy if exists income_entries_change on public.income_entries;
create policy income_entries_change on public.income_entries for update to authenticated
  using (public.is_org_admin_or_owner(organization_id))
  with check (
    public.is_org_admin_or_owner(organization_id)
    and exists (select 1 from public.workspaces w where w.workspace_id = income_entries.workspace_id and w.organization_id = income_entries.organization_id)
  );

drop policy if exists income_entries_remove on public.income_entries;
create policy income_entries_remove on public.income_entries for delete to authenticated
  using (public.is_org_admin_or_owner(organization_id));

-- Tell the API about the new table straight away.
notify pgrst, 'reload schema';
