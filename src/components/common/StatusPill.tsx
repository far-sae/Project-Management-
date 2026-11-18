import React from 'react';
import { cn } from '@/lib/utils';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'muted';

const TONE: Record<StatusTone, { pill: string; dot: string }> = {
  success: { pill: 'border-success/30 bg-success-soft text-success-soft-foreground', dot: 'bg-success' },
  warning: { pill: 'border-warning/40 bg-warning-soft text-warning-soft-foreground', dot: 'bg-warning' },
  danger: { pill: 'border-destructive/30 bg-destructive-soft text-destructive-soft-foreground', dot: 'bg-destructive' },
  info: { pill: 'border-info/30 bg-info-soft text-info-soft-foreground', dot: 'bg-info' },
  neutral: { pill: 'border-border bg-background text-foreground/80', dot: 'bg-muted-foreground/60' },
  muted: { pill: 'border-border bg-secondary text-muted-foreground', dot: 'bg-muted-foreground/40' },
};

interface StatusPillProps {
  tone?: StatusTone;
  /** Leading dot (default on). */
  dot?: boolean;
  /** Gently pulse the dot, e.g. "live" states. */
  pulse?: boolean;
  className?: string;
  title?: string;
  children: React.ReactNode;
}

/** The one status badge shape: a dot and a word in a soft tinted pill. */
export const StatusPill: React.FC<StatusPillProps> = ({
  tone = 'neutral',
  dot = true,
  pulse = false,
  className,
  title,
  children,
}) => (
  <span
    data-tone={tone}
    title={title}
    className={cn(
      'inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-xs font-medium',
      TONE[tone].pill,
      className,
    )}
  >
    {dot && (
      <span
        aria-hidden
        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', TONE[tone].dot, pulse && 'motion-safe:animate-pulse')}
      />
    )}
    {children}
  </span>
);

export default StatusPill;
