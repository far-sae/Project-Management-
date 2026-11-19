// The emails sent for one invoice or one agreement: when, to whom, what it was, and whether it went.
import React from 'react';
import { RefreshCw } from 'lucide-react';
import type { Delivery } from '../../../api/_signroom/shared/types';
import { shortDateTime } from '@/lib/signroom/billing';
import { StatusPill, type StatusTone } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { Card, PickWorkspace } from './billing/shared';
import { useServerData } from './billing/useBilling';
import { useSignroom } from '@/hooks/useSignroom';

export interface DeliveryLogProps {
  /** Where the list is read from: `billing/<id>/deliveries` or `agreements/<id>/deliveries`. */
  path: string;
  /** The card's heading. */
  title?: string;
}

type Email = Pick<Delivery, 'id' | 'recipient' | 'subject' | 'purpose' | 'route' | 'status' | 'error' | 'created'>;

const STATUS: Record<Email['status'], { tone: StatusTone; word: string }> = {
  sending: { tone: 'info', word: 'Sending' },
  sent: { tone: 'success', word: 'Sent' },
  failed: { tone: 'danger', word: 'Failed' },
};

/** What kind of email it was, from the server's short code for it. */
const KIND: Record<string, string> = {
  invoice: 'Invoice',
  billing: 'Invoice',
  receipt: 'Receipt',
  invite: 'Signing invitation',
  reminder: 'Reminder',
  complete: 'Signed copy',
  completion: 'Signed copy',
  notice: 'Notice',
  otp: 'Sign-in code',
  'billing-otp': 'Sign-in code',
};

/** Who sent it: the workspace's own mailbox, or this app on its behalf. */
const SENT_FROM: Record<NonNullable<Email['route']>, string> = {
  mailbox: 'from your mailbox',
  securovix: 'from TaskCalendar',
};

const NOTE = 'px-4 py-6 text-center text-sm';

export const DeliveryLog: React.FC<DeliveryLogProps> = ({ path, title = 'Emails' }) => {
  const { workspaceId } = useSignroom();
  const { data, loading, error, notSetUp, reload } = useServerData<{ deliveries: Email[] }>(path);
  const emails = data?.deliveries ?? [];

  return (
    <Card
      title={title}
      count={data ? emails.length : undefined}
      action={
        <Button size="sm" variant="ghost" onClick={() => void reload()} disabled={loading || !workspaceId}>
          <RefreshCw className={loading ? 'animate-spin' : undefined} aria-hidden /> Refresh
        </Button>
      }
    >
      {!workspaceId ? (
        <PickWorkspace compact what="the emails sent" />
      ) : notSetUp ? (
        <p role="status" className={`${NOTE} text-muted-foreground`}>{error}</p>
      ) : error && !data ? (
        <p role="alert" className={`${NOTE} text-destructive`}>{error}</p>
      ) : !data ? (
        <p role="status" className={`${NOTE} text-muted-foreground`}>Loading the emails</p>
      ) : (
        <>
          {error && <p role="alert" className="border-b border-border px-4 py-2 text-sm text-destructive">{error}</p>}
          {emails.length === 0 ? (
            <p className={`${NOTE} text-muted-foreground`}>No emails have been sent yet.</p>
          ) : (
            <ol>
              {emails.map((email) => {
                const details = [KIND[email.purpose], email.route ? SENT_FROM[email.route] : undefined].filter(Boolean).join(' · ');
                return (
                  <li key={email.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b border-border/60 px-4 py-2.5 last:border-0">
                    <div className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
                      <span className="break-words text-sm text-foreground">{email.subject || KIND[email.purpose] || 'Email'}</span>
                      <span className="break-words text-xs text-muted-foreground">To {email.recipient}</span>
                      {details && <span className="text-xs text-muted-foreground">{details}</span>}
                      {email.status === 'failed' && email.error && (
                        <span className="break-words text-xs text-destructive">{email.error}</span>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <StatusPill tone={STATUS[email.status].tone}>{STATUS[email.status].word}</StatusPill>
                      <time dateTime={email.created} className="text-xs tabular-nums text-muted-foreground">{shortDateTime(email.created)}</time>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </Card>
  );
};

export default DeliveryLog;
