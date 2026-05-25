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
  /** When set, only deals whose linked client is in this set are counted.
   *  Used by the workspace-scoped Forecast tab. */
  restrictToClientIds?: Set<string> | null;
}) => {
  const { organization } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const [allRows, setAllRows] = useState<ForecastRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { rates } = useFxRates();

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    getForecastRows(orgId, params.pipelineId, params.ownerId)
      .then((next) => setAllRows(next))
      .finally(() => setLoading(false));
  }, [orgId, params.pipelineId, params.ownerId]);

  // Workspace scoping: rows for deals linked to a client outside the active
  // workspace are dropped before any aggregation runs. Deals with no
  // client_id stay visible — they are unscoped by definition.
  const rows = useMemo(() => {
    if (!params.restrictToClientIds) return allRows;
    return allRows.filter(
      (r) => !r.clientId || params.restrictToClientIds!.has(r.clientId),
    );
  }, [allRows, params.restrictToClientIds]);

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
