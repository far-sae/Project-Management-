// Insights "Ask AI" client service (slice 7b).
//
// Turns a plain-English question into a CONSTRAINED widget spec + a one-line
// takeaway by calling the `dashboard-ai` edge function. The catalog the edge
// fn validates against is built HERE from the metric registry and sent with
// the request, so the edge fn never drifts from the app's known metrics.
//
// Defence in depth: even though the edge fn validates server-side, we
// re-sanitize the returned widget against `getMetric` here so a bad/unknown
// spec can never reach the render path.

import { supabase } from "@/services/supabase/config";
import { logger } from "@/lib/logger";
import { METRICS, getMetric } from "./metrics";
import type { ChartType } from "./metrics";

/** A widget spec the AI returns (a strict subset of a dashboard Widget). */
export interface AiWidgetSpec {
  metricId: string;
  chartType: ChartType;
  dimension?: string;
  timeframe?: string;
  title: string;
}

export interface AskSuccess {
  widget: AiWidgetSpec;
  takeaway: string;
}
export interface AskFailure {
  error: string;
}
export type AskResult = AskSuccess | AskFailure;

const GENERIC_ERROR =
  "Couldn't turn that into a chart — try naming a metric like \"won value by month\".";

/** Compact, JSON-serializable view of one metric for the edge prompt. */
export interface CatalogEntry {
  id: string;
  label: string;
  group: string;
  dimensions: { id: string; label: string }[];
  chartTypes: ChartType[];
  timeframe: boolean;
}

/** Build the compact catalog the edge fn validates against, from the registry. */
export const buildCatalog = (): CatalogEntry[] =>
  METRICS.map((m) => ({
    id: m.id,
    label: m.label,
    group: m.group,
    dimensions: m.dimensions ?? [],
    chartTypes: m.chartTypes,
    timeframe: Boolean(m.timeframe),
  }));

/**
 * Re-validate a returned widget against the live registry. Returns a clean
 * spec or null if anything is off (unknown metric, disallowed chart type,
 * unknown dimension, timeframe on a non-timeframe metric).
 */
const sanitizeWidget = (raw: unknown): AiWidgetSpec | null => {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Record<string, unknown>;
  const metricId = typeof w.metricId === "string" ? w.metricId : "";
  const metric = getMetric(metricId);
  if (!metric) return null;

  const chartType = w.chartType as ChartType;
  if (!metric.chartTypes.includes(chartType)) return null;

  let dimension: string | undefined;
  if (typeof w.dimension === "string" && w.dimension.length > 0) {
    if (!metric.dimensions?.some((d) => d.id === w.dimension)) return null;
    dimension = w.dimension;
  }

  let timeframe: string | undefined;
  if (typeof w.timeframe === "string" && w.timeframe.length > 0) {
    if (!metric.timeframe) return null;
    timeframe = w.timeframe;
  }

  const title =
    typeof w.title === "string" && w.title.trim().length > 0
      ? w.title.trim().slice(0, 80)
      : metric.label;

  return { metricId, chartType, dimension, timeframe, title };
};

const isFailure = (r: AskResult): r is AskFailure =>
  (r as AskFailure).error !== undefined;

/**
 * Ask the AI to turn `question` into a renderable widget spec + takeaway.
 * Always resolves; failures come back as `{ error }`.
 */
export const askDashboardAI = async (
  orgId: string,
  question: string,
): Promise<AskResult> => {
  if (!orgId || !question.trim()) return { error: GENERIC_ERROR };

  try {
    const { data, error } = await supabase.functions.invoke("dashboard-ai", {
      body: {
        organization_id: orgId,
        question: question.trim(),
        catalog: buildCatalog(),
      },
    });

    const payload = data as Partial<AskSuccess & AskFailure> | null;

    if (payload && typeof payload.error === "string" && payload.error.trim()) {
      // Surface a friendly, actionable message rather than the raw server text.
      return { error: GENERIC_ERROR };
    }

    if (error) {
      logger.warn("dashboard-ai invoke error:", error);
      return { error: GENERIC_ERROR };
    }

    const widget = sanitizeWidget(payload?.widget);
    if (!widget) return { error: GENERIC_ERROR };

    const takeaway =
      typeof payload?.takeaway === "string" ? payload.takeaway.trim() : "";

    return { widget, takeaway };
  } catch (e) {
    logger.warn("askDashboardAI failed:", e);
    return { error: GENERIC_ERROR };
  }
};

export { isFailure };
