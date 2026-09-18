import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  CheckCircle2, AlertCircle, SendHorizonal, Trash2, Loader2, RotateCcw, Settings,
} from 'lucide-react';
import { isSendable, remainingToday } from '@/lib/email/mailboxPool';
import type { MailboxHealth } from '@/lib/email/types';

interface MailboxCardProps {
  mailbox: MailboxHealth;
  isAdmin: boolean;
  testing: boolean;
  resuming: boolean;
  onSendTest: () => void;
  onDelete: () => void;
  onResume: () => void;
  onReconfigure: () => void;
}

/**
 * Whole calendar days between `from` and today, floored at zero — the same
 * "day N" migration 156's mailbox_status view counts with
 * `current_date - warmup_started_on`. Computed here purely for the label;
 * the allowance itself always comes from `effectiveLimit`, which the view
 * already worked out.
 */
const daysSince = (from: Date): number => {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((today.getTime() - start.getTime()) / 86_400_000));
};

/**
 * "Warmup day N, allowance X" while ramping, "Full volume" once warmup is
 * off or the ramp has already reached the mailbox's daily limit.
 */
const warmupLabel = (mailbox: MailboxHealth): string => {
  if (!mailbox.warmupEnabled) return 'Full volume';
  if (mailbox.dailyLimit !== undefined && mailbox.effectiveLimit >= mailbox.dailyLimit) {
    return 'Full volume';
  }
  const day = mailbox.warmupStartedOn ? daysSince(mailbox.warmupStartedOn) : 0;
  return `Warmup day ${day}, allowance ${mailbox.effectiveLimit}`;
};

/** One mailbox: status, today's usage, warmup state and admin controls. */
export const MailboxCard: React.FC<MailboxCardProps> = ({
  mailbox, isAdmin, testing, resuming, onSendTest, onDelete, onResume, onReconfigure,
}) => {
  const sendable = isSendable(mailbox);
  const pct = mailbox.effectiveLimit > 0
    ? Math.min(100, Math.round((mailbox.sentToday / mailbox.effectiveLimit) * 100))
    : 0;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium text-foreground">{mailbox.label}</p>
              {sendable ? (
                <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
                  <CheckCircle2 className="w-3 h-3 mr-1" />Sendable
                </Badge>
              ) : (
                <Badge variant="secondary">
                  <AlertCircle className="w-3 h-3 mr-1" />Not sending
                </Badge>
              )}
              {mailbox.status !== 'active' && (
                <Badge className="bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-yellow-500/30">
                  {mailbox.status === 'error' ? 'Credential error' : 'Unverified'}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{mailbox.fromEmail}</p>
          </div>

          {isAdmin && (
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={onReconfigure}>
                <Settings className="w-4 h-4 mr-1" />Limits
              </Button>
              <Button variant="outline" size="sm" disabled={testing} onClick={onSendTest}>
                {testing
                  ? <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  : <SendHorizonal className="w-4 h-4 mr-1" />}
                Send test
              </Button>
              <Button variant="ghost" size="icon" aria-label="Delete mailbox" onClick={onDelete}>
                <Trash2 className="w-4 h-4 text-red-600" />
              </Button>
            </div>
          )}
        </div>

        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>Today</span>
            <span>{mailbox.sentToday} / {mailbox.effectiveLimit} &middot; {remainingToday(mailbox)} left</span>
          </div>
          <Progress value={pct} />
        </div>

        <p className="text-xs text-muted-foreground mt-2">{warmupLabel(mailbox)}</p>

        {mailbox.pausedReason && (
          <div className="mt-3 flex items-center justify-between gap-3 p-2.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-md">
            <p className="text-sm text-red-700 dark:text-red-300">{mailbox.pausedReason}</p>
            {isAdmin && (
              <Button size="sm" variant="outline" disabled={resuming} onClick={onResume}>
                {resuming
                  ? <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  : <RotateCcw className="w-4 h-4 mr-1" />}
                Resume
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default MailboxCard;
