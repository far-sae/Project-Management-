-- 059_deal_pipeline_link_and_stage_gating.sql
-- Adds deals.pipeline_id + deals.stage_id (both NOT NULL after backfill),
-- a sync trigger that keeps deals.stage text in lock-step with the linked
-- pipeline_stages.key, and a required-field enforcement trigger.

alter table public.deals
  add column if not exists pipeline_id uuid
    references public.pipelines(pipeline_id) on delete restrict,
  add column if not exists stage_id uuid
    references public.pipeline_stages(stage_id) on delete restrict;

-- Plan 1 deal-to-won handoff needs to remember which client a project came from.
-- Foreign key is on delete set null so deleting the client doesn't cascade and
-- nuke the project; the project survives, just unlinked.
alter table public.projects
  add column if not exists client_id uuid
    references public.clients(client_id) on delete set null;

create index if not exists projects_client_idx
  on public.projects(client_id);

-- Backfill: for every deal, point to the seeded default pipeline + the stage
-- with the matching key.
update public.deals d set
  pipeline_id = p.pipeline_id,
  stage_id    = s.stage_id
from public.pipelines p, public.pipeline_stages s
where p.organization_id = d.organization_id
  and p.is_default
  and s.pipeline_id = p.pipeline_id
  and s.key = d.stage
  and (d.pipeline_id is null or d.stage_id is null);

alter table public.deals
  alter column pipeline_id set not null,
  alter column stage_id set not null;

create index if not exists deals_pipeline_idx on public.deals(pipeline_id);
create index if not exists deals_stage_idx on public.deals(stage_id);

-- Sync trigger: keep deals.stage in sync with pipeline_stages.key.
create or replace function public.deals_sync_stage_text()
returns trigger language plpgsql as $$
begin
  select key into new.stage
  from public.pipeline_stages
  where stage_id = new.stage_id;
  return new;
end;
$$;

drop trigger if exists deals_sync_stage_text_t on public.deals;
create trigger deals_sync_stage_text_t
  before insert or update of stage_id on public.deals
  for each row execute function public.deals_sync_stage_text();

-- Required-field gating trigger.
create or replace function public.deals_enforce_required_fields()
returns trigger language plpgsql as $$
declare
  req text[];
  f text;
  has_primary boolean;
begin
  if tg_op = 'UPDATE' and old.stage_id = new.stage_id then
    return new;
  end if;

  select required_fields into req
  from public.pipeline_stages
  where stage_id = new.stage_id;

  if req is null then return new; end if;

  foreach f in array req loop
    case f
      when 'value' then
        if new.value is null or new.value <= 0 then
          raise exception 'Stage requires deal value > 0' using errcode = 'P0001';
        end if;
      when 'expected_close_date' then
        if new.expected_close_date is null then
          raise exception 'Stage requires expected close date' using errcode = 'P0001';
        end if;
      when 'description' then
        if new.description is null or length(btrim(new.description)) = 0 then
          raise exception 'Stage requires description' using errcode = 'P0001';
        end if;
      when 'primary_contact' then
        select exists(
          select 1 from public.client_contacts
          where client_id = new.client_id and is_primary
        ) into has_primary;
        if not has_primary then
          raise exception 'Stage requires a primary contact on the linked client'
            using errcode = 'P0001';
        end if;
      else
        null;
    end case;
  end loop;
  return new;
end;
$$;

drop trigger if exists deals_enforce_required_fields_t on public.deals;
create trigger deals_enforce_required_fields_t
  before insert or update on public.deals
  for each row execute function public.deals_enforce_required_fields();

-- RPC: atomic deal-to-won transition that also (optionally) creates a project.
-- Called from the DealWonModal. SECURITY DEFINER so the trigger context can
-- enforce stage gating on the same connection.
create or replace function public.crm_close_deal_to_won(
  p_deal_id uuid,
  p_project_input jsonb
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_deal public.deals;
  v_won_stage uuid;
  v_project uuid;
  v_template uuid;
  v_org uuid;
  v_now timestamptz := now();
  v_actor uuid := auth.uid();
  v_task jsonb;
begin
  select * into v_deal from public.deals where deal_id = p_deal_id;
  if v_deal is null then
    raise exception 'Deal not found' using errcode = 'P0002';
  end if;
  v_org := v_deal.organization_id;

  if not public.is_org_admin(v_org) and v_deal.owner_id <> v_actor then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select stage_id into v_won_stage
  from public.pipeline_stages
  where pipeline_id = v_deal.pipeline_id and is_won;

  update public.deals
  set stage_id = v_won_stage,
      probability = 100,
      actual_close_date = v_now::date,
      closed_at = v_now,
      closed_by = v_actor,
      updated_at = v_now
  where deal_id = p_deal_id;

  if (p_project_input ->> 'skip')::boolean is true then
    return jsonb_build_object('deal_id', p_deal_id, 'project_id', null);
  end if;

  insert into public.projects (organization_id, name, owner_id, start_date, end_date, client_id)
  values (
    v_org,
    coalesce(p_project_input ->> 'name', v_deal.title),
    coalesce((p_project_input ->> 'owner_id')::uuid, v_deal.owner_id),
    coalesce((p_project_input ->> 'start_date')::date, current_date),
    coalesce((p_project_input ->> 'due_date')::date, (current_date + interval '30 days')::date),
    v_deal.client_id
  )
  returning project_id into v_project;

  v_template := (p_project_input ->> 'template_id')::uuid;
  if v_template is not null then
    for v_task in
      select * from jsonb_array_elements(
        (select task_definitions from public.project_templates
          where template_id = v_template and organization_id = v_org)
      )
    loop
      insert into public.tasks (organization_id, project_id, title, due_date, created_by)
      values (
        v_org, v_project,
        v_task ->> 'title',
        (current_date + ((v_task ->> 'offsetDays')::int) * interval '1 day')::date,
        v_actor
      );
    end loop;
  end if;

  return jsonb_build_object('deal_id', p_deal_id, 'project_id', v_project);
end;
$$;

grant execute on function public.crm_close_deal_to_won(uuid, jsonb) to authenticated;

create or replace view public.deal_forecast_v as
select
  d.organization_id,
  d.pipeline_id,
  d.owner_id,
  d.owner_name,
  d.currency,
  to_char(
    coalesce(d.actual_close_date, d.expected_close_date, d.created_at::date),
    'YYYY-MM'
  ) as month_bucket,
  d.value,
  d.value * (d.probability::numeric / 100.0) as weighted_value,
  s.is_won,
  s.is_lost,
  d.stage_id,
  d.stage
from public.deals d
join public.pipeline_stages s on s.stage_id = d.stage_id
where not s.is_lost;

grant select on public.deal_forecast_v to authenticated;
