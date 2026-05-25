import React from 'react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { palette } from './palette';

export interface TrendDatum {
  /** ISO date (yyyy-mm-dd) or short label. */
  label: string;
  /** Primary series — drawn with accent. */
  value: number;
  /** Optional secondary series — drawn with primary slate. */
  compare?: number;
}

interface Props {
  data: TrendDatum[];
  /** Tooltip-only labels. */
  primaryName?: string;
  compareName?: string;
  yFormatter?: (v: number) => string;
  /** Number of x-axis ticks. Recharts handles spacing; we use "preserveStartEnd". */
}

export const TrendArea: React.FC<Props> = ({
  data, primaryName = 'Current', compareName = 'Previous', yFormatter,
}) => {
  if (data.length === 0) {
    return (
      <div className="h-full w-full grid place-items-center text-sm text-muted-foreground">
        No data in this range
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="trend-primary" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette.accent} stopOpacity={0.35} />
            <stop offset="100%" stopColor={palette.accent} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="trend-compare" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette.primary} stopOpacity={0.15} />
            <stop offset="100%" stopColor={palette.primary} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={palette.light} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: palette.muted }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
          minTickGap={24}
        />
        <YAxis
          tick={{ fontSize: 11, fill: palette.muted }}
          axisLine={false}
          tickLine={false}
          width={36}
          tickFormatter={(v: number) => (yFormatter ? yFormatter(v) : v.toLocaleString())}
        />
        <Tooltip
          contentStyle={{ borderRadius: 8, fontSize: 12, padding: '6px 10px' }}
          formatter={(v: number) => (yFormatter ? yFormatter(v) : v.toLocaleString())}
        />
        {data.some((d) => d.compare != null) && (
          <Area
            type="monotone"
            dataKey="compare"
            stroke={palette.primary}
            strokeWidth={1.5}
            strokeDasharray="3 3"
            fill="url(#trend-compare)"
            name={compareName}
          />
        )}
        <Area
          type="monotone"
          dataKey="value"
          stroke={palette.accent}
          strokeWidth={2}
          fill="url(#trend-primary)"
          name={primaryName}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};
