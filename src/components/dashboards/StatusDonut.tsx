import React from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { palette } from './palette';

export interface DonutDatum {
  name: string;
  value: number;
  /** Optional override color. Falls back to palette.shades. */
  color?: string;
}

interface Props {
  data: DonutDatum[];
  /** Big number drawn in the middle. */
  centerValue?: string | number;
  centerLabel?: string;
}

export const StatusDonut: React.FC<Props> = ({ data, centerValue, centerLabel }) => {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) {
    return (
      <div className="h-full w-full grid place-items-center text-sm text-muted-foreground">
        No data yet
      </div>
    );
  }
  return (
    <div className="relative h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            innerRadius="62%"
            outerRadius="90%"
            paddingAngle={2}
            dataKey="value"
            nameKey="name"
            stroke="none"
          >
            {data.map((d, i) => (
              <Cell key={d.name} fill={d.color ?? palette.shades[i % palette.shades.length]} />
            ))}
          </Pie>
          <Tooltip
            cursor={{ fill: 'transparent' }}
            contentStyle={{ borderRadius: 8, fontSize: 12, padding: '6px 10px' }}
            formatter={(v: number, name: string) => [v.toLocaleString(), name]}
          />
        </PieChart>
      </ResponsiveContainer>
      {centerValue != null && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-center">
            <div className="text-2xl font-semibold text-foreground">{centerValue}</div>
            {centerLabel && <div className="text-xs text-muted-foreground">{centerLabel}</div>}
          </div>
        </div>
      )}
    </div>
  );
};

/** Simple legend that pairs with the donut (color swatch + name + count). */
export const DonutLegend: React.FC<{ data: DonutDatum[] }> = ({ data }) => (
  <div className="space-y-1.5">
    {data.map((d, i) => (
      <div key={d.name} className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ background: d.color ?? palette.shades[i % palette.shades.length] }}
          />
          <span className="text-foreground/90">{d.name}</span>
        </div>
        <span className="tabular-nums text-muted-foreground">{d.value.toLocaleString()}</span>
      </div>
    ))}
  </div>
);
