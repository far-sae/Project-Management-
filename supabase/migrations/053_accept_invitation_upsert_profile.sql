-- Fix: invited users couldn't see the project after accepting via Google.
--
-- Symptom: invitee clicks invite link → signs in with Google → gets into
-- the app, but the project they were invited to is nowhere to be seen
-- (sidebar empty, dashboard empty).
--
-- Cause: nothing in the app inserts into public.user_profiles for fresh
-- sign-ups (createUserProfile() only reads-then-updates, and there's no
-- DB trigger on auth.users that creates the row). For a brand-new
-- Google-signed user, accept_invitation()'s
--     update public.user_profiles set organization_id = … where id = …
-- was a silent no-op — zero rows matched. The user got added to
-- projects.members and organizations.members fine, but their profile
-- was never linked to the inviting org. refreshUser() then read null
-- back, kept the user's organizationId as `local-<uid>`, and every
-- downstream query (useProjects, OrganizationContext) resolved to the
-- wrong tenant.
--
-- Fix: switch to INSERT … ON CONFLICT so the link sticks regardless of
-- whether a profile row existed. Also re-run the backfill from migration
-- 048 with the same upsert semantics, so anyone who hit this bug before
-- this migration gets healed automatically.

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

  v_member_obj := jsonb_build_object(
    'userId',       v_user_id,
    'email',        v_user_email,
    'displayName',  coalesce(nullif(p_display_name, ''), v_user_email),
    'photoURL',     coalesce(p_photo_url, ''),
    'role',         v_role,
    'addedAt',      v_now,
    'status',       'active'
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

  -- Link the invitee's profile to the inviting org. UPSERT (not UPDATE) —
  -- a brand-new sign-up may not have a user_profiles row yet, in which
  -- case the previous UPDATE silently wrote nothing and the user kept
  -- resolving to a `local-<uid>` org for the rest of the session.
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

-- ---------------------------------------------------------------------------
-- Heal users who already accepted under the broken UPDATE path: any
-- accepted invitation where the matching auth user has no user_profiles
-- row, or has one with a missing/wrong organization_id, gets fixed up
-- here. Safe to run repeatedly.
-- ---------------------------------------------------------------------------
do $$
declare
  inv record;
  v_uid uuid;
begin
  for inv in
    select i.*
      from public.invitations i
      where i.status = 'accepted'
        and i.organization_id is not null
  loop
    select id into v_uid
      from auth.users
      where lower(email) = lower(coalesce(inv.email, ''))
      limit 1;

    if v_uid is null then
      continue;
    end if;

    insert into public.user_profiles (id, email, organization_id)
    values (
      v_uid,
      lower(coalesce(inv.email, '')),
      inv.organization_id
    )
    on conflict (id) do update
      set organization_id = coalesce(public.user_profiles.organization_id, excluded.organization_id);
  end loop;
end $$;
