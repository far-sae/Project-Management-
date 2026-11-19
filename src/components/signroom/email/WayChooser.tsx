// Step 1: the three ways to connect a mailbox, the password first.
import React from 'react';
import { ChevronRight, KeyRound, LogIn } from 'lucide-react';
import { StatusPill } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { WAYS, type ConnectionWay } from '@/lib/signroom/emailConnection';
import { Step } from './parts';

export const WayChooser: React.FC<{
  /** The way in use now, if any. */
  current: ConnectionWay | null;
  disabled: boolean;
  onPick: (way: ConnectionWay) => void;
  /** Leaves the choice as it is. Only offered when something is already connected. */
  onCancel?: () => void;
}> = ({ current, disabled, onPick, onCancel }) => (
  <Step title="Choose how to connect" step={{ n: 1, of: null }} next="Next: you fill in the details for the way you pick.">
    <div role="group" aria-label="Choose how to connect" className="flex flex-col gap-2">
      {WAYS.map((way) => {
        const Icon = way.id === 'smtp' ? KeyRound : LogIn;
        return (
          <button
            key={way.id}
            type="button"
            disabled={disabled}
            onClick={() => onPick(way.id)}
            className="flex w-full min-w-0 items-start gap-3 rounded-lg border border-border bg-background px-3 py-3 text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">{way.title}</span>
                {current === way.id && <StatusPill tone="neutral" dot={false}>Current</StatusPill>}
              </span>
              <span className="text-xs text-muted-foreground">{way.line}</span>
            </span>
            <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        );
      })}
    </div>
    {onCancel && (
      <div>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={disabled}>Cancel</Button>
      </div>
    )}
  </Step>
);
