import React, { useId, useMemo, useState } from 'react';
import { CalendarOff, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusPill } from '@/components/common/StatusPill';
import { cn } from '@/lib/utils';
import { LEAVE_STATUS_LABEL, LEAVE_TYPE_LABEL, type LeaveStatus } from '@/lib/leave';
import type { UseLeave } from '@/hooks/useLeave';
import type { LeaveRequest } from '@/services/supabase/leave';
import type { HrPerson } from '../types';
import { PersonCell } from './PersonCell';
import {
  errorMessage,
  formatDayCount,
  formatDays,
  formatLeaveDates,
  LEAVE_STATUS_TONE,
  personName,
  ROW_ICON_BUTTON,
  sortLeaveRequests,
  TABLE_BOX,
  TABLE_HEAD_ROW,
  TABLE_ROW,
} from './leaveView';
import { useLastValue } from './useLastValue';

type StatusFilter = 'all' | LeaveStatus;

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: LEAVE_STATUS_LABEL.pending },
  { value: 'approved', label: LEAVE_STATUS_LABEL.approved },
  { value: 'rejected', label: LEAVE_STATUS_LABEL.rejected },
  { value: 'cancelled', label: LEAVE_STATUS_LABEL.cancelled },
];

/** Small square tag (4px corners). */
const TAG =
  'inline-flex h-5 shrink-0 items-center rounded border border-border px-1.5 text-xs text-muted-foreground';

/** "Annual leave, 17 Nov – 19 Nov 2026 (3 days)" */
const summarize = (r: LeaveRequest) =>
  `${LEAVE_TYPE_LABEL[r.leaveType]}, ${formatLeaveDates(r.startDate, r.endDate)} (${formatDayCount(r.days)})`;

interface LeaveRequestsTableProps {
  people: HrPerson[];
  leave: UseLeave;
}

/** Every leave request, with the owner's approve / reject / cancel / delete actions. */
export const LeaveRequestsTable: React.FC<LeaveRequestsTableProps> = ({ people, leave }) => {
  const filterId = useId();
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<LeaveRequest | null>(null);
  const [deleting, setDeleting] = useState<LeaveRequest | null>(null);

  const byId = useMemo(() => new Map(people.map((p) => [p.userId, p])), [people]);
  const nameOf = (r: LeaveRequest) => personName(byId.get(r.userId));

  const rows = useMemo(() => {
    const shown = filter === 'all' ? leave.requests : leave.requests.filter((r) => r.status === filter);
    return sortLeaveRequests(shown, filter === 'all');
  }, [leave.requests, filter]);

  /** Run one write for a row: lock the row, then say how it went. */
  const run = async (id: string, write: () => Promise<unknown>, done: string): Promise<boolean> => {
    setBusyId(id);
    try {
      await write();
      toast.success(done);
      return true;
    } catch (e) {
      toast.error(errorMessage(e, 'Could not save the change.'));
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const approve = (r: LeaveRequest) =>
    void run(r.id, () => leave.decide(r.id, 'approved'), `Leave approved for ${nameOf(r)}`);

  const cancel = (r: LeaveRequest) =>
    void run(r.id, () => leave.decide(r.id, 'cancelled'), `Leave cancelled for ${nameOf(r)}`);

  const reject = async (r: LeaveRequest, note: string) => {
    const ok = await run(
      r.id,
      () => leave.decide(r.id, 'rejected', note.trim() || null),
      `Leave rejected for ${nameOf(r)}`,
    );
    if (ok) setRejecting(null);
  };

  const remove = (r: LeaveRequest) => void run(r.id, () => leave.remove(r.id), 'Leave deleted');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Label htmlFor={filterId} className="text-xs text-muted-foreground">
            Status
          </Label>
          <Select value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}>
            <SelectTrigger id={filterId} className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {filter !== 'all' && (
          <p className="text-xs tabular-nums text-muted-foreground">
            {rows.length} of {leave.requests.length} shown
          </p>
        )}
      </div>

      <div className={TABLE_BOX}>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-4 py-12 text-center">
            <CalendarOff className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
            {filter === 'all' ? (
              <>
                <p className="text-sm font-medium">No leave requests yet.</p>
                <p className="text-xs text-muted-foreground">
                  Use Add leave to record time off for anyone on the team.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium">No {LEAVE_STATUS_LABEL[filter].toLowerCase()} requests.</p>
                <p className="text-xs text-muted-foreground">Choose another status to see the rest.</p>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead>
                <tr className={TABLE_HEAD_ROW}>
                  <th scope="col" className="px-4 font-medium">Employee</th>
                  <th scope="col" className="px-4 font-medium">Type</th>
                  <th scope="col" className="px-4 font-medium">Dates</th>
                  <th scope="col" className="px-4 text-right font-medium">Days</th>
                  <th scope="col" className="px-4 font-medium">Status</th>
                  <th scope="col" className="px-4 font-medium">Reason</th>
                  <th scope="col" className="px-4 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const name = nameOf(r);
                  const busy = busyId === r.id;
                  return (
                    <tr key={r.id} className={TABLE_ROW}>
                      <td className="px-4">
                        <PersonCell person={byId.get(r.userId)} />
                      </td>
                      <td className="whitespace-nowrap px-4">{LEAVE_TYPE_LABEL[r.leaveType]}</td>
                      <td className="whitespace-nowrap px-4 tabular-nums">
                        <span>{formatLeaveDates(r.startDate, r.endDate)}</span>
                        {r.halfDay && <span className={cn(TAG, 'ml-2')}>Half day</span>}
                      </td>
                      <td className="px-4 text-right tabular-nums">{formatDays(r.days)}</td>
                      <td className="px-4">
                        <StatusPill tone={LEAVE_STATUS_TONE[r.status]}>{LEAVE_STATUS_LABEL[r.status]}</StatusPill>
                      </td>
                      <td className="max-w-[16rem] px-4 py-2">
                        {r.reason ? (
                          <p className="truncate" title={r.reason}>
                            {r.reason}
                          </p>
                        ) : (
                          !r.decisionNote && <span className="text-muted-foreground">—</span>
                        )}
                        {r.decisionNote && (
                          <p className="truncate text-xs text-muted-foreground" title={r.decisionNote}>
                            Note: {r.decisionNote}
                          </p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          {r.status === 'pending' && (
                            <>
                              <Button size="sm" variant="outline" disabled={busy} onClick={() => approve(r)}>
                                {busy && <Loader2 className="animate-spin" aria-hidden />}
                                Approve
                              </Button>
                              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRejecting(r)}>
                                Reject
                              </Button>
                            </>
                          )}
                          {r.status === 'approved' && (
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => cancel(r)}>
                              {busy && <Loader2 className="animate-spin" aria-hidden />}
                              Cancel leave
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className={cn(ROW_ICON_BUTTON, 'hover:bg-destructive-soft hover:text-destructive')}
                            disabled={busy}
                            onClick={() => setDeleting(r)}
                            title="Delete leave"
                            aria-label={`Delete leave for ${name}`}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <RejectLeaveDialog
        request={rejecting}
        name={rejecting ? nameOf(rejecting) : ''}
        saving={rejecting !== null && busyId === rejecting.id}
        onClose={() => setRejecting(null)}
        onReject={(note) => rejecting && void reject(rejecting, note)}
      />

      <DeleteLeaveDialog
        request={deleting}
        name={deleting ? nameOf(deleting) : ''}
        onClose={() => setDeleting(null)}
        onDelete={() => deleting && remove(deleting)}
      />
    </div>
  );
};

interface RejectLeaveDialogProps {
  request: LeaveRequest | null;
  name: string;
  saving: boolean;
  onClose: () => void;
  onReject: (note: string) => void;
}

const RejectLeaveDialog: React.FC<RejectLeaveDialogProps> = ({ request, name, saving, onClose, onReject }) => {
  const shown = useLastValue(request ? { request, name } : null);
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        {shown && (
          <RejectLeaveForm
            key={shown.request.id}
            request={shown.request}
            name={shown.name}
            saving={saving}
            onClose={onClose}
            onReject={onReject}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};

/** Mounted with the dialog, so the note starts empty every time it opens. */
const RejectLeaveForm: React.FC<Omit<RejectLeaveDialogProps, 'request'> & { request: LeaveRequest }> = ({
  request,
  name,
  saving,
  onClose,
  onReject,
}) => {
  const noteId = useId();
  const [note, setNote] = useState('');
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!saving) onReject(note);
      }}
    >
      <DialogHeader>
        <DialogTitle>Reject leave for {name}?</DialogTitle>
        <DialogDescription>{summarize(request)}.</DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor={noteId}>Note</Label>
        <Textarea
          id={noteId}
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional. Shown next to the request."
          disabled={saving}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="animate-spin" aria-hidden />}
          Reject leave
        </Button>
      </DialogFooter>
    </form>
  );
};

interface DeleteLeaveDialogProps {
  request: LeaveRequest | null;
  name: string;
  onClose: () => void;
  onDelete: () => void;
}

const DeleteLeaveDialog: React.FC<DeleteLeaveDialogProps> = ({ request, name, onClose, onDelete }) => {
  const shown = useLastValue(request ? { request, name } : null);
  return (
    <AlertDialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete leave for {shown?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {shown ? summarize(shown.request) : ''}. It is removed from the record and no longer counts against
            their allowance. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onDelete}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
