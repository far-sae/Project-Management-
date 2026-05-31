import React, { useEffect, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { Mail, ArrowDownLeft, ArrowUpRight, Loader2, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  listEntityEmails, type EmailEvent, type EmailEntityType,
} from '@/services/supabase/emailEvents';
import { cn } from '@/lib/utils';

interface EntityEmailsSectionProps {
  organizationId: string | null;
  entityType: EmailEntityType;
  entityId: string;
  /** Reload trigger — bump this from the parent after a Send Email
   *  action so the new row appears immediately. */
  refreshKey?: number;
}

const STATUS_TONE: Record<EmailEvent['status'], string> = {
  sent: 'text-muted-foreground',
  delivered: 'text-emerald-700 dark:text-emerald-300',
  failed: 'text-destructive',
  received: 'text-sky-700 dark:text-sky-300',
};

/**
 * Per-entity email timeline backed by public.email_events
 * (migration 116). Outbound rows are written by the notify-send-gmail
 * edge function; inbound by gmail-inbound. The section is purely
 * read-only — composing emails still goes through the existing
 * Send Email button on the parent drawer.
 */
export const EntityEmailsSection: React.FC<EntityEmailsSectionProps> = ({
  organizationId, entityType, entityId, refreshKey = 0,
}) => {
  const [events, setEvents] = useState<EmailEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!organizationId) { setEvents([]); return; }
    setLoading(true);
    listEntityEmails(organizationId, entityType, entityId)
      .then(setEvents)
      .finally(() => setLoading(false));
  }, [organizationId, entityType, entityId, refreshKey]);

  return (
    <div>
      <h3 className="text-sm font-semibold flex items-center gap-2 border-b pb-1.5 mb-2">
        <Mail className="w-4 h-4 text-muted-foreground" /> Emails
        <span className="text-[11px] text-muted-foreground font-normal">
          ({events.length})
        </span>
      </h3>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
        </div>
      ) : events.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No emails logged for this record yet. Use Send Email above to email this contact —
          successful sends through the in-app composer log here automatically.
        </p>
      ) : (
        <ul className="space-y-2">
          {events.map((e) => {
            const isOutbound = e.direction === 'outbound';
            const Arrow = isOutbound ? ArrowUpRight : ArrowDownLeft;
            const who = isOutbound
              ? `To ${e.toEmails.join(', ') || '—'}`
              : `From ${e.fromEmail ?? '—'}`;
            return (
              <li key={e.eventId} className="rounded-md border p-2.5">
                <div className="flex items-start gap-2">
                  <Arrow className={cn(
                    'w-3.5 h-3.5 mt-0.5 shrink-0',
                    isOutbound ? 'text-violet-600' : 'text-sky-600',
                  )} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-medium truncate">
                        {e.subject ?? <span className="italic text-muted-foreground">(no subject)</span>}
                      </p>
                      <Badge variant="outline" className="text-[9px] capitalize px-1 py-0">
                        {e.direction}
                      </Badge>
                      {e.status === 'failed' && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 text-destructive border-destructive/40 gap-1">
                          <AlertTriangle className="w-2.5 h-2.5" /> Failed
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">{who}</p>
                    {e.snippet && (
                      <p className="text-xs mt-1 text-foreground/80 line-clamp-2">{e.snippet}</p>
                    )}
                    <p className={cn('text-[11px] mt-1', STATUS_TONE[e.status])}>
                      {format(e.occurredAt, 'MMM d, yyyy · HH:mm')}
                      {' · '}
                      {formatDistanceToNow(e.occurredAt, { addSuffix: true })}
                      {e.senderName && isOutbound && <> · sent by {e.senderName}</>}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
