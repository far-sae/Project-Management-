-- One workspace = one CRM + one PM system.
--
-- This migration deliberately does not guess the owner of legacy rows. Rows
-- whose workspace can be proven from a linked project/entity (or from an org
-- that has exactly one workspace) are backfilled. Everything else remains
-- untouched and is recorded in crm_workspace_assignment_review.

set search_path = public;

alter table public.workspaces
  add column if not exists crm_settings jsonb not null default '{}'::jsonb;

alter table public.crm_deal_stages
  add column if not exists workspace_id uuid references public.workspaces(workspace_id) on delete cascade;
alter table public.crm_tags
  add column if not exists workspace_id uuid references public.workspaces(workspace_id) on delete cascade;
alter table public.crm_tasks
  add column if not exists project_id uuid references public.projects(project_id) on delete set null,
  add column if not exists shared_task_id uuid references public.tasks(task_id) on delete set null;
alter table public.tasks
  add column if not exists source_crm_deal_id uuid references public.crm_deals(id) on delete set null,
  add column if not exists source_crm_contact_id uuid references public.crm_contacts(id) on delete set null;

create index if not exists idx_crm_deal_stages_workspace on public.crm_deal_stages(workspace_id, sort_order);
create index if not exists idx_crm_tags_workspace on public.crm_tags(workspace_id, name);
create index if not exists idx_crm_tasks_project on public.crm_tasks(project_id);
create unique index if not exists idx_crm_tasks_shared_task on public.crm_tasks(shared_task_id)
  where shared_task_id is not null;
create index if not exists idx_tasks_source_crm_deal on public.tasks(source_crm_deal_id)
  where source_crm_deal_id is not null;
create index if not exists idx_tasks_source_crm_contact on public.tasks(source_crm_contact_id)
  where source_crm_contact_id is not null;

-- Seed workspace CRM settings from the old organization-level value.
update public.workspaces w
set crm_settings = jsonb_build_object(
  'currency', coalesce(o.settings #>> '{crm,currency}', o.settings->>'currency', 'GBP')
)
from public.organizations o
where o.organization_id = w.organization_id
  and w.crm_settings = '{}'::jsonb;

-- A linked PM project is authoritative for deal ownership.
update public.crm_deals d
set workspace_id = p.workspace_id
from public.projects p
where d.project_id = p.project_id
  and d.organization_id = p.organization_id
  and p.workspace_id is not null
  and d.workspace_id is null;

-- A sole workspace is unambiguous.
with sole_workspace as (
  select organization_id, min(workspace_id::text)::uuid as workspace_id
  from public.workspaces
  group by organization_id
  having count(*) = 1
)
update public.crm_companies x set workspace_id = s.workspace_id
from sole_workspace s where x.organization_id = s.organization_id and x.workspace_id is null;
with sole_workspace as (
  select organization_id, min(workspace_id::text)::uuid as workspace_id from public.workspaces
  group by organization_id having count(*) = 1
)
update public.crm_contacts x set workspace_id = s.workspace_id
from sole_workspace s where x.organization_id = s.organization_id and x.workspace_id is null;
with sole_workspace as (
  select organization_id, min(workspace_id::text)::uuid as workspace_id from public.workspaces
  group by organization_id having count(*) = 1
)
update public.crm_deals x set workspace_id = s.workspace_id
from sole_workspace s where x.organization_id = s.organization_id and x.workspace_id is null;

-- Related records are authoritative only when all available relationships
-- agree on exactly one workspace.
update public.crm_contacts c
set workspace_id = co.workspace_id
from public.crm_companies co
where c.company_id = co.id and c.organization_id = co.organization_id
  and c.workspace_id is null and co.workspace_id is not null;

with candidates as (
  select d.id, min(v.workspace_id::text)::uuid as workspace_id
  from public.crm_deals d
  cross join lateral (
    select c.workspace_id from public.crm_contacts c where c.id = d.contact_id
    union all
    select co.workspace_id from public.crm_companies co where co.id = d.company_id
  ) v
  where d.workspace_id is null and v.workspace_id is not null
  group by d.id having count(distinct v.workspace_id) = 1
)
update public.crm_deals d set workspace_id = c.workspace_id
from candidates c where d.id = c.id;

with candidates as (
  select t.id, min(v.workspace_id::text)::uuid as workspace_id
  from public.crm_tasks t
  cross join lateral (
    select d.workspace_id from public.crm_deals d where d.id = t.deal_id
    union all select c.workspace_id from public.crm_contacts c where c.id = t.contact_id
    union all select co.workspace_id from public.crm_companies co where co.id = t.company_id
  ) v
  where t.workspace_id is null and v.workspace_id is not null
  group by t.id having count(distinct v.workspace_id) = 1
)
update public.crm_tasks t set workspace_id = c.workspace_id
from candidates c where t.id = c.id;

with candidates as (
  select a.id, min(v.workspace_id::text)::uuid as workspace_id
  from public.crm_activities a
  cross join lateral (
    select d.workspace_id from public.crm_deals d where d.id = a.deal_id
    union all select c.workspace_id from public.crm_contacts c where c.id = a.contact_id
    union all select co.workspace_id from public.crm_companies co where co.id = a.company_id
    union all select t.workspace_id from public.crm_tasks t where t.id = a.task_id
  ) v
  where a.workspace_id is null and v.workspace_id is not null
  group by a.id having count(distinct v.workspace_id) = 1
)
update public.crm_activities a set workspace_id = c.workspace_id
from candidates c where a.id = c.id;

with candidates as (
  select n.id, min(v.workspace_id::text)::uuid as workspace_id
  from public.crm_notes n
  cross join lateral (
    select d.workspace_id from public.crm_deals d where d.id = n.deal_id
    union all select c.workspace_id from public.crm_contacts c where c.id = n.contact_id
    union all select co.workspace_id from public.crm_companies co where co.id = n.company_id
  ) v
  where n.workspace_id is null and v.workspace_id is not null
  group by n.id having count(distinct v.workspace_id) = 1
)
update public.crm_notes n set workspace_id = c.workspace_id
from candidates c where n.id = c.id;

-- Clone the old organization-wide stage configuration per workspace, then
-- repoint each already-owned deal. The old stage remains for ambiguous deals.
create temporary table crm_stage_workspace_map (
  old_id uuid not null, workspace_id uuid not null, new_id uuid not null,
  primary key (old_id, workspace_id)
) on commit drop;
with inserted as (
  insert into public.crm_deal_stages
    (organization_id, workspace_id, name, sort_order, probability, status)
  select s.organization_id, w.workspace_id, s.name, s.sort_order, s.probability, s.status
  from public.crm_deal_stages s
  join public.workspaces w on w.organization_id = s.organization_id
  where s.workspace_id is null
    and exists (select 1 from public.crm_deals d where d.stage_id = s.id and d.workspace_id = w.workspace_id)
  returning id, organization_id, workspace_id, name, sort_order
)
insert into crm_stage_workspace_map(old_id, workspace_id, new_id)
select old.id, i.workspace_id, i.id
from inserted i
join public.crm_deal_stages old
  on old.organization_id = i.organization_id and old.workspace_id is null
 and old.name = i.name and old.sort_order = i.sort_order;

update public.crm_deals d set stage_id = m.new_id
from crm_stage_workspace_map m
where d.stage_id = m.old_id and d.workspace_id = m.workspace_id;

-- Workspaces without deals still need an independent default pipeline.
insert into public.crm_deal_stages
  (organization_id, workspace_id, name, sort_order, probability, status)
select w.organization_id, w.workspace_id, v.name, v.sort_order, v.probability, v.status::public.crm_deal_status
from public.workspaces w
cross join (values
  ('New Lead',1,10,'open'), ('Qualified',2,25,'open'), ('Demo Booked',3,40,'open'),
  ('Proposal Sent',4,60,'open'), ('Negotiation',5,80,'open'),
  ('Won',6,100,'won'), ('Lost',7,0,'lost')
) v(name,sort_order,probability,status)
where not exists (
  select 1 from public.crm_deal_stages s where s.workspace_id = w.workspace_id
);

-- Tags are cloned only for contacts whose workspace is known.
alter table public.crm_tags drop constraint if exists crm_tags_organization_id_name_key;
create unique index if not exists crm_tags_workspace_name_key
  on public.crm_tags(organization_id, workspace_id, lower(name))
  where workspace_id is not null;

create temporary table crm_tag_workspace_map (
  old_id uuid not null, workspace_id uuid not null, new_id uuid not null,
  primary key (old_id, workspace_id)
) on commit drop;
with inserted as (
  insert into public.crm_tags(organization_id, workspace_id, name, color)
  select distinct t.organization_id, c.workspace_id, t.name, t.color
  from public.crm_tags t
  join public.crm_contact_tags ct on ct.tag_id = t.id
  join public.crm_contacts c on c.id = ct.contact_id
  where t.workspace_id is null and c.workspace_id is not null
  returning id, organization_id, workspace_id, name
)
insert into crm_tag_workspace_map(old_id, workspace_id, new_id)
select old.id, i.workspace_id, i.id
from inserted i
join public.crm_tags old
  on old.organization_id = i.organization_id and old.workspace_id is null and old.name = i.name;

update public.crm_contact_tags ct set tag_id = m.new_id
from public.crm_contacts c, crm_tag_workspace_map m
where ct.contact_id = c.id and ct.tag_id = m.old_id and c.workspace_id = m.workspace_id;

create table if not exists public.crm_workspace_assignment_review (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  reason text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_workspace_id uuid references public.workspaces(workspace_id) on delete set null,
  unique(entity_type, entity_id)
);
alter table public.crm_workspace_assignment_review enable row level security;
grant select, update on public.crm_workspace_assignment_review to authenticated;
grant all on public.crm_workspace_assignment_review to service_role;
drop policy if exists "crm_workspace_assignment_review_admin" on public.crm_workspace_assignment_review;
create policy "crm_workspace_assignment_review_admin" on public.crm_workspace_assignment_review
  for all to authenticated using (public.is_org_admin_or_owner(organization_id))
  with check (public.is_org_admin_or_owner(organization_id));

insert into public.crm_workspace_assignment_review(organization_id, entity_type, entity_id, reason)
select organization_id, 'deal', id, 'No single workspace could be verified from the deal relationships.'
from public.crm_deals where workspace_id is null on conflict do nothing;
insert into public.crm_workspace_assignment_review(organization_id, entity_type, entity_id, reason)
select organization_id, 'contact', id, 'No single workspace could be verified from the contact relationships.'
from public.crm_contacts where workspace_id is null on conflict do nothing;
insert into public.crm_workspace_assignment_review(organization_id, entity_type, entity_id, reason)
select organization_id, 'company', id, 'No single workspace could be verified.'
from public.crm_companies where workspace_id is null on conflict do nothing;
insert into public.crm_workspace_assignment_review(organization_id, entity_type, entity_id, reason)
select organization_id, 'task', id, 'No single workspace could be verified from the follow-up relationships.'
from public.crm_tasks where workspace_id is null on conflict do nothing;

-- Workspace access follows existing project membership. Owners/admins can
-- access every workspace; other members can access workspaces containing a
-- project they own or belong to.
create or replace function public.can_access_workspace(p_workspace uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspaces w
    where w.workspace_id = p_workspace
      and public.is_org_member(w.organization_id)
      and (
        public.is_org_admin_or_owner(w.organization_id)
        or exists (
          select 1 from public.projects p
          where p.workspace_id = w.workspace_id
            and (p.owner_id = auth.uid() or exists (
              select 1 from jsonb_array_elements(coalesce(p.members, '[]'::jsonb)) m
              where coalesce(m->>'userId', m->>'user_id') = auth.uid()::text
            ))
        )
      )
  );
$$;
grant execute on function public.can_access_workspace(uuid) to authenticated;

create or replace function public.can_access_crm_scope(p_org uuid, p_workspace uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case when p_workspace is null
    then public.is_org_admin_or_owner(p_org)
    else public.can_access_workspace(p_workspace)
  end;
$$;
grant execute on function public.can_access_crm_scope(uuid, uuid) to authenticated;

-- Validate tenant/workspace/project relationships at the database boundary.
create or replace function public.crm_validate_workspace_scope()
returns trigger language plpgsql set search_path = public as $$
declare v_org uuid;
begin
  if new.workspace_id is null then
    if tg_op = 'INSERT' then raise exception 'A workspace is required' using errcode = '23514'; end if;
    return new; -- preserve legacy rows until an administrator resolves them
  end if;
  select organization_id into v_org from public.workspaces where workspace_id = new.workspace_id;
  if v_org is distinct from new.organization_id then
    raise exception 'Workspace does not belong to the CRM organization' using errcode = '23514';
  end if;
  return new;
end;
$$;

do $$ declare t text; begin
  foreach t in array array['crm_companies','crm_contacts','crm_deals','crm_tasks','crm_activities','crm_notes','crm_deal_stages','crm_tags'] loop
    execute format('drop trigger if exists trg_%s_workspace_scope on public.%I', t, t);
    execute format('create trigger trg_%s_workspace_scope before insert or update of workspace_id, organization_id on public.%I for each row execute function public.crm_validate_workspace_scope()', t, t);
  end loop;
end $$;

create or replace function public.crm_validate_project_links()
returns trigger language plpgsql set search_path = public as $$
declare v_workspace uuid; v_org uuid; v_task_project uuid;
begin
  if new.project_id is not null then
    select workspace_id, organization_id into v_workspace, v_org
    from public.projects where project_id = new.project_id;
    if v_workspace is distinct from new.workspace_id or v_org is distinct from new.organization_id then
      raise exception 'Project must belong to the same workspace and organization' using errcode = '23514';
    end if;
  end if;
  if tg_table_name = 'crm_tasks' and new.shared_task_id is not null then
    select project_id into v_task_project from public.tasks where task_id = new.shared_task_id;
    if v_task_project is distinct from new.project_id then
      raise exception 'Shared task must belong to the selected project' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_crm_deals_project_scope on public.crm_deals;
create trigger trg_crm_deals_project_scope before insert or update of project_id, workspace_id
  on public.crm_deals for each row execute function public.crm_validate_project_links();
drop trigger if exists trg_crm_tasks_project_scope on public.crm_tasks;
create trigger trg_crm_tasks_project_scope before insert or update of project_id, shared_task_id, workspace_id
  on public.crm_tasks for each row execute function public.crm_validate_project_links();

create or replace function public.crm_validate_related_workspace()
returns trigger language plpgsql set search_path = public as $$
declare v_bad boolean := false;
begin
  if tg_table_name = 'crm_contacts' and new.company_id is not null then
    select not exists(select 1 from public.crm_companies x where x.id = new.company_id and x.organization_id = new.organization_id and x.workspace_id = new.workspace_id) into v_bad;
  elsif tg_table_name = 'crm_deals' then
    select
      not exists(select 1 from public.crm_deal_stages x where x.id = new.stage_id and x.organization_id = new.organization_id and x.workspace_id = new.workspace_id)
      or (new.company_id is not null and not exists(select 1 from public.crm_companies x where x.id = new.company_id and x.workspace_id = new.workspace_id))
      or (new.contact_id is not null and not exists(select 1 from public.crm_contacts x where x.id = new.contact_id and x.workspace_id = new.workspace_id))
    into v_bad;
  elsif tg_table_name = 'crm_tasks' then
    select
      (new.deal_id is not null and not exists(select 1 from public.crm_deals x where x.id = new.deal_id and x.workspace_id = new.workspace_id))
      or (new.company_id is not null and not exists(select 1 from public.crm_companies x where x.id = new.company_id and x.workspace_id = new.workspace_id))
      or (new.contact_id is not null and not exists(select 1 from public.crm_contacts x where x.id = new.contact_id and x.workspace_id = new.workspace_id))
    into v_bad;
  elsif tg_table_name in ('crm_activities', 'crm_notes') then
    select
      (new.deal_id is not null and not exists(select 1 from public.crm_deals x where x.id = new.deal_id and x.workspace_id = new.workspace_id))
      or (new.company_id is not null and not exists(select 1 from public.crm_companies x where x.id = new.company_id and x.workspace_id = new.workspace_id))
      or (new.contact_id is not null and not exists(select 1 from public.crm_contacts x where x.id = new.contact_id and x.workspace_id = new.workspace_id))
    into v_bad;
  end if;
  if v_bad then
    raise exception 'Related CRM records must belong to the same workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;
do $$ declare t text; begin
  foreach t in array array['crm_contacts','crm_deals','crm_tasks','crm_activities','crm_notes'] loop
    execute format('drop trigger if exists trg_%s_related_workspace on public.%I', t, t);
    execute format('create trigger trg_%s_related_workspace before insert or update on public.%I for each row execute function public.crm_validate_related_workspace()', t, t);
  end loop;
end $$;

create or replace function public.crm_validate_contact_tag_workspace()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (
    select 1 from public.crm_contacts c join public.crm_tags t on t.id = new.tag_id
    where c.id = new.contact_id and c.organization_id = t.organization_id and c.workspace_id = t.workspace_id
  ) then
    raise exception 'Contact and tag must belong to the same workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_crm_contact_tags_workspace on public.crm_contact_tags;
create trigger trg_crm_contact_tags_workspace before insert or update on public.crm_contact_tags
  for each row execute function public.crm_validate_contact_tag_workspace();
drop policy if exists "crm_contact_tags_rw" on public.crm_contact_tags;
create policy "crm_contact_tags_workspace_rw" on public.crm_contact_tags for all to authenticated
  using (exists (
    select 1 from public.crm_contacts c where c.id = contact_id
      and public.can_access_crm_scope(c.organization_id, c.workspace_id)
  ))
  with check (exists (
    select 1 from public.crm_contacts c where c.id = contact_id
      and public.can_access_crm_scope(c.organization_id, c.workspace_id)
      and not public.is_org_viewer(c.organization_id)
  ));

-- Workspace-specific stage seeding (replaces the organization-wide RPC).
create or replace function public.crm_seed_default_stages(p_org uuid, p_workspace uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_access_workspace(p_workspace) then
    raise exception 'workspace access denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workspaces where workspace_id = p_workspace and organization_id = p_org) then
    raise exception 'workspace does not belong to organization' using errcode = '23514';
  end if;
  if exists (select 1 from public.crm_deal_stages where workspace_id = p_workspace) then return; end if;
  insert into public.crm_deal_stages(organization_id, workspace_id, name, sort_order, probability, status) values
    (p_org,p_workspace,'New Lead',1,10,'open'), (p_org,p_workspace,'Qualified',2,25,'open'),
    (p_org,p_workspace,'Demo Booked',3,40,'open'), (p_org,p_workspace,'Proposal Sent',4,60,'open'),
    (p_org,p_workspace,'Negotiation',5,80,'open'), (p_org,p_workspace,'Won',6,100,'won'),
    (p_org,p_workspace,'Lost',7,0,'lost');
end $$;
grant execute on function public.crm_seed_default_stages(uuid, uuid) to authenticated;

-- Replace broad org policies with workspace-aware read/write policies.
do $$ declare t text; begin
  foreach t in array array['crm_companies','crm_contacts','crm_deals','crm_tasks','crm_activities','crm_notes','crm_deal_stages','crm_tags'] loop
    execute format('drop policy if exists %I on public.%I', t || '_rw', t);
    execute format('drop policy if exists %I on public.%I', t || '_workspace_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_workspace_write', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.can_access_crm_scope(organization_id, workspace_id))', t || '_workspace_select', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.can_access_crm_scope(organization_id, workspace_id) and not public.is_org_viewer(organization_id)) with check (public.can_access_crm_scope(organization_id, workspace_id) and not public.is_org_viewer(organization_id))', t || '_workspace_write', t);
  end loop;
end $$;
