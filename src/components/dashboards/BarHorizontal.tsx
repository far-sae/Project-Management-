import React from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from 'recharts';
import { palette } from './palette';

export interface HBarDatum {
  name: string;
  value: number;
  /** Optional override color (for "winner" highlight). */
  color?: string;
}

interface Props {
  data: HBarDatum[];
  /** Format the tooltip + axis numbers. */
  valueFormatter?: (v: number) => string;
  /** Highlight the top row with the accent color. */
  highlightTop?: boolean;
}

export const BarHorizontal: React.FC<Props> = ({
  data, valueFormatter, highlightTop = false,
}) => {
  if (data.length === 0) {
    return (
      <div className="h-full w-full grid place-items-center text-sm text-muted-foreground">
        Nothing to show yet
      </div>
    );
  }
  // Recharts horizontal bars require layout="vertical" and swapped axis types.
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
      >
        <CartesianGrid stroke={palette.light} strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: palette.muted }}
          axisLine={false}
          tickLine={false}
          // Wrap so Recharts' second arg (tick index) doesn't leak into
          // single-arg formatters like useFormatMoney(amount, currency).
          tickFormatter={(v: number) => (valueFormatter ? valueFormatter(v) : String(v))}
        />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 12, fill: palette.primary }}
          axisLine={false}
          tickLine={false}
          width={108}
        />
        <Tooltip
          cursor={{ fill: palette.light, opacity: 0.4 }}
          contentStyle={{ borderRadius: 8, fontSize: 12, padding: '6px 10px' }}
          formatter={(v: number) => (valueFormatter ? valueFormatter(v) : v.toLocaleString())}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
          {data.map((d, i) => (
            <Cell
              key={d.name + i}
              fill={
                d.color ??
                (highlightTop && i === 0 ? palette.accent : palette.primary)
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};
