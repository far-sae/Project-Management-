import React from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { palette } from './palette';

export interface StackedDatum {
  label: string;
  [series: string]: string | number;
}

interface Props {
  data: StackedDatum[];
  /** Series in stacking order (bottom -> top). */
  series: Array<{ key: string; name: string; color?: string }>;
  yFormatter?: (v: number) => string;
  /**
   * Whether the series stack into one bar. Default true, which is every
   * existing caller.
   *
   * False draws them side by side, and is the only honest shape when the
   * series OVERLAP rather than partition a whole: stacking a campaign's
   * "sent" and "opened" would give the bar a height that counts the same
   * message twice, and bar height is exactly what a reader compares.
   */
  stacked?: boolean;
}

export const StackedBar: React.FC<Props> = ({ data, series, yFormatter, stacked = true }) => {
  if (data.length === 0) {
    return (
      <div className="h-full w-full grid place-items-center text-sm text-muted-foreground">
        No data in this range
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={palette.light} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: palette.muted }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
          minTickGap={16}
        />
        <YAxis
          tick={{ fontSize: 11, fill: palette.muted }}
          axisLine={false}
          tickLine={false}
          width={32}
          tickFormatter={(v: number) => (yFormatter ? yFormatter(v) : v.toLocaleString())}
        />
        <Tooltip
          cursor={{ fill: palette.light, opacity: 0.4 }}
          contentStyle={{ borderRadius: 8, fontSize: 12, padding: '6px 10px' }}
          formatter={(v: number) => (yFormatter ? yFormatter(v) : v.toLocaleString())}
        />
        <Legend
          wrapperStyle={{ fontSize: 11 }}
          iconType="circle"
          iconSize={8}
        />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            stackId={stacked ? 'all' : undefined}
            fill={s.color ?? palette.shades[i % palette.shades.length]}
            name={s.name}
            radius={!stacked || i === series.length - 1 ? [4, 4, 0, 0] : 0}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
};
