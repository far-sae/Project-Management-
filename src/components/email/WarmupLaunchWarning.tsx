import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { warmupStatus } from '@/services/email/warmup';
import { notReadyReason, type WarmupStatus } from '../../../api/_warmup/shared/types';

/**
 * In the review before a campaign is sent: which of the mailboxes it will
 * leave from are not warmed up yet. Shown only when a warm-up service is
 * connected; it warns and does not block, because the person may know
 * something the figures do not (a mailbox warmed elsewhere for months).
 */
export const WarmupLaunchWarning: React.FC<{
  /** True while the review is open: the service is asked then, not before. */
  open: boolean;
  organizationId: string | null;
  /** The mailboxes this campaign may be sent from. */
  mailboxes: Array<{ id: string; fromEmail: string }>;
}> = ({ open, organizationId, mailboxes }) => {
  const [status, setStatus] = useState<WarmupStatus | null>(null);

  useEffect(() => {
    if (!open || !organizationId) return;
    let live = true;
    // Asked for the whole organisation: a pool can span more than the workspace on screen.
    void warmupStatus(organizationId, null).then((s) => { if (live) setStatus(s); }).catch(() => { if (live) setStatus(null); });
    return () => { live = false; };
  }, [open, organizationId]);

  if (!status || !status.linked || status.problem) return null;
  const cold = mailboxes
    .map((m) => ({ email: m.fromEmail, reason: notReadyReason(status.mailboxes[m.id] ?? { state: 'not_connected', score: null, days: null, sent: 0, spam: 0, spamPercent: null, ready: false }) }))
    .filter((m): m is { email: string; reason: string } => m.reason !== null);
  if (cold.length === 0) return null;

  return (
    <div role="alert" className="mt-2 rounded-md border border-warning/40 bg-warning-soft p-2 text-xs text-warning-soft-foreground">
      <p className="flex items-start gap-2 font-medium">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        {cold.length === 1 && mailboxes.length === 1
          ? 'This mailbox is not warmed up yet. Mail from it is likely to land in spam.'
          : `${cold.length} of ${mailboxes.length} mailboxes are not warmed up yet. Mail from them is likely to land in spam.`}
      </p>
      <ul className="mt-1 space-y-0.5 pl-5">
        {cold.map((m) => (
          <li key={m.email}><span className="font-medium">{m.email}</span>: {m.reason}</li>
        ))}
      </ul>
    </div>
  );
};
