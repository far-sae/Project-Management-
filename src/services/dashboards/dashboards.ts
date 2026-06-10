// Per-user customizable dashboard persistence (Insights, slice 7a).
//
// Backed by the `dashboards` table (migration 134). A user has at most one
// owned dashboard surfaced by `getOrCreateMyDashboard`; the layout is a
// `widgets` jsonb array. Local-only orgs (`local-*`) fall back to
// localStorage so the page works offline / without Supabase, matching the
// pattern used across the CRM services.

import { supabase } from "@/services/supabase/config";
import { logger } from "@/lib/logger";
import type { ChartType } from "./metrics";

export interface Widget {
  id: string;
  metricId: string;
  title: string;
  chartType: ChartType;
  dimension?: string;
  timeframe?: string; // '30d' | '90d' | 'qtd' | 'ytd'
  size: "sm" | "md" | "lg"; // grid span: sm=1, md=2, lg=full
  order: number;
}

export interface Dashboard {
  dashboardId: string;
  organizationId: string;
  ownerUserId: string;
  name: string;
  widgets: Widget[];
  isShared: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const isLocalOrg = (orgId: string) => orgId.startsWith("local-");
const localKey = (orgId: string, userId: string) => `pm_dashboard_${orgId}_${userId}`;

const mapDashboard = (r: Record<string, unknown>): Dashboard => ({
  dashboardId: r.dashboard_id as string,
  organizationId: r.organization_id as string,
  ownerUserId: r.owner_user_id as string,
  name: (r.name as string) ?? "My dashboard",
  widgets: normalizeWidgets(r.widgets),
  isShared: Boolean(r.is_shared),
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
});

/** Coerce the stored jsonb into a clean Widget[] (drops malformed rows). */
const normalizeWidgets = (raw: unknown): Widget[] => {
  if (!Array.isArray(raw)) return [];
  const out: Widget[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const w = item as Record<string, unknown>;
    if (typeof w.id !== "string" || typeof w.metricId !== "string") continue;
    out.push({
      id: w.id,
      metricId: w.metricId,
      title: typeof w.title === "string" ? w.title : w.metricId,
      chartType: (w.chartType as ChartType) ?? "bar",
      dimension: typeof w.dimension === "string" ? w.dimension : undefined,
      timeframe: typeof w.timeframe === "string" ? w.timeframe : undefined,
      size: (w.size as Widget["size"]) ?? "md",
      order: typeof w.order === "number" ? w.order : out.length,
    });
  }
  return out.sort((a, b) => a.order - b.order);
};

/** The starter layout a brand-new dashboard ships with. */
export const defaultWidgets = (): Widget[] => [
  {
    id: crypto.randomUUID(),
    metricId: "open_pipeline_value",
    title: "Open pipeline value",
    chartType: "kpi",
    size: "sm",
    order: 0,
  },
  {
    id: crypto.randomUUID(),
    metricId: "deals_by_stage",
    title: "Deals by stage",
    chartType: "bar",
    size: "md",
    order: 1,
  },
  {
    id: crypto.randomUUID(),
    metricId: "tasks_by_status",
    title: "Client tasks by status",
    chartType: "donut",
    size: "md",
    order: 2,
  },
  {
    id: crypto.randomUUID(),
    metricId: "invoices_paid_by_month",
    title: "Invoices paid by month",
    chartType: "line",
    timeframe: "90d",
    size: "lg",
    order: 3,
  },
];

// ─── local-org fallback ──────────────────────────────────────────────────────

const readLocal = (orgId: string, userId: string): Dashboard | null => {
  try {
    const raw = localStorage.getItem(localKey(orgId, userId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Dashboard;
    return {
      ...d,
      widgets: normalizeWidgets(d.widgets),
      createdAt: new Date(d.createdAt),
      updatedAt: new Date(d.updatedAt),
    };
  } catch {
    return null;
  }
};

const writeLocal = (orgId: string, userId: string, d: Dashboard) => {
  try {
    localStorage.setItem(localKey(orgId, userId), JSON.stringify(d));
  } catch {
    /* ignore */
  }
};

// ─── service ─────────────────────────────────────────────────────────────────

/** Fetch the caller's first owned dashboard, or create a default one. */
export const getOrCreateMyDashboard = async (
  orgId: string,
  userId: string,
): Promise<Dashboard> => {
  if (isLocalOrg(orgId)) {
    const existing = readLocal(orgId, userId);
    if (existing) return existing;
    const now = new Date();
    const fresh: Dashboard = {
      dashboardId: crypto.randomUUID(),
      organizationId: orgId,
      ownerUserId: userId,
      name: "My dashboard",
      widgets: defaultWidgets(),
      isShared: false,
      createdAt: now,
      updatedAt: now,
    };
    writeLocal(orgId, userId, fresh);
    return fresh;
  }

  const { data, error } = await supabase
    .from("dashboards")
    .select("*")
    .eq("organization_id", orgId)
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.error("getOrCreateMyDashboard select failed:", error);
    throw error;
  }
  if (data) return mapDashboard(data as Record<string, unknown>);

  const { data: created, error: insertErr } = await supabase
    .from("dashboards")
    .insert({
      organization_id: orgId,
      owner_user_id: userId,
      name: "My dashboard",
      widgets: defaultWidgets(),
      is_shared: false,
    })
    .select()
    .single();

  if (insertErr) {
    logger.error("getOrCreateMyDashboard insert failed:", insertErr);
    throw insertErr;
  }
  return mapDashboard(created as Record<string, unknown>);
};

/** Persist the widget layout for a dashboard (updates widgets jsonb + ts). */
export const saveWidgets = async (
  dashboardId: string,
  widgets: Widget[],
  // Optional org/user lets the local-org path locate the right localStorage
  // key; ignored on the Supabase path (the row id is enough there).
  local?: { orgId: string; userId: string },
): Promise<void> => {
  if (local && isLocalOrg(local.orgId)) {
    const existing = readLocal(local.orgId, local.userId);
    const now = new Date();
    const next: Dashboard =
      existing ?? {
        dashboardId,
        organizationId: local.orgId,
        ownerUserId: local.userId,
        name: "My dashboard",
        widgets,
        isShared: false,
        createdAt: now,
        updatedAt: now,
      };
    writeLocal(local.orgId, local.userId, { ...next, widgets, updatedAt: now });
    return;
  }

  const { error } = await supabase
    .from("dashboards")
    .update({ widgets, updated_at: new Date().toISOString() })
    .eq("dashboard_id", dashboardId);
  if (error) {
    logger.error("saveWidgets failed:", error);
    throw error;
  }
};
