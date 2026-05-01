-- CRM upgrade #2: deals (sales pipeline) + client_tasks (follow-ups)
--
-- This is what turns the existing "contact list" into a real CRM:
--
--   • deals         — sales opportunities with a stage workflow, value,
--                     expected close date, owner. Drives the pipeline kanban.
--   • client_tasks  — follow-up actions tied to a client (and optionally a
--                     deal). Lightweight: due date, type, status. Separate
--                     from project tasks because reps don't want their CRM
--                     follow-ups mixed in with the engineering board.
--
-- Permissions mirror the rest of the org: members can READ everything (sales
-- visibility), org owner+admin manage. Plus: a member who OWNS a deal or task
-- can update their own row (so reps can move their own deals through stages).
--
-- Relies on helpers from migration 036 / 042:
--   public.is_org_member, public.is_org_admin_or_owner

-- ---------------------------------------------------------------------------
-- Default stage probabilities (used to auto-fill `probability` when a deal
-- moves between stages so reps don't have to think about it).
-- ---------------------------------------------------------------------------
create or replace function public.deal_default_probability(p_stage text)
returns int
language sql immutable as $$
  select case lower(coalesce(p_stage, ''))
    when 'lead'        then 10
    when 'qualified'   then 25
    when 'proposal'    then 50
    when 'negotiation' then 75
    when 'won'         then 100
    when 'lost'        then 0
    else 10
  end;
$$;

-- ---------------------------------------------------------------------------
-- deals
-- ---------------------------------------------------------------------------
create table if not exists public.deals (
  deal_id              uuid primary key default gen_random_uuid(),
  organization_id      uuid not null,
  client_id            uuid references public.clients(client_id) on delete set null,
  client_name          text,                                   -- snapshot, survives client rename
  title                text not null,
  description          text,
  stage                text not null default 'lead',           -- lead | qualified | proposal | negotiation | won | lost
  value                numeric(14,2) not null default 0,
  currency             text not null default 'USD',
  probability          int not null default 10,                -- 0-100
  expected_close_date  date,
  actual_close_date    date,
  owner_id             uuid,
  owner_name           text,
  source               text,                                   -- referral | inbound | outbound | event | …
  tags                 text[] not null default '{}',
  -- Position within stage column for stable kanban ordering after drag-drop.
  position             numeric not null default 1000,
  loss_reason          text,
  created_by           uuid,
  created_by_name      text,
  closed_at            timestamptz,
  closed_by            uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  check (stage in ('lead','qualified','proposal','negotiation','won','lost')),
  check (probability between 0 and 100),
  check (value >= 0)
);

create index if not exists idx_deals_org_stage
  on public.deals (organization_id, stage, position);
create index if not exists idx_deals_org_close
  on public.deals (organization_id, expected_close_date);
create index if not exists idx_deals_client
  on public.deals (client_id);
create index if not exists idx_deals_owner
  on public.deals (owner_id);

alter table public.deals enable row level security;

grant select on table public.deals to anon;
grant select, insert, update, delete on table public.deals to authenticated;

drop policy if exists "anon_no_deals"               on public.deals;
drop policy if exists "members_view_deals"          on public.deals;
drop policy if exists "members_create_deals"        on public.deals;
drop policy if exists "owner_or_admin_edit_deals"   on public.deals;
drop policy if exists "deal_owner_edit_own"         on public.deals;
drop policy if exists "owner_or_admin_delete_deals" on public.deals;

create policy "anon_no_deals" on public.deals for select to anon using (false);

-- Org members READ all deals (sales pipeline visibility).
create policy "members_view_deals"
  on public.deals for select to authenticated
  using (public.is_org_member(organization_id));

-- Any org member may create a deal — reps log their own opportunities.
create policy "members_create_deals"
  on public.deals for insert to authenticated
  with check (
    public.is_org_member(organization_id)
    and (created_by is null or created_by = auth.uid())
  );

-- The deal's assigned owner can edit/move their deal (drag stages, set value).
create policy "deal_owner_edit_own"
  on public.deals for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Org admin/owner can edit anything (re-assign, override).
create policy "owner_or_admin_edit_deals"
  on public.deals for update to authenticated
  using (public.is_org_admin_or_owner(organization_id))
  with check (public.is_org_admin_or_owner(organization_id));

-- Only admin/owner deletes — prevent reps deleting their pipeline.
create policy "owner_or_admin_delete_deals"
  on public.deals for delete to authenticated
  using (public.is_org_admin_or_owner(organization_id));

-- updated_at + auto-probability + closed_at bookkeeping
create or replace function public.deals_set_updated_at_and_close()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();

  -- Auto-fill probability when the stage changes (and rep didn't override
  -- to a non-default value first). Default rule: snap to the stage's default.
  if (tg_op = 'INSERT')
     or (new.stage is distinct from old.stage) then
    new.probability := public.deal_default_probability(new.stage);
  end if;

  -- Track close metadata when entering won/lost.
  if new.stage in ('won','lost') then
    if new.closed_at is null then
      new.closed_at := now();
    end if;
    if new.closed_by is null then
      new.closed_by := auth.uid();
    end if;
    if new.actual_close_date is null then
      new.actual_close_date := current_date;
    end if;
  elsif tg_op = 'UPDATE' and old.stage in ('won','lost') and new.stage not in ('won','lost') then
    -- Reopened a closed deal — clear close metadata.
    new.closed_at := null;
    new.closed_by := null;
    new.actual_close_date := null;
    new.loss_reason := null;
  end if;

  return new;
end;
$$;

drop trigger if exists deals_set_updated_at_and_close on public.deals;
create trigger deals_set_updated_at_and_close
  before insert or update on public.deals
  for each row execute function public.deals_set_updated_at_and_close();

do $$
begin
  alter publication supabase_realtime add table public.deals;
exception when others then null;
end $$;

-- ---------------------------------------------------------------------------
-- client_tasks
-- ---------------------------------------------------------------------------
create table if not exists public.client_tasks (
  task_id           uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  client_id         uuid references public.clients(client_id) on delete cascade,
  deal_id           uuid references public.deals(deal_id) on delete set null,
  title             text not null,
  description       text,
  type              text not null default 'todo',          -- todo | call | email | meeting | followup
  status            text not null default 'pending',       -- pending | done | snoozed
  due_at            timestamptz,
  done_at           timestamptz,
  done_by           uuid,
  done_by_name      text,
  assigned_to       uuid,
  assigned_to_name  text,
  created_by        uuid,
  created_by_name   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  check (type in ('todo','call','email','meeting','followup')),
  check (status in ('pending','done','snoozed'))
);

create index if not exists idx_client_tasks_org_due
  on public.client_tasks (organization_id, due_at);
create index if not exists idx_client_tasks_client
  on public.client_tasks (client_id);
create index if not exists idx_client_tasks_deal
  on public.client_tasks (deal_id);
create index if not exists idx_client_tasks_assignee
  on public.client_tasks (assigned_to);
-- "Show me my open follow-ups" is the most-run query — partial index keeps it fast.
create index if not exists idx_client_tasks_open
  on public.client_tasks (organization_id, assigned_to, due_at)
  where status = 'pending';

alter table public.client_tasks enable row level security;

grant select on table public.client_tasks to anon;
grant select, insert, update, delete on table public.client_tasks to authenticated;

drop policy if exists "anon_no_client_tasks"            on public.client_tasks;
drop policy if exists "members_view_client_tasks"       on public.client_tasks;
drop policy if exists "members_create_client_tasks"     on public.client_tasks;
drop policy if exists "assignee_or_admin_update_tasks"  on public.client_tasks;
drop policy if exists "creator_or_admin_delete_tasks"   on public.client_tasks;

create policy "anon_no_client_tasks"
  on public.client_tasks for select to anon using (false);

create policy "members_view_client_tasks"
  on public.client_tasks for select to authenticated
  using (public.is_org_member(organization_id));

create policy "members_create_client_tasks"
  on public.client_tasks for insert to authenticated
  with check (
    public.is_org_member(organization_id)
    and (created_by is null or created_by = auth.uid())
  );

-- The assignee can mark their task done / snoozed / reschedule. Org admin
-- can edit any task to reassign or correct.
create policy "assignee_or_admin_update_tasks"
  on public.client_tasks for update to authenticated
  using (
    assigned_to = auth.uid()
    or created_by = auth.uid()
    or public.is_org_admin_or_owner(organization_id)
  )
  with check (
    assigned_to = auth.uid()
    or created_by = auth.uid()
    or public.is_org_admin_or_owner(organization_id)
  );

create policy "creator_or_admin_delete_tasks"
  on public.client_tasks for delete to authenticated
  using (
    created_by = auth.uid()
    or public.is_org_admin_or_owner(organization_id)
  );

create or replace function public.client_tasks_set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  nm text;
begin
  new.updated_at := now();

  if tg_op = 'INSERT' then
    if new.status = 'done' then
      if new.done_at is null then new.done_at := now(); end if;
      uid := coalesce(new.done_by, auth.uid());
      if new.done_by is null then new.done_by := uid; end if;
      if new.done_by_name is null and uid is not null then
        select coalesce(nullif(trim(display_name), ''), nullif(trim(email::text), ''))
          into nm
          from public.user_profiles
          where id = uid
          limit 1;
        new.done_by_name := coalesce(nullif(trim(nm), ''), 'User');
      end if;
    end if;
  elsif tg_op = 'UPDATE' then
    -- Stamp completion metadata when status flips to done.
    if new.status = 'done' and old.status is distinct from 'done' then
      if new.done_at is null then new.done_at := now(); end if;
      uid := coalesce(new.done_by, auth.uid());
      if new.done_by is null then new.done_by := uid; end if;
      if new.done_by_name is null and uid is not null then
        select coalesce(nullif(trim(display_name), ''), nullif(trim(email::text), ''))
          into nm
          from public.user_profiles
          where id = uid
          limit 1;
        new.done_by_name := coalesce(nullif(trim(nm), ''), 'User');
      end if;
    elsif new.status is distinct from 'done' and old.status = 'done' then
      -- Reopened — clear completion metadata.
      new.done_at := null;
      new.done_by := null;
      new.done_by_name := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists client_tasks_set_updated_at on public.client_tasks;
create trigger client_tasks_set_updated_at
  before insert or update on public.client_tasks
  for each row execute function public.client_tasks_set_updated_at();

do $$
begin
  alter publication supabase_realtime add table public.client_tasks;
exception when others then null;
end $$;
