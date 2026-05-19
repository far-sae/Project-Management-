import React from 'react';
import { palette } from './palette';

export interface FunnelDatum {
  stage: string;
  count: number;
  value?: number;
}

interface Props {
  data: FunnelDatum[];
  valueFormatter?: (v: number) => string;
}

/**
 * Lightweight CSS funnel — Recharts' Funnel component exists but is finicky
 * about widths and value scaling. Bars are sized as percentage of the largest
 * stage count; rendered with stage-progression palette.
 */
export const PipelineFunnel: React.FC<Props> = ({ data, valueFormatter }) => {
  if (data.length === 0) {
    return (
      <div className="h-full w-full grid place-items-center text-sm text-muted-foreground">
        No deals in this pipeline
      </div>
    );
  }
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="flex h-full w-full flex-col justify-center gap-1.5 py-2">
      {data.map((d, i) => {
        const pct = Math.max(8, Math.round((d.count / max) * 100));
        const color = palette.pipeline[Math.min(i, palette.pipeline.length - 1)];
        return (
          <div key={d.stage + i} className="flex items-center gap-3 text-xs">
            <div className="w-24 shrink-0 truncate text-foreground/80" title={d.stage}>{d.stage}</div>
            <div className="flex-1 rounded bg-muted/40 overflow-hidden h-7 relative">
              <div
                className="h-full rounded transition-[width] duration-300"
                style={{ width: `${pct}%`, background: color }}
              />
              <div className="absolute inset-0 flex items-center justify-between px-2 text-[11px] font-medium text-foreground/90">
                <span>{d.count}</span>
                {d.value != null && (
                  <span className="text-muted-foreground">
                    {valueFormatter ? valueFormatter(d.value) : d.value.toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
