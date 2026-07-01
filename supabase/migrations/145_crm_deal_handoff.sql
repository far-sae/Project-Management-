-- 145_crm_deal_handoff.sql
--
-- Deal → PM handoff: when a deal is Won, the user can create (or link)
-- a workspace + a project inside TaskCalendar so sales-execution moves
-- into project management. We track that link on crm_deals itself.
--
-- Both columns are ON DELETE SET NULL so deleting the workspace/project
-- doesn't cascade-delete a paying deal record — the link just goes null.

set search_path = public;

alter table public.crm_deals
  add column if not exists workspace_id uuid references public.workspaces(workspace_id) on delete set null,
  add column if not exists project_id   uuid references public.projects(project_id)     on delete set null;

create index if not exists idx_crm_deals_workspace on public.crm_deals(workspace_id);
create index if not exists idx_crm_deals_project   on public.crm_deals(project_id);
