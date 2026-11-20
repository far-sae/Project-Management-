// Approvals: the list with Review / Approve / Reject, the dialog that shows the whole action, and the reject question.
import React, { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Approval } from '../../../api/_automation/shared/types';
import { useAutomation } from '@/hooks/useAutomation';
import { ago, approveBody, describeAction } from '@/lib/automation/format';
import { errorSentence, errorStatus } from '@/services/automation/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const REASON_MAX = 500;

type Edited = { subject: string; body: string };

/** The whole action behind one approval. An email can be changed before it is approved. */
const ReviewForm: React.FC<{
  approval: Approval;
  busy: boolean;
  onApprove: (edited: Edited | null) => void;
  onReject: () => void;
  onClose: () => void;
}> = ({ approval, busy, onApprove, onReject, onClose }) => {
  const id = useId();
  const { action } = approval;
  const email = action.type === 'send_email' ? action : null;
  const [subject, setSubject] = useState(email?.subject ?? '');
  const [body, setBody] = useState(email?.body ?? '');
  const changed = email !== null && (subject !== email.subject || body !== email.body);
  const incomplete = email !== null && (!subject.trim() || !body.trim());

  return (
    // Enter in the subject line must not send the email: only the Approve button approves.
    <form className="flex min-w-0 flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
      <DialogHeader>
        <DialogTitle className="pr-8">{approval.what}</DialogTitle>
        <DialogDescription>
          {approval.agentName} · {approval.about} · {ago(approval.created)}
        </DialogDescription>
      </DialogHeader>

      {email ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">To</span>
            <p className="break-words text-sm text-foreground">{approval.to ? `${approval.to} (${approval.about})` : `The lead’s own email address (${approval.about})`}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-subject`}>Subject</Label>
            <Input id={`${id}-subject`} value={subject} maxLength={300} disabled={busy} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-body`}>Body</Label>
            <Textarea id={`${id}-body`} rows={10} value={body} disabled={busy} onChange={(e) => setBody(e.target.value)} />
          </div>
          <p role="status" className="text-xs text-muted-foreground">
            {incomplete
              ? 'An email needs a subject and a body.'
              : changed
                ? 'The email goes out as you changed it.'
                : 'You can change the subject and the text before you approve.'}
          </p>
        </div>
      ) : (
        <p className="whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
          {describeAction(action)}
        </p>
      )}

      <DialogFooter className="gap-y-2">
        <Button type="button" variant="ghost" onClick={onReject} disabled={busy}>Reject</Button>
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Decide later</Button>
        <Button type="button" disabled={busy || incomplete} onClick={() => onApprove(email ? { subject, body } : null)}>
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          Approve
        </Button>
      </DialogFooter>
    </form>
  );
};

/** Asks why, before an approval is rejected. The reason is optional. */
const RejectForm: React.FC<{
  approval: Approval;
  busy: boolean;
  onReject: (reason: string) => void;
  onClose: () => void;
}> = ({ approval, busy, onReject, onClose }) => {
  const id = useId();
  const [reason, setReason] = useState('');
  return (
    <form
      className="flex min-w-0 flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) onReject(reason.trim());
      }}
    >
      <DialogHeader>
        <DialogTitle className="pr-8">Reject this?</DialogTitle>
        <DialogDescription>
          “{approval.what}” is not carried out, and the run for {approval.about} stops at this step.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-reason`}>Reason (optional)</Label>
        <Textarea
          id={`${id}-reason`} rows={3} value={reason} maxLength={REASON_MAX} disabled={busy} autoFocus
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <DialogFooter className="gap-y-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="destructive" disabled={busy}>
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          Reject
        </Button>
      </DialogFooter>
    </form>
  );
};

/**
 * The approvals that are waiting, each with what it is, who asks, who it is
 * about and since when. Review, Approve and Reject are shown only on the ones
 * the person may decide. `onDecided` runs after a decision so the screen can
 * read its data again.
 */
export const ApprovalList: React.FC<{
  approvals: readonly Approval[];
  onDecided: () => void;
  className?: string;
}> = ({ approvals, onDecided, className }) => {
  const { client } = useAutomation();
  const [reviewing, setReviewing] = useState<Approval | null>(null);
  const [rejecting, setRejecting] = useState<Approval | null>(null);
  const [busy, setBusy] = useState(false);

  const decide = async (approval: Approval, path: 'approve' | 'reject', body: object, done: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await client.call<Approval>(`approvals/${approval.id}/${path}`, body);
      toast.success(done);
      setReviewing(null);
      setRejecting(null);
      onDecided();
    } catch (e) {
      toast.error(errorSentence(e));
      // Someone else decided it meanwhile, or it is gone: show what the server has now.
      if (errorStatus(e) === 404 || errorStatus(e) === 409) {
        setReviewing(null);
        setRejecting(null);
        onDecided();
      }
    } finally {
      setBusy(false);
    }
  };

  const approve = (approval: Approval, edited: Edited | null) =>
    decide(approval, 'approve', approveBody(approval.action, edited), 'Approved. The run goes on.');
  const reject = (approval: Approval, reason: string) =>
    decide(approval, 'reject', reason ? { reason } : {}, 'Rejected. The run has stopped.');

  return (
    <>
      <ul className={cn('divide-y divide-border', className)}>
        {approvals.map((approval) => (
          <li key={approval.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
            <div className="min-w-0 flex-1 basis-60">
              <p className="break-words text-sm font-medium text-foreground">{approval.what}</p>
              <p className="break-words text-xs text-muted-foreground">
                {approval.agentName} · {approval.about} · {ago(approval.created)}
              </p>
            </div>
            {approval.canDecide ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <Button size="sm" variant="outline" aria-label={`Review: ${approval.what}`} disabled={busy} onClick={() => setReviewing(approval)}>
                  Review
                </Button>
                <Button size="sm" aria-label={`Approve: ${approval.what}`} disabled={busy} onClick={() => void approve(approval, null)}>
                  Approve
                </Button>
                <Button size="sm" variant="ghost" aria-label={`Reject: ${approval.what}`} disabled={busy} onClick={() => setRejecting(approval)}>
                  Reject
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">For the lead’s owner or an admin to decide.</p>
            )}
          </li>
        ))}
      </ul>

      <Dialog open={reviewing !== null} onOpenChange={(open) => { if (!open && !busy) setReviewing(null); }}>
        <DialogContent className="sm:max-w-xl">
          {reviewing && (
            <ReviewForm
              key={reviewing.id}
              approval={reviewing}
              busy={busy}
              onApprove={(edited) => void approve(reviewing, edited)}
              onReject={() => { setRejecting(reviewing); setReviewing(null); }}
              onClose={() => setReviewing(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={rejecting !== null} onOpenChange={(open) => { if (!open && !busy) setRejecting(null); }}>
        <DialogContent className="sm:max-w-md">
          {rejecting && (
            <RejectForm
              key={rejecting.id}
              approval={rejecting}
              busy={busy}
              onReject={(reason) => void reject(rejecting, reason)}
              onClose={() => setRejecting(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ApprovalList;
