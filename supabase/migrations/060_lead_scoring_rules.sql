-- 060_lead_scoring_rules.sql
-- Per-org configurable lead scoring. Rules + thresholds + computed score on clients.

create table if not exists public.lead_scoring_rules (
  rule_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(organization_id) on delete cascade,
  label text not null,
  field text not null,
  operator text not null check (operator in (
    'eq','neq','gte','lte','gt','lt','in','contains','exists'
  )),
  value jsonb not null,
  points int not null,
  position int not null default 0,
  enabled boolean not null default true,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists lead_scoring_rules_org_idx
  on public.lead_scoring_rules(organization_id, position);

create table if not exists public.lead_scoring_thresholds (
  organization_id uuid primary key
    references public.organizations(organization_id) on delete cascade,
  hot int not null default 70,
  warm int not null default 40
);

create table if not exists public.lead_scoring_recompute_queue (
  organization_id uuid primary key
    references public.organizations(organization_id) on delete cascade,
  enqueued_at timestamptz not null default now()
);

alter table public.clients
  add column if not exists score int not null default 0,
  add column if not exists score_band text not null default 'cold'
    check (score_band in ('hot','warm','cold')),
  add column if not exists score_updated_at timestamptz;

create index if not exists clients_score_idx
  on public.clients(organization_id, score desc);

-- Seed defaults per org. Idempotent.
create or replace function public.seed_lead_scoring_for_org(p_org uuid)
returns void language plpgsql as $$
begin
  insert into public.lead_scoring_thresholds (organization_id, hot, warm)
  values (p_org, 70, 40)
  on conflict (organization_id) do nothing;

  insert into public.lead_scoring_rules
    (organization_id, label, field, operator, value, points, position) values
    (p_org, 'Annual revenue >= $1M',  'annual_revenue', 'gte', to_jsonb(1000000),  20, 1),
    (p_org, 'Annual revenue >= $10M', 'annual_revenue', 'gte', to_jsonb(10000000), 15, 2),
    (p_org, '50+ employees',         'employee_count', 'gte', to_jsonb(50),       10, 3),
    (p_org, 'Source referral/event', 'source', 'in', '["referral","event"]'::jsonb, 10, 4),
    (p_org, 'Active last 14 days',   'recent_activity_days', 'lte', to_jsonb(14), 10, 5),
    (p_org, 'Open deals >= 1',        'open_deals_count', 'gte', to_jsonb(1),      15, 6),
    (p_org, 'Inactive penalty',      'status', 'eq', '"inactive"'::jsonb,         -20, 7),
    (p_org, 'Vendor penalty',        'type', 'eq', '"vendor"'::jsonb,             -10, 8)
  on conflict do nothing;
end;
$$;

do $$
declare o record;
begin
  for o in select organization_id from public.organizations loop
    perform public.seed_lead_scoring_for_org(o.organization_id);
  end loop;
end $$;

create or replace function public.lead_scoring_seed_on_org_insert()
returns trigger language plpgsql as $$
begin
  perform public.seed_lead_scoring_for_org(new.organization_id);
  return new;
end;
$$;

drop trigger if exists lead_scoring_seed_on_org_insert_t on public.organizations;
create trigger lead_scoring_seed_on_org_insert_t
  after insert on public.organizations
  for each row execute function public.lead_scoring_seed_on_org_insert();

-- Single-client recompute. SECURITY DEFINER so RLS doesn't block. Called by
-- per-row triggers and the bulk worker.
create or replace function public.recompute_client_score(p_client_id uuid)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_org uuid;
  v_client public.clients;
  v_recent_days int;
  v_open_deals int;
  v_score int := 0;
  v_band text;
  v_hot int; v_warm int;
  v_rule record;
  v_match boolean;
  v_field_val jsonb;
begin
  select * into v_client from public.clients where client_id = p_client_id;
  if v_client is null then return; end if;
  v_org := v_client.organization_id;

  select coalesce(extract(day from now() - max(occurred_at)), 9999)::int
    into v_recent_days
    from public.client_notes where client_id = p_client_id;

  select count(*) into v_open_deals
    from public.deals d
    join public.pipeline_stages s on s.stage_id = d.stage_id
    where d.client_id = p_client_id
      and not s.is_won and not s.is_lost;

  for v_rule in
    select * from public.lead_scoring_rules
    where organization_id = v_org and enabled order by position
  loop
    -- Per-iteration BEGIN/EXCEPTION block: a single malformed rule (e.g.
    -- non-numeric value passed to `gte`) must not poison the whole score.
    -- The exception handler must live inside a BEGIN/END inside the LOOP —
    -- PL/pgSQL doesn't allow an EXCEPTION clause directly under LOOP.
    begin
      -- Resolve the field value as jsonb.
      v_field_val := case v_rule.field
        when 'industry'        then to_jsonb(v_client.industry)
        when 'annual_revenue'  then to_jsonb(v_client.annual_revenue)
        when 'employee_count'  then to_jsonb(v_client.employee_count)
        when 'source'          then to_jsonb(v_client.source)
        when 'status'          then to_jsonb(v_client.status)
        when 'type'            then to_jsonb(v_client.type)
        when 'rating'          then to_jsonb(v_client.rating)
        when 'country'         then to_jsonb(v_client.country)
        when 'recent_activity_days' then to_jsonb(v_recent_days)
        when 'open_deals_count'     then to_jsonb(v_open_deals)
        when 'tag_present'          then to_jsonb(v_client.tags)
        else 'null'::jsonb
      end;

      v_match := case v_rule.operator
        when 'eq'  then v_field_val = v_rule.value
        when 'neq' then v_field_val <> v_rule.value
        when 'gte' then (v_field_val ->> 0)::numeric >= (v_rule.value)::text::numeric
                        or (v_field_val::text)::numeric >= (v_rule.value::text)::numeric
        when 'lte' then (v_field_val::text)::numeric <= (v_rule.value::text)::numeric
        when 'gt'  then (v_field_val::text)::numeric >  (v_rule.value::text)::numeric
        when 'lt'  then (v_field_val::text)::numeric <  (v_rule.value::text)::numeric
        when 'in'  then v_rule.value @> v_field_val
        when 'contains' then (v_field_val::text) ilike '%' || trim(both '"' from v_rule.value::text) || '%'
        when 'exists' then v_field_val is not null and v_field_val <> 'null'::jsonb
        else false
      end;

      if v_match then v_score := v_score + v_rule.points; end if;
    exception when others then
      -- Skip this rule and continue to the next. Falling out of the
      -- BEGIN/END returns control to LOOP, which advances naturally.
      null;
    end;
  end loop;

  v_score := greatest(-100, least(200, v_score));

  select hot, warm into v_hot, v_warm
    from public.lead_scoring_thresholds where organization_id = v_org;
  v_hot := coalesce(v_hot, 70);
  v_warm := coalesce(v_warm, 40);
  v_band := case when v_score >= v_hot then 'hot' when v_score >= v_warm then 'warm' else 'cold' end;

  update public.clients
  set score = v_score,
      score_band = v_band,
      score_updated_at = now()
  where client_id = p_client_id;
end;
$$;

grant execute on function public.recompute_client_score(uuid) to authenticated;

-- Auto-recompute triggers.
create or replace function public.clients_score_after_change()
returns trigger language plpgsql as $$
begin
  perform public.recompute_client_score(coalesce(new.client_id, old.client_id));
  return null;
end;
$$;

drop trigger if exists clients_score_after_change_t on public.clients;
create trigger clients_score_after_change_t
  after insert or update on public.clients
  for each row execute function public.clients_score_after_change();

create or replace function public.deals_recompute_client_score()
returns trigger language plpgsql as $$
begin
  if new is not null and new.client_id is not null then
    perform public.recompute_client_score(new.client_id);
  end if;
  if old is not null and old.client_id is not null
     and (new is null or new.client_id <> old.client_id) then
    perform public.recompute_client_score(old.client_id);
  end if;
  return null;
end;
$$;

drop trigger if exists deals_recompute_client_score_t on public.deals;
create trigger deals_recompute_client_score_t
  after insert or update or delete on public.deals
  for each row execute function public.deals_recompute_client_score();

create or replace function public.client_notes_recompute_score()
returns trigger language plpgsql as $$
begin
  perform public.recompute_client_score(coalesce(new.client_id, old.client_id));
  return null;
end;
$$;

drop trigger if exists client_notes_recompute_score_t on public.client_notes;
create trigger client_notes_recompute_score_t
  after insert or update or delete on public.client_notes
  for each row execute function public.client_notes_recompute_score();

-- Rule/threshold edits enqueue an org-wide recompute; bulk worker drains it.
create or replace function public.lead_scoring_enqueue_org()
returns trigger language plpgsql as $$
begin
  insert into public.lead_scoring_recompute_queue (organization_id)
  values (coalesce(new.organization_id, old.organization_id))
  on conflict (organization_id) do update set enqueued_at = now();
  return null;
end;
$$;

drop trigger if exists lead_scoring_rules_enqueue_t on public.lead_scoring_rules;
create trigger lead_scoring_rules_enqueue_t
  after insert or update or delete on public.lead_scoring_rules
  for each row execute function public.lead_scoring_enqueue_org();

drop trigger if exists lead_scoring_thresholds_enqueue_t on public.lead_scoring_thresholds;
create trigger lead_scoring_thresholds_enqueue_t
  after insert or update or delete on public.lead_scoring_thresholds
  for each row execute function public.lead_scoring_enqueue_org();

-- Bulk recompute for one org (called by the worker).
create or replace function public.bulk_recompute_org_scores(p_org uuid, p_batch int default 500)
returns int language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_count int := 0;
  c record;
begin
  for c in
    select client_id from public.clients
    where organization_id = p_org
    order by client_id
    limit p_batch
  loop
    perform public.recompute_client_score(c.client_id);
    v_count := v_count + 1;
  end loop;
  if v_count < p_batch then
    delete from public.lead_scoring_recompute_queue where organization_id = p_org;
  end if;
  return v_count;
end;
$$;

grant execute on function public.bulk_recompute_org_scores(uuid, int) to service_role;

alter table public.lead_scoring_rules enable row level security;
alter table public.lead_scoring_thresholds enable row level security;

drop policy if exists "rules read for org members" on public.lead_scoring_rules;
create policy "rules read for org members"
  on public.lead_scoring_rules for select
  using (public.is_org_member(organization_id));

drop policy if exists "thresholds read for org members" on public.lead_scoring_thresholds;
create policy "thresholds read for org members"
  on public.lead_scoring_thresholds for select
  using (public.is_org_member(organization_id));

-- Writes only via service functions (admin check) — no write policy by design.
