import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { AlertTriangle, CheckCircle2, HelpCircle, TrendingUp } from 'lucide-react';
import { format } from 'date-fns';
import {
  healthReport, limitOnDay, nextIncrease, rampProgress,
  type BounceRate, type HealthState,
} from '@/lib/email/ramp';
import type { MailboxHealth } from '@/lib/email/types';

interface MailboxHealthPanelProps {
  mailbox: MailboxHealth;
  /** Null when this database has not measured one — not the same as zero. */
  bounce: BounceRate | null;
  /** The mailbox's own bounce ceiling, from migration 164a. */
  threshold: number;
}

const healthIcon = (state: HealthState) => {
  switch (state) {
    case 'good':
      return <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />;
    case 'watch':
      return <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />;
    case 'bad':
      return <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />;
    default:
      // A question mark, not a tick. "Not measured" must not look like "fine".
      return <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
  }
};

/**
 * Two things about a mailbox, kept apart on purpose.
 *
 * GRADUAL SENDING is a volume ramp: it raises the daily allowance on a
 * schedule. HEALTH is what actually came back from the mail that went out.
 *
 * They used to be one section called "Warmup", and that name did real harm:
 * it implies a mailbox has been warmed — that its reputation has been built
 * and its mail reaches inboxes — when all that has happened is a number going
 * up on a timer. Somebody who believes that sends their real campaign on day
 * fourteen expecting placement they have no evidence for. A ramp decides how
 * fast mail leaves. Only the bounces, failures and replies coming back say
 * anything about whether it arrives.
 *
 * So the ramp is described as a ramp, health is measured separately, and where
 * nothing has been measured this says so rather than showing a comforting
 * zero.
 */
export const MailboxHealthPanel: React.FC<MailboxHealthPanelProps> = ({
  mailbox, bounce, threshold,
}) => {
  const today = new Date();
  const progress = rampProgress(mailbox, today);
  const next = nextIncrease(mailbox, today);
  const health = healthReport(mailbox, bounce, threshold);

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-border p-3">
      {/* ── the ramp ──────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <TrendingUp className="h-3.5 w-3.5" />
            Gradual sending
          </p>
          <Badge variant="outline" className="text-xs">
            {mailbox.warmupEnabled === false
              ? 'Off — full volume'
              : !mailbox.warmupStartedOn
                ? 'Not started'
                : `${limitOnDay(mailbox, today)} a day`}
          </Badge>
        </div>

        {progress !== null && (
          <Progress value={Math.round(progress * 100)} className="mt-2 h-1.5" />
        )}

        <p className="mt-1.5 text-xs text-muted-foreground">
          {mailbox.warmupEnabled === false ? (
            `Sending up to ${mailbox.dailyLimit ?? mailbox.effectiveLimit} a day.`
          ) : !mailbox.warmupStartedOn ? (
            // Migration 156's own warning, said to the person it affects: with
            // no start date the ramp sits at its start volume for ever,
            // because nothing sets the date on its own.
            `Set a start date to begin. Until then this mailbox is capped at ${
              mailbox.warmupStartVolume ?? mailbox.effectiveLimit
            } a day and will not climb.`
          ) : next ? (
            `Rises to ${next.to} a day on ${format(next.on, 'EEE d MMM')}.`
          ) : (
            `At its full ${mailbox.dailyLimit ?? mailbox.effectiveLimit} a day.`
          )}
        </p>

        {/* The sentence that stops this being read as a warm-up service. */}
        <p className="mt-1 text-xs text-muted-foreground/80">
          This raises how much you send. It is not evidence that your mail reaches inboxes —
          the delivery record below is.
        </p>
      </div>

      {/* ── what actually came back ───────────────────────────────── */}
      <div className="border-t border-border pt-3">
        <p className="mb-1.5 text-xs font-medium text-foreground">Delivery record</p>
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          {healthIcon(health.state)}
          <span>{health.detail}</span>
        </p>
        {mailbox.consecutiveFailures > 0 && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            {mailbox.consecutiveFailures} send
            {mailbox.consecutiveFailures === 1 ? '' : 's'} failed in a row — this mailbox pauses
            itself at three.
          </p>
        )}
      </div>
    </div>
  );
};
