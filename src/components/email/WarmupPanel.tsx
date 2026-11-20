import React from 'react';
import { Flame, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusPill, type StatusTone } from '@/components/common/StatusPill';
import {
  notReadyReason, type WarmupMailbox, type WarmupState, type WarmupStatus,
} from '../../../api/_warmup/shared/types';

/**
 * Warm-up of one mailbox, as the warm-up service (MailReach) reports it: is it
 * warming, its reputation score, how many of its warm-up emails landed in
 * spam, and whether it is ready to send campaigns from.
 *
 * This is the real thing the "Gradual sending" ramp above it is not: other
 * inboxes receive this mailbox's emails, open them, reply, and move them out
 * of spam.
 */

interface WarmupPanelProps {
  /** The organisation's warm-up status; null while it is loading or cannot be read. */
  status: WarmupStatus | null;
  /** This mailbox's part of it. */
  mailbox: WarmupMailbox | undefined;
  isAdmin: boolean;
  /** True while a start, pause or resume of this mailbox is on its way. */
  busy: boolean;
  onStart: () => void;
  onPause: (paused: boolean) => void;
}

const STATE: Record<WarmupState, { label: string; tone: StatusTone }> = {
  not_connected: { label: 'Not started', tone: 'neutral' },
  warming: { label: 'Warming', tone: 'info' },
  paused: { label: 'Paused', tone: 'warning' },
  off: { label: 'Off', tone: 'warning' },
  disconnected: { label: 'Disconnected', tone: 'danger' },
};

export const WarmupPanel: React.FC<WarmupPanelProps> = ({ status, mailbox, isAdmin, busy, onStart, onPause }) => {
  if (!status) return null;

  const pill = mailbox?.ready ? { label: 'Warmed up', tone: 'success' as StatusTone } : STATE[mailbox?.state ?? 'not_connected'];
  const linked = status.linked && !status.problem;

  return (
    <div className="mt-3 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Flame className="h-3.5 w-3.5" aria-hidden />
          Warm-up
        </p>
        {linked && <StatusPill tone={pill.tone}>{pill.label}</StatusPill>}
      </div>

      {status.problem ? (
        <p role="alert" className="mt-1.5 text-xs text-destructive">{status.problem}</p>
      ) : !status.linked ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          No warm-up service is connected. Add your MailReach key in Settings to warm this mailbox up before
          sending campaigns from it.
        </p>
      ) : !mailbox || mailbox.state === 'not_connected' ? (
        <>
          <p className="mt-1.5 text-xs text-muted-foreground">
            This mailbox is not warming yet. Sending campaigns from a cold mailbox is how mail ends up in spam.
          </p>
          {isAdmin && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={onStart} disabled={busy}>
                {busy && <Loader2 className="animate-spin" aria-hidden />}Start warm-up
              </Button>
              <span className="text-xs text-muted-foreground">Uses one warm-up seat of your MailReach plan.</span>
            </div>
          )}
        </>
      ) : (
        <>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
            <div>
              <dt className="text-muted-foreground">Reputation score</dt>
              <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{mailbox.score ?? 'Not yet'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Warming for</dt>
              <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                {mailbox.days === null ? 'Not known' : `${mailbox.days} day${mailbox.days === 1 ? '' : 's'}`}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Landing in spam</dt>
              <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                {mailbox.spamPercent === null ? 'Not measured' : `${mailbox.spamPercent}%`}
              </dd>
            </div>
          </dl>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {mailbox.sent > 0
              ? `Last ${status.periodDays} days: ${mailbox.sent} warm-up email${mailbox.sent === 1 ? '' : 's'}, ${mailbox.spam} landed in spam.`
              : `No warm-up emails in the last ${status.periodDays} days yet.`}
          </p>
          <p className={mailbox.ready ? 'mt-1 text-xs text-success-soft-foreground' : 'mt-1 text-xs text-foreground'}>
            {mailbox.ready ? 'Ready to send campaigns from.' : `Not ready for campaigns yet. ${notReadyReason(mailbox)}`}
          </p>
          {isAdmin && (mailbox.state === 'warming' || mailbox.state === 'paused') && (
            <Button
              className="mt-2"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onPause(mailbox.state === 'warming')}
            >
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              {mailbox.state === 'warming' ? 'Pause warm-up' : 'Resume warm-up'}
            </Button>
          )}
          {isAdmin && mailbox.state === 'disconnected' && (
            <Button className="mt-2" size="sm" variant="outline" disabled={busy} onClick={onStart}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}Reconnect
            </Button>
          )}
        </>
      )}
    </div>
  );
};
