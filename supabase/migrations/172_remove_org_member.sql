-- Remove a person from an organization COMPLETELY.
--
-- Before this, "remove from organization" only dropped them from
-- organizations.members. Project access is checked against each project's
-- own members list (can_access_project), so a removed person kept full access
-- to every project they had been added to — plus any project they owned,
-- pending invitations they could still accept, etc.
--
-- This function, in one transaction, for the given organization:
--   • drops them from the organization roster
--   • drops them from every project's member list
--   • hands projects / templates they owned to the organization owner
--   • (optionally) unassigns them from every task
--   • cancels their pending/accepted invitations
--   • deletes their per-org leftovers: CRM grants, saved views, task drafts,
--     mind-map state, notifications about the org's projects, connected
--     mailboxes (SMTP/IMAP credentials)
--   • clears their profile's pointer to this organization
--
-- Kept on purpose (the team's own records): tasks they created, comments,
-- files, chat messages, time entries, expenses, HR/payroll rows, activity.
-- Their login account is not deleted — it may belong to other organizations.
--
-- Who may remove: an owner/admin of the organization. Only the organization
-- owner can remove an admin. Nobody can remove the owner or themselves.

set search_path = public;

create or replace function public.remove_org_member(
  p_org uuid,
  p_user uuid,
  p_unassign_tasks boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_role text;
  v_email text := '';
  v_uid_txt text := p_user::text;
  v_projects integer := 0;
  v_owned integer := 0;
  v_tasks integer := 0;
  v_invites integer := 0;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select owner_id into v_owner
  from public.organizations where organization_id = p_org
  for update;
  if not found then
    raise exception 'Organization not found' using errcode = 'P0002';
  end if;

  if not public.is_org_admin_or_owner(p_org) then
    raise exception 'Only an organization owner or admin can remove people'
      using errcode = '42501';
  end if;
  if p_user = v_owner then
    raise exception 'The organization owner can''t be removed' using errcode = '42501';
  end if;
  if p_user = v_uid then
    raise exception 'You can''t remove yourself' using errcode = '42501';
  end if;

  select m->>'role', lower(trim(coalesce(m->>'email', '')))
    into v_role, v_email
  from public.organizations o,
       jsonb_array_elements(coalesce(o.members, '[]'::jsonb)) m
  where o.organization_id = p_org
    and coalesce(m->>'userId', m->>'user_id', '') = v_uid_txt
  limit 1;

  if v_role in ('admin', 'owner') and v_uid <> v_owner then
    raise exception 'Only the organization owner can remove an admin' using errcode = '42501';
  end if;

  if coalesce(v_email, '') = '' then
    select lower(trim(coalesce(email, ''))) into v_email from auth.users where id = p_user;
  end if;
  v_email := coalesce(v_email, '');

  -- 1. Organization roster
  update public.organizations o
    set members = (
          select coalesce(jsonb_agg(m), '[]'::jsonb)
          from jsonb_array_elements(coalesce(o.members, '[]'::jsonb)) m
          where coalesce(m->>'userId', m->>'user_id', '') <> v_uid_txt
            and (v_email = '' or lower(trim(coalesce(m->>'email', ''))) <> v_email)
        ),
        updated_at = now()
    where o.organization_id = p_org;

  -- 2. Every project's member list
  with changed as (
    update public.projects p
      set members = f.kept,
          stats = jsonb_set(coalesce(p.stats, '{}'::jsonb), '{membersCount}',
                            to_jsonb(jsonb_array_length(f.kept)), true),
          updated_at = now()
      from (
        select p2.project_id,
               coalesce((
                 select jsonb_agg(m)
                 from jsonb_array_elements(coalesce(p2.members, '[]'::jsonb)) m
                 where coalesce(m->>'userId', m->>'user_id', '') <> v_uid_txt
                   and (v_email = '' or lower(trim(coalesce(m->>'email', ''))) <> v_email)
               ), '[]'::jsonb) as kept
        from public.projects p2
        where p2.organization_id = p_org
          and exists (
            select 1 from jsonb_array_elements(coalesce(p2.members, '[]'::jsonb)) m
            where coalesce(m->>'userId', m->>'user_id', '') = v_uid_txt
               or (v_email <> '' and lower(trim(coalesce(m->>'email', ''))) = v_email)
          )
      ) f
      where p.project_id = f.project_id
      returning 1
  )
  select count(*) into v_projects from changed;

  -- 3. Projects and templates they owned stay with the team
  update public.projects
    set owner_id = v_owner, updated_at = now()
    where organization_id = p_org and owner_id = p_user;
  get diagnostics v_owned = row_count;

  update public.project_templates
    set owner_id = v_owner, updated_at = now()
    where organization_id = p_org and owner_id = p_user;

  -- 4. Task assignments
  if p_unassign_tasks then
    update public.tasks t
      set assignees = (
            select coalesce(jsonb_agg(a), '[]'::jsonb)
            from jsonb_array_elements(coalesce(t.assignees, '[]'::jsonb)) a
            where coalesce(a->>'userId', a->>'user_id', '') <> v_uid_txt
              and (v_email = '' or lower(trim(coalesce(a->>'email', ''))) <> v_email)
          ),
          updated_at = now()
      where t.organization_id = p_org
        and exists (
          select 1 from jsonb_array_elements(coalesce(t.assignees, '[]'::jsonb)) a
          where coalesce(a->>'userId', a->>'user_id', '') = v_uid_txt
             or (v_email <> '' and lower(trim(coalesce(a->>'email', ''))) = v_email)
        );
    get diagnostics v_tasks = row_count;
  end if;

  -- 5. Invitations they could still use
  if v_email <> '' then
    update public.invitations
      set status = 'cancelled', updated_at = now()
      where organization_id = p_org
        and lower(trim(email)) = v_email
        and status in ('pending', 'accepted');
    get diagnostics v_invites = row_count;
  end if;

  -- 6. Per-organization leftovers
  delete from public.crm_module_grants where organization_id = p_org and user_id = p_user;
  delete from public.saved_views       where organization_id = p_org and owner_id = p_user;
  delete from public.email_accounts    where organization_id = p_org and user_id = p_user;
  delete from public.task_comment_drafts d
    using public.tasks t
    where d.user_id = p_user and t.task_id = d.task_id and t.organization_id = p_org;
  delete from public.mind_map_state s
    using public.projects p
    where s.user_id = p_user and p.project_id = s.project_id and p.organization_id = p_org;
  delete from public.notifications n
    using public.projects p
    where n.user_id = p_user and p.project_id = n.project_id and p.organization_id = p_org;

  update public.user_profiles
    set organization_id = null, updated_at = now()
    where id = p_user and organization_id = p_org::text;

  return jsonb_build_object(
    'projects', v_projects,
    'ownedProjectsTransferred', v_owned,
    'tasksUnassigned', v_tasks,
    'invitationsCancelled', v_invites
  );
end;
$$;

revoke all on function public.remove_org_member(uuid, uuid, boolean) from public;
grant execute on function public.remove_org_member(uuid, uuid, boolean) to authenticated;
