import React from 'react';
import { cn } from '@/lib/utils';

export interface StatItem {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Small line under the value. */
  note?: React.ReactNode;
  tone?: 'default' | 'danger' | 'success' | 'muted';
}

const TONE: Record<NonNullable<StatItem['tone']>, string> = {
  default: 'text-foreground',
  danger: 'text-destructive',
  success: 'text-success',
  muted: 'text-muted-foreground',
};

/**
 * A row of headline figures in one bordered strip. Cells share dividers and
 * wrap onto more rows on narrow screens, always filling the row.
 */
export const StatStrip: React.FC<{ items: StatItem[]; className?: string }> = ({ items, className }) => (
  <div className={cn('overflow-hidden rounded-lg border border-border bg-card', className)}>
    <dl className="-ml-px -mt-px flex flex-wrap">
      {items.map((item, i) => (
        <div key={i} className="flex min-w-0 flex-1 basis-44 flex-col gap-1 border-l border-t border-border p-4">
          <dt className="truncate text-[13px] text-muted-foreground">{item.label}</dt>
          <dd
            data-tone={item.tone ?? 'default'}
            className={cn('text-2xl font-semibold leading-8 tracking-tight tabular-nums', TONE[item.tone ?? 'default'])}
          >
            {item.value}
          </dd>
          {item.note && <dd className="truncate text-xs text-muted-foreground">{item.note}</dd>}
        </div>
      ))}
    </dl>
  </div>
);

export default StatStrip;
