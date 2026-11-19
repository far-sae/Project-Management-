// Who the workspace's emails come from right now, in one glance.
import React from 'react';
import { Mail, TriangleAlert } from 'lucide-react';
import { StatusPill } from '@/components/common/StatusPill';
import {
  keptMailboxSentence, lastCheckOf, summaryOf, whenText, type EmailConnectionView,
} from '@/lib/signroom/emailConnection';
import { cn } from '@/lib/utils';
import { HELP } from './parts';

export const ConnectionStatus: React.FC<{ view: EmailConnectionView }> = ({ view }) => {
  const summary = summaryOf(view);
  const kept = keptMailboxSentence(view);
  const lastCheck = lastCheckOf(view);
  const warn = summary.state === 'reconnect';
  const Icon = warn ? TriangleAlert : Mail;

  return (
    <div
      role="group"
      aria-label="Who your emails come from"
      className={cn(
        'flex min-w-0 items-start gap-3 rounded-lg border px-3 py-3',
        warn ? 'border-warning/40 bg-warning-soft' : 'border-border bg-background',
      )}
    >
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border',
          warn ? 'border-warning/40 text-warning-soft-foreground' : 'border-border bg-muted text-muted-foreground',
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className={cn('text-xs', warn ? 'text-warning-soft-foreground' : 'text-muted-foreground')}>Emails are sent from</p>
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn('min-w-0 break-all text-sm font-semibold', warn ? 'text-warning-soft-foreground' : 'text-foreground')}>
            {summary.sender}
          </span>
          <StatusPill tone={summary.pill.tone}>{summary.pill.label}</StatusPill>
        </p>
        <p className={cn('text-sm', warn ? 'text-warning-soft-foreground' : 'text-muted-foreground')}>{summary.detail}</p>
        {kept && <p className={cn('text-xs', warn ? 'text-warning-soft-foreground' : 'text-muted-foreground')}>{kept}</p>}
        {view.lastError && (
          <p className={cn('text-xs', warn ? 'text-warning-soft-foreground' : 'text-destructive')}>
            Last problem: {view.lastError}
          </p>
        )}
        {lastCheck && (
          <p className={cn(HELP, 'tabular-nums', warn && 'text-warning-soft-foreground')}>Last checked {whenText(lastCheck)}</p>
        )}
      </div>
    </div>
  );
};
