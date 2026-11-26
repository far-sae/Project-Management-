-- Extra access for one person, without making them an admin.
--
-- Until now there were only four kinds of people in an organisation: owner,
-- admin, member and viewer. Social media was for the owner and admins. So a
-- person who looks after the social pages had to be made an admin, and then
-- saw the CRM, the calls, the email and the team as well.
--
-- An owner or admin can now give one person access to one area:
--
--   org_member_access   one row for each person and area
--     area   'social' (the only area so far; more can follow with no new table)
--     level  'use'     the person sees the area and works in it
--            'manage'  the person may also do what was for admins only:
--                      for social media, connect and disconnect accounts and
--                      change and run the autopilot
--
--   has_area_access(organisation, area, level)
--     true for the owner and admins, and for an active member who was given
--     that area at that level or higher.
--
-- Who can read it: a person reads their own rows; the owner and admins read
-- all rows of their organisation. Who can change it: the owner and admins.
--
-- The same file lets a person with social media at 'manage' save the
-- autopilot's settings (207_social_autopilot.sql let only the owner and
-- admins do that). Nothing else changes for anybody.
--
-- Safe to run more than once. The autopilot part changes nothing when the
-- autopilot's table has not been made yet.

set search_path = public;

create table if not exists public.org_member_access (
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  user_id uuid not null,
  area text not null check (area ~ '^[a-z][a-z_]{1,29}$'),
  level text not null check (level in ('use', 'manage')),
  granted_by uuid,
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, area)
);

create index if not exists idx_org_member_access_user on public.org_member_access(user_id);

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

-- The owner and admins have every area. Anybody else needs a row, and must
-- still be an active member: a row left behind by somebody who was removed
-- from the organisation gives nothing.
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
        and (p_level = 'use' or a.level = 'manage')
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

-- The autopilot's settings: also for the person who manages social media.
-- A second rule next to the one for the owner and admins; either one lets a
-- change through.
do $do$
begin
  if to_regclass('public.social_autopilot') is null then
    raise notice 'social_autopilot is not there yet: run 207_social_autopilot.sql first, then this file again.';
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
