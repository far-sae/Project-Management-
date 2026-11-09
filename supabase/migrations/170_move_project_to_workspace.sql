-- Move a project — and everything that belongs to it — to another workspace,
-- including a workspace in a DIFFERENT organization.
--
-- Why a function: when the target workspace is in another organization,
-- organization_id must change on the project AND on every row that carries
-- it (tasks, files, comments, chat, activity, time, expenses, invitations,
-- saved views) in one transaction, otherwise RLS (which is org-scoped) would
-- hide half the project from its new organization.
--
-- Who may move:
--   • source: the project owner, or an owner/admin of the project's organization
--   • target: an owner/admin of the target workspace's organization
-- Cross-organization moves are refused if the project has CRM, billing or
-- social records, which are tied to the old organization's pipelines/accounts.

set search_path = public;

create or replace function public.move_project_to_workspace(
  p_project uuid,
  p_workspace uuid  -- null = "No workspace" (stays in its organization)
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_src_org uuid;
  v_owner uuid;
  v_tgt_org uuid;
  v_blockers text := '';
  v_n bigint;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select organization_id, owner_id into v_src_org, v_owner
  from public.projects where project_id = p_project
  for update;
  if not found then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;

  if not (v_owner = v_uid or public.is_org_admin_or_owner(v_src_org)) then
    raise exception 'Only the project owner or an organization admin can move this project'
      using errcode = '42501';
  end if;

  if p_workspace is null then
    update public.projects
      set workspace_id = null, updated_at = now()
      where project_id = p_project;
    return;
  end if;

  select organization_id into v_tgt_org
  from public.workspaces where workspace_id = p_workspace;
  if not found then
    raise exception 'That workspace no longer exists' using errcode = 'P0002';
  end if;

  if not public.is_org_admin_or_owner(v_tgt_org) then
    raise exception 'You need to be an owner or admin of the destination organization'
      using errcode = '42501';
  end if;

  if v_tgt_org = v_src_org then
    update public.projects
      set workspace_id = p_workspace, updated_at = now()
      where project_id = p_project;
    return;
  end if;

  -- Cross-organization: refuse if records tied to the old org's CRM/billing/social exist.
  select count(*) into v_n from public.crm_deals where project_id = p_project;
  if v_n > 0 then v_blockers := v_blockers || ', CRM deals'; end if;
  select count(*) into v_n from public.crm_tasks where project_id = p_project;
  if v_n > 0 then v_blockers := v_blockers || ', CRM tasks'; end if;
  select count(*) into v_n from public.crm_client_accounts where project_id = p_project;
  if v_n > 0 then v_blockers := v_blockers || ', client accounts'; end if;
  select count(*) into v_n from public.invoices where project_id = p_project;
  if v_n > 0 then v_blockers := v_blockers || ', invoices'; end if;
  select count(*) into v_n from public.invoice_schedules where project_id = p_project;
  if v_n > 0 then v_blockers := v_blockers || ', invoice schedules'; end if;
  select count(*) into v_n from public.bills where project_id = p_project;
  if v_n > 0 then v_blockers := v_blockers || ', bills'; end if;
  select count(*) into v_n from public.social_campaigns where project_id = p_project;
  if v_n > 0 then v_blockers := v_blockers || ', social campaigns'; end if;
  select count(*) into v_n from public.social_content where project_id = p_project;
  if v_n > 0 then v_blockers := v_blockers || ', social posts'; end if;
  if v_blockers <> '' then
    raise exception 'This project can''t move to another organization because it has %',
      substr(v_blockers, 3)
      using errcode = '23503';
  end if;

  update public.projects
    set organization_id = v_tgt_org, workspace_id = p_workspace, updated_at = now()
    where project_id = p_project;
  update public.tasks                 set organization_id = v_tgt_org where project_id = p_project;
  update public.files                 set organization_id = v_tgt_org where project_id = p_project;
  update public.global_comments       set organization_id = v_tgt_org where project_id = p_project;
  update public.project_chat_messages set organization_id = v_tgt_org where project_id = p_project;
  update public.activity              set organization_id = v_tgt_org where project_id = p_project;
  update public.time_entries          set organization_id = v_tgt_org where project_id = p_project;
  update public.expenses              set organization_id = v_tgt_org where project_id = p_project;
  update public.saved_views           set organization_id = v_tgt_org where project_id = p_project;
  update public.invitations           set organization_id = v_tgt_org where project_id = p_project;
end;
$$;

revoke all on function public.move_project_to_workspace(uuid, uuid) from public;
grant execute on function public.move_project_to_workspace(uuid, uuid) to authenticated;
