-- Server-side accept-invitation flow.
--
-- Why this migration exists: src/services/supabase/invitations.ts calls the
-- Postgres RPCs `accept_invitation(...)` and `get_invitation_by_token(...)`.
-- Neither was defined in any prior migration, so when an invited user clicks
-- the link and signs in, the accept call errors and the project membership
-- never gets written. They land back on the dashboard with no projects
-- visible — the bug the user just reported.
--
-- The RPCs run as SECURITY DEFINER so they can:
--   1. Read the invitation row (regardless of who's reading)
--   2. Write to projects.members and organizations.members JSON arrays
--   3. Update user_profiles.organization_id
-- Even though they bypass RLS, the function bodies enforce the security
-- check explicitly: the invitation row's email MUST match auth.uid()'s
-- email (case-insensitive), and the invitation MUST be 'pending' and not
-- expired. Without those checks SECURITY DEFINER would be a hole; with them
-- the RPC is a tightly-scoped privilege escalation for one specific action.

-- ---------------------------------------------------------------------------
-- Some deployments already have older copies of these functions (from a
-- hand-applied "supabase-invite-and-storage-fix.sql" or earlier branches)
-- with parameter defaults that don't match the new signatures. Postgres
-- won't let CREATE OR REPLACE change parameter defaults, so we drop every
-- overload by name first. This is safe — the next CREATE FUNCTION puts
-- back the canonical version this migration intends.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select format('drop function if exists %s cascade', oid::regprocedure) as cmd
    from pg_proc
    where proname in ('accept_invitation', 'get_invitation_by_token')
      and pronamespace = 'public'::regnamespace
  loop
    execute r.cmd;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- get_invitation_by_token: lets the AcceptInvite page render preview info
-- (project name, inviter, role) before the user signs in. Returns a JSON
-- object the client maps with mapInvitationRow.
--
-- Anonymous-safe: the only thing it exposes is the invitation row itself,
-- and only for a UUID-shaped token the caller already has. That's the
-- intended public link surface.
-- ---------------------------------------------------------------------------
create or replace function public.get_invitation_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_row record;
begin
  if p_token is null or btrim(p_token) = '' then
    return null;
  end if;

  select *
    into v_row
    from public.invitations
    where token = btrim(p_token)
    limit 1;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'invitationId',    v_row.invitation_id,
    'projectId',       v_row.project_id,
    'organizationId',  v_row.organization_id,
    'projectName',     v_row.project_name,
    'inviterUserId',   v_row.invited_by,
    'inviterName',     v_row.inviter_name,
    'inviterEmail',    v_row.inviter_email,
    'inviteeEmail',    v_row.email,
    'role',            v_row.role,
    'status',          v_row.status,
    'token',           v_row.token,
    'createdAt',       v_row.created_at,
    'expiresAt',       v_row.expires_at,
    'acceptedAt',      v_row.accepted_at
  );
end;
$$;

grant execute on function public.get_invitation_by_token(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- accept_invitation: the actual fix.
--
-- Validates → adds to project members → adds to org members → marks invite
-- accepted → links user_profiles.organization_id. Idempotent: if the user is
-- already in the project / org members array, the corresponding append is
-- skipped so re-running this RPC is safe.
--
-- Returns: jsonb { ok: true } on success or { ok: false, error: '<msg>' } on
-- known failure modes. Unexpected DB failures return error 'internal_error';
-- details are written to server logs (RAISE LOG) only.
-- ---------------------------------------------------------------------------
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

  -- Load the invitation
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

  -- Verify the calling user's email matches the invitation email. This is
  -- the security check that justifies SECURITY DEFINER above.
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

  -- Build the canonical member object once. Shape matches what
  -- ensureOrganizationExists() in AuthContext writes (camelCase keys), so the
  -- existing members lookups in getUserProjects() / OrganizationContext
  -- recognize the row.
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

  -- Add to organization.members (idempotent). Reuse v_member_obj — same shape.
  update public.organizations
    set members = coalesce(members, '[]'::jsonb) || jsonb_build_array(v_member_obj),
        updated_at = v_now
    where organization_id = p_organization_id
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(members, '[]'::jsonb)) m
        where coalesce(m->>'userId', m->>'user_id') = v_user_id::text
      );

  -- Link the invitee's profile to the inviting org. Without this, the next
  -- session may end up resolving to whichever org they previously self-owned
  -- (the bug fixed in AuthContext for fresh signups). updated_at may not be
  -- present on every deployment, so we only set organization_id.
  update public.user_profiles
    set organization_id = p_organization_id
    where id = v_user_id;

  -- Mark invitation as accepted. accepted_by may or may not exist on the
  -- table depending on which migrations the deployment ran; we only touch
  -- status + accepted_at, which are guaranteed.
  update public.invitations
    set status = 'accepted',
        accepted_at = v_now
    where invitation_id = p_invitation_id;

  return jsonb_build_object('ok', true, 'projectId', v_project_id);
exception when others then
  -- Log full detail for operators; return a generic code to the client (no sqlerrm).
  raise log 'accept_invitation failed: sqlstate=% sqlerrm=%', sqlstate, sqlerrm;
  return jsonb_build_object('ok', false, 'error', 'internal_error');
end;
$$;

grant execute on function public.accept_invitation(uuid, uuid, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill: any invitation that was already "accepted" in the table but where
-- the user never actually got added to the project (because the RPC didn't
-- exist) — fix them now. Loops over accepted invitations, finds the auth
-- user with the matching email, appends them to the relevant member arrays
-- if absent. Safe to run repeatedly.
-- ---------------------------------------------------------------------------
do $$
declare
  inv record;
  v_uid uuid;
  v_obj jsonb;
begin
  for inv in
    select i.*
      from public.invitations i
      where i.status = 'accepted'
  loop
    select id into v_uid
      from auth.users
      where lower(email) = lower(coalesce(inv.email, ''))
      limit 1;

    if v_uid is null then
      continue;
    end if;

    v_obj := jsonb_build_object(
      'userId',      v_uid,
      'email',       lower(inv.email),
      'displayName', coalesce(
        nullif(trim(coalesce((row_to_json(inv)::jsonb)->>'display_name', '')), ''),
        lower(coalesce(inv.email, ''))
      ),
      'photoURL',    '',
      'role',        coalesce(inv.role, 'member'),
      'addedAt',     coalesce(inv.accepted_at, now()),
      'status',      'active'
    );

    update public.projects
      set members = coalesce(members, '[]'::jsonb) || jsonb_build_array(v_obj)
      where project_id = inv.project_id
        and not exists (
          select 1
          from jsonb_array_elements(coalesce(members, '[]'::jsonb)) m
          where coalesce(m->>'userId', m->>'user_id') = v_uid::text
        );

    if inv.organization_id is not null then
      update public.organizations
        set members = coalesce(members, '[]'::jsonb) || jsonb_build_array(v_obj)
        where organization_id = inv.organization_id
          and not exists (
            select 1
            from jsonb_array_elements(coalesce(members, '[]'::jsonb)) m
            where coalesce(m->>'userId', m->>'user_id') = v_uid::text
          );
    end if;
  end loop;
end $$;
