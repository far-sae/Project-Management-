-- 063_org_activity_views.sql
-- Unified activity feed view, sourced from existing CRM tables.
-- form_submissions is added in migration 062 (Plan 4). If 062 is not yet
-- applied, comment out the last UNION ALL block; re-add when 062 lands.

create or replace view public.crm_activity_v as
  select
    'note'::text as event_type,
    n.organization_id,
    n.client_id,
    null::uuid as deal_id,
    n.author_id as actor_id,
    n.author_name as actor_name,
    n.kind::text as subtype,
    coalesce(n.subject, left(coalesce(n.body,''), 80)) as title,
    n.body as body,
    n.occurred_at as occurred_at
  from public.client_notes n

  union all

  select
    'deal_stage'::text,
    d.organization_id,
    d.client_id,
    d.deal_id,
    coalesce(d.closed_by, d.created_by),
    coalesce(d.created_by_name, 'system'),
    d.stage::text,
    format('Deal %s moved to %s', d.title, d.stage),
    null,
    coalesce(d.closed_at, d.updated_at)
  from public.deals d

  union all

  select
    'task'::text,
    t.organization_id,
    t.client_id,
    null::uuid,
    t.created_by,
    t.created_by_name,
    case when t.status = 'done' then 'completed' else 'created' end,
    t.title,
    null,
    coalesce(t.done_at, t.created_at)
  from public.client_tasks t

  union all

  select
    'form_submission'::text,
    f.organization_id,
    f.client_id,
    f.deal_id,
    null::uuid,
    'Lead form'::text,
    f.form_slug,
    format('Submission to "%s"', f.form_title),
    null,
    f.created_at
  from public.form_submissions f;

-- Indexes that help the view stay fast. Some may already exist; CREATE IF NOT EXISTS.
create index if not exists client_notes_org_time_idx
  on public.client_notes(organization_id, occurred_at desc);
create index if not exists deals_org_time_idx
  on public.deals(organization_id, updated_at desc);
create index if not exists client_tasks_org_time_idx
  on public.client_tasks(organization_id, created_at desc);

-- Views inherit table RLS, but the explicit grant makes the access pattern
-- visible to anyone reading this migration.
grant select on public.crm_activity_v to authenticated;
