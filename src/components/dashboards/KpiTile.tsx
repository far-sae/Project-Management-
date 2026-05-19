import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { ResponsiveContainer, AreaChart, Area } from 'recharts';
import { palette } from './palette';
import { cn } from '@/lib/utils';

interface Props {
  label: string;
  value: string | number;
  /** Percentage delta vs previous period (e.g. +12 for +12%). null = hide. */
  deltaPct?: number | null;
  /** Sub-label under the value (e.g. "this week"). */
  hint?: string;
  /** Sparkline series of recent values; ≥2 points for a curve. */
  sparkline?: Array<{ value: number }>;
  /** Accent treatment for the primary KPI on the page. */
  accent?: boolean;
}

export const KpiTile: React.FC<Props> = ({
  label, value, deltaPct = null, hint, sparkline, accent = false,
}) => {
  const deltaColor =
    deltaPct == null ? '' : deltaPct >= 0 ? 'text-emerald-600' : 'text-rose-600';
  const deltaPrefix = deltaPct == null ? '' : deltaPct > 0 ? '+' : '';
  return (
    <Card className={cn(accent && 'border-orange-200 bg-orange-50/40')}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground truncate">{label}</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
            {(hint || deltaPct != null) && (
              <div className="mt-1 flex items-center gap-2 text-xs">
                {deltaPct != null && (
                  <span className={cn('font-medium', deltaColor)}>
                    {deltaPrefix}{deltaPct.toFixed(0)}%
                  </span>
                )}
                {hint && <span className="text-muted-foreground">{hint}</span>}
              </div>
            )}
          </div>
          {sparkline && sparkline.length >= 2 && (
            <div className="h-10 w-20 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sparkline} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={accent ? palette.accent : palette.primary} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={accent ? palette.accent : palette.primary} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke={accent ? palette.accent : palette.primary}
                    strokeWidth={1.5}
                    fill="url(#spark-grad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
