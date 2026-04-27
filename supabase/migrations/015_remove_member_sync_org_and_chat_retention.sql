-- 1) When a user is removed from a project, also remove them from organizations.members
--    if they are not the org owner and no longer appear on any project in that org
--    (owner_id or members JSON) — fixes Workload / Reports / pickers still listing them.
--
-- 2) Purge project_chat_messages older than N days (same retention idea as comments).

create or replace function public.remove_project_member(
  p_project_id uuid,
  p_member_user_id text,
  p_member_email text default null,
  p_unassign_tasks boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_email text := lower(trim(coalesce(p_member_email, '')));
  v_cancelled_invitations integer := 0;
  v_affected_tasks integer := 0;
  v_org_id uuid;
  v_still_in_org_projects boolean;
  v_is_org_owner boolean;
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

  -- Drop from organization roster when they are not on any project in that org anymore.
  select organization_id into v_org_id
  from projects
  where project_id = p_project_id;

  if v_org_id is not null then
    select exists (
      select 1 from organizations o
      where o.organization_id = v_org_id
        and o.owner_id::text = p_member_user_id
    ) into v_is_org_owner;

    if not v_is_org_owner then
      select exists (
        select 1
        from projects pr
        where pr.organization_id = v_org_id
          and (
            pr.owner_id::text = p_member_user_id
            or exists (
              select 1
              from jsonb_array_elements(coalesce(pr.members, '[]'::jsonb)) elem
              where coalesce(elem->>'userId', elem->>'user_id', '') = p_member_user_id
            )
          )
      ) into v_still_in_org_projects;

      if not coalesce(v_still_in_org_projects, false) then
        update organizations o
        set
          members = (
            select coalesce(jsonb_agg(m), '[]'::jsonb)
            from jsonb_array_elements(coalesce(o.members, '[]'::jsonb)) as m
            where coalesce(m->>'userId', m->>'user_id', '') <> p_member_user_id
              and (
                v_member_email = ''
                or lower(trim(coalesce(m->>'email', ''))) <> v_member_email
              )
          ),
          updated_at = now()
        where o.organization_id = v_org_id;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'cancelledInvitations', v_cancelled_invitations,
    'affectedTaskCount', v_affected_tasks
  );
end;
$$;

-- Project rail chat: same 30-day style retention as task comments (no FK cascade concerns).
create or replace function public.purge_old_project_chat_messages(p_retention_days integer default 30)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff timestamptz;
  n_deleted bigint;
begin
  if p_retention_days < 1 then
    raise exception 'retention must be at least 1 day';
  end if;

  cutoff := now() - make_interval(days => p_retention_days);

  delete from public.project_chat_messages
  where created_at < cutoff;

  get diagnostics n_deleted = row_count;
  return n_deleted;
end;
$$;

revoke all on function public.purge_old_project_chat_messages(integer) from public;
grant execute on function public.purge_old_project_chat_messages(integer) to service_role;

comment on function public.purge_old_project_chat_messages(integer) is
  'Deletes project_chat_messages older than p_retention_days.';

create index if not exists idx_project_chat_messages_created_at
  on public.project_chat_messages (created_at);

-- Schedule chat purge next to comment purge when pg_cron exists.
do $$
declare
  r record;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    for r in select jobid from cron.job where jobname = 'purge_old_project_chat_messages'
    loop
      perform cron.unschedule(r.jobid);
    end loop;
    perform cron.schedule(
      'purge_old_project_chat_messages',
      '15 6 * * *',
      'select public.purge_old_project_chat_messages(30)'
    );
  end if;
end $$;
