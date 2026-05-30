# CRM Plan 3 — Analytics (Forecasting + Activity Timeline)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A forecasting dashboard with monthly + quarterly buckets filterable by pipeline and owner, and a unified activity timeline that lives both inside `ClientDetailDrawer` (per-client) and on a new top-level `/clients/activity` page (org-wide).

**Architecture:** No new base tables. One SQL view (`crm_activity_v`) unions four existing tables. Forecasting reads from `deals + pipeline_stages` directly via a service-layer aggregator that respects the same currency-conversion pattern already in `src/pages/Clients.tsx`. The activity timeline component is reused across the drawer and the org-wide page.

**Tech Stack:** Same as Plan 1. Recharts already in dependencies.

**Depends on:** Plan 1 (pipelines/stages) and Plan 4 (`form_submissions` table). If running before Plan 4, omit the `form_submission` leg of the view; add it back when Plan 4 lands.

---

## File Structure

**Created:**
- `supabase/migrations/063_org_activity_views.sql`
- `src/services/supabase/forecast.ts`
- `src/services/supabase/activityFeed.ts`
- `src/hooks/useForecast.ts`
- `src/hooks/useActivity.ts`
- `src/components/clients/ForecastTab.tsx`
- `src/components/clients/ActivityTimeline.tsx`
- `src/pages/ClientsActivity.tsx`
- `tests/unit/forecast.test.ts`

**Modified:**
- `src/components/clients/ClientDetailDrawer.tsx` — add "Activity" tab
- `src/pages/Clients.tsx` — add "Forecast" tab
- `src/App.tsx` — register `/clients/activity` route

---

## Task 1: Migration 063 — activity view

**Files:**
- Create: `supabase/migrations/063_org_activity_views.sql`

- [ ] **Step 1: Write the migration**

```sql
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
    case when t.done then 'completed' else 'created' end,
    t.title,
    null,
    coalesce(t.completed_at, t.created_at)
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
```

- [ ] **Step 2: Apply**

Run: `npx supabase migration up`
Expected: view created. Spot-check: `select event_type, count(*) from public.crm_activity_v group by 1;` — every leg returns counts.

- [ ] **Step 3: Confirm column types**

Run: `select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = 'crm_activity_v' order by ordinal_position;`
Expected: `event_type text`, `organization_id uuid`, `client_id uuid`, `deal_id uuid`, `actor_id uuid`, `actor_name text`, `subtype text`, `title text`, `body text`, `occurred_at timestamptz`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/063_org_activity_views.sql
git commit -m "feat(crm): unified activity view across notes/deals/tasks/forms"
```

---

## Task 2: forecast service + test

**Files:**
- Create: `src/services/supabase/forecast.ts`
- Create: `tests/unit/forecast.test.ts`

- [ ] **Step 1: Write the failing test (pure-function aggregator)**

```ts
// tests/unit/forecast.test.ts
import { describe, it, expect } from "vitest";
import {
  aggregateForecast,
  ForecastRow,
} from "@/services/supabase/forecast";

const r = (over: Partial<ForecastRow>): ForecastRow => ({
  organizationId: "o1",
  pipelineId: "p1",
  ownerId: "u1",
  ownerName: "Faraz",
  currency: "USD",
  monthBucket: "2026-05",
  value: 0,
  weightedValue: 0,
  isWon: false,
  isLost: false,
  stageKey: "lead",
  ...over,
});

describe("aggregateForecast", () => {
  it("buckets committed vs best-case vs pipeline", () => {
    const rows: ForecastRow[] = [
      r({ value: 100, weightedValue: 100, isWon: true,  monthBucket: "2026-05" }),
      r({ value: 200, weightedValue: 100, isWon: false, monthBucket: "2026-05" }),
      r({ value: 50,  weightedValue: 25,  isWon: false, monthBucket: "2026-06" }),
    ];
    const out = aggregateForecast(rows, { months: ["2026-05", "2026-06"] });
    expect(out["2026-05"].committed).toBe(100);
    expect(out["2026-05"].bestCase).toBe(100);
    expect(out["2026-05"].pipeline).toBe(200);
    expect(out["2026-06"].pipeline).toBe(50);
  });

  it("ignores months outside range", () => {
    const rows = [r({ value: 999, monthBucket: "2025-01" })];
    const out = aggregateForecast(rows, { months: ["2026-05"] });
    expect(out["2026-05"].pipeline).toBe(0);
  });
});
```

- [ ] **Step 2: Verify it fails**

Run: `npm test -- forecast.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the service**

```ts
// src/services/supabase/forecast.ts
import { supabase } from "./config";
import { logger } from "@/lib/logger";

export interface ForecastRow {
  organizationId: string;
  pipelineId: string;
  ownerId: string | null;
  ownerName: string | null;
  currency: string;
  monthBucket: string;            // 'YYYY-MM'
  value: number;
  weightedValue: number;
  isWon: boolean;
  isLost: boolean;
  stageKey: string;
}

const mapForecastRow = (r: Record<string, unknown>): ForecastRow => ({
  organizationId: r.organization_id as string,
  pipelineId: r.pipeline_id as string,
  ownerId: (r.owner_id as string) ?? null,
  ownerName: (r.owner_name as string) ?? null,
  currency: (r.currency as string)?.toUpperCase() ?? "USD",
  monthBucket: r.month_bucket as string,
  value: Number(r.value ?? 0),
  weightedValue: Number(r.weighted_value ?? 0),
  isWon: Boolean(r.is_won),
  isLost: Boolean(r.is_lost),
  stageKey: (r.stage as string) ?? "",
});

export const getForecastRows = async (
  organizationId: string,
  pipelineId: string | null,
  ownerId: string | null,
): Promise<ForecastRow[]> => {
  let q = supabase
    .from("deal_forecast_v")
    .select("*")
    .eq("organization_id", organizationId);
  if (pipelineId) q = q.eq("pipeline_id", pipelineId);
  if (ownerId) q = q.eq("owner_id", ownerId);
  const { data, error } = await q;
  if (error) {
    logger.error("Failed to load forecast rows:", error);
    return [];
  }
  return (data || []).map(mapForecastRow);
};

export interface ForecastBucket {
  committed: number;
  bestCase: number;
  pipeline: number;
}

export interface AggregateOptions {
  months: string[];   // ordered YYYY-MM strings
  fxRate?: Record<string, number>;  // currency -> rate-to-display-currency
}

export const aggregateForecast = (
  rows: ForecastRow[],
  opts: AggregateOptions,
): Record<string, ForecastBucket> => {
  const monthSet = new Set(opts.months);
  const out: Record<string, ForecastBucket> = {};
  for (const m of opts.months) out[m] = { committed: 0, bestCase: 0, pipeline: 0 };
  for (const row of rows) {
    if (!monthSet.has(row.monthBucket)) continue;
    const fx = opts.fxRate?.[row.currency] ?? 1;
    const v = row.value * fx;
    const w = row.weightedValue * fx;
    if (row.isWon) {
      out[row.monthBucket].committed += v;
    } else {
      out[row.monthBucket].bestCase += w;
      out[row.monthBucket].pipeline += v;
    }
  }
  return out;
};

export const buildMonthRange = (
  period: "month" | "quarter" | "next_quarter",
  ref: Date = new Date(),
): string[] => {
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const months: string[] = [];
  const start = new Date(ref.getFullYear(), ref.getMonth(), 1);
  if (period === "month") {
    months.push(fmt(start));
  } else {
    const q = Math.floor(start.getMonth() / 3);
    const offset = period === "next_quarter" ? 1 : 0;
    const qStart = new Date(start.getFullYear(), (q + offset) * 3, 1);
    for (let i = 0; i < 3; i++) {
      months.push(fmt(new Date(qStart.getFullYear(), qStart.getMonth() + i, 1)));
    }
  }
  return months;
};
```

- [ ] **Step 4: Add `deal_forecast_v` to migration 059**

Append to `supabase/migrations/059_deal_pipeline_link_and_stage_gating.sql`:

```sql
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
```

Re-apply migrations: `npx supabase db reset` (or run migration up if the file modification is detected — Supabase CLI handles it).

- [ ] **Step 5: Run tests**

Run: `npm test -- forecast.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/supabase/forecast.ts tests/unit/forecast.test.ts \
  supabase/migrations/059_deal_pipeline_link_and_stage_gating.sql
git commit -m "feat(crm): forecast service + deal_forecast_v view"
```

---

## Task 3: useForecast hook

**Files:**
- Create: `src/hooks/useForecast.ts`

- [ ] **Step 1: Write the hook**

```ts
// src/hooks/useForecast.ts
import { useEffect, useMemo, useState } from "react";
import { useOrganization } from "@/context/OrganizationContext";
import {
  ForecastRow, ForecastBucket,
  aggregateForecast, buildMonthRange, getForecastRows,
} from "@/services/supabase/forecast";
import { useFxRates } from "@/lib/fxRates";

export type ForecastPeriod = "month" | "quarter" | "next_quarter";

export const useForecast = (params: {
  pipelineId: string | null;
  ownerId: string | null;
  period: ForecastPeriod;
  displayCurrency: string;
}) => {
  const { organization } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const [rows, setRows] = useState<ForecastRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { rates } = useFxRates();

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    getForecastRows(orgId, params.pipelineId, params.ownerId)
      .then((next) => setRows(next))
      .finally(() => setLoading(false));
  }, [orgId, params.pipelineId, params.ownerId]);

  const months = useMemo(() => buildMonthRange(params.period), [params.period]);

  const fxRate = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    const target = params.displayCurrency.toUpperCase();
    for (const cur of Array.from(new Set(rows.map((r) => r.currency)))) {
      const from = rates?.[cur] ?? 1;
      const to = rates?.[target] ?? 1;
      out[cur] = to / from;
    }
    return out;
  }, [rows, rates, params.displayCurrency]);

  const buckets = useMemo(
    () => aggregateForecast(rows, { months, fxRate }),
    [rows, months, fxRate],
  );

  const totals = useMemo<ForecastBucket>(() => {
    return Object.values(buckets).reduce(
      (acc, b) => ({
        committed: acc.committed + b.committed,
        bestCase: acc.bestCase + b.bestCase,
        pipeline: acc.pipeline + b.pipeline,
      }),
      { committed: 0, bestCase: 0, pipeline: 0 },
    );
  }, [buckets]);

  const byOwner = useMemo(() => {
    const map = new Map<string, { name: string; b: ForecastBucket }>();
    for (const row of rows) {
      if (!months.includes(row.monthBucket)) continue;
      const key = row.ownerId ?? "unassigned";
      const fx = fxRate[row.currency] ?? 1;
      const v = row.value * fx;
      const w = row.weightedValue * fx;
      const existing = map.get(key) ?? {
        name: row.ownerName ?? "Unassigned",
        b: { committed: 0, bestCase: 0, pipeline: 0 },
      };
      if (row.isWon) existing.b.committed += v;
      else { existing.b.bestCase += w; existing.b.pipeline += v; }
      map.set(key, existing);
    }
    return Array.from(map.entries()).map(([id, v]) => ({
      ownerId: id, name: v.name, ...v.b,
    }));
  }, [rows, months, fxRate]);

  return { loading, months, buckets, totals, byOwner };
};
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useForecast.ts
git commit -m "feat(crm): useForecast hook"
```

---

## Task 4: ForecastTab component

**Files:**
- Create: `src/components/clients/ForecastTab.tsx`
- Modify: `src/pages/Clients.tsx`

- [ ] **Step 1: ForecastTab**

```tsx
// src/components/clients/ForecastTab.tsx
import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useForecast, ForecastPeriod } from "@/hooks/useForecast";
import { usePipelines } from "@/hooks/usePipelines";
import { formatDealMoney } from "@/services/supabase/deals";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from "recharts";

interface Props {
  displayCurrency: string;
}

export const ForecastTab: React.FC<Props> = ({ displayCurrency }) => {
  const { pipelines, defaultPipeline } = usePipelines();
  const [pipelineId, setPipelineId] = useState<string>("all");
  const [ownerId, setOwnerId] = useState<string>("all");
  const [period, setPeriod] = useState<ForecastPeriod>("quarter");

  const { loading, months, buckets, totals, byOwner } = useForecast({
    pipelineId: pipelineId === "all" ? null : pipelineId,
    ownerId: ownerId === "all" ? null : ownerId,
    period,
    displayCurrency,
  });

  const chartData = months.map((m) => ({
    month: m,
    Committed: Math.round(buckets[m]?.committed ?? 0),
    "Best case": Math.round(buckets[m]?.bestCase ?? 0),
    Pipeline: Math.round(buckets[m]?.pipeline ?? 0),
  }));

  const owners = Array.from(new Map(byOwner.map((o) => [o.ownerId, o.name])).entries());

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4 flex flex-wrap gap-3 items-end">
          <div>
            <Label>Pipeline</Label>
            <Select value={pipelineId} onValueChange={setPipelineId}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All pipelines</SelectItem>
                {pipelines.map((p) => (
                  <SelectItem key={p.pipelineId} value={p.pipelineId}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Owner</Label>
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All owners</SelectItem>
                {owners.map(([id, name]) => (
                  <SelectItem key={id} value={id}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Period</Label>
            <Select value={period} onValueChange={(v) => setPeriod(v as ForecastPeriod)}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="month">This month</SelectItem>
                <SelectItem value="quarter">This quarter</SelectItem>
                <SelectItem value="next_quarter">Next quarter</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-3">
        {(["committed", "bestCase", "pipeline"] as const).map((k) => (
          <Card key={k}>
            <CardContent className="pt-4">
              <p className="text-xs uppercase text-muted-foreground tracking-wide">
                {k === "committed" ? "Committed" : k === "bestCase" ? "Best case" : "Pipeline"}
              </p>
              <p className="text-2xl font-bold">{formatDealMoney(totals[k], displayCurrency)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="pt-4 h-72">
          {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="Committed" stackId="a" fill="#10B981" />
                <Bar dataKey="Best case" stackId="a" fill="#3B82F6" />
                <Bar dataKey="Pipeline"  stackId="a" fill="#9CA3AF" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left p-1">Owner</th>
                <th className="text-right p-1">Committed</th>
                <th className="text-right p-1">Best case</th>
                <th className="text-right p-1">Pipeline</th>
              </tr>
            </thead>
            <tbody>
              {byOwner.map((o) => (
                <tr key={o.ownerId}>
                  <td className="p-1">{o.name}</td>
                  <td className="p-1 text-right">{formatDealMoney(o.committed, displayCurrency)}</td>
                  <td className="p-1 text-right">{formatDealMoney(o.bestCase, displayCurrency)}</td>
                  <td className="p-1 text-right">{formatDealMoney(o.pipeline, displayCurrency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
};
```

- [ ] **Step 2: Add Forecast tab to Clients page**

In `src/pages/Clients.tsx`, add to `<TabsList>`:

```tsx
<TabsTrigger value="forecast">
  <Coins className="w-4 h-4 mr-1.5" /> Forecast
</TabsTrigger>
```

And as a new `<TabsContent>`:

```tsx
<TabsContent value="forecast" className="mt-4">
  <ForecastTab displayCurrency={effectivePipelineCurrency} />
</TabsContent>
```

Import: `import { ForecastTab } from "@/components/clients/ForecastTab";`

- [ ] **Step 3: Commit**

```bash
git add src/components/clients/ForecastTab.tsx src/pages/Clients.tsx
git commit -m "feat(crm): forecast tab on Clients page"
```

---

## Task 5: Activity feed service + hook

**Files:**
- Create: `src/services/supabase/activityFeed.ts`
- Create: `src/hooks/useActivity.ts`

- [ ] **Step 1: Service**

```ts
// src/services/supabase/activityFeed.ts
import { supabase } from "./config";
import { logger } from "@/lib/logger";

export type ActivityEventType = "note" | "deal_stage" | "task" | "form_submission";

export interface ActivityEvent {
  eventType: ActivityEventType;
  organizationId: string;
  clientId: string | null;
  dealId: string | null;
  actorId: string | null;
  actorName: string | null;
  subtype: string | null;
  title: string;
  body: string | null;
  occurredAt: Date;
}

const mapRow = (r: Record<string, unknown>): ActivityEvent => ({
  eventType: r.event_type as ActivityEventType,
  organizationId: r.organization_id as string,
  clientId: (r.client_id as string) ?? null,
  dealId: (r.deal_id as string) ?? null,
  actorId: (r.actor_id as string) ?? null,
  actorName: (r.actor_name as string) ?? null,
  subtype: (r.subtype as string) ?? null,
  title: r.title as string,
  body: (r.body as string) ?? null,
  occurredAt: new Date(r.occurred_at as string),
});

export interface ActivityQuery {
  organizationId: string;
  clientId?: string;
  eventTypes?: ActivityEventType[];
  actorId?: string;
  fromDate?: Date;
  toDate?: Date;
  beforeCursor?: Date;
  limit?: number;
}

export const queryActivity = async (q: ActivityQuery): Promise<ActivityEvent[]> => {
  let query = supabase
    .from("crm_activity_v")
    .select("*")
    .eq("organization_id", q.organizationId)
    .order("occurred_at", { ascending: false })
    .limit(q.limit ?? 50);

  if (q.clientId) query = query.eq("client_id", q.clientId);
  if (q.eventTypes?.length) query = query.in("event_type", q.eventTypes);
  if (q.actorId) query = query.eq("actor_id", q.actorId);
  if (q.fromDate) query = query.gte("occurred_at", q.fromDate.toISOString());
  if (q.toDate) query = query.lte("occurred_at", q.toDate.toISOString());
  if (q.beforeCursor) query = query.lt("occurred_at", q.beforeCursor.toISOString());

  const { data, error } = await query;
  if (error) {
    logger.error("Failed to load activity:", error);
    return [];
  }
  return (data || []).map(mapRow);
};
```

- [ ] **Step 2: Hook**

```ts
// src/hooks/useActivity.ts
import { useCallback, useEffect, useState } from "react";
import { useOrganization } from "@/context/OrganizationContext";
import {
  ActivityEvent, ActivityEventType,
  queryActivity,
} from "@/services/supabase/activityFeed";
import { supabase } from "@/services/supabase/config";

export interface UseActivityParams {
  clientId?: string;
  eventTypes?: ActivityEventType[];
  actorId?: string;
  fromDate?: Date;
  toDate?: Date;
}

export const useActivity = (params: UseActivityParams) => {
  const { organization } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);

  const loadFirstPage = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const next = await queryActivity({
      organizationId: orgId,
      clientId: params.clientId,
      eventTypes: params.eventTypes,
      actorId: params.actorId,
      fromDate: params.fromDate,
      toDate: params.toDate,
      limit: 50,
    });
    setEvents(next);
    setHasMore(next.length === 50);
    setLoading(false);
  }, [orgId, params.clientId, params.eventTypes?.join(","), params.actorId, params.fromDate?.toISOString(), params.toDate?.toISOString()]);

  useEffect(() => { loadFirstPage(); }, [loadFirstPage]);

  // Realtime: any insert into the base tables triggers a refetch of the first
  // page. Cheap and avoids merging in delta logic for v1.
  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`activity-${orgId}-${Math.random().toString(36).slice(2, 9)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "client_notes",
        filter: `organization_id=eq.${orgId}` }, loadFirstPage)
      .on("postgres_changes", { event: "*", schema: "public", table: "deals",
        filter: `organization_id=eq.${orgId}` }, loadFirstPage)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "client_tasks",
        filter: `organization_id=eq.${orgId}` }, loadFirstPage)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "form_submissions",
        filter: `organization_id=eq.${orgId}` }, loadFirstPage)
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [orgId, loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (!orgId || !events.length || !hasMore) return;
    const cursor = events[events.length - 1].occurredAt;
    const next = await queryActivity({
      organizationId: orgId,
      clientId: params.clientId,
      eventTypes: params.eventTypes,
      actorId: params.actorId,
      fromDate: params.fromDate,
      toDate: params.toDate,
      beforeCursor: cursor,
      limit: 50,
    });
    setEvents((prev) => [...prev, ...next]);
    setHasMore(next.length === 50);
  }, [orgId, events, hasMore, params.clientId, params.eventTypes?.join(","), params.actorId, params.fromDate?.toISOString(), params.toDate?.toISOString()]);

  return { events, loading, hasMore, loadMore };
};
```

- [ ] **Step 3: Commit**

```bash
git add src/services/supabase/activityFeed.ts src/hooks/useActivity.ts
git commit -m "feat(crm): activity feed service + hook"
```

---

## Task 6: ActivityTimeline component

**Files:**
- Create: `src/components/clients/ActivityTimeline.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/components/clients/ActivityTimeline.tsx
import React from "react";
import { StickyNote, GitBranch, CheckSquare, MailPlus, Loader2 } from "lucide-react";
import { ActivityEvent } from "@/services/supabase/activityFeed";
import { useActivity, UseActivityParams } from "@/hooks/useActivity";
import { Button } from "@/components/ui/button";

const ICON: Record<ActivityEvent["eventType"], React.FC<{ className?: string }>> = {
  note: StickyNote,
  deal_stage: GitBranch,
  task: CheckSquare,
  form_submission: MailPlus,
};

const formatDateTime = (d: Date) =>
  d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

interface Props extends UseActivityParams {
  emptyHint?: string;
}

export const ActivityTimeline: React.FC<Props> = (props) => {
  const { events, loading, hasMore, loadMore } = useActivity(props);

  if (loading && !events.length) {
    return (
      <p className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading activity…
      </p>
    );
  }
  if (!events.length) {
    return (
      <p className="text-sm text-muted-foreground">
        {props.emptyHint ?? "No activity yet."}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {events.map((e, i) => {
        const Icon = ICON[e.eventType] ?? StickyNote;
        return (
          <div key={i} className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
              <Icon className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm">{e.title}</p>
              <p className="text-xs text-muted-foreground">
                {e.actorName ? `${e.actorName} · ` : ""}
                {formatDateTime(e.occurredAt)}
                {e.subtype ? ` · ${e.subtype}` : ""}
              </p>
              {e.body && (
                <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{e.body}</p>
              )}
            </div>
          </div>
        );
      })}
      {hasMore && (
        <Button variant="outline" size="sm" onClick={loadMore}>
          Load more
        </Button>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add src/components/clients/ActivityTimeline.tsx
git commit -m "feat(crm): ActivityTimeline component"
```

---

## Task 7: Add Activity tab to ClientDetailDrawer

**Files:**
- Modify: `src/components/clients/ClientDetailDrawer.tsx`

- [ ] **Step 1: Add the tab**

Find the existing tabs in `ClientDetailDrawer`. Add a new trigger and content:

```tsx
import { ActivityTimeline } from "./ActivityTimeline";

// in TabsList:
<TabsTrigger value="activity">Activity</TabsTrigger>

// in TabsContent:
<TabsContent value="activity" className="mt-4">
  <ActivityTimeline
    clientId={client.clientId}
    emptyHint="No notes, deal moves, tasks, or form submissions yet."
  />
</TabsContent>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/clients/ClientDetailDrawer.tsx
git commit -m "feat(crm): per-client activity tab in drawer"
```

---

## Task 8: Org-wide /clients/activity page

**Files:**
- Create: `src/pages/ClientsActivity.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: ClientsActivity page**

```tsx
// src/pages/ClientsActivity.tsx
import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ActivityTimeline } from "@/components/clients/ActivityTimeline";
import { ActivityEventType } from "@/services/supabase/activityFeed";

const EVENT_OPTIONS: { value: ActivityEventType | "all"; label: string }[] = [
  { value: "all", label: "All events" },
  { value: "note", label: "Notes" },
  { value: "deal_stage", label: "Deal stage changes" },
  { value: "task", label: "Tasks" },
  { value: "form_submission", label: "Form submissions" },
];

export const ClientsActivity: React.FC = () => {
  const [eventFilter, setEventFilter] = useState<ActivityEventType | "all">("all");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  return (
    <main className="flex-1 min-w-0 overflow-y-auto p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-4">
        <h1 className="text-2xl md:text-3xl font-bold">Recent activity</h1>

        <Card>
          <CardContent className="pt-4 flex flex-wrap gap-3 items-end">
            <div>
              <Label>Event type</Label>
              <Select value={eventFilter} onValueChange={(v) => setEventFilter(v as ActivityEventType | "all")}>
                <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EVENT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <Label>To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <ActivityTimeline
              eventTypes={eventFilter === "all" ? undefined : [eventFilter]}
              fromDate={from ? new Date(from + "T00:00:00") : undefined}
              toDate={to ? new Date(to + "T23:59:59") : undefined}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
};

export default ClientsActivity;
```

- [ ] **Step 2: Register the route**

In `src/App.tsx`, inside the authenticated routes block:

```tsx
import { ClientsActivity } from "@/pages/ClientsActivity";
// alongside other Clients routes:
<Route path="/clients/activity" element={<ClientsActivity />} />
```

- [ ] **Step 3: Add a link from the Clients page header**

In `src/pages/Clients.tsx`, in the header action button row:

```tsx
<Button variant="outline" asChild>
  <a href="/clients/activity">Recent activity</a>
</Button>
```

(Or use `<Link>` from `react-router-dom` for consistency with other internal nav.)

- [ ] **Step 4: Commit**

```bash
git add src/pages/ClientsActivity.tsx src/App.tsx src/pages/Clients.tsx
git commit -m "feat(crm): org-wide /clients/activity page"
```

---

## Self-review pass

1. The `crm_activity_v` view references `form_submissions`, which is created in Plan 4 (migration 062). Confirm Plan 4 is applied before this view is created; if not, comment out the last UNION ALL block until 062 lands. The migration file does NOT need to be re-applied — it's recreated as a view, so a follow-up CREATE OR REPLACE VIEW once 062 exists is enough.
2. The view inherits RLS from its base tables. Confirm that `client_notes`, `deals`, `client_tasks`, and `form_submissions` all have RLS policies that scope by `organization_id`. If any one is missing a policy, the view will leak rows. (Plan 4 establishes RLS on `form_submissions`; the rest already have it from earlier migrations 041 and 045.)
3. The activity hook re-queries the first page on any realtime event. For an org with high event volume that could mean N requests per second. Spec accepts this for v1; revisit if perceived lag.
4. The `useForecast` hook computes FX conversion using `useFxRates()` from `src/lib/fxRates`. Confirm the rates dictionary uses currency codes as keys and that the conversion divides target by source (lines 28-37 of `useForecast.ts`).
5. `formatDealMoney` is exported from `src/services/supabase/deals.ts`. Confirm it accepts `(amount: number, currency: string)`.
