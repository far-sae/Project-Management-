-- 138_invitation_custom_role.sql
--
-- Let an invitation carry a CUSTOM ROLE (custom_roles, migration 135), so the
-- inviter can pick "Sales rep (view-only billing)" etc. instead of just the
-- built-in admin/member/viewer. On accept, the new member gets that role.
--
-- A custom role is stored as `customRoleId` on the member's entry in
-- organizations.members (jsonb) — exactly what the Team page writes when an
-- owner changes a member's role inline. We keep the built-in `role` as a safe
-- baseline ('member') so deleting the custom role later degrades gracefully.

alter table public.invitations
  add column if not exists custom_role_id uuid references public.custom_roles(role_id) on delete set null;

-- Recreate accept_invitation to stamp customRoleId onto the new member.
-- Body is migration 053's, plus the custom-role read + member field.
drop function if exists public.accept_invitation(uuid, uuid, text, text) cascade;

create or replace function public.accept_invitation(
  p_invitation_id  uuid,
  p_organization_id uuid,
  p_display_name   text,
  p_photo_url      text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
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

  -- Add to organization.members (idempotent)
  update public.organizations
    set members = coalesce(members, '[]'::jsonb) || jsonb_build_array(v_member_obj),
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
$$;

grant execute on function public.accept_invitation(uuid, uuid, text, text)
  to authenticated;
