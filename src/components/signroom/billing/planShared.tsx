// Small pieces the billing plans panel and the accounts overview share.
import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Sums } from '@/lib/signroom/billing';
import { STATUS_WORD, sumLines, type MonthStatus } from '@/lib/signroom/billingPlans';
import { StatusPill, type StatusTone } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** A filter chip: filled while it is the one chosen. */
export const chipClass = (active: boolean): string =>
  cn(
    'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    active
      ? 'border-foreground bg-foreground text-background'
      : 'border-border text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground',
  );

/** Amounts in one or more currencies, one line each. Currencies are never added together. */
export const SumLines: React.FC<{ sums: Sums }> = ({ sums }) => {
  const lines = sumLines(sums);
  if (lines.length === 0) return <>—</>;
  if (lines.length === 1) return <>{lines[0]}</>;
  return (
    <span className="flex flex-col">
      {lines.map((line) => <span key={line}>{line}</span>)}
    </span>
  );
};

const PAYMENT_TONE: Record<Exclude<MonthStatus, 'neutral'>, StatusTone> = {
  paid: 'success',
  upcoming: 'info',
  overdue: 'danger',
};

/** Paid, To come or Overdue. */
export const PaymentPill: React.FC<{ status: Exclude<MonthStatus, 'neutral'>; dot?: boolean }> = ({ status, dot }) => (
  <StatusPill tone={PAYMENT_TONE[status]} dot={dot}>{STATUS_WORD[status]}</StatusPill>
);

const SMALL_ICON = 'md:h-7 md:min-h-7 md:w-7 md:min-w-7';

/** Step back and forward through the years. */
export const YearSwitcher: React.FC<{
  year: number;
  onChange: (year: number) => void;
  min: number;
  max: number;
  disabled?: boolean;
  /** Sized to sit beside small buttons, as in a card's title row. */
  compact?: boolean;
}> = ({ year, onChange, min, max, disabled, compact }) => (
  <div role="group" aria-label="Year" className="inline-flex items-center gap-1">
    <Button
      type="button" size="icon" variant="outline" className={compact ? SMALL_ICON : undefined}
      aria-label="Previous year" disabled={disabled || year <= min} onClick={() => onChange(year - 1)}
    >
      <ChevronLeft />
    </Button>
    <span className="min-w-12 px-1 text-center text-sm font-medium tabular-nums text-foreground" aria-live="polite">{year}</span>
    <Button
      type="button" size="icon" variant="outline" className={compact ? SMALL_ICON : undefined}
      aria-label="Next year" disabled={disabled || year >= max} onClick={() => onChange(year + 1)}
    >
      <ChevronRight />
    </Button>
  </div>
);
