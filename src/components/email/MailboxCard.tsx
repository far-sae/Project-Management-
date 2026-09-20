import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  CheckCircle2, AlertCircle, SendHorizonal, Trash2, Loader2, RotateCcw, Settings, Inbox,
  PenLine,
  AlertTriangle,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { inboxConnected } from '@/lib/email/readiness';
import type { BounceRate } from '@/lib/email/ramp';
import { MailboxHealthPanel } from './MailboxHealthPanel';
import { isSendable, remainingToday } from '@/lib/email/mailboxPool';
import type { EmailAccount, MailboxHealth } from '@/lib/email/types';

interface MailboxCardProps {
  mailbox: MailboxHealth;
  /**
   * The parallel `email_accounts` row for this mailbox — carries the IMAP
   * columns migration 157 added, none of which are on `mailbox_status`
   * (and so none of which are on `mailbox`). Undefined only for the moment
   * before AccountsTab's own parallel `listAccounts()` read lands; the inbox
   * section below simply doesn't render until then.
   */
  account: EmailAccount | undefined;
  isAdmin: boolean;
  /** This mailbox's measured bounce rate, or null where none was measured. */
  bounce: BounceRate | null;
  onEditSignature: () => void;
  testing: boolean;
  resuming: boolean;
  onSendTest: () => void;
  onDelete: () => void;
  onResume: () => void;
  onReconfigure: () => void;
}

/**
 * The inbox-scanning line: not configured, active with the last scan time,
 * an error with its message, or "incomplete". Always visually subordinate to
 * the sending state above it — small and muted, never a colored banner like
 * the paused-mailbox block below — because reading a mailbox and sending
 * from it are separate permissions (migration 157), and this section must
 * never read as urgent the way a sending problem does.
 */
const InboxHealth: React.FC<{ account: EmailAccount }> = ({ account }) => {
  switch (account.imapStatus) {
    case 'unconfigured':
      return (
        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
          <Inbox className="w-3 h-3 shrink-0" />
          Inbox scanning not set up — replies and bounces won&apos;t be detected for this
          mailbox. Sending is unaffected.
        </p>
      );
    case 'active':
      // 'active' with a note on it is a scan that finished and did not read
      // its whole window: the mailbox takes more mail than one pass covers,
      // so the cursor moved to where the scan stopped and the messages in
      // between went unchecked. Nothing is broken and nothing needs fixing,
      // but it must not read as an ordinary healthy scan -- the whole point
      // of advancing there was to stop the mailbox stalling silently.
      return (
        <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
          <Inbox className="w-3 h-3 mt-0.5 shrink-0" />
          <span>
            {/*
              'caught up to', not 'last scanned'. This column is the scan
              CURSOR: how far through the mailbox the worker has read, which is
              the scan's start time on an ordinary pass but lags behind on a
              mailbox that takes more mail than one scan reads. Calling it
              'last scanned' would show 'a day ago' for a mailbox being scanned
              every five minutes, and send the admin looking for a dead worker.
            */}
            Inbox: caught up to{' '}
            {account.inboxLastScanAt
              ? formatDistanceToNow(account.inboxLastScanAt, { addSuffix: true })
              : 'nothing yet'}.
            {account.imapLastError ? ` ${account.imapLastError}` : ''}
          </span>
        </p>
      );
    case 'incomplete':
      // Not a failure — see the ImapStatus doc comment in
      // src/lib/email/types.ts. The mailbox was read fine; only recording
      // what the scan found could not finish, and the next pass re-reads the
      // same window on its own. A passing remark, not a red one.
      return (
        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
          <Inbox className="w-3 h-3 shrink-0" />
          Inbox scan couldn&apos;t finish recording what it found — nothing wrong with this
          mailbox; the next scan picks up the same window automatically.
        </p>
      );
    case 'error':
      return (
        <p className="text-xs text-red-600 dark:text-red-400 mt-1 flex items-start gap-1">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          <span>
            Inbox: {account.imapLastError ?? 'could not be read.'} This does not stop this
            mailbox from sending — reading a mailbox and sending from it are separate
            permissions.
          </span>
        </p>
      );
    default:
      return null;
  }
};

/**
 * Whole calendar days between `from` and today, floored at zero — the "day N"
 * migration 156's mailbox_status view counts as
 * `(now() at time zone <org zone>)::date - warmup_started_on`. This counts it
 * in the reader's own timezone instead, so the two can differ by a day for
 * someone working outside the organization's zone. That is accepted: this is
 * a label, and the allowance it sits next to always comes from
 * `effectiveLimit`, which is the view's own arithmetic.
 *
 * `from` is local midnight on the stored date — see `fromDateOnly` in
 * services/supabase/email.ts — so these local getters read the day the column
 * actually names.
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
  mailbox, account, isAdmin, bounce, onEditSignature, testing, resuming, onSendTest, onDelete,
  onResume, onReconfigure,
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
              {/* Named on the card rather than buried in the limits dialog,
                  because with a pool every mailbox signs with its own and a
                  mailbox with no signature sends unsigned mail silently. The
                  label says which state it is in. */}
              <Button variant="outline" size="sm" onClick={onEditSignature}>
                <PenLine className="w-4 h-4 mr-1" />
                {account?.signatureHtml?.trim() ? 'Signature' : 'Add signature'}
              </Button>
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

        {/*
          Sending and inbox, side by side and never merged into one "connected"
          light. They are separate permissions at every provider — Google and
          Zoho both issue app passwords with IMAP left off — so a mailbox can
          be perfectly able to send and unable to read a single reply. One
          combined indicator would have to pick which of those to lie about.
        */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <SendHorizonal className="h-3 w-3" />
            Sending
            <span
              className={
                mailbox.status === 'active'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-amber-600 dark:text-amber-400'
              }
            >
              {mailbox.status === 'active' ? 'connected' : 'not verified'}
            </span>
          </Badge>
          <Badge variant="outline" className="gap-1">
            <Inbox className="h-3 w-3" />
            Inbox
            <span
              className={
                account && inboxConnected(account)
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-muted-foreground'
              }
            >
              {account && inboxConnected(account) ? 'connected' : 'not connected'}
            </span>
          </Badge>
        </div>
        {account && <InboxHealth account={account} />}

        <MailboxHealthPanel
          mailbox={mailbox}
          bounce={bounce}
          // The mailbox's own ceiling (migration 164a), defaulted to the
          // column's default where the database has not run it yet.
          threshold={account?.bouncePausePercent ?? 5}
        />

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

        {/* Resume clears the pause and the failure count but not a credential
            error — only a send that actually works can do that — so a mailbox
            can look un-paused and still be out of rotation. Say which action
            does what rather than leaving that to be discovered. */}
        {(mailbox.pausedReason || mailbox.status === 'error') && (
          <p className="text-xs text-muted-foreground mt-2">
            Sending resumes once this mailbox is back in the pool with working credentials:
            Resume clears the pause and the failure count, and a successful test send clears a
            credential error.
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default MailboxCard;
