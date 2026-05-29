-- 105_client_categories.sql
-- A workspace-scoped registry of account categories so reps can set up the
-- list once and then assign accounts to them, instead of typing the same
-- category string into every account record. Existing free-text values on
-- clients.category keep working — the UI merges registered categories with
-- any unique free-text values found on existing accounts so historic data
-- isn't orphaned.

create table if not exists public.client_categories (
  category_id      uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  workspace_id     uuid not null,
  name             text not null,
  color            text,             -- optional hex for the tile accent
  description      text,
  sort_order       integer not null default 0,
  created_by       uuid,
  created_by_name  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Names are unique per workspace, case-insensitive. The lower() expression
-- in the index means "Enterprise" and "enterprise" can't both exist.
create unique index if not exists ux_client_categories_workspace_name
  on public.client_categories (organization_id, workspace_id, lower(name));

create index if not exists idx_client_categories_org_workspace
  on public.client_categories (organization_id, workspace_id, sort_order);

alter table public.client_categories enable row level security;

grant select on table public.client_categories to anon;
grant select, insert, update, delete on table public.client_categories to authenticated;

drop policy if exists "anon_no_client_categories"                on public.client_categories;
drop policy if exists "members_view_client_categories"           on public.client_categories;
drop policy if exists "members_insert_client_categories"         on public.client_categories;
drop policy if exists "author_or_admin_update_client_categories" on public.client_categories;
drop policy if exists "author_or_admin_delete_client_categories" on public.client_categories;

create policy "anon_no_client_categories"
  on public.client_categories for select to anon using (false);

create policy "members_view_client_categories"
  on public.client_categories for select to authenticated
  using (public.is_org_member(organization_id));

-- Categories are workspace organisation — any non-viewer member can add
-- one. Mirrors the lead_notes / leads pattern from 101.
create policy "members_insert_client_categories"
  on public.client_categories for insert to authenticated
  with check (
    public.is_org_member(organization_id)
    and not public.is_org_viewer(organization_id)
    and (created_by = auth.uid() or created_by is null)
  );

create policy "author_or_admin_update_client_categories"
  on public.client_categories for update to authenticated
  using (
    public.is_org_member(organization_id)
    and not public.is_org_viewer(organization_id)
    and (created_by = auth.uid() or public.is_org_admin_or_owner(organization_id))
  )
  with check (
    public.is_org_member(organization_id)
    and not public.is_org_viewer(organization_id)
    and (created_by = auth.uid() or public.is_org_admin_or_owner(organization_id))
  );

create policy "author_or_admin_delete_client_categories"
  on public.client_categories for delete to authenticated
  using (
    public.is_org_member(organization_id)
    and not public.is_org_viewer(organization_id)
    and (created_by = auth.uid() or public.is_org_admin_or_owner(organization_id))
  );

create or replace function public.client_categories_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists client_categories_set_updated_at on public.client_categories;
create trigger client_categories_set_updated_at
  before update on public.client_categories
  for each row execute function public.client_categories_set_updated_at();

do $$
begin
  alter publication supabase_realtime add table public.client_categories;
exception when others then null;
end $$;
