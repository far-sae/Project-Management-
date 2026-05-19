import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { subDays, differenceInDays, format } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ArrowRight, Users, Loader2, AlertTriangle } from 'lucide-react';
import { useClients } from '@/hooks/useClients';
import { useDeals } from '@/hooks/useDeals';
import { useClientTasks } from '@/hooks/useClientTasks';
import { useFormatMoney } from '@/hooks/useFormatMoney';

import { KpiTile } from '@/components/dashboards/KpiTile';
import { ChartCard } from '@/components/dashboards/ChartCard';
import { StatusDonut, DonutLegend, type DonutDatum } from '@/components/dashboards/StatusDonut';
import { TrendArea, type TrendDatum } from '@/components/dashboards/TrendArea';
import { BarHorizontal } from '@/components/dashboards/BarHorizontal';
import { PipelineFunnel } from '@/components/dashboards/PipelineFunnel';
import { palette } from '@/components/dashboards/palette';

type Range = '30d' | '90d' | 'qtd' | 'ytd';
const rangeStart = (r: Range): Date => {
  const now = new Date();
  if (r === '30d') return subDays(now, 30);
  if (r === '90d') return subDays(now, 90);
  if (r === 'qtd') {
    const q = Math.floor(now.getMonth() / 3);
    return new Date(now.getFullYear(), q * 3, 1);
  }
  return new Date(now.getFullYear(), 0, 1);
};

const OPEN_STAGES = new Set(['lead', 'qualified', 'proposal', 'negotiation']);

const STAGE_LABEL: Record<string, string> = {
  lead: 'Lead',
  qualified: 'Qualified',
  proposal: 'Proposal',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
};

export const ClientsDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { clients, loading: clientsLoading } = useClients();
  const { deals, loading: dealsLoading } = useDeals();
  const { allTasks: clientTasks } = useClientTasks();
  const fmtMoney = useFormatMoney();

  const [range, setRange] = useState<Range>('30d');
  const rs = rangeStart(range);
  const prevDays = differenceInDays(new Date(), rs);
  const prevStart = subDays(rs, prevDays);

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const openDeals = deals.filter((d) => OPEN_STAGES.has(d.stage));
  const openValue = openDeals.reduce((s, d) => s + (d.value || 0), 0);

  const wonInRange = deals.filter(
    (d) => d.stage === 'won' && d.closedAt && d.closedAt >= rs,
  );
  const wonInPrev = deals.filter(
    (d) => d.stage === 'won' && d.closedAt && d.closedAt >= prevStart && d.closedAt < rs,
  );
  const wonValue = wonInRange.reduce((s, d) => s + (d.value || 0), 0);
  const wonValuePrev = wonInPrev.reduce((s, d) => s + (d.value || 0), 0);
  const wonValueDelta =
    wonValuePrev === 0 ? null : ((wonValue - wonValuePrev) / wonValuePrev) * 100;

  const closedInRange = deals.filter(
    (d) =>
      (d.stage === 'won' || d.stage === 'lost') &&
      d.closedAt && d.closedAt >= rs,
  );
  const winRate =
    closedInRange.length === 0
      ? 0
      : (closedInRange.filter((d) => d.stage === 'won').length / closedInRange.length) * 100;

  const cycleDays = wonInRange
    .map((d) =>
      d.closedAt && d.createdAt ? differenceInDays(d.closedAt, d.createdAt) : null,
    )
    .filter((n): n is number => n !== null && n >= 0);
  const avgCycle = cycleDays.length === 0 ? 0 : cycleDays.reduce((s, n) => s + n, 0) / cycleDays.length;

  // ── Sparklines ────────────────────────────────────────────────────────────
  const sparkDays = 14;
  const dayBuckets = useMemo(() => {
    const out: Array<{ date: Date; wonCount: number; wonValue: number; openCount: number }> = [];
    for (let i = sparkDays - 1; i >= 0; i--) {
      out.push({ date: subDays(new Date(), i), wonCount: 0, wonValue: 0, openCount: 0 });
    }
    const findIdx = (d: Date) => {
      const idx = differenceInDays(new Date(), d);
      const bIdx = sparkDays - 1 - idx;
      return bIdx >= 0 && bIdx < out.length ? bIdx : -1;
    };
    for (const deal of deals) {
      if (deal.stage === 'won' && deal.closedAt) {
        const i = findIdx(deal.closedAt);
        if (i >= 0) {
          out[i].wonCount += 1;
          out[i].wonValue += deal.value || 0;
        }
      }
    }
    return out;
  }, [deals, sparkDays]);

  const sparkOpenDeals = useMemo(
    () => Array(sparkDays).fill(null).map(() => ({ value: openDeals.length })),
    [openDeals.length],
  );
  const sparkWonValue = dayBuckets.map((b) => ({ value: b.wonValue }));
  const sparkWonCount = dayBuckets.map((b) => ({ value: b.wonCount }));
  const sparkWinRate = useMemo(() => dayBuckets.map((b) => ({ value: b.wonCount })), [dayBuckets]);

  // ── Pipeline funnel ───────────────────────────────────────────────────────
  const funnelData = useMemo(() => {
    const order: Array<'lead' | 'qualified' | 'proposal' | 'negotiation' | 'won'> = [
      'lead', 'qualified', 'proposal', 'negotiation', 'won',
    ];
    return order.map((stage) => {
      const rows = deals.filter((d) => d.stage === stage);
      return {
        stage: STAGE_LABEL[stage],
        count: rows.length,
        value: rows.reduce((s, d) => s + (d.value || 0), 0),
      };
    });
  }, [deals]);

  // ── Forecast by month (next 6 months, weighted by probability) ────────────
  const forecastData: TrendDatum[] = useMemo(() => {
    const months: Record<string, { value: number; compare: number }> = {};
    const now = new Date();
    for (let i = 0; i < 6; i++) {
      const m = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const key = format(m, 'MMM yyyy');
      months[key] = { value: 0, compare: 0 };
    }
    for (const d of deals) {
      if (!d.expectedCloseDate || d.stage === 'won' || d.stage === 'lost') continue;
      const key = format(d.expectedCloseDate, 'MMM yyyy');
      if (months[key]) {
        const prob = d.probability ?? 0;
        months[key].value += (d.value || 0) * (prob / 100);
      }
    }
    // "compare" = last year's actual won for same month (very rough proxy).
    for (const d of deals) {
      if (d.stage !== 'won' || !d.closedAt) continue;
      const key = format(new Date(d.closedAt.getFullYear() + 1, d.closedAt.getMonth(), 1), 'MMM yyyy');
      if (months[key]) months[key].compare += d.value || 0;
    }
    return Object.entries(months).map(([label, v]) => ({
      label, value: Math.round(v.value), compare: Math.round(v.compare),
    }));
  }, [deals]);

  // ── Lead score distribution ───────────────────────────────────────────────
  const scoreData: DonutDatum[] = useMemo(() => {
    const counts = { hot: 0, warm: 0, cold: 0 } as Record<string, number>;
    for (const c of clients) counts[c.scoreBand] = (counts[c.scoreBand] ?? 0) + 1;
    return [
      { name: 'Hot',  value: counts.hot,  color: palette.accent },
      { name: 'Warm', value: counts.warm, color: palette.shades[2] },
      { name: 'Cold', value: counts.cold, color: palette.shades[4] },
    ].filter((d) => d.value > 0);
  }, [clients]);

  // ── Top performers ────────────────────────────────────────────────────────
  const topOwners = useMemo(() => {
    const map = new Map<string, { name: string; wonCount: number; wonValue: number }>();
    for (const d of wonInRange) {
      const key = d.ownerName || d.ownerId || 'Unassigned';
      const row = map.get(key) ?? { name: key, wonCount: 0, wonValue: 0 };
      row.wonCount += 1;
      row.wonValue += d.value || 0;
      map.set(key, row);
    }
    return Array.from(map.values())
      .sort((a, b) => b.wonValue - a.wonValue)
      .slice(0, 6)
      .map((r) => ({ name: r.name, value: r.wonValue }));
  }, [wonInRange]);

  // ── Deals at risk ─────────────────────────────────────────────────────────
  const dealsAtRisk = useMemo(() => {
    const now = new Date();
    return deals
      .filter((d) => OPEN_STAGES.has(d.stage))
      .filter((d) => differenceInDays(now, d.updatedAt) >= 14)
      .sort((a, b) => (b.value || 0) - (a.value || 0))
      .slice(0, 6);
  }, [deals]);

  // ── Activity by type (this period) ────────────────────────────────────────
  const activityByType = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of clientTasks) {
      if (t.createdAt < rs) continue;
      counts[t.type] = (counts[t.type] ?? 0) + 1;
    }
    return Object.entries(counts)
      .map(([k, v]) => ({ name: k.charAt(0).toUpperCase() + k.slice(1), value: v }))
      .sort((a, b) => b.value - a.value);
  }, [clientTasks, rs]);

  if (clientsLoading || dealsLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading dashboard…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">CRM dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {deals.length.toLocaleString()} deals · {clients.length.toLocaleString()} clients
          </p>
        </div>
        <Select value={range} onValueChange={(v) => setRange(v as Range)}>
          <SelectTrigger className="h-9 w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
            <SelectItem value="qtd">Quarter to date</SelectItem>
            <SelectItem value="ytd">Year to date</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile
          label="Open deals"
          value={openDeals.length.toLocaleString()}
          hint={fmtMoney(openValue)}
          sparkline={sparkOpenDeals}
        />
        <KpiTile
          label={`Won (${range})`}
          value={fmtMoney(wonValue)}
          deltaPct={wonValueDelta}
          hint={`${wonInRange.length} deal${wonInRange.length === 1 ? '' : 's'}`}
          sparkline={sparkWonValue}
          accent
        />
        <KpiTile
          label="Win rate"
          value={`${winRate.toFixed(0)}%`}
          hint={`${closedInRange.length} closed`}
          sparkline={sparkWinRate}
        />
        <KpiTile
          label="Avg deal cycle"
          value={`${avgCycle.toFixed(0)}d`}
          hint="create → won"
          sparkline={sparkWonCount}
        />
      </div>

      {/* Row 2: funnel + forecast */}
      <div className="grid lg:grid-cols-2 gap-3">
        <ChartCard title="Pipeline funnel" subtitle="Counts and value per stage" bodyHeight="h-64">
          <PipelineFunnel data={funnelData} valueFormatter={fmtMoney} />
        </ChartCard>
        <ChartCard title="Forecast" subtitle="Weighted by stage probability — next 6 months" bodyHeight="h-64">
          <TrendArea
            data={forecastData}
            primaryName="Forecast"
            compareName="Last year"
            yFormatter={(v) => fmtMoney(v).replace(/\.00$/, '')}
          />
        </ChartCard>
      </div>

      {/* Row 3: top performers + score distribution */}
      <div className="grid lg:grid-cols-3 gap-3">
        <ChartCard title="Top performers" subtitle={`Won value, ${range}`} bodyHeight="h-72" className="lg:col-span-2">
          <BarHorizontal data={topOwners} highlightTop valueFormatter={fmtMoney} />
        </ChartCard>
        <ChartCard title="Lead score" subtitle="Client distribution" bodyHeight="h-72">
          <div className="grid grid-rows-[1fr_auto] gap-2 h-full">
            <StatusDonut
              data={scoreData}
              centerValue={clients.length.toLocaleString()}
              centerLabel="clients"
            />
            <DonutLegend data={scoreData} />
          </div>
        </ChartCard>
      </div>

      {/* Row 4: deals at risk + activity */}
      <div className="grid lg:grid-cols-2 gap-3">
        <ChartCard title="Deals at risk" subtitle="Open deals stalled ≥14 days" bodyHeight="h-72">
          {dealsAtRisk.length === 0 ? (
            <div className="h-full grid place-items-center text-sm text-muted-foreground">
              No stalled deals — nice
            </div>
          ) : (
            <div className="space-y-1.5 overflow-y-auto h-full pr-1">
              {dealsAtRisk.map((d) => {
                const daysStalled = differenceInDays(new Date(), d.updatedAt);
                return (
                  <button
                    key={d.dealId}
                    className="w-full text-left rounded-md border border-transparent hover:border-border p-2 transition-colors"
                    onClick={() => navigate('/clients')}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                        <span className="truncate font-medium text-foreground">{d.title}</span>
                        {d.clientName && (
                          <span className="truncate text-muted-foreground">· {d.clientName}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 tabular-nums">
                        <span className="text-foreground">{fmtMoney(d.value)}</span>
                        <span className="text-muted-foreground">{daysStalled}d</span>
                      </div>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {STAGE_LABEL[d.stage]} · {d.ownerName ?? 'No owner'}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </ChartCard>
        <ChartCard title="Activity by type" subtitle={`Client tasks created · ${range}`} bodyHeight="h-72">
          <BarHorizontal data={activityByType} />
        </ChartCard>
      </div>

      {/* Footer nav */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Users className="h-4 w-4" />
            <span>Need delivery-side stats?</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate('/dashboard/projects')}>
            Open Projects dashboard <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default ClientsDashboard;
