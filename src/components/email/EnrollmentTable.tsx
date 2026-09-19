import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Send, CheckCircle2, CircleSlash, Users } from 'lucide-react';
import { format } from 'date-fns';
import type { EmailEnrollment, EnrollmentStatus, StopReason } from '@/lib/email/types';

interface EnrollmentTableProps {
  enrollments: EmailEnrollment[];
  loading: boolean;
  /** The enrollment currently being stopped, if any. */
  stoppingId: string | null;
  onStop: (enrollment: EmailEnrollment) => void;
}

const enrollmentStatusBadge = (status: EnrollmentStatus) => {
  switch (status) {
    case 'completed':
      return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"><CheckCircle2 className="w-3 h-3 mr-1" />Completed</Badge>;
    case 'stopped':
      return <Badge variant="secondary"><CircleSlash className="w-3 h-3 mr-1" />Stopped</Badge>;
    default:
      return <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30"><Send className="w-3 h-3 mr-1" />Active</Badge>;
  }
};

/**
 * Why an enrollment ended, in the words a person would use. Never the stored
 * token: 'failed' in particular reads as the recipient's fault and is not —
 * it is a send of ours that would not go.
 */
export const stopReasonLabel = (reason: StopReason): string => {
  switch (reason) {
    case 'replied':
      return 'Replied';
    case 'bounced':
      return 'Bounced';
    case 'unsubscribed':
      return 'Unsubscribed';
    case 'failed':
      return 'Could not be delivered';
    default:
      return 'Stopped by hand';
  }
};

export const EnrollmentTable: React.FC<EnrollmentTableProps> = ({
  enrollments, loading, stoppingId, onStop,
}) => {
  if (loading) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        <Loader2 className="w-6 h-6 mx-auto animate-spin" />
      </div>
    );
  }

  if (enrollments.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Users className="w-14 h-14 mx-auto mb-4 text-muted-foreground/60" />
        <p className="text-lg font-medium text-foreground">Nobody is enrolled yet</p>
        <p className="text-sm">Add people above to start them at the first step.</p>
      </div>
    );
  }

  return (
    <div className="max-h-72 overflow-y-auto divide-y divide-border rounded-lg border border-border">
      {enrollments.map((enrollment) => (
        <div key={enrollment.id} className="flex items-center justify-between gap-3 px-4 py-2">
          <div className="min-w-0">
            <p className="text-sm truncate">{enrollment.toName || enrollment.toEmail}</p>
            {enrollment.toName && (
              <p className="text-xs text-muted-foreground truncate">{enrollment.toEmail}</p>
            )}
            {enrollment.status === 'stopped' && enrollment.stopReason && (
              <p className="text-xs text-muted-foreground truncate">
                {stopReasonLabel(enrollment.stopReason)}
                {enrollment.stoppedAt && ` on ${format(enrollment.stoppedAt, 'MMM d, yyyy')}`}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-sm text-muted-foreground" title="The step this person will get next">
              Step {enrollment.currentStep + 1}
            </span>
            <span className="text-xs text-muted-foreground hidden sm:inline">
              {/* Null is not "overdue" and not an error: the previous step is
                  queued and unsent, or the sequence is over for this person. */}
              {enrollment.nextDueAt
                ? `Due ${format(enrollment.nextDueAt, 'MMM d, yyyy HH:mm')}`
                : 'Nothing scheduled'}
            </span>
            {enrollmentStatusBadge(enrollment.status)}
            {enrollment.status === 'active' && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Stop ${enrollment.toEmail}`}
                disabled={stoppingId === enrollment.id}
                onClick={() => onStop(enrollment)}
              >
                {stoppingId === enrollment.id
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : 'Stop'}
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default EnrollmentTable;
