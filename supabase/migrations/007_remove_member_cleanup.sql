-- Keep project membership, invitations, and optional task assignees in sync
-- when removing a member from a project.

create or replace function public.remove_project_member(
  p_project_id uuid,
  p_member_user_id text,
  p_member_email text default null,
  p_unassign_tasks boolean default false
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_member_email text := lower(trim(coalesce(p_member_email, '')));
  v_cancelled_invitations integer := 0;
  v_affected_tasks integer := 0;
begin
  update projects p
  set
    members = f.filtered_members,
    stats = jsonb_set(
      coalesce(p.stats, '{}'::jsonb),
      '{membersCount}',
      to_jsonb(
        (
          select count(*)
          from jsonb_array_elements(f.filtered_members) as elem
        )
      ),
      true
    ),
    updated_at = now()
  from (
    select
      p_src.project_id,
      coalesce(
        (
          select coalesce(jsonb_agg(m), '[]'::jsonb)
          from jsonb_array_elements(coalesce(p_src.members, '[]'::jsonb)) as m
          where coalesce(m->>'userId', m->>'user_id', '') <> p_member_user_id
            and (
              v_member_email = ''
              or lower(trim(coalesce(m->>'email', ''))) <> v_member_email
            )
        ),
        '[]'::jsonb
      ) as filtered_members
    from projects p_src
    where p_src.project_id = p_project_id
  ) f
  where p.project_id = f.project_id;

  if v_member_email <> '' then
    with updated as (
      update invitations
      set status = 'cancelled'
      where project_id = p_project_id
        and lower(trim(email)) = v_member_email
        and status in ('pending', 'accepted')
      returning 1
    )
    select count(*) into v_cancelled_invitations from updated;
  end if;

  if p_unassign_tasks then
    update tasks t
    set
      assignees = (
        select coalesce(jsonb_agg(a), '[]'::jsonb)
        from jsonb_array_elements(coalesce(t.assignees, '[]'::jsonb)) as a
        where coalesce(a->>'userId', a->>'user_id', '') <> p_member_user_id
          and (
            v_member_email = ''
            or lower(trim(coalesce(a->>'email', ''))) <> v_member_email
          )
      ),
      updated_at = now()
    where t.project_id = p_project_id
      and exists (
        select 1
        from jsonb_array_elements(coalesce(t.assignees, '[]'::jsonb)) as a
        where coalesce(a->>'userId', a->>'user_id', '') = p_member_user_id
          or (
            v_member_email <> ''
            and lower(trim(coalesce(a->>'email', ''))) = v_member_email
          )
      );

    get diagnostics v_affected_tasks = row_count;
  end if;

  return jsonb_build_object(
    'cancelledInvitations', v_cancelled_invitations,
    'affectedTaskCount', v_affected_tasks
  );
end;
$$;
