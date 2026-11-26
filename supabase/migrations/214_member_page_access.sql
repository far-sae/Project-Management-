-- Which pages one person sees: the owner chooses, page by page.
--
-- 213_member_access.sql let an owner or admin give one person an area (social
-- media). The owner now chooses for each person which pages they see and can
-- use, and which they cannot. So a row can also close a page:
--
--   org_member_access.level
--     'off'     the person does not see this page and cannot open it
--     'use'     the person sees the page and works in it
--     'manage'  as 'use', and may also do what was for admins only there
--
--   org_member_access.area is the page: 'crm', 'calls', 'email', 'social',
--   'reports' and so on. No row for a page: the person has what a member had
--   before, so nothing changes for anybody until the owner chooses.
--
--   has_area_access(organisation, area, level) is true for the owner and
--   admins, and for an active member whose row says 'use' or 'manage' (for the
--   level 'manage': only 'manage'). A row that says 'off' gives nothing.
--
-- Who can read and change it: as before. A person reads their own rows; the
-- owner and admins read and change all rows of their organisation.
--
-- Safe to run more than once. It makes the table when 213 was not run yet.

set search_path = public;

create table if not exists public.org_member_access (
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  user_id uuid not null,
  area text not null check (area ~ '^[a-z][a-z_]{1,29}$'),
  level text not null,
  granted_by uuid,
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, area)
);

create index if not exists idx_org_member_access_user on public.org_member_access(user_id);

-- The levels a row may have: the rule from 213 (use, manage) is replaced by one that also knows 'off'.
do $do$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.org_member_access'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%level%'
  loop
    execute format('alter table public.org_member_access drop constraint %I', c.conname);
  end loop;
  alter table public.org_member_access add constraint org_member_access_level_check check (level in ('off', 'use', 'manage'));
end
$do$;

alter table public.org_member_access enable row level security;
revoke all on public.org_member_access from anon;
grant select, insert, update, delete on public.org_member_access to authenticated;
grant all on public.org_member_access to service_role;

drop policy if exists org_member_access_select on public.org_member_access;
create policy org_member_access_select on public.org_member_access for select to authenticated
  using (user_id = auth.uid() or public.is_org_admin_or_owner(organization_id));

drop policy if exists org_member_access_insert on public.org_member_access;
create policy org_member_access_insert on public.org_member_access for insert to authenticated
  with check (public.is_org_admin_or_owner(organization_id));

drop policy if exists org_member_access_update on public.org_member_access;
create policy org_member_access_update on public.org_member_access for update to authenticated
  using (public.is_org_admin_or_owner(organization_id))
  with check (public.is_org_admin_or_owner(organization_id));

drop policy if exists org_member_access_delete on public.org_member_access;
create policy org_member_access_delete on public.org_member_access for delete to authenticated
  using (public.is_org_admin_or_owner(organization_id));

create or replace function public.has_area_access(p_org uuid, p_area text, p_level text default 'use')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_org_admin_or_owner(p_org)
    or exists (
      select 1
      from public.org_member_access a
      join public.organizations o on o.organization_id = a.organization_id
      where a.organization_id = p_org
        and a.user_id = auth.uid()
        and a.area = p_area
        -- 'off' gives nothing; 'manage' is asked for by name.
        and ((p_level = 'use' and a.level in ('use', 'manage')) or (p_level = 'manage' and a.level = 'manage'))
        and exists (
          select 1
          from jsonb_array_elements(coalesce(o.members, '[]'::jsonb)) m
          where (m->>'userId') = auth.uid()::text
            and coalesce(m->>'status', 'active') = 'active'
            and (m->>'role') in ('admin', 'member')
        )
    );
$$;

revoke all on function public.has_area_access(uuid, text, text) from public, anon;
grant execute on function public.has_area_access(uuid, text, text) to authenticated, service_role;

-- The autopilot's settings, for the person who manages social media (the same rules as in 213).
do $do$
begin
  if to_regclass('public.social_autopilot') is null then
    return;
  end if;
  execute 'drop policy if exists social_autopilot_area_insert on public.social_autopilot';
  execute $q$
    create policy social_autopilot_area_insert on public.social_autopilot for insert to authenticated
      with check (public.can_access_workspace(workspace_id) and public.has_area_access(organization_id, 'social', 'manage')
        and exists (select 1 from public.workspaces w where w.workspace_id = social_autopilot.workspace_id and w.organization_id = social_autopilot.organization_id))
  $q$;
  execute 'drop policy if exists social_autopilot_area_update on public.social_autopilot';
  execute $q$
    create policy social_autopilot_area_update on public.social_autopilot for update to authenticated
      using (public.can_access_workspace(workspace_id) and public.has_area_access(organization_id, 'social', 'manage'))
      with check (public.can_access_workspace(workspace_id) and public.has_area_access(organization_id, 'social', 'manage')
        and exists (select 1 from public.workspaces w where w.workspace_id = social_autopilot.workspace_id and w.organization_id = social_autopilot.organization_id))
  $q$;
end
$do$;

notify pgrst, 'reload schema';
