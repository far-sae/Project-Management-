import React, { useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Calendar, ListTodo, Phone, MapPin, User, Clock, Trash2,
  CheckCircle2, Loader2, RotateCcw, Video, Edit3, Copy, ExternalLink,
  ArrowDownLeft, ArrowUpRight, AlertTriangle, StickyNote, Mail,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import {
  updateClientTask, deleteClientTask,
  type ClientTaskPriority, type ClientTaskStatus,
} from '@/services/supabase/clientTasks';
import {
  updateMeeting, deleteMeeting, type MeetingStatus,
} from '@/services/supabase/meetings';
import { updateCall, deleteCall, type CallStatus } from '@/services/supabase/calls';
import type { Activity } from '@/services/supabase/activities';
import { cn } from '@/lib/utils';
import { CreateTaskDialog } from './CreateTaskDialog';
import { CreateMeetingDialog } from './CreateMeetingDialog';
import { CreateCallDialog } from './CreateCallDialog';

interface ActivityDetailDialogProps {
  activity: Activity | null;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}

const KIND_THEME: Record<import('@/services/supabase/activities').ActivityKind, { Icon: typeof Calendar; accent: string; label: string }> = {
  task:    { Icon: ListTodo,   accent: 'rose',    label: 'Task' },
  meeting: { Icon: Calendar,   accent: 'violet',  label: 'Meeting' },
  call:    { Icon: Phone,      accent: 'emerald', label: 'Call' },
  note:    { Icon: StickyNote, accent: 'amber',   label: 'Note' },
  email:   { Icon: Mail,       accent: 'sky',     label: 'Email' },
};

const PRIORITY_DOT: Record<ClientTaskPriority, string> = {
  high: 'bg-rose-500',
  normal: 'bg-amber-500',
  low: 'bg-slate-400',
};

// Banner gradient per kind — gives the dialog a distinct accent strip at
// the top so reps can tell at a glance what kind of record they opened.
const KIND_BANNER: Record<Activity['kind'], string> = {
  task:    'from-rose-500/15 via-rose-500/5 to-transparent',
  meeting: 'from-violet-500/15 via-violet-500/5 to-transparent',
  call:    'from-emerald-500/15 via-emerald-500/5 to-transparent',
  note:    'from-amber-500/15 via-amber-500/5 to-transparent',
  email:   'from-sky-500/15 via-sky-500/5 to-transparent',
};

const KIND_ICON_BG: Record<Activity['kind'], string> = {
  task:    'bg-rose-500/15 text-rose-600 dark:text-rose-300',
  meeting: 'bg-violet-500/15 text-violet-600 dark:text-violet-300',
  call:    'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
  note:    'bg-amber-500/15 text-amber-600 dark:text-amber-300',
  email:   'bg-sky-500/15 text-sky-600 dark:text-sky-300',
};

const TASK_STATUS_OPTS: ClientTaskStatus[] = ['pending', 'snoozed', 'done'];
const TASK_STATUS_LABEL: Record<ClientTaskStatus, string> = {
  pending: 'Not started',
  snoozed: 'Snoozed',
  done: 'Completed',
};

const MEETING_STATUS_OPTS: MeetingStatus[] = ['scheduled', 'held', 'cancelled', 'no_show'];
const MEETING_STATUS_LABEL: Record<MeetingStatus, string> = {
  scheduled: 'Scheduled',
  held: 'Held',
  cancelled: 'Cancelled',
  no_show: 'No-show',
};

const CALL_STATUS_OPTS: CallStatus[] = ['scheduled', 'completed', 'missed', 'cancelled'];
const CALL_STATUS_LABEL: Record<CallStatus, string> = {
  scheduled: 'Scheduled',
  completed: 'Completed',
  missed: 'Missed',
  cancelled: 'Cancelled',
};

const PRIORITY_OPTS: ClientTaskPriority[] = ['high', 'normal', 'low'];

/**
 * Modernized read + quick-edit view for a single Activity row.
 *
 * What's new vs the v1 dialog:
 *   - Kind-tinted banner + larger icon header so the type is unmissable.
 *   - Inline status pill — click to change without leaving the dialog.
 *   - For tasks: inline priority dot picker.
 *   - For calls: direction badge + duration prominently rendered.
 *   - For meetings: full participants list + Join Meet button.
 *   - "Edit" button opens the matching Create* dialog in EDIT mode so
 *     the user can change any field, not just status.
 *   - Relative time ("in 3 hours" / "2 days ago") alongside the
 *     absolute timestamp.
 *   - Copy-to-clipboard for Meet links.
 *
 * The detail dialog stays the "what is this and what do I do with it
 * right now" surface; the create/edit dialog is the "change every
 * field" surface. Two-step UX keeps the detail panel scannable.
 */
export const ActivityDetailDialog: React.FC<ActivityDetailDialogProps> = ({
  activity, onOpenChange, onChanged,
}) => {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  if (!activity) return null;
  const { Icon } = KIND_THEME[activity.kind];

  // ── Inline edits (status / priority) ────────────────────────────────────
  const setTaskStatus = async (next: ClientTaskStatus) => {
    if (activity.source.kind !== 'task') return;
    setBusy(true);
    try {
      await updateClientTask(
        activity.organizationId, activity.source.row.taskId, { status: next },
        { userId: user?.userId ?? '', displayName: user?.displayName ?? user?.email ?? '' },
      );
      toast.success(`Task → ${TASK_STATUS_LABEL[next].toLowerCase()}`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update status');
    } finally { setBusy(false); }
  };

  const setTaskPriority = async (next: ClientTaskPriority) => {
    if (activity.source.kind !== 'task') return;
    setBusy(true);
    try {
      await updateClientTask(
        activity.organizationId, activity.source.row.taskId, { priority: next },
        { userId: user?.userId ?? '', displayName: user?.displayName ?? user?.email ?? '' },
      );
      toast.success(`Priority → ${next}`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update priority');
    } finally { setBusy(false); }
  };

  const setMeetingStatus = async (next: MeetingStatus) => {
    if (activity.source.kind !== 'meeting') return;
    setBusy(true);
    try {
      await updateMeeting(activity.source.row.meetingId, { status: next });
      toast.success(`Meeting → ${MEETING_STATUS_LABEL[next].toLowerCase()}`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update status');
    } finally { setBusy(false); }
  };

  const setCallStatus = async (next: CallStatus) => {
    if (activity.source.kind !== 'call') return;
    setBusy(true);
    try {
      await updateCall(activity.source.row.callId, { callStatus: next });
      toast.success(`Call → ${CALL_STATUS_LABEL[next].toLowerCase()}`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update status');
    } finally { setBusy(false); }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete this ${activity.kind}? This can't be undone.`)) return;
    setBusy(true);
    try {
      if (activity.source.kind === 'task')         await deleteClientTask(activity.organizationId, activity.source.row.taskId);
      else if (activity.source.kind === 'meeting') await deleteMeeting(activity.source.row.meetingId, activity.organizationId);
      else if (activity.source.kind === 'call')    await deleteCall(activity.source.row.callId, activity.organizationId);
      else { toast.error('Notes and emails cannot be deleted from here.'); setBusy(false); return; }
      toast.success(`${activity.kind[0].toUpperCase()}${activity.kind.slice(1)} deleted`);
      onChanged();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete');
    } finally { setBusy(false); }
  };

  // ── Render helpers ──────────────────────────────────────────────────────
  const whenLabel = activity.whenAt ? (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <Clock className="w-3.5 h-3.5 text-muted-foreground" />
      <span className="font-medium">{format(activity.whenAt, "EEE, MMM d 'at' HH:mm")}</span>
      <span className="text-muted-foreground">
        ({formatDistanceToNow(activity.whenAt, { addSuffix: true })})
      </span>
    </span>
  ) : (
    <span className="text-sm text-muted-foreground inline-flex items-center gap-1.5">
      <Clock className="w-3.5 h-3.5" /> No date set
    </span>
  );

  const statusControl = (() => {
    if (activity.source.kind === 'task') {
      const cur = activity.source.row.status;
      return (
        <Select value={cur} onValueChange={(v) => setTaskStatus(v as ClientTaskStatus)} disabled={busy}>
          <SelectTrigger className="h-7 w-36 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TASK_STATUS_OPTS.map((s) => <SelectItem key={s} value={s}>{TASK_STATUS_LABEL[s]}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }
    if (activity.source.kind === 'meeting') {
      const cur = activity.source.row.status;
      return (
        <Select value={cur} onValueChange={(v) => setMeetingStatus(v as MeetingStatus)} disabled={busy}>
          <SelectTrigger className="h-7 w-36 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MEETING_STATUS_OPTS.map((s) => <SelectItem key={s} value={s}>{MEETING_STATUS_LABEL[s]}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }
    if (activity.source.kind === 'call') {
      const cur = activity.source.row.callStatus;
      return (
        <Select value={cur} onValueChange={(v) => setCallStatus(v as CallStatus)} disabled={busy}>
          <SelectTrigger className="h-7 w-36 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CALL_STATUS_OPTS.map((s) => <SelectItem key={s} value={s}>{CALL_STATUS_LABEL[s]}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }
    // note / email — no editable status
    return <Badge variant="outline" className="text-xs">Logged</Badge>;
  })();

  const copyMeetLink = async () => {
    if (activity.source.kind !== 'meeting' || !activity.source.row.googleMeetLink) return;
    try {
      await navigator.clipboard.writeText(activity.source.row.googleMeetLink);
      toast.success('Meet link copied');
    } catch {
      toast.error('Could not copy');
    }
  };

  return (
    <>
      <Dialog open={Boolean(activity) && !editing} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-hidden p-0 gap-0">
          {/* ── Banner header ───────────────────────────────────────────── */}
          <div className={cn('relative bg-gradient-to-br p-5 pb-4', KIND_BANNER[activity.kind])}>
            <DialogHeader>
              <div className="flex items-start gap-3">
                <span className={cn('inline-flex items-center justify-center w-11 h-11 rounded-lg shrink-0', KIND_ICON_BG[activity.kind])}>
                  <Icon className="w-5 h-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <DialogTitle className="text-lg leading-tight break-words">{activity.title}</DialogTitle>
                  <DialogDescription className="sr-only">
                    {activity.kind} detail — change status, edit fields, or delete.
                  </DialogDescription>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary" className="capitalize text-[10px]">{activity.kind}</Badge>
                    {activity.overdue && (
                      <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive gap-1">
                        <AlertTriangle className="w-3 h-3" /> Overdue
                      </Badge>
                    )}
                    {activity.source.kind === 'call' && (
                      <Badge variant="outline" className="text-[10px] gap-1">
                        {activity.source.row.callType === 'inbound' ? (
                          <><ArrowDownLeft className="w-3 h-3" /> Inbound</>
                        ) : (
                          <><ArrowUpRight className="w-3 h-3" /> Outbound</>
                        )}
                      </Badge>
                    )}
                    {activity.source.kind === 'call' && activity.source.row.callDurationSeconds != null && (
                      <Badge variant="outline" className="text-[10px]">
                        {Math.round(activity.source.row.callDurationSeconds / 60)} min
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </DialogHeader>
          </div>

          {/* ── Body ────────────────────────────────────────────────────── */}
          <div className="px-5 py-4 space-y-4 overflow-y-auto max-h-[60vh]">
            {/* Status + Priority inline editors */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Status</p>
                {statusControl}
              </div>
              {activity.source.kind === 'task' && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Priority</p>
                  <Select
                    value={activity.source.row.priority ?? 'normal'}
                    onValueChange={(v) => setTaskPriority(v as ClientTaskPriority)}
                    disabled={busy}
                  >
                    <SelectTrigger className="h-7 w-36 text-xs">
                      <span className="inline-flex items-center gap-2">
                        <span className={cn('inline-block w-2 h-2 rounded-full', PRIORITY_DOT[activity.source.row.priority ?? 'normal'])} />
                        <SelectValue />
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITY_OPTS.map((p) => (
                        <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Time + Owner */}
            <div className="space-y-1.5 text-sm">
              {whenLabel}
              {activity.ownerName && (
                <p className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <User className="w-3.5 h-3.5" />
                  {activity.ownerName}
                </p>
              )}
            </div>

            {/* Meeting-specific: location + participants + Meet link */}
            {activity.source.kind === 'meeting' && (
              <>
                {activity.source.row.location && (
                  <p className="text-sm inline-flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                    {activity.source.row.location}
                  </p>
                )}
                {activity.source.row.participants.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                      Participants ({activity.source.row.participants.length})
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {activity.source.row.participants.map((p, i) => (
                        <Badge key={i} variant="secondary" className="text-[11px]">
                          {p.name}
                          {p.email && p.email !== p.name && (
                            <span className="ml-1 text-muted-foreground">· {p.email}</span>
                          )}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {activity.source.row.googleMeetLink && (
                  <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 flex items-center gap-2">
                    <Video className="w-4 h-4 text-emerald-600 shrink-0" />
                    <a
                      href={activity.source.row.googleMeetLink}
                      target="_blank" rel="noopener noreferrer"
                      className="text-sm font-medium text-emerald-700 dark:text-emerald-300 hover:underline truncate flex-1"
                    >
                      Join Google Meet
                    </a>
                    <button
                      type="button" onClick={copyMeetLink}
                      className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                      title="Copy link"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <a
                      href={activity.source.row.googleMeetLink}
                      target="_blank" rel="noopener noreferrer"
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}
              </>
            )}

            {/* Call-specific: contact + outcome */}
            {activity.source.kind === 'call' && (activity.source.row.contactName || activity.source.row.contactPhone) && (
              <div className="rounded-md border p-2.5 text-sm space-y-0.5">
                {activity.source.row.contactName && (
                  <p className="font-medium">{activity.source.row.contactName}</p>
                )}
                {activity.source.row.contactPhone && (
                  <p className="text-muted-foreground inline-flex items-center gap-1.5">
                    <Phone className="w-3 h-3" /> {activity.source.row.contactPhone}
                  </p>
                )}
              </div>
            )}

            {/* Description + Outcome */}
            {activity.description && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Description</p>
                <p className="text-sm whitespace-pre-wrap break-words">{activity.description}</p>
              </div>
            )}
            {activity.source.kind === 'call' && activity.source.row.outcome && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Outcome</p>
                <p className="text-sm whitespace-pre-wrap break-words">{activity.source.row.outcome}</p>
              </div>
            )}

            {/* Task repeat rule */}
            {activity.source.kind === 'task' && activity.source.row.repeatRule && (
              <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                <RotateCcw className="w-3 h-3" /> Repeats {activity.source.row.repeatRule.replace('FREQ=', '').toLowerCase()}
              </p>
            )}
          </div>

          {/* ── Footer ──────────────────────────────────────────────────── */}
          <div className="border-t px-5 py-3 flex items-center gap-2 bg-muted/20">
            <Button
              variant="ghost" size="sm" onClick={handleDelete} disabled={busy}
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              title="Delete"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            </Button>
            <span className="flex-1" />
            <Button variant="outline" size="sm" onClick={() => setEditing(true)} disabled={busy}>
              <Edit3 className="w-3.5 h-3.5 mr-1.5" /> Edit
            </Button>
            <Button
              size="sm" onClick={() => {
                if (activity.source.kind === 'task')         setTaskStatus(activity.open ? 'done'       : 'pending');
                else if (activity.source.kind === 'meeting') setMeetingStatus(activity.open ? 'held'    : 'scheduled');
                else if (activity.source.kind === 'call')    setCallStatus(activity.open ? 'completed'  : 'scheduled');
                // note / email are always logged — no status change needed
                onOpenChange(false);
              }}
              disabled={busy}
            >
              {activity.open
                ? <><CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Mark closed</>
                : <><RotateCcw   className="w-3.5 h-3.5 mr-1.5" /> Reopen</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit mode — opens the matching Create dialog with prefilled
          state via the editX prop. Closing flips back to the detail view. */}
      {activity.source.kind === 'task' && (
        <CreateTaskDialog
          open={editing}
          onOpenChange={(o) => { setEditing(o); if (!o) onChanged(); }}
          editTask={activity.source.row}
        />
      )}
      {activity.source.kind === 'meeting' && (
        <CreateMeetingDialog
          open={editing}
          onOpenChange={(o) => { setEditing(o); if (!o) onChanged(); }}
          editMeeting={activity.source.row}
        />
      )}
      {activity.source.kind === 'call' && (
        <CreateCallDialog
          open={editing}
          onOpenChange={(o) => { setEditing(o); if (!o) onChanged(); }}
          editCall={activity.source.row}
        />
      )}
    </>
  );
};
