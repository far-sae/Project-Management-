-- Project admins are admins of THEIR PROJECT only.
--
-- 1. accept_invitation: inviting someone to a project as "admin" used to copy
--    that role onto the organization roster too, making them an admin of the
--    whole organization (every project, team settings, billing...). The org
--    entry now gets "member" for project admins (viewer stays viewer).
--    Organization-wide invites (no project) still grant the role as chosen.
-- 2. can_manage_project_members(): project owner, org owner/admin, or a
--    project member whose project role is "admin".
-- 3. upsert_project_member: project admins can add people / change roles in
--    their own project (was owner / org admin only). Existing entry fields
--    (email, display name) are kept when a role changes.
-- 4. invitations: only someone who can manage the project's members may
--    create an invitation for it; organization-wide invites need an org
--    owner/admin (was: any organization member).
--
-- Existing organization admins are NOT changed — review them on the Team page.

set search_path = public;

create or replace function public.can_manage_project_members(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.projects p
    where p.project_id = p_project
      and auth.uid() is not null
      and (
        p.owner_id = auth.uid()
        or public.is_org_admin_or_owner(p.organization_id)
        or exists (
          select 1 from jsonb_array_elements(coalesce(p.members, '[]'::jsonb)) m
          where coalesce(m->>'userId', m->>'user_id') = auth.uid()::text
            and m->>'role' = 'admin'
        )
      )
  );
$$;

revoke all on function public.can_manage_project_members(uuid) from public;
grant execute on function public.can_manage_project_members(uuid) to authenticated;

create or replace function public.upsert_project_member(
  p_project_id uuid,
  p_organization_id uuid,
  p_user_id uuid,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_owner    uuid;
  v_org      uuid;
  v_members  jsonb;
  v_existing jsonb;
begin
  if p_role not in ('admin', 'member', 'viewer') then
    return jsonb_build_object('ok', false, 'error', 'Invalid role');
  end if;

  select owner_id, organization_id, coalesce(members, '[]'::jsonb)
    into v_owner, v_org, v_members
  from public.projects
  where project_id = p_project_id;

  if v_owner is null then
    return jsonb_build_object('ok', false, 'error', 'Project not found');
  end if;
  if v_org is distinct from p_organization_id then
    return jsonb_build_object('ok', false, 'error', 'Project is not in this organization');
  end if;

  -- Project owner, org owner/admin, or an admin of THIS project.
  if not public.can_manage_project_members(p_project_id) then
    return jsonb_build_object('ok', false, 'error', 'Only the project owner or a project admin can manage members');
  end if;

  -- The owner is implicit (owner_id) — don't duplicate them into members.
  if p_user_id = v_owner then
    return jsonb_build_object('ok', true);
  end if;

  select m into v_existing
  from jsonb_array_elements(v_members) m
  where coalesce(m->>'userId', m->>'user_id') = p_user_id::text
  limit 1;

  v_members := (
    select coalesce(jsonb_agg(m), '[]'::jsonb)
    from jsonb_array_elements(v_members) m
    where coalesce(m->>'userId', m->>'user_id') <> p_user_id::text
  );
  v_members := v_members || jsonb_build_array(
    coalesce(v_existing, '{}'::jsonb) || jsonb_build_object(
      'userId',  p_user_id::text,
      'role',    p_role,
      'addedAt', coalesce(v_existing->>'addedAt',
                          to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    )
  );

  update public.projects
    set members = v_members, updated_at = now()
  where project_id = p_project_id;

  return jsonb_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.accept_invitation(p_invitation_id uuid, p_organization_id uuid, p_display_name text, p_photo_url text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_user_id      uuid := auth.uid();
  v_user_email   text;
  v_invitation   public.invitations%rowtype;
  v_project_id   uuid;
  v_role         text;
  v_now          timestamptz := now();
  v_member_obj   jsonb;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'Not authenticated');
  end if;

  select *
    into v_invitation
    from public.invitations
    where invitation_id = p_invitation_id
    limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Invitation not found');
  end if;

  if v_invitation.status <> 'pending' then
    return jsonb_build_object(
      'ok', false,
      'error', format('Invitation is %s, not pending', v_invitation.status)
    );
  end if;

  if v_invitation.expires_at is not null and v_invitation.expires_at < v_now then
    return jsonb_build_object('ok', false, 'error', 'Invitation has expired');
  end if;

  if v_invitation.organization_id is distinct from p_organization_id then
    return jsonb_build_object(
      'ok', false,
      'error', 'Organization mismatch for this invitation'
    );
  end if;

  select lower(email) into v_user_email from auth.users where id = v_user_id;

  if v_user_email is null then
    return jsonb_build_object('ok', false, 'error', 'Could not resolve account email');
  end if;

  if lower(coalesce(v_invitation.email, '')) <> v_user_email then
    return jsonb_build_object(
      'ok', false,
      'error', 'This invitation was sent to a different email address'
    );
  end if;

  v_project_id := v_invitation.project_id;
  v_role := coalesce(v_invitation.role, 'member');

  -- customRoleId (camelCase) matches what the Team page stores on members
  -- and what OrganizationContext reads to resolve per-page access. Null when
  -- the invite used a built-in role.
  v_member_obj := jsonb_build_object(
    'userId',        v_user_id,
    'email',         v_user_email,
    'displayName',   coalesce(nullif(p_display_name, ''), v_user_email),
    'photoURL',      coalesce(p_photo_url, ''),
    'role',          v_role,
    'customRoleId',  v_invitation.custom_role_id,
    'addedAt',       v_now,
    'status',        'active'
  );

  -- Add to project.members (idempotent)
  update public.projects
    set members = coalesce(members, '[]'::jsonb) || jsonb_build_array(v_member_obj),
        updated_at = v_now
    where project_id = v_project_id
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(members, '[]'::jsonb)) m
        where coalesce(m->>'userId', m->>'user_id') = v_user_id::text
      );

  -- Add to organization.members (idempotent). A project role never grants
  -- organization-wide power: a project ADMIN joins the organization as a
  -- plain member, so they only see the projects they were added to.
  update public.organizations
    set members = coalesce(members, '[]'::jsonb) || jsonb_build_array(
          v_member_obj || jsonb_build_object(
            'role', case
              when v_invitation.project_id is not null and v_role in ('admin', 'owner') then 'member'
              else v_role
            end
          )
        ),
        updated_at = v_now
    where organization_id = p_organization_id
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(members, '[]'::jsonb)) m
        where coalesce(m->>'userId', m->>'user_id') = v_user_id::text
      );

  -- Link the invitee's profile to the inviting org (UPSERT — see migration 053).
  insert into public.user_profiles (id, email, display_name, photo_url, organization_id)
  values (
    v_user_id,
    v_user_email,
    coalesce(nullif(p_display_name, ''), v_user_email),
    coalesce(p_photo_url, ''),
    p_organization_id
  )
  on conflict (id) do update
    set organization_id = excluded.organization_id;

  update public.invitations
    set status = 'accepted',
        accepted_at = v_now
    where invitation_id = p_invitation_id;

  return jsonb_build_object('ok', true, 'projectId', v_project_id);
exception when others then
  raise log 'accept_invitation failed: sqlstate=% sqlerrm=%', sqlstate, sqlerrm;
  return jsonb_build_object('ok', false, 'error', 'internal_error');
end;
$function$;

create or replace function public.invitations_require_project_manager()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;  -- service role / server-side jobs
  end if;
  if new.project_id is null then
    -- Organization-wide invite: organization owners/admins only.
    if not public.is_org_admin_or_owner(new.organization_id) then
      raise exception 'Only an organization owner or admin can invite people to the organization'
        using errcode = '42501';
    end if;
  elsif not public.can_manage_project_members(new.project_id) then
    raise exception 'Only the project owner or a project admin can invite people to this project'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists invitations_require_project_manager_trg on public.invitations;
create trigger invitations_require_project_manager_trg
  before insert on public.invitations
  for each row execute function public.invitations_require_project_manager();
