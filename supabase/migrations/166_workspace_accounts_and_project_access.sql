-- Workspace client accounts and one authoritative project access check.

set search_path = public;

create or replace function public.can_access_project(p_project uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.projects p
    where p.project_id = p_project
      and auth.uid() is not null
      and (
        p.owner_id = auth.uid()
        or public.is_org_admin_or_owner(p.organization_id)
        or exists (
          select 1 from jsonb_array_elements(coalesce(p.members, '[]'::jsonb)) m
          where coalesce(m->>'userId', m->>'user_id') = auth.uid()::text
        )
      )
  );
$$;
grant execute on function public.can_access_project(uuid) to authenticated;

create or replace function public.project_access_role(p_project uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p.owner_id = auth.uid() or public.is_org_admin_or_owner(p.organization_id) then 'admin'
    else coalesce((select m->>'role' from jsonb_array_elements(coalesce(p.members, '[]'::jsonb)) m
      where coalesce(m->>'userId', m->>'user_id') = auth.uid()::text limit 1), 'none')
  end
  from public.projects p where p.project_id = p_project;
$$;
grant execute on function public.project_access_role(uuid) to authenticated;

-- Projects were historically protected only by filtered client queries. RLS
-- makes direct API access follow the exact same membership rule.
alter table public.projects enable row level security;
drop policy if exists "projects_member_select" on public.projects;
create policy "projects_member_select" on public.projects for select to authenticated
  using (public.can_access_project(project_id));
drop policy if exists "projects_admin_insert" on public.projects;
create policy "projects_admin_insert" on public.projects for insert to authenticated
  with check (owner_id = auth.uid() or public.is_org_admin_or_owner(organization_id));
drop policy if exists "projects_manager_update" on public.projects;
create policy "projects_manager_update" on public.projects for update to authenticated
  using (
    owner_id = auth.uid() or public.is_org_admin_or_owner(organization_id)
    or exists (
      select 1 from jsonb_array_elements(coalesce(members, '[]'::jsonb)) m
      where coalesce(m->>'userId', m->>'user_id') = auth.uid()::text
        and m->>'role' = 'admin'
    )
  )
  with check (public.can_access_project(project_id));
drop policy if exists "projects_admin_delete" on public.projects;
create policy "projects_admin_delete" on public.projects for delete to authenticated
  using (owner_id = auth.uid() or public.is_org_admin_or_owner(organization_id));

-- A task is never visible outside its project. Locked tasks retain the tighter
-- creator/assignee/owner rule. This also fixes invited users whose access was
-- granted in either legacy user_id or current userId JSON form.
drop policy if exists "tasks_locked_visibility" on public.tasks;
create policy "tasks_locked_visibility" on public.tasks for select to authenticated
  using (
    public.can_access_project(project_id)
    and (
      not coalesce(is_locked, false)
      or created_by = auth.uid()
      or public.tasks_user_is_assignee(assignees)
      or public.tasks_user_is_project_owner(project_id)
      or public.tasks_user_is_org_admin(organization_id)
    )
  );
drop policy if exists "tasks_insert_authenticated" on public.tasks;
create policy "tasks_insert_authenticated" on public.tasks for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.can_access_project(project_id)
    and not public.is_org_viewer(organization_id)
    and public.project_access_role(project_id) <> 'viewer'
  );

drop policy if exists "tasks_update_authorized" on public.tasks;
create policy "tasks_update_authorized" on public.tasks for update to authenticated
  using (
    public.can_access_project(project_id)
    and not public.is_org_viewer(organization_id)
    and public.project_access_role(project_id) <> 'viewer'
    and (
      not coalesce(is_locked, false) or created_by = auth.uid()
      or public.tasks_user_is_assignee(assignees)
      or public.tasks_user_is_project_owner(project_id)
      or public.tasks_user_is_org_admin(organization_id)
    )
  )
  with check (
    public.can_access_project(project_id)
    and not public.is_org_viewer(organization_id)
    and public.project_access_role(project_id) <> 'viewer'
  );

drop policy if exists "tasks_delete_authorized" on public.tasks;
create policy "tasks_delete_authorized" on public.tasks for delete to authenticated
  using (
    public.can_access_project(project_id)
    and public.project_access_role(project_id) <> 'viewer'
    and (
      created_by = auth.uid() or public.tasks_user_is_assignee(assignees)
      or public.tasks_user_is_project_owner(project_id)
      or public.tasks_user_is_org_admin(organization_id)
    )
  );

create table if not exists public.crm_client_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  workspace_id uuid not null references public.workspaces(workspace_id) on delete cascade,
  contact_id uuid not null references public.crm_contacts(id) on delete cascade,
  project_id uuid references public.projects(project_id) on delete set null,
  service_name text not null,
  billing_type text not null check (billing_type in ('one_time', 'monthly')),
  agreed_amount numeric(14,2) not null default 0 check (agreed_amount >= 0),
  opening_paid numeric(14,2) not null default 0 check (opening_paid >= 0),
  service_start date,
  service_end date,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (service_end is null or service_start is null or service_end >= service_start)
);

create table if not exists public.crm_account_payments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.crm_client_accounts(id) on delete cascade,
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  workspace_id uuid not null references public.workspaces(workspace_id) on delete cascade,
  paid_on date not null,
  amount numeric(14,2) not null check (amount > 0),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists crm_client_accounts_scope_idx
  on public.crm_client_accounts(workspace_id, contact_id);
create index if not exists crm_account_payments_scope_idx
  on public.crm_account_payments(workspace_id, paid_on, account_id);

create or replace function public.crm_validate_account_scope()
returns trigger language plpgsql set search_path = public as $$
declare v_org uuid; v_workspace uuid;
begin
  select organization_id, workspace_id into v_org, v_workspace
  from public.crm_contacts where id = new.contact_id;
  if v_org is distinct from new.organization_id or v_workspace is distinct from new.workspace_id then
    raise exception 'Account contact must belong to the same workspace' using errcode = '23514';
  end if;
  if new.project_id is not null and not exists (
    select 1 from public.projects p where p.project_id = new.project_id
      and p.organization_id = new.organization_id and p.workspace_id = new.workspace_id
  ) then
    raise exception 'Account project must belong to the same workspace' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists crm_validate_account_scope_trg on public.crm_client_accounts;
create trigger crm_validate_account_scope_trg before insert or update on public.crm_client_accounts
  for each row execute function public.crm_validate_account_scope();

create or replace function public.crm_validate_payment_scope()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (
    select 1 from public.crm_client_accounts a where a.id = new.account_id
      and a.organization_id = new.organization_id and a.workspace_id = new.workspace_id
  ) then
    raise exception 'Payment must belong to its account workspace' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists crm_validate_payment_scope_trg on public.crm_account_payments;
create trigger crm_validate_payment_scope_trg before insert or update on public.crm_account_payments
  for each row execute function public.crm_validate_payment_scope();

alter table public.crm_client_accounts enable row level security;
alter table public.crm_account_payments enable row level security;
grant select, insert, update, delete on public.crm_client_accounts, public.crm_account_payments to authenticated;
grant all on public.crm_client_accounts, public.crm_account_payments to service_role;

create policy "crm_client_accounts_select" on public.crm_client_accounts for select to authenticated
  using (public.can_access_workspace(workspace_id));
create policy "crm_client_accounts_write" on public.crm_client_accounts for all to authenticated
  using (public.can_access_workspace(workspace_id) and not public.is_org_viewer(organization_id))
  with check (public.can_access_workspace(workspace_id) and not public.is_org_viewer(organization_id));
create policy "crm_account_payments_select" on public.crm_account_payments for select to authenticated
  using (public.can_access_workspace(workspace_id));
create policy "crm_account_payments_write" on public.crm_account_payments for all to authenticated
  using (public.can_access_workspace(workspace_id) and not public.is_org_viewer(organization_id))
  with check (public.can_access_workspace(workspace_id) and not public.is_org_viewer(organization_id));

-- Keeps updated_at accurate without depending on any older trigger helper.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists crm_client_accounts_touch_trg on public.crm_client_accounts;
create trigger crm_client_accounts_touch_trg before update on public.crm_client_accounts
  for each row execute function public.touch_updated_at();
