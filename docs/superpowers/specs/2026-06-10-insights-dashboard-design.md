# Insights dashboard — customizable widgets + AI Ask (#7)

**Date:** 2026-06-10
**Status:** Approved (design)
**Branch:** `insights-dashboard` (off `main`)

## Context

A customizable, per-user dashboard over the app's OWN data: add/arrange chart + KPI widgets, save the layout, and an AI "Ask" that turns a plain-English question into a chart + a one-line takeaway. Today's dashboards (`/dashboard/projects`, `/dashboard/clients`) are fixed recharts views with no config or AI. Built in two slices: **7a (foundation)** then **7b (AI)**. Data is the app's own data only — no external connectors. AI only ever picks from a safe metric registry (no raw SQL).

---

## Core: metric registry — `src/services/dashboards/metrics.ts` (new)

The single safe data layer powering both catalog widgets and AI widgets.

```ts
export type ChartType = 'kpi' | 'bar' | 'line' | 'donut' | 'funnel';
export type DataPoint = { label: string; value: number };          // categorical / kpi (single row)
export type SeriesPoint = { date: string; value: number };          // time series
export interface MetricDef {
  id: string;                       // stable, e.g. 'deals_by_stage'
  label: string;                    // 'Deals by stage'
  group: 'Sales' | 'Leads' | 'Tasks' | 'Money';
  chartTypes: ChartType[];          // allowed renderings
  defaultChart: ChartType;
  dimensions?: { id: string; label: string }[]; // optional group-by choices
  timeframe?: boolean;              // supports a 30d/90d/qtd/ytd window
  compute: (orgId: string, opts: { dimension?: string; timeframe?: string }) => Promise<DataPoint[] | SeriesPoint[] | number>;
}
export const METRICS: MetricDef[];  // the catalog
export const getMetric = (id: string) => METRICS.find(m => m.id === id);
```

**v1 metric set (reuse existing list services + aggregate client-side):**
- Sales: `deals_by_stage` (count, bar/donut), `deal_value_by_stage` (sum value, bar), `won_value_by_month` (line/bar, timeframe), `open_pipeline_value` (kpi), `win_rate` (kpi).
- Leads: `leads_by_category` (bar/donut), `leads_by_status` (donut), `unassigned_leads` (kpi).
- Tasks: `tasks_by_status` (donut/bar), `overdue_tasks` (kpi).
- Money: `invoices_outstanding` (kpi), `invoices_paid_by_month` (line, timeframe), `expenses_by_month` (line, timeframe).

Each `compute` calls the relevant existing service (e.g. `getOrganizationDeals`/deals list, `leads` list, `getOrganizationClientTasks`, `listOrgInvoices`, expenses list), groups, and returns the right shape. Keep them small + pure-ish (fetch + reduce). Where a service is org-wide, filter client-side. (No new queries beyond existing list fns.)

---

## SLICE 7a — Customizable dashboard

### Migration 134 — `supabase/migrations/134_dashboards.sql`
```sql
create table if not exists public.dashboards (
  dashboard_id    uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  owner_user_id   uuid not null,
  name            text not null default 'My dashboard',
  widgets         jsonb not null default '[]'::jsonb,
  is_shared       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_dashboards_org_owner on public.dashboards (organization_id, owner_user_id);
alter table public.dashboards enable row level security;
drop policy if exists "anon_no_dashboards" on public.dashboards;
create policy "anon_no_dashboards" on public.dashboards for select to anon using (false);
drop policy if exists "view_own_or_shared_dashboards" on public.dashboards;
create policy "view_own_or_shared_dashboards" on public.dashboards for select to authenticated
  using (public.is_org_member(organization_id) and (owner_user_id = auth.uid() or is_shared));
drop policy if exists "insert_own_dashboards" on public.dashboards;
create policy "insert_own_dashboards" on public.dashboards for insert to authenticated
  with check (public.is_org_member(organization_id) and owner_user_id = auth.uid());
drop policy if exists "update_own_dashboards" on public.dashboards;
create policy "update_own_dashboards" on public.dashboards for update to authenticated
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
drop policy if exists "delete_own_dashboards" on public.dashboards;
create policy "delete_own_dashboards" on public.dashboards for delete to authenticated
  using (owner_user_id = auth.uid());
```

### Widget model + service — `src/services/dashboards/dashboards.ts` (new)
```ts
export interface Widget {
  id: string;            // uuid
  metricId: string;
  title: string;
  chartType: ChartType;
  dimension?: string;
  timeframe?: string;    // '30d'|'90d'|'qtd'|'ytd'
  size: 'sm' | 'md' | 'lg';  // grid span: sm=1, md=2, lg=full
  order: number;
}
export interface Dashboard { dashboardId; organizationId; ownerUserId; name; widgets: Widget[]; isShared; ... }
export const getOrCreateMyDashboard(orgId, userId): Promise<Dashboard>;  // fetch first owned, else insert a default (a few starter widgets)
export const saveWidgets(dashboardId, widgets: Widget[]): Promise<void>;  // update widgets jsonb + updated_at
```
Pure widget helpers in `src/lib/dashboardWidgets.ts` (testable): `addWidget`, `removeWidget`, `reorderWidget(widgets, id, dir)`, `setWidgetSize`. Unit-tested.

### Page — `src/pages/dashboards/InsightsDashboard.tsx` (new), route `/dashboard/insights`
- Loads `getOrCreateMyDashboard`; renders widgets in a responsive grid (size → column span: sm = 1 col, md = 2, lg = full, on a 4-col desktop grid). Each widget runs `getMetric(w.metricId).compute(orgId, {dimension,timeframe})` (with a small loading + error state per widget) and renders via the existing components: `kpi`→`KpiTile`, `donut`→`StatusDonut`, `bar`→`BarHorizontal`/`StackedBar`, `line`→`TrendArea`, `funnel`→`PipelineFunnel` (wrapped in `ChartCard` with the widget title).
- **＋ Add widget** dialog: pick metric (grouped) → dimension (if any) → chart type (allowed) → timeframe (if supported) → title (default = metric label) → size. Appends via `addWidget` and `saveWidgets`.
- Per-widget menu: change size, reorder (↑/↓), remove — each persists via `saveWidgets` (debounced/immediate).
- Empty state: a friendly "Add your first widget" + the Add button (and, after 7b, the Ask box).
- Sidebar: add an **Insights** quick-nav entry (e.g. after CRM analytics) → `/dashboard/insights`; route under `<AppLayout>` `requireSubscription`.

### 7a testing
- Unit: `dashboardWidgets.ts` helpers (add/remove/reorder/size). 1-2 metric compute fns with a mocked service if easy (otherwise rely on build + manual).
- `npm run build` + `npm run test` green. Manual (post-migration 134): add several widgets, reorder/resize/remove, reload → layout persists.

---

## SLICE 7b — AI "Ask" (build after 7a merged)

- Edge fn `supabase/functions/dashboard-ai/index.ts` (model `claude-sonnet-4-6`, same cors/auth pattern as crm-assistant): body `{ organization_id, question }`. System prompt embeds the metric catalog (ids + labels + each metric's allowed dimensions/chartTypes/timeframe). Returns strict JSON `{ widget: { metricId, dimension?, chartType, timeframe?, title }, takeaway: string }`. Validate the returned `metricId`/`chartType`/`dimension` against the registry server-side (reject unknowns) so only safe specs come back.
- Frontend: an **"Ask AI"** input on the Insights page → calls `dashboard-ai` → renders the resulting widget (live data via the registry) with the **takeaway** under it + a **Pin** button (`addWidget` + `saveWidgets`). Sanitize/guard a bad spec (fall back to a message).
- Reuse the registry as the single source of truth so AI can't reference anything unrenderable.

---

## Non-goals
- No external data connectors, no raw SQL, no pixel drag-resize (size presets + reorder only), no cross-user dashboard sharing UI in v1 (the `is_shared` column exists for later). Existing fixed dashboards are untouched.

## Self-review
The metric registry is the keystone — one safe catalog feeds both manual and AI widgets and bounds what AI can produce. 7a is a real but contained build (migration + registry + per-user persistence + a grid page reusing existing charts). 7b layers a constrained NL→spec edge fn on top, validated against the same registry. Widget mutation logic is pure + unit-tested; rendering reuses existing recharts components.
