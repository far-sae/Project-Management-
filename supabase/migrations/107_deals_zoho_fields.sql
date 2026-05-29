-- 107_deals_zoho_fields.sql
-- Brings the deals table to Zoho-CRM parity for the redesigned Deals page:
--   • New optional columns on deals: deal_type, next_step, contact_id,
--     lead_source, campaign_source.
--   • New tables for Zoho's deal "Related Lists":
--       - deal_competitors      (free-form list of competing vendors)
--       - deal_contact_roles    (decision-maker / influencer / champion …)
--       - deal_stage_history    (audit trail of stage transitions; populated
--                                by trigger so reps can't fake it)
-- RLS mirrors the existing deals policies — members read, admin/owner write,
-- viewers blocked.

-- ─── deals: extra Zoho fields ──────────────────────────────────────────────

alter table public.deals add column if not exists deal_type      text;
alter table public.deals add column if not exists next_step      text;
alter table public.deals add column if not exists contact_id     uuid references public.client_contacts(contact_id) on delete set null;
alter table public.deals add column if not exists lead_source    text;
alter table public.deals add column if not exists campaign_source text;

create index if not exists idx_deals_contact_id on public.deals (contact_id) where contact_id is not null;

-- ─── deal_competitors ──────────────────────────────────────────────────────

create table if not exists public.deal_competitors (
  competitor_id     uuid primary key default gen_random_uuid(),
  deal_id           uuid not null references public.deals(deal_id) on delete cascade,
  organization_id   uuid not null,
  name              text not null,
  url               text,
  notes             text,
  created_by        uuid,
  created_by_name   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_deal_competitors_deal on public.deal_competitors (deal_id);
create index if not exists idx_deal_competitors_org  on public.deal_competitors (organization_id);

alter table public.deal_competitors enable row level security;
grant select, insert, update, delete on table public.deal_competitors to authenticated;

drop policy if exists "members_view_deal_competitors"     on public.deal_competitors;
drop policy if exists "members_write_deal_competitors"    on public.deal_competitors;
drop policy if exists "members_update_deal_competitors"   on public.deal_competitors;
drop policy if exists "members_delete_deal_competitors"   on public.deal_competitors;

create policy "members_view_deal_competitors"
  on public.deal_competitors for select to authenticated
  using (public.is_org_member(organization_id));

create policy "members_write_deal_competitors"
  on public.deal_competitors for insert to authenticated
  with check (
    public.is_org_member(organization_id)
    and not public.is_org_viewer(organization_id)
  );

create policy "members_update_deal_competitors"
  on public.deal_competitors for update to authenticated
  using (
    public.is_org_member(organization_id)
    and not public.is_org_viewer(organization_id)
  )
  with check (
    public.is_org_member(organization_id)
    and not public.is_org_viewer(organization_id)
  );

create policy "members_delete_deal_competitors"
  on public.deal_competitors for delete to authenticated
  using (
    public.is_org_member(organization_id)
    and not public.is_org_viewer(organization_id)
  );

create or replace function public.deal_competitors_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists deal_competitors_set_updated_at on public.deal_competitors;
create trigger deal_competitors_set_updated_at
  before update on public.deal_competitors
  for each row execute function public.deal_competitors_set_updated_at();

-- ─── deal_contact_roles ────────────────────────────────────────────────────
-- A deal can have many contacts; each in a role (decision maker, influencer,
-- champion, technical buyer, etc.). One contact per role per deal max.

create table if not exists public.deal_contact_roles (
  role_id           uuid primary key default gen_random_uuid(),
  deal_id           uuid not null references public.deals(deal_id) on delete cascade,
  contact_id        uuid not null references public.client_contacts(contact_id) on delete cascade,
  organization_id   uuid not null,
  role              text,                          -- decision_maker | influencer | champion | …
  is_primary        boolean not null default false,
  notes             text,
  created_by        uuid,
  created_by_name   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Same contact can't be added twice to the same deal.
create unique index if not exists ux_deal_contact_roles_deal_contact
  on public.deal_contact_roles (deal_id, contact_id);

create index if not exists idx_deal_contact_roles_deal on public.deal_contact_roles (deal_id);
create index if not exists idx_deal_contact_roles_org  on public.deal_contact_roles (organization_id);

alter table public.deal_contact_roles enable row level security;
grant select, insert, update, delete on table public.deal_contact_roles to authenticated;

drop policy if exists "members_view_deal_contact_roles"   on public.deal_contact_roles;
drop policy if exists "members_write_deal_contact_roles"  on public.deal_contact_roles;
drop policy if exists "members_update_deal_contact_roles" on public.deal_contact_roles;
drop policy if exists "members_delete_deal_contact_roles" on public.deal_contact_roles;

create policy "members_view_deal_contact_roles"
  on public.deal_contact_roles for select to authenticated
  using (public.is_org_member(organization_id));

create policy "members_write_deal_contact_roles"
  on public.deal_contact_roles for insert to authenticated
  with check (
    public.is_org_member(organization_id)
    and not public.is_org_viewer(organization_id)
  );

create policy "members_update_deal_contact_roles"
  on public.deal_contact_roles for update to authenticated
  using (
    public.is_org_member(organization_id)
    and not public.is_org_viewer(organization_id)
  )
  with check (
    public.is_org_member(organization_id)
    and not public.is_org_viewer(organization_id)
  );

create policy "members_delete_deal_contact_roles"
  on public.deal_contact_roles for delete to authenticated
  using (
    public.is_org_member(organization_id)
    and not public.is_org_viewer(organization_id)
  );

create or replace function public.deal_contact_roles_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists deal_contact_roles_set_updated_at on public.deal_contact_roles;
create trigger deal_contact_roles_set_updated_at
  before update on public.deal_contact_roles
  for each row execute function public.deal_contact_roles_set_updated_at();

-- ─── deal_stage_history ────────────────────────────────────────────────────
-- Audit row written by trigger whenever deals.stage changes. Reps can't write
-- to this directly (no INSERT policy for non-system writers).

create table if not exists public.deal_stage_history (
  history_id        uuid primary key default gen_random_uuid(),
  deal_id           uuid not null references public.deals(deal_id) on delete cascade,
  organization_id   uuid not null,
  from_stage        text,
  to_stage          text not null,
  amount            numeric(14,2),
  probability       int,
  expected_close_date date,
  changed_by        uuid,
  changed_by_name   text,
  changed_at        timestamptz not null default now()
);

create index if not exists idx_deal_stage_history_deal on public.deal_stage_history (deal_id, changed_at desc);
create index if not exists idx_deal_stage_history_org  on public.deal_stage_history (organization_id);

alter table public.deal_stage_history enable row level security;
grant select on table public.deal_stage_history to authenticated;

drop policy if exists "members_view_deal_stage_history" on public.deal_stage_history;
create policy "members_view_deal_stage_history"
  on public.deal_stage_history for select to authenticated
  using (public.is_org_member(organization_id));

-- Trigger to record stage transitions on deals.
create or replace function public.record_deal_stage_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user_id   uuid;
  v_user_name text;
begin
  -- INSERT: stamp initial stage; UPDATE: only when stage actually changed.
  if (tg_op = 'INSERT') then
    v_user_id := new.created_by;
    v_user_name := new.created_by_name;
    insert into public.deal_stage_history (
      deal_id, organization_id, from_stage, to_stage,
      amount, probability, expected_close_date,
      changed_by, changed_by_name
    ) values (
      new.deal_id, new.organization_id, null, new.stage,
      new.value, new.probability, new.expected_close_date,
      v_user_id, v_user_name
    );
    return new;
  end if;

  if (tg_op = 'UPDATE' and new.stage is distinct from old.stage) then
    -- auth.uid() may be null when triggered server-side (e.g. via RPC running
    -- as the service role); fall back to created_by snapshot.
    begin
      v_user_id := auth.uid();
    exception when others then
      v_user_id := null;
    end;
    v_user_name := coalesce(new.owner_name, new.created_by_name);
    insert into public.deal_stage_history (
      deal_id, organization_id, from_stage, to_stage,
      amount, probability, expected_close_date,
      changed_by, changed_by_name
    ) values (
      new.deal_id, new.organization_id, old.stage, new.stage,
      new.value, new.probability, new.expected_close_date,
      v_user_id, v_user_name
    );
  end if;
  return new;
end;
$$;

drop trigger if exists deals_record_stage_change on public.deals;
create trigger deals_record_stage_change
  after insert or update of stage on public.deals
  for each row execute function public.record_deal_stage_change();

-- ─── realtime publication ──────────────────────────────────────────────────
do $$
begin
  alter publication supabase_realtime add table public.deal_competitors;
exception when others then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.deal_contact_roles;
exception when others then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.deal_stage_history;
exception when others then null;
end $$;
