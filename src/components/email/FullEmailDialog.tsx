// The whole email, in one window: the email that was sent to a person, as
// they got it, and (when it is opened from the Replies list) what they wrote
// back, above it.
//
// The reply is shown as plain words, never as HTML: it was written by somebody
// outside, and only its text is kept (migration 217). The sent email is our
// own wording with that person's values filled in and escaped, so it is shown
// the way the review before sending shows it.
import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { publicMessage } from '@/lib/publicError';
import { loadReplyText, loadSentEmail, type ReplyText, type SentEmail } from '@/services/supabase/emailReplies';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The sent email (email_messages.id). */
  messageId: string | null;
  /** The reply to it (email_inbox_events.id), when the window is opened from a reply. */
  replyEventId?: string | null;
  /** What the list already knows about that reply. */
  reply?: { who: string; address: string; at: Date; mailbox: string | null };
}

const when = (date: Date): string => format(date, 'd MMM yyyy, HH:mm');
const person = (name: string | null, address: string): string => (name && name.trim() && name.trim() !== address ? `${name.trim()} <${address}>` : address);

const Line: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex gap-2 text-xs">
    <dt className="w-14 shrink-0 text-muted-foreground">{label}</dt>
    <dd className="min-w-0 break-words text-foreground">{children}</dd>
  </div>
);

export const FullEmailDialog: React.FC<Props> = ({ open, onOpenChange, messageId, replyEventId = null, reply }) => {
  const [sent, setSent] = useState<SentEmail | null>(null);
  const [theirs, setTheirs] = useState<ReplyText | null | undefined>(undefined);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !messageId) return;
    let live = true;
    setSent(null);
    setTheirs(undefined);
    setProblem(null);
    loadSentEmail(messageId)
      .then((email) => { if (live) setSent(email); })
      .catch((err) => { if (live) setProblem(publicMessage(err, 'This email could not be loaded. Please try again.')); });
    if (replyEventId) {
      // A reply whose words cannot be read is still a reply: the window says where to read it instead.
      loadReplyText(replyEventId).then((text) => { if (live) setTheirs(text); }).catch(() => { if (live) setTheirs(null); });
    }
    return () => { live = false; };
  }, [open, messageId, replyEventId]);

  const title = replyEventId && reply ? `Reply from ${reply.who}` : sent ? `Email to ${sent.toName?.trim() || sent.to}` : 'Email';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {replyEventId ? 'What they wrote, and the email of yours that they answered.' : 'The email as this person got it.'}
          </DialogDescription>
        </DialogHeader>

        {replyEventId && reply && (
          <section aria-label="Their reply" className="rounded-lg border border-border">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Their reply</h3>
              <dl className="mt-2 space-y-1">
                <Line label="From">{person(reply.who, reply.address)}</Line>
                <Line label="Seen"><time dateTime={reply.at.toISOString()}>{when(reply.at)}</time></Line>
                {theirs?.subject && <Line label="Subject"><span className="font-medium">{theirs.subject}</span></Line>}
              </dl>
            </div>
            <div className="px-4 py-3">
              {theirs === undefined ? (
                <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Loading the reply…</p>
              ) : theirs === null || !theirs.body ? (
                <p className="text-sm text-muted-foreground">
                  The words of this reply were not kept. {reply.mailbox ? `You can read it in ${reply.mailbox}.` : 'The mailbox it arrived in has been removed.'}
                </p>
              ) : (
                <p className="whitespace-pre-wrap break-words text-sm text-foreground">{theirs.body}</p>
              )}
            </div>
          </section>
        )}

        {problem ? (
          <p role="alert" className="text-sm text-destructive">{problem}</p>
        ) : !sent ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Loading the email…</p>
        ) : (
          <section aria-label="The email you sent" className="rounded-lg border border-border">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">The email you sent</h3>
              <dl className="mt-2 space-y-1">
                <Line label="From">{sent.fromEmail ? person(sent.fromName, sent.fromEmail) : 'A mailbox that has been removed'}</Line>
                <Line label="To">{person(sent.toName, sent.to)}</Line>
                <Line label="Sent">
                  {sent.sentAt ? <time dateTime={sent.sentAt.toISOString()}>{when(sent.sentAt)}</time> : 'Not sent yet: this is how it will go out.'}
                </Line>
                <Line label="Subject"><span className="font-medium">{sent.view.subject}</span></Line>
              </dl>
            </div>
            {/* Our own wording, with this person's values escaped where they were filled in (substitutePlaceholders). */}
            <div className="break-words px-4 py-3 text-sm text-foreground [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_p:last-child]:mb-0 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: sent.view.html }} />
            {sent.view.footnote && <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">{sent.view.footnote}</p>}
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default FullEmailDialog;
