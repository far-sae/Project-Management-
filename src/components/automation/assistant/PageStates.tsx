// What the assistant and agents screens show before there is anything to work on.
import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** The two-column frame both screens use; the columns stack on a phone. */
export const COLUMNS = 'grid min-w-0 items-start gap-4';
export const PANEL = 'min-w-0 rounded-lg border border-border bg-card';

/** Grey blocks in the shape of the page, so nothing jumps when the real content arrives. */
export const LoadingColumns: React.FC<{ label: string; className?: string }> = ({ label, className }) => (
  <div role="status" aria-label={label} className={cn(COLUMNS, className)}>
    {[0, 1].map((column) => (
      <div key={column} className={cn(PANEL, 'flex min-h-[32rem] flex-col gap-3 p-4')}>
        <div className="h-4 w-40 rounded-md bg-muted motion-safe:animate-pulse" />
        <div className="h-3 w-64 max-w-full rounded-md bg-muted motion-safe:animate-pulse" />
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="h-16 rounded-lg border border-border bg-muted/40 motion-safe:animate-pulse" />
        ))}
      </div>
    ))}
  </div>
);

/** The server's sentence, and a way to ask again. */
export const LoadFailed: React.FC<{ message: string; onRetry: () => void }> = ({ message, onRetry }) => (
  <div className="flex min-h-[32rem] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-4 py-16 text-center">
    <p role="alert" className="max-w-md text-sm text-destructive">{message}</p>
    <Button variant="outline" onClick={onRetry}>Try again</Button>
  </div>
);

/** Automation has not been set up in this workspace yet: say so and point to where it is. */
export const NotSetUp: React.FC<{ workspaceName: string }> = ({ workspaceName }) => (
  <div className="flex min-h-[32rem] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-4 py-16 text-center">
    <p className="max-w-md text-sm text-muted-foreground">
      Automation is not set up in {workspaceName || 'this workspace'} yet. Set it up on the overview first.
    </p>
    <Button asChild variant="outline">
      <Link to="/crm/automation">Go to the overview</Link>
    </Button>
  </div>
);

/** One quiet sentence for a person who may look but not change. */
export const ReadOnlyNote: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">{children}</p>
);
