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
