-- 136_upsert_project_member.sql
-- Add an EXISTING org member to a project directly (no email invite), or change
-- their per-project role. Project membership lives in projects.members (jsonb);
-- this RPC is the owner/admin-gated write path (mirrors accept_invitation /
-- remove-member, which already own member writes server-side).
--
-- Role is the per-project role (admin | member | viewer) — separate from the
-- org-wide role / custom role on organizations.members.

create or replace function public.upsert_project_member(
  p_project_id     uuid,
  p_organization_id uuid,
  p_user_id        uuid,
  p_role           text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_caller  uuid := auth.uid();
  v_owner   uuid;
  v_members jsonb;
begin
  if p_role not in ('admin', 'member', 'viewer') then
    return jsonb_build_object('ok', false, 'error', 'Invalid role');
  end if;

  select owner_id, coalesce(members, '[]'::jsonb)
    into v_owner, v_members
  from public.projects
  where project_id = p_project_id;

  if v_owner is null then
    return jsonb_build_object('ok', false, 'error', 'Project not found');
  end if;

  -- Only the project owner or an org admin/owner may manage project members.
  if not (v_caller = v_owner
          or public.is_org_admin_or_owner_for(v_caller, p_organization_id)) then
    return jsonb_build_object('ok', false, 'error', 'Not allowed');
  end if;

  -- The owner is implicit (owner_id) — don't duplicate them into members.
  if p_user_id = v_owner then
    return jsonb_build_object('ok', true);
  end if;

  -- Upsert: drop any existing entry for this user, then append the new one.
  v_members := (
    select coalesce(jsonb_agg(m), '[]'::jsonb)
    from jsonb_array_elements(v_members) m
    where (m->>'userId') <> p_user_id::text
  );
  v_members := v_members || jsonb_build_array(jsonb_build_object(
    'userId',  p_user_id::text,
    'role',    p_role,
    'addedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  ));

  update public.projects
    set members = v_members, updated_at = now()
  where project_id = p_project_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.upsert_project_member(uuid, uuid, uuid, text) from public, anon;
grant  execute on function public.upsert_project_member(uuid, uuid, uuid, text) to authenticated, service_role;
