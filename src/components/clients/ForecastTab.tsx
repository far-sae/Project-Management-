// src/components/clients/ForecastTab.tsx
import React, { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, TrendingUp, Wallet, Trophy, Percent } from "lucide-react";
import { useOrganization } from "@/context/OrganizationContext";
import { useAuth } from "@/context/AuthContext";
import { useFxRates, convertAmount } from "@/lib/fxRates";
import {
  getOrganizationDeals,
  DEAL_STAGES,
  OPEN_STAGES,
  type Deal,
  type DealStage,
} from "@/services/supabase/deals";

import { KpiTile } from "@/components/dashboards/KpiTile";
import { ChartCard } from "@/components/dashboards/ChartCard";
import { BarHorizontal } from "@/components/dashboards/BarHorizontal";
import { TrendArea, type TrendDatum } from "@/components/dashboards/TrendArea";
import { PipelineFunnel, type FunnelDatum } from "@/components/dashboards/PipelineFunnel";

interface Props {
  displayCurrency: string;
  /** When set, restricts the forecast to deals linked to these clients
   *  (i.e. the currently selected workspace's clients). */
  restrictToClientIds?: Set<string> | null;
}

const OPEN_STAGE_SET = new Set<DealStage>(OPEN_STAGES);
const STAGE_LABEL: Record<DealStage, string> = DEAL_STAGES.reduce(
  (acc, s) => ({ ...acc, [s.id]: s.label }),
  {} as Record<DealStage, string>,
);

/** "This period" for the won/win-rate KPIs = the current calendar quarter. */
const quarterStart = (): Date => {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3);
  return new Date(now.getFullYear(), q * 3, 1);
};

export const ForecastTab: React.FC<Props> = ({ displayCurrency, restrictToClientIds }) => {
  const { organization } = useOrganization();
  const { user } = useAuth();
  const orgId =
    organization?.organizationId ??
    user?.organizationId ??
    (user?.userId ? `local-${user.userId}` : null);

  const { rates } = useFxRates();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  // Real pipeline data — read straight from getOrganizationDeals.
  useEffect(() => {
    if (!orgId) {
      setDeals([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getOrganizationDeals(orgId)
      .then((next) => {
        if (!cancelled) setDeals(next);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  // Workspace scoping: drop deals whose client is outside the active
  // workspace. Deals with no client stay (they are unscoped by definition).
  const scopedDeals = useMemo(() => {
    if (!restrictToClientIds) return deals;
    return deals.filter(
      (d) => !d.clientId || restrictToClientIds.has(d.clientId),
    );
  }, [deals, restrictToClientIds]);

  // Convert each deal value into the display currency before any summing,
  // so a mix of USD/GBP/EUR deals aggregates into one meaningful number.
  const toDisplay = useMemo(
    () =>
      (amount: number, currency: string | null | undefined) =>
        convertAmount(amount, currency ?? displayCurrency, displayCurrency, rates),
    [displayCurrency, rates],
  );

  const fmt = useMemo(() => {
    const nf = (max: number) =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: displayCurrency,
        maximumFractionDigits: max,
      });
    const full = nf(0);
    return {
      money: (v: number) => {
        try {
          return full.format(v);
        } catch {
          return `${displayCurrency} ${Math.round(v)}`;
        }
      },
      // Compact axis ticks (e.g. £12k) keep charts legible.
      compact: (v: number) => {
        const abs = Math.abs(v);
        const sym = (() => {
          try {
            const p = new Intl.NumberFormat(undefined, {
              style: "currency",
              currency: displayCurrency,
              currencyDisplay: "narrowSymbol",
            }).formatToParts(0);
            return p.find((x) => x.type === "currency")?.value ?? "";
          } catch {
            return "";
          }
        })();
        if (abs >= 1_000_000) return `${sym}${(v / 1_000_000).toFixed(1)}M`;
        if (abs >= 1_000) return `${sym}${Math.round(v / 1_000)}k`;
        return `${sym}${Math.round(v)}`;
      },
    };
  }, [displayCurrency]);

  // ── KPIs ────────────────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const open = scopedDeals.filter((d) => OPEN_STAGE_SET.has(d.stage));
    const openPipeline = open.reduce((s, d) => s + toDisplay(d.value || 0, d.currency), 0);
    const weightedForecast = open.reduce(
      (s, d) => s + toDisplay(d.value || 0, d.currency) * ((d.probability ?? 0) / 100),
      0,
    );

    const qs = quarterStart();
    const wonThisPeriod = scopedDeals.filter(
      (d) => d.stage === "won" && d.closedAt && d.closedAt >= qs,
    );
    const wonValue = wonThisPeriod.reduce((s, d) => s + toDisplay(d.value || 0, d.currency), 0);

    const closedThisPeriod = scopedDeals.filter(
      (d) => (d.stage === "won" || d.stage === "lost") && d.closedAt && d.closedAt >= qs,
    );
    const winRate =
      closedThisPeriod.length === 0
        ? null
        : (wonThisPeriod.length / closedThisPeriod.length) * 100;

    return {
      openCount: open.length,
      openPipeline,
      weightedForecast,
      wonCount: wonThisPeriod.length,
      wonValue,
      winRate,
      closedCount: closedThisPeriod.length,
    };
  }, [scopedDeals, toDisplay]);

  // ── Weighted forecast by stage (open stages only) ─────────────────────────
  const byStage = useMemo<{ name: string; value: number }[]>(() => {
    return OPEN_STAGES.map((stage) => {
      const rows = scopedDeals.filter((d) => d.stage === stage);
      const weighted = rows.reduce(
        (s, d) => s + toDisplay(d.value || 0, d.currency) * ((d.probability ?? 0) / 100),
        0,
      );
      return { name: STAGE_LABEL[stage], value: Math.round(weighted) };
    }).filter((d) => d.value > 0);
  }, [scopedDeals, toDisplay]);

  // ── Expected revenue by close month (next 6 months, weighted) ─────────────
  const byMonth = useMemo<TrendDatum[]>(() => {
    const buckets: Record<string, number> = {};
    const now = new Date();
    const order: string[] = [];
    for (let i = 0; i < 6; i++) {
      const m = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const key = format(m, "MMM yyyy");
      buckets[key] = 0;
      order.push(key);
    }
    for (const d of scopedDeals) {
      if (!d.expectedCloseDate || d.stage === "won" || d.stage === "lost") continue;
      const key = format(d.expectedCloseDate, "MMM yyyy");
      if (key in buckets) {
        buckets[key] += toDisplay(d.value || 0, d.currency) * ((d.probability ?? 0) / 100);
      }
    }
    return order.map((label) => ({ label, value: Math.round(buckets[label]) }));
  }, [scopedDeals, toDisplay]);

  // ── Pipeline funnel — stage counts + (gross) values ───────────────────────
  const funnel = useMemo<FunnelDatum[]>(() => {
    const order: DealStage[] = ["lead", "qualified", "proposal", "negotiation", "won"];
    return order.map((stage) => {
      const rows = scopedDeals.filter((d) => d.stage === stage);
      return {
        stage: STAGE_LABEL[stage],
        count: rows.length,
        value: rows.reduce((s, d) => s + toDisplay(d.value || 0, d.currency), 0),
      };
    });
  }, [scopedDeals, toDisplay]);

  if (loading) {
    return (
      <div className="flex h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading forecast…
      </div>
    );
  }

  // Empty state — no deals at all in scope.
  if (scopedDeals.length === 0) {
    return (
      <Card>
        <CardContent className="p-10 text-center space-y-2">
          <TrendingUp className="mx-auto h-9 w-9 text-orange-500" />
          <h3 className="text-base font-semibold">No deals to forecast yet</h3>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            Add deals to your pipeline and this view fills in with weighted
            forecast, expected revenue by month, and a stage funnel — all from
            your real pipeline data.
          </p>
        </CardContent>
      </Card>
    );
  }

  const hasMonthData = byMonth.some((m) => m.value > 0);

  return (
    <div className="space-y-4">
      {/* KPI tiles. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          label="Open pipeline"
          icon={Wallet}
          value={fmt.money(metrics.openPipeline)}
          hint={`${metrics.openCount} open ${metrics.openCount === 1 ? "deal" : "deals"}`}
        />
        <KpiTile
          label="Weighted forecast"
          icon={TrendingUp}
          accent
          value={fmt.money(metrics.weightedForecast)}
          hint="Σ value × probability"
        />
        <KpiTile
          label="Won this quarter"
          icon={Trophy}
          value={fmt.money(metrics.wonValue)}
          hint={`${metrics.wonCount} ${metrics.wonCount === 1 ? "deal" : "deals"} closed`}
        />
        <KpiTile
          label="Win rate"
          icon={Percent}
          value={metrics.winRate == null ? "—" : `${metrics.winRate.toFixed(0)}%`}
          hint={
            metrics.winRate == null
              ? "No closed deals this quarter"
              : `${metrics.closedCount} closed this quarter`
          }
        />
      </div>

      {/* Charts. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ChartCard
          title="Weighted forecast by stage"
          subtitle="Open deals, value × probability"
          bodyHeight="h-64"
        >
          <BarHorizontal data={byStage} valueFormatter={fmt.compact} highlightTop />
        </ChartCard>

        <ChartCard
          title="Expected revenue by close month"
          subtitle="Weighted, next 6 months"
          bodyHeight="h-64"
        >
          {hasMonthData ? (
            <TrendArea data={byMonth} primaryName="Weighted" yFormatter={fmt.compact} />
          ) : (
            <div className="grid h-full w-full place-items-center text-sm text-muted-foreground">
              No open deals with an expected close date in the next 6 months
            </div>
          )}
        </ChartCard>
      </div>

      <ChartCard
        title="Pipeline funnel"
        subtitle="Deal count and value by stage"
        bodyHeight="h-64"
      >
        <PipelineFunnel data={funnel} valueFormatter={fmt.compact} />
      </ChartCard>
    </div>
  );
};
