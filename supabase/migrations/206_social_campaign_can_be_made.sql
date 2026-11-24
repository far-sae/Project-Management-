-- A social media campaign can be made again.
--
-- What was wrong: one check guards both a campaign and a post (it makes sure
-- that the workspace, the project, the lead and so on belong together). For a
-- post it also looks at the post's campaign and account. A campaign has no
-- such fields, and the database stopped with
--   record "new" has no field "campaign_id"
-- on every new campaign, so none could ever be saved.
--
-- The fix: the check reads those two fields only when the row has them. All
-- the rules stay as they were.
--
-- Safe to run more than once.

create or replace function public.social_validate_scope()
returns trigger language plpgsql set search_path = public as $$
declare
  -- The row as a list of named values: a field that this table does not have is simply not in it.
  r jsonb := to_jsonb(new);
  v_campaign uuid := nullif(r ->> 'campaign_id', '')::uuid;
  v_account uuid := nullif(r ->> 'account_id', '')::uuid;
begin
  if not exists (select 1 from public.workspaces w where w.workspace_id = new.workspace_id and w.organization_id = new.organization_id) then
    raise exception 'Workspace does not belong to organization' using errcode = '23514';
  end if;
  if new.project_id is not null and not exists (
    select 1 from public.projects p where p.project_id = new.project_id
      and p.workspace_id = new.workspace_id and p.organization_id = new.organization_id
  ) then raise exception 'Project must belong to the same workspace' using errcode = '23514'; end if;
  if new.task_id is not null and not exists (
    select 1 from public.tasks t join public.projects p on p.project_id = t.project_id
    where t.task_id = new.task_id and p.workspace_id = new.workspace_id
  ) then raise exception 'Task must belong to the same workspace' using errcode = '23514'; end if;
  if new.crm_contact_id is not null and not exists (
    select 1 from public.crm_contacts c where c.id = new.crm_contact_id and c.workspace_id = new.workspace_id
  ) then raise exception 'CRM contact must belong to the same workspace' using errcode = '23514'; end if;
  if new.crm_company_id is not null and not exists (
    select 1 from public.crm_companies c where c.id = new.crm_company_id and c.workspace_id = new.workspace_id
  ) then raise exception 'CRM company must belong to the same workspace' using errcode = '23514'; end if;
  if v_campaign is not null and not exists (
    select 1 from public.social_campaigns c where c.id = v_campaign and c.workspace_id = new.workspace_id
  ) then raise exception 'Campaign must belong to the same workspace' using errcode = '23514'; end if;
  if v_account is not null and not exists (
    select 1 from public.social_accounts a where a.id = v_account and a.workspace_id = new.workspace_id
  ) then raise exception 'Social account must belong to the same workspace' using errcode = '23514'; end if;
  return new;
end $$;
