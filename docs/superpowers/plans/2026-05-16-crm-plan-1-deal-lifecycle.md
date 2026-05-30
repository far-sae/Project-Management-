# CRM Plan 1 — Deal Lifecycle (Pipelines, Stage Gating, Won-Handoff)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single hardcoded six-stage deal pipeline with per-org configurable pipelines, server-enforced required-field gating per stage, and a confirm modal that turns a won deal into a project with optional template tasks.

**Architecture:** Two new database tables (`pipelines`, `pipeline_stages`) and one supporting table (`project_templates`). Existing `deals.stage` text column is preserved as a denormalized convenience; new `deals.pipeline_id` and `deals.stage_id` foreign keys become the source of truth. A `before insert or update` trigger on `deals` enforces required-field gating server-side. Frontend gets a Pipelines tab in Settings, a pipeline selector above the existing `DealsKanban`, and a `DealWonModal` that intercepts the won-stage move.

**Tech Stack:** React 18 + TypeScript + Vite, shadcn/ui, Tailwind, `@dnd-kit` (already in `package.json`), Supabase Postgres + Edge Functions, Vitest.

**Note on git:** The working tree is not currently a git repo (`git init` not run). Commit steps below assume the user runs `git init` first; if not, treat each commit step as a manual checkpoint instead.

**Coordination:** The platform-integrations agent owns `057_integrations_tables.sql`, `src/services/integrations/**`, `src/components/integrations/**`, `src/hooks/useIntegration.ts`, and all `oauth-*` / `integrations-*` Edge Functions. This plan does not touch any of those.

---

## File Structure

**Created:**
- `supabase/migrations/058_pipelines_and_stages.sql`
- `supabase/migrations/059_deal_pipeline_link_and_stage_gating.sql`
- `src/services/supabase/pipelines.ts` — CRUD + types for pipelines and stages
- `src/services/supabase/projectTemplates.ts` — CRUD + types for project templates
- `src/hooks/usePipelines.ts` — list + selection + realtime
- `src/components/settings/PipelinesSettingsTab.tsx` — outer settings tab
- `src/components/settings/PipelineEditor.tsx` — single-pipeline editor
- `src/components/clients/PipelineSelector.tsx` — pipeline `<Select>` above kanban
- `src/components/clients/DealWonModal.tsx` — won-handoff modal
- `tests/unit/pipelines.test.ts`
- `tests/unit/dealWonModal.test.tsx`

**Modified:**
- `src/services/supabase/deals.ts` — extend types with `pipelineId`/`stageId`, add `closeDealToWon` RPC wrapper, translate trigger errors
- `src/hooks/useDeals.ts` — accept `pipelineId` filter
- `src/components/clients/DealsKanban.tsx` — render columns from `pipeline_stages`, intercept won move
- `src/pages/Settings.tsx` — add Pipelines tab
- `src/pages/Clients.tsx` — render `PipelineSelector` above `DealsKanban`

---

## Task 1: Migration 058 — pipelines, pipeline_stages, project_templates

**Files:**
- Create: `supabase/migrations/058_pipelines_and_stages.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 058_pipelines_and_stages.sql
-- Adds per-org configurable pipelines, their stages (with required-field gating),
-- and project templates used by the won-handoff modal. A trigger seeds defaults
-- on org insert; an in-migration data backfill seeds defaults for existing orgs.

create table if not exists public.pipelines (
  pipeline_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(organization_id) on delete cascade,
  name text not null,
  description text,
  is_default boolean not null default false,
  position int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create unique index if not exists ux_pipelines_one_default
  on public.pipelines(organization_id) where is_default;

create table if not exists public.pipeline_stages (
  stage_id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null
    references public.pipelines(pipeline_id) on delete cascade,
  organization_id uuid not null,
  key text not null,
  label text not null,
  color text not null default '#94A3B8',
  position int not null,
  default_probability int not null default 10
    check (default_probability between 0 and 100),
  is_won boolean not null default false,
  is_lost boolean not null default false,
  required_fields text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (pipeline_id, key),
  unique (pipeline_id, position)
);

create unique index if not exists ux_pipeline_stages_one_won
  on public.pipeline_stages(pipeline_id) where is_won;
create unique index if not exists ux_pipeline_stages_one_lost
  on public.pipeline_stages(pipeline_id) where is_lost;

create table if not exists public.project_templates (
  template_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  name text not null,
  description text,
  task_definitions jsonb not null default '[]'::jsonb,
  created_at timestamptz default now(),
  unique (organization_id, name)
);

-- Seed defaults for a single org. Idempotent via on conflict do nothing.
create or replace function public.seed_default_pipeline_for_org(p_org uuid)
returns void language plpgsql as $$
declare
  v_pipeline uuid;
begin
  insert into public.pipelines (organization_id, name, description, is_default, position)
  values (p_org, 'Sales', 'Default sales pipeline', true, 0)
  on conflict (organization_id, name) do nothing
  returning pipeline_id into v_pipeline;

  if v_pipeline is null then
    select pipeline_id into v_pipeline
    from public.pipelines
    where organization_id = p_org and is_default
    limit 1;
  end if;

  insert into public.pipeline_stages
    (pipeline_id, organization_id, key, label, color, position,
     default_probability, is_won, is_lost, required_fields)
  values
    (v_pipeline, p_org, 'lead',        'Lead',        '#94A3B8', 1, 10,  false, false, '{}'),
    (v_pipeline, p_org, 'qualified',   'Qualified',   '#FB923C', 2, 25,  false, false, '{}'),
    (v_pipeline, p_org, 'proposal',    'Proposal',    '#FACC15', 3, 50,  false, false,
       '{value,expected_close_date}'),
    (v_pipeline, p_org, 'negotiation', 'Negotiation', '#A855F7', 4, 75,  false, false,
       '{value,expected_close_date}'),
    (v_pipeline, p_org, 'won',         'Won',         '#10B981', 5, 100, true,  false,
       '{value}'),
    (v_pipeline, p_org, 'lost',        'Lost',        '#EF4444', 6, 0,   false, true,  '{}')
  on conflict (pipeline_id, key) do nothing;

  insert into public.project_templates (organization_id, name, description, task_definitions)
  values
    (p_org, 'Onboarding',
     'Standard 4-step customer onboarding',
     '[{"title":"Kickoff call","offsetDays":1},
       {"title":"Share access + credentials","offsetDays":3},
       {"title":"Configure workspace","offsetDays":7},
       {"title":"Onboarding review","offsetDays":14}]'::jsonb),
    (p_org, 'SOW Delivery',
     '6-step SOW delivery',
     '[{"title":"Confirm scope","offsetDays":1},
       {"title":"Resource allocation","offsetDays":2},
       {"title":"Kickoff","offsetDays":5},
       {"title":"Mid-project review","offsetDays":15},
       {"title":"Final delivery","offsetDays":28},
       {"title":"Wrap-up + invoice","offsetDays":30}]'::jsonb)
  on conflict (organization_id, name) do nothing;
end;
$$;

-- Seed every existing org.
do $$
declare
  o record;
begin
  for o in select organization_id from public.organizations loop
    perform public.seed_default_pipeline_for_org(o.organization_id);
  end loop;
end $$;

-- Auto-seed on future org inserts.
create or replace function public.pipelines_seed_on_org_insert()
returns trigger language plpgsql as $$
begin
  perform public.seed_default_pipeline_for_org(new.organization_id);
  return new;
end;
$$;

drop trigger if exists pipelines_seed_on_org_insert_t on public.organizations;
create trigger pipelines_seed_on_org_insert_t
  after insert on public.organizations
  for each row execute function public.pipelines_seed_on_org_insert();

-- RLS: members read, admins write.
alter table public.pipelines enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.project_templates enable row level security;

create policy "pipelines read for org members"
  on public.pipelines for select
  using (public.is_org_member(organization_id));

create policy "pipeline_stages read for org members"
  on public.pipeline_stages for select
  using (public.is_org_member(organization_id));

create policy "project_templates read for org members"
  on public.project_templates for select
  using (public.is_org_member(organization_id));

-- Writes gated by canManageSettings — enforced application-side in services
-- (mirrors the existing pattern on organizations.settings); no DB write policy
-- means inserts/updates go through SECURITY DEFINER service functions only.
```

- [ ] **Step 2: Run migration locally**

Run: `npx supabase db reset` (or `npx supabase migration up` if you don't want a full reset)
Expected: migration applies without error; `select count(*) from public.pipelines` returns one row per existing org.

- [ ] **Step 3: Spot-check seeded data**

Run: `npx supabase db query "select organization_id, name, is_default from public.pipelines order by 1;"`
Expected: every org has exactly one default pipeline named "Sales". Then: `select pipeline_id, key, label, position, is_won, is_lost, required_fields from public.pipeline_stages order by pipeline_id, position limit 12;` should show six stages per pipeline, won/lost flags correct, `required_fields` populated for proposal/negotiation/won.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/058_pipelines_and_stages.sql
git commit -m "feat(crm): add pipelines, pipeline_stages, project_templates with seed"
```

---

## Task 2: Migration 059 — deals link + stage-gating trigger

**Files:**
- Create: `supabase/migrations/059_deal_pipeline_link_and_stage_gating.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 059_deal_pipeline_link_and_stage_gating.sql
-- Adds deals.pipeline_id + deals.stage_id (both NOT NULL after backfill),
-- a sync trigger that keeps deals.stage text in lock-step with the linked
-- pipeline_stages.key, and a required-field enforcement trigger.

alter table public.deals
  add column if not exists pipeline_id uuid
    references public.pipelines(pipeline_id) on delete restrict,
  add column if not exists stage_id uuid
    references public.pipeline_stages(stage_id) on delete restrict;

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

  insert into public.projects (organization_id, name, owner_id, start_date, due_date, client_id)
  values (
    v_org,
    coalesce(p_project_input ->> 'name', v_deal.title),
    coalesce((p_project_input ->> 'owner_id')::uuid, v_deal.owner_id),
    coalesce((p_project_input ->> 'start_date')::date, current_date),
    coalesce((p_project_input ->> 'due_date')::date, (current_date + interval '30 days')::date),
    v_deal.client_id
  )
  returning id into v_project;

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
```

- [ ] **Step 2: Verify the projects + tasks tables have the columns the RPC inserts into**

Run: `npx supabase db query "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'projects' order by 1;"`
Expected: includes `organization_id`, `name`, `owner_id`, `start_date`, `due_date`, `client_id`. If any are missing, **stop and report** — the existing schema differs from assumptions; the RPC needs adjustment.

Same for `tasks`: must include `organization_id`, `project_id`, `title`, `due_date`, `created_by`.

- [ ] **Step 3: Apply the migration**

Run: `npx supabase migration up`
Expected: applies cleanly; `select count(*) from public.deals where pipeline_id is null or stage_id is null` returns 0.

- [ ] **Step 4: Smoke-test the gating trigger from SQL**

Run:
```sql
-- Should succeed (lead has no required fields):
update public.deals set stage_id = (
  select stage_id from public.pipeline_stages
  where pipeline_id = deals.pipeline_id and key = 'lead'
) where deal_id = (select deal_id from public.deals limit 1);

-- Should fail with "Stage requires deal value > 0":
update public.deals set value = 0, stage_id = (
  select stage_id from public.pipeline_stages
  where pipeline_id = deals.pipeline_id and key = 'proposal'
) where deal_id = (select deal_id from public.deals limit 1);
```
Expected: first succeeds, second errors with `P0001`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/059_deal_pipeline_link_and_stage_gating.sql
git commit -m "feat(crm): link deals to pipelines and enforce stage gating"
```

---

## Task 3: Pipeline service — types and CRUD

**Files:**
- Create: `src/services/supabase/pipelines.ts`
- Create: `tests/unit/pipelines.test.ts`

- [ ] **Step 1: Write the failing test for type mappers**

`tests/unit/pipelines.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mapPipelineRow, mapStageRow } from '@/services/supabase/pipelines';

describe('pipelines mappers', () => {
  it('maps a pipeline row from snake_case to camelCase', () => {
    const row = {
      pipeline_id: 'p1',
      organization_id: 'o1',
      name: 'Sales',
      description: null,
      is_default: true,
      position: 0,
      created_by: 'u1',
      created_at: '2026-05-16T00:00:00Z',
      updated_at: '2026-05-16T00:00:00Z',
    };
    const out = mapPipelineRow(row);
    expect(out.pipelineId).toBe('p1');
    expect(out.organizationId).toBe('o1');
    expect(out.isDefault).toBe(true);
    expect(out.position).toBe(0);
  });

  it('maps a stage row preserving required_fields and won/lost flags', () => {
    const row = {
      stage_id: 's1',
      pipeline_id: 'p1',
      organization_id: 'o1',
      key: 'won',
      label: 'Won',
      color: '#10B981',
      position: 5,
      default_probability: 100,
      is_won: true,
      is_lost: false,
      required_fields: ['value'],
      created_at: '2026-05-16T00:00:00Z',
    };
    const out = mapStageRow(row);
    expect(out.isWon).toBe(true);
    expect(out.isLost).toBe(false);
    expect(out.requiredFields).toEqual(['value']);
    expect(out.defaultProbability).toBe(100);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- pipelines.test.ts`
Expected: fail — `pipelines.ts` does not export `mapPipelineRow` / `mapStageRow`.

- [ ] **Step 3: Write the service module**

`src/services/supabase/pipelines.ts`:

```ts
import { supabase } from "./config";
import { logger } from "@/lib/logger";

export type RequiredFieldKey =
  | "value"
  | "expected_close_date"
  | "description"
  | "primary_contact";

export interface Pipeline {
  pipelineId: string;
  organizationId: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  position: number;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PipelineStage {
  stageId: string;
  pipelineId: string;
  organizationId: string;
  key: string;
  label: string;
  color: string;
  position: number;
  defaultProbability: number;
  isWon: boolean;
  isLost: boolean;
  requiredFields: RequiredFieldKey[];
  createdAt: Date;
}

export const mapPipelineRow = (r: Record<string, unknown>): Pipeline => ({
  pipelineId: r.pipeline_id as string,
  organizationId: r.organization_id as string,
  name: r.name as string,
  description: (r.description as string) ?? null,
  isDefault: Boolean(r.is_default),
  position: Number(r.position ?? 0),
  createdBy: (r.created_by as string) ?? null,
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
});

export const mapStageRow = (r: Record<string, unknown>): PipelineStage => ({
  stageId: r.stage_id as string,
  pipelineId: r.pipeline_id as string,
  organizationId: r.organization_id as string,
  key: r.key as string,
  label: r.label as string,
  color: (r.color as string) ?? "#94A3B8",
  position: Number(r.position ?? 0),
  defaultProbability: Number(r.default_probability ?? 10),
  isWon: Boolean(r.is_won),
  isLost: Boolean(r.is_lost),
  requiredFields: Array.isArray(r.required_fields)
    ? (r.required_fields as RequiredFieldKey[])
    : [],
  createdAt: new Date(r.created_at as string),
});

export const getOrganizationPipelines = async (
  organizationId: string,
): Promise<Pipeline[]> => {
  const { data, error } = await supabase
    .from("pipelines")
    .select("*")
    .eq("organization_id", organizationId)
    .order("position", { ascending: true });
  if (error) {
    logger.error("Failed to load pipelines:", error);
    return [];
  }
  return (data || []).map(mapPipelineRow);
};

export const getPipelineStages = async (
  pipelineId: string,
): Promise<PipelineStage[]> => {
  const { data, error } = await supabase
    .from("pipeline_stages")
    .select("*")
    .eq("pipeline_id", pipelineId)
    .order("position", { ascending: true });
  if (error) {
    logger.error("Failed to load stages:", error);
    return [];
  }
  return (data || []).map(mapStageRow);
};

export interface CreatePipelineInput {
  name: string;
  description?: string | null;
  isDefault?: boolean;
}

export const createPipeline = async (
  organizationId: string,
  input: CreatePipelineInput,
): Promise<Pipeline> => {
  if (!input.name?.trim()) throw new Error("Pipeline name is required");
  const { data, error } = await supabase
    .from("pipelines")
    .insert({
      organization_id: organizationId,
      name: input.name.trim(),
      description: input.description ?? null,
      is_default: Boolean(input.isDefault),
    })
    .select()
    .single();
  if (error) throw error;
  return mapPipelineRow(data);
};

export interface UpdatePipelineInput {
  name?: string;
  description?: string | null;
  isDefault?: boolean;
  position?: number;
}

export const updatePipeline = async (
  pipelineId: string,
  input: UpdatePipelineInput,
): Promise<Pipeline> => {
  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name.trim();
  if (input.description !== undefined) update.description = input.description;
  if (input.isDefault !== undefined) update.is_default = input.isDefault;
  if (input.position !== undefined) update.position = input.position;
  const { data, error } = await supabase
    .from("pipelines")
    .update(update)
    .eq("pipeline_id", pipelineId)
    .select()
    .single();
  if (error) throw error;
  return mapPipelineRow(data);
};

export const deletePipeline = async (pipelineId: string): Promise<void> => {
  const { error } = await supabase
    .from("pipelines")
    .delete()
    .eq("pipeline_id", pipelineId);
  if (error) throw error;
};

export interface UpsertStageInput {
  stageId?: string;
  key: string;
  label: string;
  color?: string;
  position: number;
  defaultProbability?: number;
  isWon?: boolean;
  isLost?: boolean;
  requiredFields?: RequiredFieldKey[];
}

export const upsertStages = async (
  pipelineId: string,
  organizationId: string,
  stages: UpsertStageInput[],
): Promise<PipelineStage[]> => {
  // Server-side: replace the stage set atomically. Stages with stageId update;
  // stages without it insert; existing stages not in the list are deleted.
  const { data, error } = await supabase.rpc("crm_replace_pipeline_stages", {
    p_pipeline_id: pipelineId,
    p_organization_id: organizationId,
    p_stages: stages.map((s) => ({
      stage_id: s.stageId ?? null,
      key: s.key,
      label: s.label,
      color: s.color ?? "#94A3B8",
      position: s.position,
      default_probability: s.defaultProbability ?? 10,
      is_won: Boolean(s.isWon),
      is_lost: Boolean(s.isLost),
      required_fields: s.requiredFields ?? [],
    })),
  });
  if (error) throw error;
  return (data as Record<string, unknown>[]).map(mapStageRow);
};

export const subscribePipelines = (
  organizationId: string,
  callback: (pipelines: Pipeline[]) => void,
): (() => void) => {
  getOrganizationPipelines(organizationId).then(callback);
  const channel = supabase
    .channel(`pipelines-${organizationId}-${Math.random().toString(36).slice(2, 9)}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "pipelines",
        filter: `organization_id=eq.${organizationId}`,
      },
      () => getOrganizationPipelines(organizationId).then(callback),
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "pipeline_stages",
        filter: `organization_id=eq.${organizationId}`,
      },
      () => getOrganizationPipelines(organizationId).then(callback),
    )
    .subscribe();
  return () => {
    channel.unsubscribe();
  };
};
```

- [ ] **Step 4: Add the `crm_replace_pipeline_stages` RPC to migration 058**

Append to `058_pipelines_and_stages.sql`:

```sql
create or replace function public.crm_replace_pipeline_stages(
  p_pipeline_id uuid,
  p_organization_id uuid,
  p_stages jsonb
) returns setof public.pipeline_stages
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_keys text[];
  v_stage jsonb;
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select array_agg(s ->> 'key') into v_keys from jsonb_array_elements(p_stages) s;

  delete from public.pipeline_stages
  where pipeline_id = p_pipeline_id
    and (v_keys is null or not (key = any(v_keys)));

  for v_stage in select * from jsonb_array_elements(p_stages) loop
    insert into public.pipeline_stages (
      stage_id, pipeline_id, organization_id, key, label, color, position,
      default_probability, is_won, is_lost, required_fields
    )
    values (
      coalesce(nullif(v_stage ->> 'stage_id','')::uuid, gen_random_uuid()),
      p_pipeline_id,
      p_organization_id,
      v_stage ->> 'key',
      v_stage ->> 'label',
      coalesce(v_stage ->> 'color', '#94A3B8'),
      (v_stage ->> 'position')::int,
      coalesce((v_stage ->> 'default_probability')::int, 10),
      coalesce((v_stage ->> 'is_won')::boolean, false),
      coalesce((v_stage ->> 'is_lost')::boolean, false),
      coalesce(
        array(select jsonb_array_elements_text(v_stage -> 'required_fields')),
        '{}'::text[]
      )
    )
    on conflict (pipeline_id, key) do update set
      label = excluded.label,
      color = excluded.color,
      position = excluded.position,
      default_probability = excluded.default_probability,
      is_won = excluded.is_won,
      is_lost = excluded.is_lost,
      required_fields = excluded.required_fields;
  end loop;

  return query
    select * from public.pipeline_stages
    where pipeline_id = p_pipeline_id
    order by position;
end;
$$;

grant execute on function public.crm_replace_pipeline_stages(uuid, uuid, jsonb) to authenticated;
```

Re-run `npx supabase migration up` (or `db reset` if the migration was already applied).

- [ ] **Step 5: Run the unit tests**

Run: `npm test -- pipelines.test.ts`
Expected: PASS — both mapper tests green.

- [ ] **Step 6: Commit**

```bash
git add src/services/supabase/pipelines.ts tests/unit/pipelines.test.ts \
  supabase/migrations/058_pipelines_and_stages.sql
git commit -m "feat(crm): pipelines service + replace-stages RPC"
```

---

## Task 4: Project templates service

**Files:**
- Create: `src/services/supabase/projectTemplates.ts`

- [ ] **Step 1: Write the service**

```ts
import { supabase } from "./config";
import { logger } from "@/lib/logger";

export interface TemplateTaskDef {
  title: string;
  offsetDays: number;
}

export interface ProjectTemplate {
  templateId: string;
  organizationId: string;
  name: string;
  description: string | null;
  taskDefinitions: TemplateTaskDef[];
  createdAt: Date;
}

export const mapTemplateRow = (r: Record<string, unknown>): ProjectTemplate => ({
  templateId: r.template_id as string,
  organizationId: r.organization_id as string,
  name: r.name as string,
  description: (r.description as string) ?? null,
  taskDefinitions: Array.isArray(r.task_definitions)
    ? (r.task_definitions as TemplateTaskDef[])
    : [],
  createdAt: new Date(r.created_at as string),
});

export const getOrganizationTemplates = async (
  organizationId: string,
): Promise<ProjectTemplate[]> => {
  const { data, error } = await supabase
    .from("project_templates")
    .select("*")
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });
  if (error) {
    logger.error("Failed to load project templates:", error);
    return [];
  }
  return (data || []).map(mapTemplateRow);
};
```

- [ ] **Step 2: Commit**

```bash
git add src/services/supabase/projectTemplates.ts
git commit -m "feat(crm): project templates service"
```

---

## Task 5: Extend deals service — types + closeDealToWon + error translation

**Files:**
- Modify: `src/services/supabase/deals.ts`

- [ ] **Step 1: Add new fields to `Deal` and `UpdateDealInput`**

In `src/services/supabase/deals.ts`, locate the `Deal` interface and add:

```ts
export interface Deal {
  // … existing fields …
  pipelineId: string;
  stageId: string;
}

export interface UpdateDealInput {
  // … existing fields …
  pipelineId?: string;
  stageId?: string;
}
```

Update `mapDeal` to set them:

```ts
const mapDeal = (row: Record<string, unknown>): Deal => ({
  // … existing fields …
  pipelineId: row.pipeline_id as string,
  stageId: row.stage_id as string,
});
```

Update `updateDeal` server path to forward `stage_id`/`pipeline_id`:

```ts
if (input.stageId !== undefined) update.stage_id = input.stageId;
if (input.pipelineId !== undefined) update.pipeline_id = input.pipelineId;
```

- [ ] **Step 2: Add the won-handoff wrapper**

Append:

```ts
export interface CloseDealToWonInput {
  skip?: boolean;          // true => transition only, no project
  name?: string;
  ownerId?: string;
  startDate?: string;      // YYYY-MM-DD
  dueDate?: string;        // YYYY-MM-DD
  templateId?: string | null;
}

export const closeDealToWon = async (
  dealId: string,
  input: CloseDealToWonInput,
): Promise<{ dealId: string; projectId: string | null }> => {
  const { data, error } = await supabase.rpc("crm_close_deal_to_won", {
    p_deal_id: dealId,
    p_project_input: {
      skip: input.skip ?? false,
      name: input.name ?? null,
      owner_id: input.ownerId ?? null,
      start_date: input.startDate ?? null,
      due_date: input.dueDate ?? null,
      template_id: input.templateId ?? null,
    },
  });
  if (error) {
    logger.error("Failed to close deal to won:", error);
    throw error;
  }
  return {
    dealId: (data as Record<string, unknown>).deal_id as string,
    projectId: ((data as Record<string, unknown>).project_id as string) ?? null,
  };
};
```

- [ ] **Step 3: Translate `P0001` gating errors to human messages**

In `updateDeal`, wrap the existing supabase update call so the error path translates trigger messages:

```ts
if (error) {
  const code = (error as { code?: string }).code;
  const msg = (error as { message?: string }).message ?? "";
  if (code === "P0001") {
    throw new Error(msg);  // already human-readable from the trigger
  }
  logger.error("Failed to update deal:", error);
  throw error;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/services/supabase/deals.ts
git commit -m "feat(crm): deals service pipeline_id/stage_id + close-to-won RPC"
```

---

## Task 6: usePipelines hook

**Files:**
- Create: `src/hooks/usePipelines.ts`

- [ ] **Step 1: Write the hook**

```ts
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOrganization } from "@/context/OrganizationContext";
import {
  Pipeline,
  PipelineStage,
  getPipelineStages,
  subscribePipelines,
} from "@/services/supabase/pipelines";

export const usePipelines = () => {
  const { user } = useAuth();
  const { organization, isOwner, isAdmin } = useOrganization();
  const orgId =
    organization?.organizationId ?? user?.organizationId ?? null;

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) {
      setPipelines([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return subscribePipelines(orgId, (next) => {
      setPipelines(next);
      setLoading(false);
    });
  }, [orgId]);

  const defaultPipeline = useMemo(
    () => pipelines.find((p) => p.isDefault) ?? pipelines[0] ?? null,
    [pipelines],
  );

  const [stagesByPipeline, setStagesByPipeline] = useState<
    Record<string, PipelineStage[]>
  >({});

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      pipelines.map(async (p) => [p.pipelineId, await getPipelineStages(p.pipelineId)] as const),
    ).then((pairs) => {
      if (cancelled) return;
      const next: Record<string, PipelineStage[]> = {};
      for (const [id, stages] of pairs) next[id] = stages;
      setStagesByPipeline(next);
    });
    return () => {
      cancelled = true;
    };
  }, [pipelines]);

  return {
    organizationId: orgId,
    pipelines,
    defaultPipeline,
    stagesByPipeline,
    loading,
    canManage: isOwner || isAdmin,
  };
};
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/usePipelines.ts
git commit -m "feat(crm): usePipelines hook"
```

---

## Task 7: Extend useDeals to accept `pipelineId`

**Files:**
- Modify: `src/hooks/useDeals.ts:26`

- [ ] **Step 1: Change the hook signature**

```ts
export const useDeals = (pipelineId?: string | null) => {
  const { user } = useAuth();
  const { organization, isOwner, isAdmin } = useOrganization();
  const orgId = effectiveOrgId(
    organization?.organizationId ?? user?.organizationId ?? null,
    user?.userId,
  );

  const [allDeals, setAllDeals] = useState<Deal[]>([]);
  // … rest of effect uses setAllDeals instead of setDeals
```

Filter `allDeals` by `pipelineId` for the public `deals` value:

```ts
const deals = useMemo(
  () => (pipelineId ? allDeals.filter((d) => d.pipelineId === pipelineId) : allDeals),
  [allDeals, pipelineId],
);
```

- [ ] **Step 2: Update callers**

`src/components/clients/DealsKanban.tsx` and any other caller: pass the selected `pipelineId`. (Existing callers that pass no argument continue to work — they see all deals.)

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useDeals.ts
git commit -m "feat(crm): useDeals optional pipeline filter"
```

---

## Task 8: Pipelines settings tab + editor

**Files:**
- Create: `src/components/settings/PipelinesSettingsTab.tsx`
- Create: `src/components/settings/PipelineEditor.tsx`
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: PipelineEditor component**

`src/components/settings/PipelineEditor.tsx`:

```tsx
import React, { useState } from "react";
import {
  Pipeline,
  PipelineStage,
  RequiredFieldKey,
  UpsertStageInput,
  upsertStages,
} from "@/services/supabase/pipelines";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { GripVertical, Trash2, Plus } from "lucide-react";

const ALL_REQUIRED: RequiredFieldKey[] = [
  "value",
  "expected_close_date",
  "description",
  "primary_contact",
];

interface Props {
  pipeline: Pipeline;
  initialStages: PipelineStage[];
  onSaved?: (stages: PipelineStage[]) => void;
}

interface DraftStage {
  stageId?: string;
  key: string;
  label: string;
  color: string;
  position: number;
  defaultProbability: number;
  isWon: boolean;
  isLost: boolean;
  requiredFields: RequiredFieldKey[];
}

export const PipelineEditor: React.FC<Props> = ({ pipeline, initialStages, onSaved }) => {
  const [stages, setStages] = useState<DraftStage[]>(
    initialStages.map((s) => ({
      stageId: s.stageId,
      key: s.key,
      label: s.label,
      color: s.color,
      position: s.position,
      defaultProbability: s.defaultProbability,
      isWon: s.isWon,
      isLost: s.isLost,
      requiredFields: s.requiredFields,
    })),
  );
  const [saving, setSaving] = useState(false);

  const update = (idx: number, patch: Partial<DraftStage>) => {
    setStages((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const addStage = () => {
    setStages((prev) => [
      ...prev,
      {
        key: `stage_${prev.length + 1}`,
        label: "New stage",
        color: "#94A3B8",
        position: prev.length + 1,
        defaultProbability: 10,
        isWon: false,
        isLost: false,
        requiredFields: [],
      },
    ]);
  };

  const removeStage = (idx: number) => {
    setStages((prev) => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, position: i + 1 })));
  };

  const toggleRequired = (idx: number, key: RequiredFieldKey) => {
    setStages((prev) =>
      prev.map((s, i) => {
        if (i !== idx) return s;
        return s.requiredFields.includes(key)
          ? { ...s, requiredFields: s.requiredFields.filter((k) => k !== key) }
          : { ...s, requiredFields: [...s.requiredFields, key] };
      }),
    );
  };

  const save = async () => {
    setSaving(true);
    try {
      const wonCount = stages.filter((s) => s.isWon).length;
      const lostCount = stages.filter((s) => s.isLost).length;
      if (wonCount !== 1) throw new Error("Exactly one stage must be marked Won");
      if (lostCount !== 1) throw new Error("Exactly one stage must be marked Lost");
      const next = await upsertStages(
        pipeline.pipelineId,
        pipeline.organizationId,
        stages.map<UpsertStageInput>((s, i) => ({ ...s, position: i + 1 })),
      );
      toast.success("Pipeline saved");
      onSaved?.(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {stages.map((s, idx) => (
        <div key={idx} className="border rounded-lg p-3 grid grid-cols-12 gap-3">
          <div className="col-span-1 flex items-center justify-center text-muted-foreground">
            <GripVertical className="w-4 h-4" />
          </div>
          <div className="col-span-2">
            <Label>Key</Label>
            <Input
              value={s.key}
              onChange={(e) => update(idx, { key: e.target.value })}
              maxLength={40}
            />
          </div>
          <div className="col-span-2">
            <Label>Label</Label>
            <Input
              value={s.label}
              onChange={(e) => update(idx, { label: e.target.value })}
              maxLength={60}
            />
          </div>
          <div className="col-span-1">
            <Label>%</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={s.defaultProbability}
              onChange={(e) => update(idx, { defaultProbability: Number(e.target.value) || 0 })}
            />
          </div>
          <div className="col-span-1">
            <Label>Color</Label>
            <Input
              type="color"
              value={s.color}
              onChange={(e) => update(idx, { color: e.target.value })}
            />
          </div>
          <div className="col-span-1 flex items-end gap-2">
            <Switch checked={s.isWon} onCheckedChange={(v) => update(idx, { isWon: v, isLost: v ? false : s.isLost })} />
            <Label className="text-xs">Won</Label>
          </div>
          <div className="col-span-1 flex items-end gap-2">
            <Switch checked={s.isLost} onCheckedChange={(v) => update(idx, { isLost: v, isWon: v ? false : s.isWon })} />
            <Label className="text-xs">Lost</Label>
          </div>
          <div className="col-span-2 flex flex-wrap gap-1 items-end">
            {ALL_REQUIRED.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => toggleRequired(idx, k)}
                className={`text-[10px] px-2 py-1 rounded border ${
                  s.requiredFields.includes(k)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {k}
              </button>
            ))}
          </div>
          <div className="col-span-1 flex items-end justify-end">
            <Button variant="ghost" size="icon" onClick={() => removeStage(idx)}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      ))}
      <div className="flex gap-2">
        <Button variant="outline" onClick={addStage}>
          <Plus className="w-4 h-4 mr-1" /> Add stage
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save pipeline"}
        </Button>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: PipelinesSettingsTab**

`src/components/settings/PipelinesSettingsTab.tsx`:

```tsx
import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { usePipelines } from "@/hooks/usePipelines";
import { PipelineEditor } from "./PipelineEditor";
import {
  createPipeline,
  updatePipeline,
  deletePipeline,
} from "@/services/supabase/pipelines";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const PipelinesSettingsTab: React.FC = () => {
  const { organizationId, pipelines, stagesByPipeline, canManage } = usePipelines();
  const [newName, setNewName] = useState("");

  const addPipeline = async () => {
    if (!organizationId || !newName.trim()) return;
    try {
      await createPipeline(organizationId, { name: newName.trim() });
      setNewName("");
      toast.success("Pipeline created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    }
  };

  if (!canManage) {
    return <p className="text-sm text-muted-foreground">Only admins can manage pipelines.</p>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4 flex gap-2 items-end">
          <div className="flex-1">
            <Input
              placeholder="New pipeline name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <Button onClick={addPipeline}>
            <Plus className="w-4 h-4 mr-1" /> Add pipeline
          </Button>
        </CardContent>
      </Card>

      <Tabs defaultValue={pipelines[0]?.pipelineId ?? ""}>
        <TabsList className="flex flex-wrap">
          {pipelines.map((p) => (
            <TabsTrigger key={p.pipelineId} value={p.pipelineId}>
              {p.name} {p.isDefault && "·default"}
            </TabsTrigger>
          ))}
        </TabsList>
        {pipelines.map((p) => (
          <TabsContent key={p.pipelineId} value={p.pipelineId} className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <Input
                defaultValue={p.name}
                onBlur={async (e) => {
                  if (e.target.value !== p.name) {
                    await updatePipeline(p.pipelineId, { name: e.target.value });
                  }
                }}
                className="max-w-[260px]"
              />
              {!p.isDefault && (
                <Button
                  variant="outline"
                  onClick={() => updatePipeline(p.pipelineId, { isDefault: true })}
                >
                  Make default
                </Button>
              )}
              {!p.isDefault && (
                <Button
                  variant="ghost"
                  onClick={async () => {
                    if (confirm("Delete this pipeline? Deals on it must be moved first.")) {
                      try {
                        await deletePipeline(p.pipelineId);
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Delete failed");
                      }
                    }
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
            <PipelineEditor
              pipeline={p}
              initialStages={stagesByPipeline[p.pipelineId] ?? []}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
};
```

- [ ] **Step 3: Wire into `Settings.tsx`**

Open `src/pages/Settings.tsx`, find the `<TabsList>` and `<TabsContent>` set. Add — adjacent to existing tabs, not inside the Integrations tab the other agent owns:

```tsx
import { PipelinesSettingsTab } from "@/components/settings/PipelinesSettingsTab";

// inside <TabsList>:
<TabsTrigger value="pipelines">Pipelines</TabsTrigger>

// alongside other <TabsContent>:
<TabsContent value="pipelines"><PipelinesSettingsTab /></TabsContent>
```

- [ ] **Step 4: Run dev server and click through**

Run: `npm run dev`, navigate to Settings → Pipelines. Confirm: default Sales pipeline shows with six stages; editing label + saving persists (close & reopen); adding a new pipeline appears in the tab list; toggling Won on a different stage and saving without flipping the old one off triggers the "Exactly one stage must be marked Won" validation.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/PipelinesSettingsTab.tsx \
  src/components/settings/PipelineEditor.tsx src/pages/Settings.tsx
git commit -m "feat(crm): pipeline editor UI in settings"
```

---

## Task 9: Pipeline selector on Clients pipeline tab

**Files:**
- Create: `src/components/clients/PipelineSelector.tsx`
- Modify: `src/pages/Clients.tsx`

- [ ] **Step 1: PipelineSelector**

```tsx
import React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pipeline } from "@/services/supabase/pipelines";

interface Props {
  pipelines: Pipeline[];
  value: string;
  onChange: (id: string) => void;
}

export const PipelineSelector: React.FC<Props> = ({ pipelines, value, onChange }) => (
  <Select value={value} onValueChange={onChange}>
    <SelectTrigger className="w-[220px]">
      <SelectValue placeholder="Select pipeline" />
    </SelectTrigger>
    <SelectContent>
      {pipelines.map((p) => (
        <SelectItem key={p.pipelineId} value={p.pipelineId}>
          {p.name}
          {p.isDefault && " · default"}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);
```

- [ ] **Step 2: Mount inside `Clients.tsx` Pipeline tab**

Modify `src/pages/Clients.tsx` Pipeline `TabsContent`: import `usePipelines`, choose default pipeline on mount, render the selector, pass `pipelineId` down to `DealsKanban`:

```tsx
import { usePipelines } from "@/hooks/usePipelines";
import { PipelineSelector } from "@/components/clients/PipelineSelector";

// inside Clients component (top of the function):
const { pipelines, defaultPipeline, stagesByPipeline } = usePipelines();
const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
useEffect(() => {
  if (!selectedPipelineId && defaultPipeline) setSelectedPipelineId(defaultPipeline.pipelineId);
}, [defaultPipeline, selectedPipelineId]);

// Pipeline TabsContent — render selector above DealsKanban:
<TabsContent value="pipeline" className="mt-4 space-y-4">
  <Card>
    <CardContent className="pt-4 flex flex-wrap items-center gap-3">
      <PipelineSelector
        pipelines={pipelines}
        value={selectedPipelineId}
        onChange={setSelectedPipelineId}
      />
      {/* existing currency selector etc. stays here */}
    </CardContent>
  </Card>
  <PipelineAnalyticsCard currency={effectivePipelineCurrency} pipelineId={selectedPipelineId} />
  <DealsKanban
    clients={clients}
    displayCurrency={effectivePipelineCurrency}
    pipelineId={selectedPipelineId}
    stages={stagesByPipeline[selectedPipelineId] ?? []}
  />
</TabsContent>
```

- [ ] **Step 3: Commit**

```bash
git add src/components/clients/PipelineSelector.tsx src/pages/Clients.tsx
git commit -m "feat(crm): pipeline selector on Clients pipeline tab"
```

---

## Task 10: DealsKanban — render columns from pipeline_stages, intercept won move

**Files:**
- Modify: `src/components/clients/DealsKanban.tsx`

- [ ] **Step 1: Replace the hardcoded `DEAL_STAGES` import with the `stages` prop**

At the top of `DealsKanban.tsx`, remove `import { DEAL_STAGES } from "@/services/supabase/deals"`. Take `stages: PipelineStage[]` and `pipelineId: string` as new props. Iterate over `stages` (sorted by `position`) to render columns instead of the constant.

- [ ] **Step 2: Intercept won-stage moves**

In the drag-end handler:

```tsx
const stageMovingTo = stages.find((s) => s.stageId === overStageId);
if (stageMovingTo?.isWon) {
  setPendingWonDeal({ deal: draggedDeal, stage: stageMovingTo });
  return; // open modal; updateDeal happens inside it
}
await update(draggedDeal.dealId, { stageId: overStageId });
```

Add state `const [pendingWonDeal, setPendingWonDeal] = useState<{ deal: Deal; stage: PipelineStage } | null>(null);` and at the bottom of the JSX:

```tsx
{pendingWonDeal && (
  <DealWonModal
    deal={pendingWonDeal.deal}
    targetStage={pendingWonDeal.stage}
    onClose={() => setPendingWonDeal(null)}
  />
)}
```

- [ ] **Step 3: Translate stage-gating errors back to the user**

Wrap the `update(...)` call in a try/catch so the trigger's human message surfaces and the card snaps back (it already snaps back on update failure since the realtime layer is the source of truth, but the toast is needed):

```tsx
try {
  await update(draggedDeal.dealId, { stageId: overStageId });
} catch (err) {
  toast.error(err instanceof Error ? err.message : "Couldn't move deal");
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/clients/DealsKanban.tsx
git commit -m "feat(crm): DealsKanban driven by pipeline_stages + won intercept"
```

---

## Task 11: DealWonModal

**Files:**
- Create: `src/components/clients/DealWonModal.tsx`
- Create: `tests/unit/dealWonModal.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/dealWonModal.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DealWonModal } from "@/components/clients/DealWonModal";

vi.mock("@/services/supabase/deals", () => ({
  closeDealToWon: vi.fn().mockResolvedValue({ dealId: "d1", projectId: "p1" }),
}));
vi.mock("@/services/supabase/projectTemplates", () => ({
  getOrganizationTemplates: vi.fn().mockResolvedValue([
    { templateId: "t1", organizationId: "o1", name: "Onboarding", description: null, taskDefinitions: [], createdAt: new Date() },
  ]),
}));

describe("DealWonModal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls closeDealToWon with skip=true when 'Skip' clicked", async () => {
    const { closeDealToWon } = await import("@/services/supabase/deals");
    render(
      <DealWonModal
        deal={{
          dealId: "d1",
          organizationId: "o1",
          clientId: "c1",
          clientName: "Acme",
          title: "Renew",
          ownerId: "u1",
          ownerName: "Faraz",
        } as any}
        targetStage={{ stageId: "swon", isWon: true } as any}
        onClose={() => {}}
      />
    );
    fireEvent.click(screen.getByText("Skip"));
    await waitFor(() => expect(closeDealToWon).toHaveBeenCalledWith("d1", expect.objectContaining({ skip: true })));
  });
});
```

- [ ] **Step 2: Verify it fails**

Run: `npm test -- dealWonModal.test.tsx`
Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement the modal**

```tsx
// src/components/clients/DealWonModal.tsx
import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Deal, closeDealToWon } from "@/services/supabase/deals";
import { PipelineStage } from "@/services/supabase/pipelines";
import { ProjectTemplate, getOrganizationTemplates } from "@/services/supabase/projectTemplates";
import { toast } from "sonner";

interface Props {
  deal: Deal;
  targetStage: PipelineStage;
  onClose: () => void;
}

const toIso = (d: Date) => d.toISOString().slice(0, 10);

export const DealWonModal: React.FC<Props> = ({ deal, targetStage, onClose }) => {
  const today = new Date();
  const due = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [name, setName] = useState(`${deal.clientName ?? ""} — ${deal.title}`.trim().slice(0, 120));
  const [templateId, setTemplateId] = useState<string>("none");
  const [start, setStart] = useState(toIso(today));
  const [dueDate, setDueDate] = useState(toIso(due));
  const [submitting, setSubmitting] = useState(false);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);

  useEffect(() => {
    getOrganizationTemplates(deal.organizationId).then(setTemplates);
  }, [deal.organizationId]);

  const submit = async (skip: boolean) => {
    setSubmitting(true);
    try {
      await closeDealToWon(deal.dealId, {
        skip,
        name: skip ? undefined : name,
        ownerId: skip ? undefined : (deal.ownerId ?? undefined),
        startDate: skip ? undefined : start,
        dueDate: skip ? undefined : dueDate,
        templateId: skip || templateId === "none" ? null : templateId,
      });
      toast.success(skip ? "Deal won" : "Deal won, project created");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create project from won deal</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Project name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Start</Label>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <Label>Due</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Template</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No template</SelectItem>
                {templates.map((t) => (
                  <SelectItem key={t.templateId} value={t.templateId}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">Client: {deal.clientName ?? "—"}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => submit(true)} disabled={submitting}>Skip</Button>
          <Button onClick={() => submit(false)} disabled={submitting}>
            {submitting ? "Creating…" : "Create project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
```

- [ ] **Step 4: Run the test**

Run: `npm test -- dealWonModal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire `DealWonModal` import into `DealsKanban.tsx`**

```tsx
import { DealWonModal } from "./DealWonModal";
```
(already referenced in Task 10 step 2)

- [ ] **Step 6: Manual E2E test**

Run `npm run dev`. Create a deal with `value > 0` and an expected close date. Drag it to a stage with `value` in `required_fields` after clearing the value first — confirm the toast shows the trigger message and the card snaps back. Drag a complete deal into the Won column — confirm the modal opens; click `Skip` once and verify deal closes without a project; revert and click `Create project` and verify a new project appears in Projects with the chosen template's tasks.

- [ ] **Step 7: Commit**

```bash
git add src/components/clients/DealWonModal.tsx tests/unit/dealWonModal.test.tsx
git commit -m "feat(crm): won-handoff modal + project creation"
```

---

## Self-review pass

Before declaring this plan done, verify:

1. Migrations 058 and 059 reference `public.is_org_admin(uuid)` and `public.is_org_member(uuid)`. Confirm they exist (migration 036 per the spec note). If not, replace the calls with a SECURITY DEFINER helper that checks the existing `organizations.members` JSONB.
2. The `crm_close_deal_to_won` RPC inserts into `public.projects` and `public.tasks`. Re-verify those tables' columns before merging (Task 2 step 2). If `tasks` uses a different column name, fix the RPC inline.
3. All exported types from `pipelines.ts` (`Pipeline`, `PipelineStage`, `RequiredFieldKey`) are used consistently across `usePipelines`, `PipelineEditor`, `PipelineSelector`, and `DealsKanban`. No stragglers using the old `DealStage` text union for column rendering.
4. The toast message surfaced on `P0001` is the trigger's `raise exception` message — confirm by deliberately tripping one in the dev UI.
5. After all migrations run, every existing deal has `pipeline_id` and `stage_id` populated. `select count(*) from deals where pipeline_id is null or stage_id is null` must return 0.
