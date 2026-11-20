// What an automation screen shows in place of its content: not ready on the server, a failed read, still loading.
import React from 'react';
import { Workflow } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/signroom/billing/shared';
import { cn } from '@/lib/utils';

/** The server answered 503: said quietly, in the server's own sentence, which names what is missing. */
export const NotReady: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <EmptyState icon={<Workflow className="h-5 w-5 text-muted-foreground" aria-hidden />}>
    <span role="status">{children}</span>
  </EmptyState>
);

/** A read that failed: the server's sentence, and a way to try again. */
export const LoadFailed: React.FC<{ error: string; onRetry: () => void; action?: React.ReactNode }> = ({ error, onRetry, action }) => (
  <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-16 text-center">
    <p role="alert" className="max-w-md text-sm text-destructive">{error}</p>
    <div className="flex flex-wrap items-center justify-center gap-2">
      <Button variant="outline" onClick={onRetry}>Try again</Button>
      {action}
    </div>
  </div>
);

/** A read that failed while older data is still on the screen. */
export const StaleNote: React.FC<{ error: string; onRetry: () => void }> = ({ error, onRetry }) => (
  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border border-border px-3 py-2">
    <p role="alert" className="min-w-0 text-sm text-destructive">{error}</p>
    <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>
  </div>
);

/** A grey bar standing in for a line of text while it loads. */
export const Bar: React.FC<{ className?: string }> = ({ className }) => (
  <span aria-hidden className={cn('block h-3 rounded-md bg-muted motion-safe:animate-pulse', className)} />
);

/** Wraps placeholders so a screen reader hears one "loading" instead of a pile of empty boxes. */
export const Loading: React.FC<{ label: string; className?: string; children: React.ReactNode }> = ({ label, className, children }) => (
  <div role="status" aria-label={label} aria-busy="true" className={className}>
    {children}
  </div>
);

/** A bordered box with a title row and a few placeholder lines, the size of a loaded card. */
export const CardSkeleton: React.FC<{ rows?: number; className?: string }> = ({ rows = 3, className }) => (
  <div className={cn('overflow-hidden rounded-lg border border-border bg-card', className)}>
    <div className="flex min-h-11 items-center border-b border-border px-4">
      <Bar className="w-40" />
    </div>
    <div className="divide-y divide-border">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex flex-col gap-2 px-4 py-3.5">
          <Bar className="w-1/2" />
          <Bar className="w-1/3" />
        </div>
      ))}
    </div>
  </div>
);
