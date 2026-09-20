import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { AlertTriangle, Clock, Loader2, Mail, Send, Users } from 'lucide-react';
import { format } from 'date-fns';
import { buildMessage } from '@/lib/email/message';
import { applySignature } from '@/lib/email/signature';
import { placeholdersUsed } from '@/lib/email/richText';
import type { LaunchEstimate } from '@/lib/email/launchEstimate';
import type { EmailAccount } from '@/lib/email/types';
import type { Recipient } from '@/services/supabase/email';

interface LaunchReviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subject: string;
  bodyHtml: string;
  /** Null when the campaign uses the whole pool. */
  account: EmailAccount | null;
  /** Every mailbox that could take this, for the pool case. */
  poolAccounts: EmailAccount[];
  recipients: Recipient[];
  excludedCount: number;
  estimate: LaunchEstimate;
  scheduledAt: Date | null;
  sending: boolean;
  onConfirm: () => void;
}

/** The recipient a preview is rendered for: the first one that will be sent to. */
function previewRecipient(recipients: Recipient[]): Recipient | null {
  return recipients[0] ?? null;
}

/**
 * The last screen before a campaign goes out.
 *
 * Compose put the message, the audience and Send on one screen with no step
 * between writing and sending, so the first time anybody saw the message as a
 * recipient would see it was in the recipient's inbox. A send is not undoable:
 * whatever is wrong with it is wrong in somebody else's mail for ever.
 *
 * What it shows is chosen to answer the four questions somebody actually has
 * at that moment, in this order: who is this from, what does it say, who gets
 * it and who does not, and when. Everything here is read from the same
 * functions the send path uses — `buildMessage`, `applySignature` — rather
 * than approximated, because a preview that is merely similar to the real
 * message is worse than none: it is trusted and wrong.
 */
export const LaunchReview: React.FC<LaunchReviewProps> = ({
  open, onOpenChange, subject, bodyHtml, account, poolAccounts, recipients,
  excludedCount, estimate, scheduledAt, sending, onConfirm,
}) => {
  const person = previewRecipient(recipients);

  // The signature of whichever mailbox will actually send. With the pool that
  // is not knowable, so the first pool member stands in and the screen says
  // so — a preview showing one signature while the mail goes out under three
  // different ones would be the specific lie this screen exists to prevent.
  const signingAccount = account ?? poolAccounts[0] ?? null;

  const rendered = React.useMemo(() => {
    const withSignature = applySignature(bodyHtml, signingAccount?.signatureHtml ?? '');
    return buildMessage({
      kind: 'bulk',
      subject,
      bodyHtml: withSignature,
      mergeData: person?.mergeData ?? {},
      // The real unsubscribe URL is signed per message at send time; a preview
      // has no message id yet, so the footer is shown as a plain marker rather
      // than a link that would 404 if anybody clicked it.
      unsubscribeUrl: undefined,
    });
  }, [bodyHtml, subject, person, signingAccount]);

  // Placeholders the chosen recipient has no value for. They substitute to
  // nothing, which is how a message goes out reading "Hi ," — visible here
  // and nowhere else.
  const missing = React.useMemo(() => {
    if (!person) return [];
    const used = placeholdersUsed(`${subject} ${bodyHtml}`);
    return used.filter((name) => {
      const value = person.mergeData[name];
      return value === undefined || value === null || String(value).trim() === '';
    });
  }, [subject, bodyHtml, person]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review before sending</DialogTitle>
          <DialogDescription>
            This cannot be undone once it starts. Check the sender, the message and who it
            reaches.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* ── who it is from ─────────────────────────────────────── */}
          <section className="rounded-lg border border-border p-3">
            <p className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Mail className="h-4 w-4" />From
            </p>
            {account ? (
              <p className="text-sm">
                {account.fromName} &lt;{account.fromEmail}&gt;
                {account.signatureHtml.trim() === '' && (
                  <Badge variant="outline" className="ml-2 text-amber-700 dark:text-amber-400">
                    no signature
                  </Badge>
                )}
              </p>
            ) : (
              <div className="space-y-1 text-sm">
                <p>
                  The whole pool — {poolAccounts.length} mailbox
                  {poolAccounts.length === 1 ? '' : 'es'}, rotating.
                </p>
                <ul className="text-xs text-muted-foreground">
                  {poolAccounts.map((a) => (
                    <li key={a.id}>
                      {a.fromEmail}
                      {a.signatureHtml.trim() === '' && ' — no signature'}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Each signs with its own signature, so the preview below shows{' '}
                  {signingAccount?.fromEmail}&rsquo;s.
                </p>
              </div>
            )}
          </section>

          {/* ── what it says, to a real person ─────────────────────── */}
          <section className="rounded-lg border border-border p-3">
            <p className="mb-2 flex items-center gap-2 text-sm font-medium">
              Message
              {person && (
                <span className="text-xs font-normal text-muted-foreground">
                  as {person.email} will see it
                </span>
              )}
            </p>
            {missing.length > 0 && (
              <p className="mb-2 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {/* Not a blocker: an empty merge field is sometimes exactly
                      what somebody intends. It is only unacceptable to send it
                      without having been shown. */}
                  This person has nothing for {missing.map((m) => `{{${m}}}`).join(', ')} — those
                  will come out blank.
                </span>
              </p>
            )}
            <p className="text-sm font-medium">{rendered.subject}</p>
            <div
              className="prose prose-sm mt-2 max-h-56 max-w-none overflow-y-auto rounded border border-border bg-background p-3 dark:prose-invert"
              // The same HTML the send path builds. It is the message.
              dangerouslySetInnerHTML={{ __html: rendered.html }}
            />
          </section>

          {/* ── who gets it, and who does not ──────────────────────── */}
          <section className="rounded-lg border border-border p-3">
            <p className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Users className="h-4 w-4" />Audience
            </p>
            <p className="text-sm">
              <span className="text-lg font-semibold">{recipients.length}</span> will be sent to.
            </p>
            {excludedCount > 0 && (
              // Said out loud, because a silent exclusion is how somebody
              // believes they mailed 200 people and mailed 140.
              <p className="text-xs text-muted-foreground">
                {excludedCount} excluded — already unsubscribed, bounced or duplicated.
              </p>
            )}
          </section>

          {/* ── when, and for how long ─────────────────────────────── */}
          <section className="rounded-lg border border-border p-3">
            <p className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Clock className="h-4 w-4" />Timing
            </p>
            <p className="text-sm">
              {scheduledAt
                ? `Scheduled for ${format(scheduledAt, 'PPp')} (${
                    Intl.DateTimeFormat().resolvedOptions().timeZone
                  })`
                : 'Starts as soon as you confirm.'}
            </p>
            {/* The question the product never answered: not "when does it
                start" but "when is it finished". */}
            <p className="mt-1 text-xs text-muted-foreground">{estimate.summary}</p>
          </section>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Back to editing
          </Button>
          <Button type="button" onClick={onConfirm} disabled={sending || recipients.length === 0}>
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            {scheduledAt ? 'Schedule it' : `Send to ${recipients.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
