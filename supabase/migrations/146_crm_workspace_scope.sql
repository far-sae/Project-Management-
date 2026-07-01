-- 146_crm_workspace_scope.sql
--
-- Scope CRM entities to workspaces (in addition to organizations) so users
-- can slice their pipeline by workspace via the sidebar workspace switcher.
--
-- All columns are NULLable: a row with NULL workspace_id is org-wide (visible
-- from every workspace). A row with a workspace_id is only listed when the
-- user has that workspace selected (or "All workspaces" is active).
--
-- Deal stages + tags stay purely org-scoped — they're pipeline / label
-- configuration shared across workspaces. crm_deals already got its
-- workspace_id in 145 as the handoff-target column; the same column doubles
-- as the workspace scope, so no change needed on crm_deals here.

set search_path = public;

alter table public.crm_companies
  add column if not exists workspace_id uuid references public.workspaces(workspace_id) on delete set null;
create index if not exists idx_crm_companies_workspace on public.crm_companies(workspace_id);

alter table public.crm_contacts
  add column if not exists workspace_id uuid references public.workspaces(workspace_id) on delete set null;
create index if not exists idx_crm_contacts_workspace on public.crm_contacts(workspace_id);

alter table public.crm_tasks
  add column if not exists workspace_id uuid references public.workspaces(workspace_id) on delete set null;
create index if not exists idx_crm_tasks_workspace on public.crm_tasks(workspace_id);

alter table public.crm_activities
  add column if not exists workspace_id uuid references public.workspaces(workspace_id) on delete set null;
create index if not exists idx_crm_activities_workspace on public.crm_activities(workspace_id);

alter table public.crm_notes
  add column if not exists workspace_id uuid references public.workspaces(workspace_id) on delete set null;
create index if not exists idx_crm_notes_workspace on public.crm_notes(workspace_id);
