# CRM Plan 2 — Data Quality (Lead Scoring + Duplicate Detection)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Per-org configurable lead scoring (rules engine + thresholds + computed score on every client) and server-enforced hard-block duplicate detection on clients/contacts with admin override.

**Architecture:** Two new tables for scoring (`lead_scoring_rules`, `lead_scoring_thresholds`), one for queueing async recomputes (`lead_scoring_recompute_queue`), and a `client_dup_overrides` audit table. Three new columns on `clients` (`score`, `score_band`, `score_updated_at`). Partial unique indexes on `clients` and `client_contacts` enforce duplicate rejection at the database level; a `dup_override` tag in `tags` opts a row out of the unique index. Recompute logic lives in a SECURITY DEFINER SQL function plus a 60-second polling Edge Function for bulk recomputes.

**Tech Stack:** Same as Plan 1.

**Depends on:** Plan 1 must be merged first — this plan reads but doesn't modify pipelines.

---

## File Structure

**Created:**
- `supabase/migrations/060_lead_scoring_rules.sql`
- `supabase/migrations/061_dup_detection_indexes.sql`
- `supabase/functions/crm-recompute-scores/index.ts` — 60s polling worker
- `src/services/supabase/leadScoring.ts` — rules + thresholds CRUD, dry-run preview
- `src/services/supabase/dupDetection.ts` — `findDuplicates`, override helpers
- `src/hooks/useLeadScoringRules.ts`
- `src/components/settings/LeadScoringSettingsTab.tsx`
- `src/components/clients/ScoreBadge.tsx`
- `src/components/clients/DuplicateBanner.tsx`
- `tests/unit/leadScoring.test.ts`
- `tests/unit/dupDetection.test.ts`

**Modified:**
- `src/services/supabase/clients.ts` — duplicate-aware create/update; CSV import duplicate handling; expose `score`, `score_band` on the `Client` type
- `src/components/clients/ClientFormDialog.tsx` — inline duplicate banner before save
- `src/components/clients/ImportClientsDialog.tsx` — surface rejected duplicates with per-row override
- `src/components/clients/ClientDetailDrawer.tsx` — score badge near header
- `src/pages/Clients.tsx` — sortable Score column + score-band filter
- `src/pages/Settings.tsx` — add Lead Scoring tab

---

## Task 1: Migration 060 — lead scoring tables + recompute fn

**Files:**
- Create: `supabase/migrations/060_lead_scoring_rules.sql`

- [ ] **Step 1: Write the migration**

```sql
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
    (p_org, 'Annual revenue ≥ $1M',  'annual_revenue', 'gte', to_jsonb(1000000),  20, 1),
    (p_org, 'Annual revenue ≥ $10M', 'annual_revenue', 'gte', to_jsonb(10000000), 15, 2),
    (p_org, '50+ employees',         'employee_count', 'gte', to_jsonb(50),       10, 3),
    (p_org, 'Source referral/event', 'source', 'in', '["referral","event"]'::jsonb, 10, 4),
    (p_org, 'Active last 14 days',   'recent_activity_days', 'lte', to_jsonb(14), 10, 5),
    (p_org, 'Open deals ≥ 1',        'open_deals_count', 'gte', to_jsonb(1),      15, 6),
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
    -- Cast errors on bad rule data shouldn't poison the score.
    continue;
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

create policy "rules read for org members"
  on public.lead_scoring_rules for select
  using (public.is_org_member(organization_id));

create policy "thresholds read for org members"
  on public.lead_scoring_thresholds for select
  using (public.is_org_member(organization_id));

-- Writes only via service functions (admin check) — no write policy by design.
```

- [ ] **Step 2: Apply and verify**

Run: `npx supabase migration up`
Then: `select organization_id, count(*) from public.lead_scoring_rules group by 1;`
Expected: every org has 8 seeded rules.

`select client_id, score, score_band from public.clients limit 10;`
Expected: rows still show default 0/cold (no auto-recompute on existing rows; bulk worker will catch up after first deploy).

- [ ] **Step 3: Spot-check a single recompute**

`select public.recompute_client_score((select client_id from public.clients limit 1));`
Then re-select that client — `score` should be ≠ 0 if any seeded rule matches.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/060_lead_scoring_rules.sql
git commit -m "feat(crm): lead scoring rules, thresholds, and recompute functions"
```

---

## Task 2: Bulk-recompute Edge Function worker

**Files:**
- Create: `supabase/functions/crm-recompute-scores/index.ts`

- [ ] **Step 1: Write the worker**

```ts
// supabase/functions/crm-recompute-scores/index.ts
// Polls lead_scoring_recompute_queue and drains it via bulk_recompute_org_scores.
// Invoke via Supabase Scheduled Functions every 60 seconds, OR with a manual
// curl against /functions/v1/crm-recompute-scores for testing.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async () => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: queued, error: qErr } = await admin
    .from("lead_scoring_recompute_queue")
    .select("organization_id")
    .order("enqueued_at", { ascending: true })
    .limit(5);
  if (qErr) {
    return new Response(JSON.stringify({ ok: false, error: qErr.message }), { status: 500 });
  }

  const results: Array<{ org: string; processed: number }> = [];
  for (const row of queued || []) {
    let processed = 0;
    while (true) {
      const { data, error } = await admin.rpc("bulk_recompute_org_scores", {
        p_org: row.organization_id,
        p_batch: 500,
      });
      if (error) break;
      const n = Number(data ?? 0);
      processed += n;
      if (n < 500) break;
    }
    results.push({ org: row.organization_id, processed });
  }

  return new Response(JSON.stringify({ ok: true, processed: results }), {
    headers: { "content-type": "application/json" },
  });
});
```

- [ ] **Step 2: Deploy + schedule**

Run: `npx supabase functions deploy crm-recompute-scores`
Then schedule via the Supabase dashboard: "Schedules → Add → every 1 minute → crm-recompute-scores".

For local testing: `curl -X POST http://127.0.0.1:54321/functions/v1/crm-recompute-scores`

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/crm-recompute-scores/index.ts
git commit -m "feat(crm): bulk-recompute worker for lead scoring queue"
```

---

## Task 3: leadScoring service + tests

**Files:**
- Create: `src/services/supabase/leadScoring.ts`
- Create: `tests/unit/leadScoring.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/leadScoring.test.ts
import { describe, it, expect } from "vitest";
import {
  mapRuleRow,
  validateRuleInput,
  bandFromScore,
} from "@/services/supabase/leadScoring";

describe("leadScoring", () => {
  it("maps a rule row", () => {
    const row = {
      rule_id: "r1",
      organization_id: "o1",
      label: "Big revenue",
      field: "annual_revenue",
      operator: "gte",
      value: 1000000,
      points: 20,
      position: 1,
      enabled: true,
      created_at: "2026-05-16T00:00:00Z",
      updated_at: "2026-05-16T00:00:00Z",
    };
    const r = mapRuleRow(row);
    expect(r.field).toBe("annual_revenue");
    expect(r.points).toBe(20);
    expect(r.enabled).toBe(true);
  });

  it("rejects invalid operator", () => {
    expect(() =>
      validateRuleInput({ label: "x", field: "industry", operator: "wat" as any, value: 1, points: 5 })
    ).toThrow();
  });

  it("derives band from score and thresholds", () => {
    expect(bandFromScore(80, { hot: 70, warm: 40 })).toBe("hot");
    expect(bandFromScore(50, { hot: 70, warm: 40 })).toBe("warm");
    expect(bandFromScore(10, { hot: 70, warm: 40 })).toBe("cold");
  });
});
```

- [ ] **Step 2: Verify it fails**

Run: `npm test -- leadScoring.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the service**

```ts
// src/services/supabase/leadScoring.ts
import { supabase } from "./config";
import { logger } from "@/lib/logger";

export type ScoreBand = "hot" | "warm" | "cold";

export type ScoringField =
  | "industry" | "annual_revenue" | "employee_count" | "source"
  | "status" | "type" | "rating" | "country"
  | "recent_activity_days" | "open_deals_count" | "tag_present";

export type ScoringOperator =
  | "eq" | "neq" | "gte" | "lte" | "gt" | "lt" | "in" | "contains" | "exists";

export interface LeadScoringRule {
  ruleId: string;
  organizationId: string;
  label: string;
  field: ScoringField;
  operator: ScoringOperator;
  value: unknown;
  points: number;
  position: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Thresholds {
  hot: number;
  warm: number;
}

export const mapRuleRow = (r: Record<string, unknown>): LeadScoringRule => ({
  ruleId: r.rule_id as string,
  organizationId: r.organization_id as string,
  label: r.label as string,
  field: r.field as ScoringField,
  operator: r.operator as ScoringOperator,
  value: r.value,
  points: Number(r.points ?? 0),
  position: Number(r.position ?? 0),
  enabled: Boolean(r.enabled),
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
});

const VALID_OPERATORS: ScoringOperator[] = [
  "eq","neq","gte","lte","gt","lt","in","contains","exists",
];

const VALID_FIELDS: ScoringField[] = [
  "industry","annual_revenue","employee_count","source","status","type",
  "rating","country","recent_activity_days","open_deals_count","tag_present",
];

export interface RuleInput {
  label: string;
  field: ScoringField;
  operator: ScoringOperator;
  value: unknown;
  points: number;
  position?: number;
  enabled?: boolean;
}

export const validateRuleInput = (input: RuleInput): void => {
  if (!input.label?.trim()) throw new Error("Rule label is required");
  if (!VALID_FIELDS.includes(input.field)) throw new Error("Invalid field");
  if (!VALID_OPERATORS.includes(input.operator)) throw new Error("Invalid operator");
  if (!Number.isFinite(input.points)) throw new Error("Points must be a number");
  if (input.points < -100 || input.points > 100) throw new Error("Points out of range");
};

export const bandFromScore = (score: number, t: Thresholds): ScoreBand =>
  score >= t.hot ? "hot" : score >= t.warm ? "warm" : "cold";

export const getRules = async (organizationId: string): Promise<LeadScoringRule[]> => {
  const { data, error } = await supabase
    .from("lead_scoring_rules")
    .select("*")
    .eq("organization_id", organizationId)
    .order("position", { ascending: true });
  if (error) {
    logger.error("Failed to load lead scoring rules:", error);
    return [];
  }
  return (data || []).map(mapRuleRow);
};

export const getThresholds = async (organizationId: string): Promise<Thresholds> => {
  const { data } = await supabase
    .from("lead_scoring_thresholds")
    .select("hot, warm")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return { hot: data?.hot ?? 70, warm: data?.warm ?? 40 };
};

export const createRule = async (
  organizationId: string,
  input: RuleInput,
): Promise<LeadScoringRule> => {
  validateRuleInput(input);
  const { data, error } = await supabase
    .from("lead_scoring_rules")
    .insert({
      organization_id: organizationId,
      label: input.label.trim(),
      field: input.field,
      operator: input.operator,
      value: input.value,
      points: input.points,
      position: input.position ?? 1,
      enabled: input.enabled ?? true,
    })
    .select()
    .single();
  if (error) throw error;
  return mapRuleRow(data);
};

export const updateRule = async (
  ruleId: string,
  input: Partial<RuleInput>,
): Promise<LeadScoringRule> => {
  if (input.operator && !VALID_OPERATORS.includes(input.operator)) {
    throw new Error("Invalid operator");
  }
  const update: Record<string, unknown> = {};
  if (input.label !== undefined) update.label = input.label.trim();
  if (input.field !== undefined) update.field = input.field;
  if (input.operator !== undefined) update.operator = input.operator;
  if (input.value !== undefined) update.value = input.value;
  if (input.points !== undefined) update.points = input.points;
  if (input.position !== undefined) update.position = input.position;
  if (input.enabled !== undefined) update.enabled = input.enabled;
  const { data, error } = await supabase
    .from("lead_scoring_rules")
    .update(update)
    .eq("rule_id", ruleId)
    .select()
    .single();
  if (error) throw error;
  return mapRuleRow(data);
};

export const deleteRule = async (ruleId: string): Promise<void> => {
  const { error } = await supabase.from("lead_scoring_rules").delete().eq("rule_id", ruleId);
  if (error) throw error;
};

export const saveThresholds = async (
  organizationId: string,
  t: Thresholds,
): Promise<Thresholds> => {
  if (t.hot < t.warm) throw new Error("Hot threshold must be ≥ warm");
  const { data, error } = await supabase
    .from("lead_scoring_thresholds")
    .upsert({ organization_id: organizationId, hot: t.hot, warm: t.warm })
    .select("hot, warm")
    .single();
  if (error) throw error;
  return { hot: data.hot, warm: data.warm };
};
```

- [ ] **Step 4: Run tests**

Run: `npm test -- leadScoring.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/supabase/leadScoring.ts tests/unit/leadScoring.test.ts
git commit -m "feat(crm): lead scoring service + validation"
```

---

## Task 4: Migration 061 — duplicate detection indexes + override audit

**Files:**
- Create: `supabase/migrations/061_dup_detection_indexes.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 061_dup_detection_indexes.sql
-- Hard-block duplicate clients/contacts via partial unique indexes on normalized
-- keys. Admin override via 'dup_override' tag in clients.tags.

create or replace function public.normalize_email(e text) returns text
language sql immutable as $$
  select case
    when e is null then null
    when btrim(lower(e)) = '' then null
    else regexp_replace(btrim(lower(e)), '\+[^@]*(?=@)', '')
  end;
$$;

create or replace function public.normalize_company_name(n text) returns text
language sql immutable as $$
  select nullif(
    btrim(regexp_replace(
      regexp_replace(lower(coalesce(n,'')),
        '\m(inc|llc|ltd|gmbh|s\.a\.|pty|co|corp|corporation)\.?\M', '', 'g'),
      '\s+', ' ', 'g'
    )), ''
  );
$$;

-- Note: partial unique indexes on FUNCTIONS require the function to be IMMUTABLE.
-- Both above are declared IMMUTABLE.

-- Clean any existing pre-migration duplicates before creating the index, or the
-- migration will fail. The cleanup tags the older duplicate with dup_override so
-- it gets skipped by the index.
update public.clients c
set tags = array_append(coalesce(tags,'{}'), 'dup_override')
where exists (
  select 1 from public.clients c2
  where c2.organization_id = c.organization_id
    and c2.client_id <> c.client_id
    and public.normalize_email(c2.email) = public.normalize_email(c.email)
    and c.email is not null
    and c.created_at < c2.created_at
);

create unique index if not exists ux_clients_email_per_org
  on public.clients(organization_id, public.normalize_email(email))
  where email is not null
    and not ('dup_override' = any(tags));

-- Pre-deduplicate name+country collisions the same way.
update public.clients c
set tags = array_append(coalesce(tags,'{}'), 'dup_override')
where exists (
  select 1 from public.clients c2
  where c2.organization_id = c.organization_id
    and c2.client_id <> c.client_id
    and public.normalize_company_name(c2.name) = public.normalize_company_name(c.name)
    and coalesce(c2.country,'') = coalesce(c.country,'')
    and c.created_at < c2.created_at
);

create unique index if not exists ux_clients_name_country_per_org
  on public.clients(
    organization_id,
    public.normalize_company_name(name),
    coalesce(country,'')
  )
  where not ('dup_override' = any(tags));

create unique index if not exists ux_client_contacts_email_per_org
  on public.client_contacts(organization_id, public.normalize_email(email))
  where email is not null;

create table if not exists public.client_dup_overrides (
  override_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  client_id uuid not null references public.clients(client_id) on delete cascade,
  matched_existing_id uuid not null references public.clients(client_id) on delete cascade,
  overridden_by uuid,
  reason text,
  created_at timestamptz default now()
);

create index if not exists client_dup_overrides_org_idx
  on public.client_dup_overrides(organization_id, created_at desc);

alter table public.client_dup_overrides enable row level security;
create policy "dup overrides read for org members"
  on public.client_dup_overrides for select
  using (public.is_org_member(organization_id));
```

- [ ] **Step 2: Apply + verify**

Run: `npx supabase migration up`
Expected: completes. If you see `unique constraint violation` mid-migration, a pre-existing duplicate slipped past the cleanup — surface it: `select organization_id, public.normalize_email(email), count(*) from public.clients group by 1,2 having count(*) > 1;` then manually tag the older rows.

- [ ] **Step 3: Smoke-test from SQL**

```sql
-- First insert succeeds.
insert into public.clients (organization_id, name, email)
values ('<some-org-id>', 'Acme Corp', 'jane@acme.com');

-- Second with same email rejected.
insert into public.clients (organization_id, name, email)
values ('<some-org-id>', 'Other', 'jane@acme.com');

-- Same email but with override tag succeeds.
insert into public.clients (organization_id, name, email, tags)
values ('<some-org-id>', 'Other', 'jane@acme.com', '{dup_override}');
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/061_dup_detection_indexes.sql
git commit -m "feat(crm): duplicate-detection partial unique indexes + audit table"
```

---

## Task 5: dupDetection service

**Files:**
- Create: `src/services/supabase/dupDetection.ts`
- Create: `tests/unit/dupDetection.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/dupDetection.test.ts
import { describe, it, expect } from "vitest";
import { normalizeEmail, normalizeCompanyName } from "@/services/supabase/dupDetection";

describe("normalization", () => {
  it("lowercases and strips +tags from gmail-style addresses", () => {
    expect(normalizeEmail("Jane+marketing@Acme.com")).toBe("jane@acme.com");
    expect(normalizeEmail("  jane@acme.com  ")).toBe("jane@acme.com");
  });
  it("returns null for empty", () => {
    expect(normalizeEmail("")).toBe(null);
    expect(normalizeEmail(null)).toBe(null);
  });
  it("strips company suffixes for matching", () => {
    expect(normalizeCompanyName("Acme Corp.")).toBe("acme");
    expect(normalizeCompanyName("Acme  Inc")).toBe("acme");
    expect(normalizeCompanyName("ACME LLC")).toBe("acme");
  });
});
```

- [ ] **Step 2: Implement the service**

```ts
// src/services/supabase/dupDetection.ts
import { supabase } from "./config";
import { logger } from "@/lib/logger";

export const normalizeEmail = (e: string | null | undefined): string | null => {
  if (!e) return null;
  const trimmed = e.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.replace(/\+[^@]*(?=@)/, "");
};

const SUFFIX_RE = /\b(inc|llc|ltd|gmbh|s\.a\.|pty|co|corp|corporation)\.?\b/g;

export const normalizeCompanyName = (n: string | null | undefined): string | null => {
  if (!n) return null;
  const lowered = n.toLowerCase().replace(SUFFIX_RE, "").replace(/\s+/g, " ").trim();
  return lowered.length ? lowered : null;
};

export interface DuplicateMatch {
  clientId: string;
  name: string;
  email: string | null;
  matchedOn: "email" | "name_country";
}

export const findDuplicates = async (
  organizationId: string,
  input: { name: string; email?: string | null; country?: string | null },
): Promise<DuplicateMatch[]> => {
  const out: DuplicateMatch[] = [];
  const normEmail = normalizeEmail(input.email ?? null);
  const normName = normalizeCompanyName(input.name);

  if (normEmail) {
    const { data } = await supabase
      .from("clients")
      .select("client_id, name, email")
      .eq("organization_id", organizationId)
      .filter("email", "ilike", normEmail.replace(/[%_]/g, "\\$&"));
    for (const row of data ?? []) {
      if (normalizeEmail((row as Record<string, string>).email) === normEmail) {
        out.push({
          clientId: (row as Record<string, string>).client_id,
          name: (row as Record<string, string>).name,
          email: (row as Record<string, string>).email,
          matchedOn: "email",
        });
      }
    }
  }

  if (normName) {
    const { data } = await supabase
      .from("clients")
      .select("client_id, name, email, country")
      .eq("organization_id", organizationId);
    for (const row of data ?? []) {
      const r = row as Record<string, string>;
      if (
        normalizeCompanyName(r.name) === normName &&
        (r.country ?? "") === (input.country ?? "")
      ) {
        if (!out.some((m) => m.clientId === r.client_id)) {
          out.push({
            clientId: r.client_id,
            name: r.name,
            email: r.email,
            matchedOn: "name_country",
          });
        }
      }
    }
  }

  return out;
};

export const recordOverride = async (
  organizationId: string,
  clientId: string,
  matchedExistingId: string,
  reason: string | null,
): Promise<void> => {
  const { error } = await supabase.from("client_dup_overrides").insert({
    organization_id: organizationId,
    client_id: clientId,
    matched_existing_id: matchedExistingId,
    overridden_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    reason,
  });
  if (error) logger.warn("Failed to record dup override:", error);
};
```

- [ ] **Step 3: Run tests**

Run: `npm test -- dupDetection.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/services/supabase/dupDetection.ts tests/unit/dupDetection.test.ts
git commit -m "feat(crm): duplicate-detection helper service"
```

---

## Task 6: ClientFormDialog — inline duplicate banner

**Files:**
- Create: `src/components/clients/DuplicateBanner.tsx`
- Modify: `src/components/clients/ClientFormDialog.tsx`

- [ ] **Step 1: DuplicateBanner**

```tsx
// src/components/clients/DuplicateBanner.tsx
import React from "react";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DuplicateMatch } from "@/services/supabase/dupDetection";

interface Props {
  matches: DuplicateMatch[];
  onOpenExisting: (clientId: string) => void;
  onOverride: () => void;
}

export const DuplicateBanner: React.FC<Props> = ({ matches, onOpenExisting, onOverride }) => {
  if (matches.length === 0) return null;
  const m = matches[0];
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-destructive mt-0.5" />
        <div className="flex-1">
          <p>
            <strong>{m.name}</strong> already exists{" "}
            {m.matchedOn === "email" && m.email ? `with email ${m.email}` : "with the same company name"}.
          </p>
          <div className="flex gap-2 mt-2">
            <Button size="sm" variant="outline" onClick={() => onOpenExisting(m.clientId)}>
              <ExternalLink className="w-3 h-3 mr-1" /> View existing
            </Button>
            <Button size="sm" variant="destructive" onClick={onOverride}>
              Override duplicate
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Add duplicate check to `ClientFormDialog`**

In `src/components/clients/ClientFormDialog.tsx`:

```tsx
import { useEffect, useState } from "react";
import { findDuplicates, DuplicateMatch, recordOverride } from "@/services/supabase/dupDetection";
import { DuplicateBanner } from "./DuplicateBanner";

// inside the component:
const [matches, setMatches] = useState<DuplicateMatch[]>([]);
const [override, setOverride] = useState(false);

useEffect(() => {
  if (!organizationId || !formState.name?.trim()) {
    setMatches([]); return;
  }
  const handle = setTimeout(async () => {
    const m = await findDuplicates(organizationId, {
      name: formState.name,
      email: formState.email,
      country: formState.country,
    });
    setMatches(m);
  }, 250);
  return () => clearTimeout(handle);
}, [organizationId, formState.name, formState.email, formState.country]);

// in render, right above the buttons:
<DuplicateBanner
  matches={matches}
  onOpenExisting={(id) => { onClose(); /* parent navigates */ window.dispatchEvent(new CustomEvent("open-client", { detail: id })); }}
  onOverride={() => setOverride(true)}
/>

// in submit handler:
if (matches.length > 0 && !override) return; // banner shows; user must override
const payload = {
  ...input,
  tags: override ? Array.from(new Set([...(input.tags ?? []), "dup_override"])) : input.tags,
};
const created = await onSubmit(payload);
if (override && matches[0] && created?.clientId) {
  await recordOverride(organizationId, created.clientId, matches[0].clientId, null);
}
```

- [ ] **Step 3: Update `clients.ts` to translate the unique-constraint error**

In `src/services/supabase/clients.ts` `createClient` error branch:

```ts
if (error) {
  const code = (error as { code?: string }).code;
  const msg = String((error as { message?: string }).message ?? "");
  if (code === "23505") {
    if (msg.includes("ux_clients_email_per_org")) {
      throw new Error("A client with this email already exists. Use Override duplicate to proceed.");
    }
    if (msg.includes("ux_clients_name_country_per_org")) {
      throw new Error("A client with this name and country already exists. Use Override duplicate to proceed.");
    }
  }
  logger.error("Failed to create client:", error);
  throw error;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/clients/DuplicateBanner.tsx \
  src/components/clients/ClientFormDialog.tsx src/services/supabase/clients.ts
git commit -m "feat(crm): inline duplicate banner + override in client form"
```

---

## Task 7: ImportClientsDialog — duplicates pre-flight + per-row override

**Files:**
- Modify: `src/components/clients/ImportClientsDialog.tsx`
- Modify: `src/services/supabase/clients.ts`

- [ ] **Step 1: Extend `importClientsFromCsv` to return rejected duplicates**

In `clients.ts`, modify the function to call `findDuplicates` per row before insert. Build a third bucket on `ImportResult`:

```ts
export interface ImportResult {
  imported: Client[];
  errors: CsvRowError[];
  unknownHeaders: string[];
  missingHeaders: string[];
  rejectedDuplicates: Array<{
    row: number;
    input: CreateClientInput;
    matches: DuplicateMatch[];
  }>;
}
```

In the loop:

```ts
const dups = await findDuplicates(organizationId, {
  name: parsed.input.name,
  email: parsed.input.email,
  country: parsed.input.country,
});
if (dups.length > 0) {
  rejectedDuplicates.push({ row: i + 2, input: parsed.input, matches: dups });
  continue;
}
```

Add a new function:

```ts
export const importClientsOverrideRow = async (
  organizationId: string,
  userId: string,
  userName: string,
  input: CreateClientInput,
  matchedExistingId: string,
): Promise<Client> => {
  const payload = {
    ...input,
    tags: Array.from(new Set([...(input.tags ?? []), "dup_override"])),
  };
  const created = await createClient(organizationId, userId, userName, payload);
  await recordOverride(organizationId, created.clientId, matchedExistingId, "CSV override");
  return created;
};
```

- [ ] **Step 2: Surface in the dialog**

In `ImportClientsDialog`, after the existing imported/errors summary, render:

```tsx
{result?.rejectedDuplicates && result.rejectedDuplicates.length > 0 && (
  <div className="rounded-md border bg-amber-500/10 p-3 space-y-2">
    <p className="font-medium text-sm">Rejected: {result.rejectedDuplicates.length} duplicate(s)</p>
    {result.rejectedDuplicates.map((r) => (
      <div key={r.row} className="text-xs flex items-center gap-2">
        <span className="flex-1">
          Row {r.row}: <strong>{r.input.name}</strong> matches <strong>{r.matches[0]?.name}</strong>
        </span>
        <Button size="sm" variant="outline" onClick={async () => {
          await importClientsOverrideRow(
            organizationId, userId!, userName!, r.input, r.matches[0].clientId,
          );
          toast.success("Overridden");
        }}>
          Override and create anyway
        </Button>
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/clients/ImportClientsDialog.tsx src/services/supabase/clients.ts
git commit -m "feat(crm): CSV import shows rejected duplicates with per-row override"
```

---

## Task 8: Lead Scoring settings tab + UI

**Files:**
- Create: `src/hooks/useLeadScoringRules.ts`
- Create: `src/components/settings/LeadScoringSettingsTab.tsx`
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Hook**

```ts
// src/hooks/useLeadScoringRules.ts
import { useEffect, useState } from "react";
import { useOrganization } from "@/context/OrganizationContext";
import { LeadScoringRule, Thresholds, getRules, getThresholds } from "@/services/supabase/leadScoring";
import { supabase } from "@/services/supabase/config";

export const useLeadScoringRules = () => {
  const { organization, isOwner, isAdmin } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const [rules, setRules] = useState<LeadScoringRule[]>([]);
  const [thresholds, setThresholds] = useState<Thresholds>({ hot: 70, warm: 40 });

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    Promise.all([getRules(orgId), getThresholds(orgId)]).then(([r, t]) => {
      if (cancelled) return;
      setRules(r);
      setThresholds(t);
    });
    const channel = supabase
      .channel(`scoring-${orgId}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "lead_scoring_rules",
        filter: `organization_id=eq.${orgId}`,
      }, () => getRules(orgId).then(setRules))
      .on("postgres_changes", {
        event: "*", schema: "public", table: "lead_scoring_thresholds",
        filter: `organization_id=eq.${orgId}`,
      }, () => getThresholds(orgId).then(setThresholds))
      .subscribe();
    return () => {
      cancelled = true;
      channel.unsubscribe();
    };
  }, [orgId]);

  return { organizationId: orgId, rules, thresholds, canManage: isOwner || isAdmin };
};
```

- [ ] **Step 2: Settings tab UI**

```tsx
// src/components/settings/LeadScoringSettingsTab.tsx
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useLeadScoringRules } from "@/hooks/useLeadScoringRules";
import {
  createRule, updateRule, deleteRule, saveThresholds,
  ScoringField, ScoringOperator,
} from "@/services/supabase/leadScoring";
import { Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

const FIELDS: ScoringField[] = [
  "industry","annual_revenue","employee_count","source","status","type",
  "rating","country","recent_activity_days","open_deals_count","tag_present",
];
const OPS: ScoringOperator[] = ["eq","neq","gte","lte","gt","lt","in","contains","exists"];

export const LeadScoringSettingsTab: React.FC = () => {
  const { organizationId, rules, thresholds, canManage } = useLeadScoringRules();
  const [draftThresholds, setDraftThresholds] = useState(thresholds);
  const [adding, setAdding] = useState(false);
  const [newRule, setNewRule] = useState({
    label: "", field: "annual_revenue" as ScoringField, operator: "gte" as ScoringOperator,
    value: "1000000", points: 10,
  });

  React.useEffect(() => setDraftThresholds(thresholds), [thresholds]);

  if (!canManage) return <p className="text-sm text-muted-foreground">Only admins can manage scoring.</p>;
  if (!organizationId) return null;

  const parseValue = (v: string): unknown => {
    if (v.startsWith("[") || v.startsWith("{") || v === "true" || v === "false" || /^-?\d+(\.\d+)?$/.test(v)) {
      try { return JSON.parse(v); } catch { /* fallthrough */ }
    }
    return v;
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-end">
        <div>
          <Label>Hot ≥</Label>
          <Input type="number" value={draftThresholds.hot}
            onChange={(e) => setDraftThresholds({ ...draftThresholds, hot: Number(e.target.value) })} />
        </div>
        <div>
          <Label>Warm ≥</Label>
          <Input type="number" value={draftThresholds.warm}
            onChange={(e) => setDraftThresholds({ ...draftThresholds, warm: Number(e.target.value) })} />
        </div>
        <Button onClick={async () => {
          try { await saveThresholds(organizationId, draftThresholds); toast.success("Thresholds saved"); }
          catch (e) { toast.error(e instanceof Error ? e.message : "Save failed"); }
        }}>Save thresholds</Button>
      </div>

      <div className="space-y-2">
        {rules.map((r) => (
          <div key={r.ruleId} className="border rounded-md p-3 grid grid-cols-12 gap-2 items-end">
            <Input className="col-span-3" defaultValue={r.label} onBlur={(e) => updateRule(r.ruleId, { label: e.target.value })} />
            <Select value={r.field} onValueChange={(v) => updateRule(r.ruleId, { field: v as ScoringField })}>
              <SelectTrigger className="col-span-2"><SelectValue /></SelectTrigger>
              <SelectContent>{FIELDS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={r.operator} onValueChange={(v) => updateRule(r.ruleId, { operator: v as ScoringOperator })}>
              <SelectTrigger className="col-span-1"><SelectValue /></SelectTrigger>
              <SelectContent>{OPS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
            <Input className="col-span-3" defaultValue={JSON.stringify(r.value)} onBlur={(e) => updateRule(r.ruleId, { value: parseValue(e.target.value) })} />
            <Input className="col-span-1" type="number" defaultValue={r.points} onBlur={(e) => updateRule(r.ruleId, { points: Number(e.target.value) })} />
            <div className="col-span-1 flex items-center gap-2">
              <Switch checked={r.enabled} onCheckedChange={(v) => updateRule(r.ruleId, { enabled: v })} />
            </div>
            <Button variant="ghost" size="icon" className="col-span-1" onClick={() => deleteRule(r.ruleId)}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
      </div>

      {adding ? (
        <div className="border rounded-md p-3 grid grid-cols-12 gap-2 items-end">
          <Input className="col-span-3" placeholder="Label"
            value={newRule.label} onChange={(e) => setNewRule({ ...newRule, label: e.target.value })} />
          <Select value={newRule.field} onValueChange={(v) => setNewRule({ ...newRule, field: v as ScoringField })}>
            <SelectTrigger className="col-span-2"><SelectValue /></SelectTrigger>
            <SelectContent>{FIELDS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={newRule.operator} onValueChange={(v) => setNewRule({ ...newRule, operator: v as ScoringOperator })}>
            <SelectTrigger className="col-span-1"><SelectValue /></SelectTrigger>
            <SelectContent>{OPS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
          </Select>
          <Input className="col-span-3" placeholder='Value (JSON or string)'
            value={newRule.value} onChange={(e) => setNewRule({ ...newRule, value: e.target.value })} />
          <Input className="col-span-1" type="number"
            value={newRule.points} onChange={(e) => setNewRule({ ...newRule, points: Number(e.target.value) })} />
          <Button className="col-span-2" onClick={async () => {
            try {
              await createRule(organizationId, {
                label: newRule.label, field: newRule.field, operator: newRule.operator,
                value: parseValue(newRule.value), points: newRule.points, position: rules.length + 1,
              });
              setAdding(false);
              setNewRule({ label: "", field: "annual_revenue", operator: "gte", value: "1000000", points: 10 });
              toast.success("Rule added");
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Add failed");
            }
          }}>Add</Button>
        </div>
      ) : (
        <Button variant="outline" onClick={() => setAdding(true)}>
          <Plus className="w-4 h-4 mr-1" /> Add rule
        </Button>
      )}
    </div>
  );
};
```

- [ ] **Step 3: Wire into Settings**

`src/pages/Settings.tsx`:

```tsx
import { LeadScoringSettingsTab } from "@/components/settings/LeadScoringSettingsTab";
// in <TabsList>:
<TabsTrigger value="lead-scoring">Lead scoring</TabsTrigger>
// in TabsContent:
<TabsContent value="lead-scoring"><LeadScoringSettingsTab /></TabsContent>
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useLeadScoringRules.ts \
  src/components/settings/LeadScoringSettingsTab.tsx src/pages/Settings.tsx
git commit -m "feat(crm): lead scoring settings UI"
```

---

## Task 9: ScoreBadge + clients list integration

**Files:**
- Create: `src/components/clients/ScoreBadge.tsx`
- Modify: `src/pages/Clients.tsx`
- Modify: `src/components/clients/ClientDetailDrawer.tsx`
- Modify: `src/services/supabase/clients.ts`

- [ ] **Step 1: Expose `score`/`scoreBand` on the `Client` type**

In `src/services/supabase/clients.ts`:

```ts
export interface Client {
  // … existing fields …
  score: number;
  scoreBand: "hot" | "warm" | "cold";
}

const mapClient = (row: Record<string, unknown>): Client => ({
  // … existing fields …
  score: Number(row.score ?? 0),
  scoreBand: ((row.score_band as string) || "cold") as Client["scoreBand"],
});
```

Local-org fallback: set `score: 0, scoreBand: "cold"` on create.

- [ ] **Step 2: ScoreBadge**

```tsx
// src/components/clients/ScoreBadge.tsx
import React from "react";
import { Badge } from "@/components/ui/badge";

interface Props { score: number; band: "hot" | "warm" | "cold"; }

export const ScoreBadge: React.FC<Props> = ({ score, band }) => (
  <Badge className={
    band === "hot"
      ? "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30"
      : band === "warm"
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30"
      : "bg-muted text-muted-foreground"
  }>
    Score {score} · {band}
  </Badge>
);
```

- [ ] **Step 3: Add to client cards and detail drawer**

In `src/pages/Clients.tsx`, inside the client card's badge row:

```tsx
<ScoreBadge score={c.score} band={c.scoreBand} />
```

Add filter dropdown next to type/status:

```tsx
const [bandFilter, setBandFilter] = useState<"all" | "hot" | "warm" | "cold">("all");
// in the filter section:
<Select value={bandFilter} onValueChange={(v) => setBandFilter(v as any)}>
  <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
  <SelectContent>
    <SelectItem value="all">All scores</SelectItem>
    <SelectItem value="hot">Hot</SelectItem>
    <SelectItem value="warm">Warm</SelectItem>
    <SelectItem value="cold">Cold</SelectItem>
  </SelectContent>
</Select>
// in `filtered`:
if (bandFilter !== "all" && c.scoreBand !== bandFilter) return false;
```

In `ClientDetailDrawer`, header section:

```tsx
<ScoreBadge score={client.score} band={client.scoreBand} />
```

- [ ] **Step 4: Commit**

```bash
git add src/components/clients/ScoreBadge.tsx \
  src/services/supabase/clients.ts \
  src/pages/Clients.tsx src/components/clients/ClientDetailDrawer.tsx
git commit -m "feat(crm): score badge in clients list + drawer + filter"
```

---

## Self-review pass

1. The `recompute_client_score` function casts JSON values to numeric for `gte/lte/gt/lt`. The fallback path in the `EXCEPTION WHEN OTHERS` block prevents one malformed rule from breaking scoring. Confirm by manually inserting a rule with a string value on a numeric field and verifying other rules still apply.
2. The `client_dup_overrides` audit table records the override but the partial unique index *also* requires the new row to carry the `dup_override` tag. If the application bypasses the tag, the insert fails with `23505`. Confirm the override path in both `ClientFormDialog` and `ImportClientsDialog` always sets the tag.
3. `findDuplicates` does an `ilike` query as a coarse prefilter, then re-normalizes in JS for the final match. For very large orgs (>50k clients) this is wasteful — we'd want a Postgres function to do the normalized lookup. Defer to a v2 perf pass; flag as known.
4. The bulk-recompute worker drains one batch per HTTP invocation (called once a minute). For an org with 50k+ clients, that's ~100 minutes to fully reapply a rule edit. Acceptable for v1; revisit if customers complain.
5. The seed-on-org-insert trigger creates 8 seeded rules. If an org is created during a test, those rules show up. Make sure tests that count `lead_scoring_rules` rows for an org account for the seed.
