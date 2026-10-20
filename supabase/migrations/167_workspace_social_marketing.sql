-- Workspace-scoped social planning, approval, publishing queue and analytics.

set search_path = public;

create table if not exists public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  workspace_id uuid not null references public.workspaces(workspace_id) on delete cascade,
  provider text not null check (provider in ('linkedin','facebook','instagram','x','youtube','tiktok','other')),
  display_name text not null,
  external_account_id text,
  credential_ref text,
  status text not null default 'disconnected' check (status in ('disconnected','connected','error')),
  last_error text,
  connected_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, provider, external_account_id)
);

create table if not exists public.social_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  workspace_id uuid not null references public.workspaces(workspace_id) on delete cascade,
  name text not null,
  objective text,
  crm_contact_id uuid references public.crm_contacts(id) on delete set null,
  crm_company_id uuid references public.crm_companies(id) on delete set null,
  project_id uuid references public.projects(project_id) on delete set null,
  task_id uuid references public.tasks(task_id) on delete set null,
  status text not null default 'draft' check (status in ('draft','active','paused','finished')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.social_content (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  workspace_id uuid not null references public.workspaces(workspace_id) on delete cascade,
  campaign_id uuid references public.social_campaigns(id) on delete set null,
  account_id uuid references public.social_accounts(id) on delete set null,
  crm_contact_id uuid references public.crm_contacts(id) on delete set null,
  crm_company_id uuid references public.crm_companies(id) on delete set null,
  project_id uuid references public.projects(project_id) on delete set null,
  task_id uuid references public.tasks(task_id) on delete set null,
  title text not null,
  body text not null default '',
  media_urls jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft','in_review','approved','scheduled','publishing','published','failed')),
  scheduled_at timestamptz,
  published_at timestamptz,
  external_post_id text,
  last_error text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.social_content_metrics (
  content_id uuid primary key references public.social_content(id) on delete cascade,
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  workspace_id uuid not null references public.workspaces(workspace_id) on delete cascade,
  impressions bigint not null default 0,
  reach bigint not null default 0,
  clicks bigint not null default 0,
  reactions bigint not null default 0,
  comments bigint not null default 0,
  shares bigint not null default 0,
  synced_at timestamptz,
  check (impressions >= 0 and reach >= 0 and clicks >= 0 and reactions >= 0 and comments >= 0 and shares >= 0)
);

create table if not exists public.social_account_secrets (
  account_id uuid primary key references public.social_accounts(id) on delete cascade,
  secret_encrypted text not null,
  updated_at timestamptz not null default now()
);
alter table public.social_account_secrets enable row level security;
revoke all on public.social_account_secrets from public, anon, authenticated;
grant all on public.social_account_secrets to service_role;

create index if not exists social_content_calendar_idx on public.social_content(workspace_id, scheduled_at);
create index if not exists social_content_status_idx on public.social_content(workspace_id, status);
create index if not exists social_campaigns_scope_idx on public.social_campaigns(workspace_id, status);

create or replace function public.social_validate_scope()
returns trigger language plpgsql set search_path = public as $$
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
  if tg_table_name = 'social_content' and new.campaign_id is not null and not exists (
    select 1 from public.social_campaigns c where c.id = new.campaign_id and c.workspace_id = new.workspace_id
  ) then raise exception 'Campaign must belong to the same workspace' using errcode = '23514'; end if;
  if tg_table_name = 'social_content' and new.account_id is not null and not exists (
    select 1 from public.social_accounts a where a.id = new.account_id and a.workspace_id = new.workspace_id
  ) then raise exception 'Social account must belong to the same workspace' using errcode = '23514'; end if;
  return new;
end $$;
drop trigger if exists social_campaign_scope_trg on public.social_campaigns;
create trigger social_campaign_scope_trg before insert or update on public.social_campaigns
  for each row execute function public.social_validate_scope();
drop trigger if exists social_content_scope_trg on public.social_content;
create trigger social_content_scope_trg before insert or update on public.social_content
  for each row execute function public.social_validate_scope();

create or replace function public.social_validate_basic_scope()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from public.workspaces w where w.workspace_id = new.workspace_id and w.organization_id = new.organization_id) then
    raise exception 'Workspace does not belong to organization' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists social_account_scope_trg on public.social_accounts;
create trigger social_account_scope_trg before insert or update on public.social_accounts for each row execute function public.social_validate_basic_scope();
drop trigger if exists social_metrics_scope_trg on public.social_content_metrics;
create trigger social_metrics_scope_trg before insert or update on public.social_content_metrics for each row execute function public.social_validate_basic_scope();

do $$ declare t text; begin
  foreach t in array array['social_accounts','social_campaigns','social_content','social_content_metrics'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.can_access_workspace(workspace_id))', t || '_select', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.can_access_workspace(workspace_id) and not public.is_org_viewer(organization_id)) with check (public.can_access_workspace(workspace_id) and not public.is_org_viewer(organization_id))', t || '_write', t);
  end loop;
end $$;

drop trigger if exists social_accounts_touch_trg on public.social_accounts;
create trigger social_accounts_touch_trg before update on public.social_accounts for each row execute function public.touch_updated_at();
drop trigger if exists social_campaigns_touch_trg on public.social_campaigns;
create trigger social_campaigns_touch_trg before update on public.social_campaigns for each row execute function public.touch_updated_at();
drop trigger if exists social_content_touch_trg on public.social_content;
create trigger social_content_touch_trg before update on public.social_content for each row execute function public.touch_updated_at();

-- Claim approved scheduled posts. A service worker calls this and then uses
-- credential_ref to resolve provider credentials outside the database.
create or replace function public.claim_social_posts(p_limit int default 25)
returns setof public.social_content
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select id from public.social_content
    where status = 'scheduled' and scheduled_at <= now()
    order by scheduled_at for update skip locked limit greatest(1, least(p_limit, 100))
  ), claimed as (
    update public.social_content c set status = 'publishing', updated_at = now()
    from due where c.id = due.id returning c.*
  ) select * from claimed;
end $$;
revoke execute on function public.claim_social_posts(int) from public, anon, authenticated;
grant execute on function public.claim_social_posts(int) to service_role;
