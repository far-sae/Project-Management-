import React, { useState } from 'react';
import { format } from 'date-fns';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Calendar, ListTodo, Phone, MapPin, User, Clock, Trash2, CheckCircle2, Loader2,
  RotateCcw, Video,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { updateClientTask, deleteClientTask } from '@/services/supabase/clientTasks';
import { updateMeeting, deleteMeeting } from '@/services/supabase/meetings';
import { updateCall, deleteCall } from '@/services/supabase/calls';
import type { Activity } from '@/services/supabase/activities';

interface ActivityDetailDialogProps {
  activity: Activity | null;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}

/**
 * Read + light-edit detail view for a single Activity row. Every
 * button on the card opens this — so there's never a "card you can
 * click but nothing happens" UX. From here the user can mark
 * Open ↔ Closed, delete, or follow the Meet link.
 *
 * Full editing (re-pick host, change participants, etc.) is reserved
 * for a v2 — we keep this surface small to keep the build shippable.
 */
export const ActivityDetailDialog: React.FC<ActivityDetailDialogProps> = ({
  activity, onOpenChange, onChanged,
}) => {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);

  if (!activity) return null;

  const handleToggleStatus = async () => {
    setBusy(true);
    try {
      if (activity.source.kind === 'task') {
        await updateClientTask(
          activity.organizationId,
          activity.source.row.taskId,
          { status: activity.open ? 'done' : 'pending' },
          { userId: user?.userId ?? '', displayName: user?.displayName ?? user?.email ?? '' },
        );
      } else if (activity.source.kind === 'meeting') {
        await updateMeeting(activity.source.row.meetingId, {
          status: activity.open ? 'held' : 'scheduled',
        });
      } else {
        await updateCall(activity.source.row.callId, {
          callStatus: activity.open ? 'completed' : 'scheduled',
        });
      }
      toast.success(activity.open ? 'Marked closed' : 'Reopened');
      onChanged();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete this ${activity.kind}? This can't be undone.`)) return;
    setBusy(true);
    try {
      if (activity.source.kind === 'task') {
        await deleteClientTask(activity.organizationId, activity.source.row.taskId);
      } else if (activity.source.kind === 'meeting') {
        await deleteMeeting(activity.source.row.meetingId, activity.organizationId);
      } else {
        await deleteCall(activity.source.row.callId, activity.organizationId);
      }
      toast.success(`${activity.kind[0].toUpperCase()}${activity.kind.slice(1)} deleted`);
      onChanged();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete');
    } finally {
      setBusy(false);
    }
  };

  const Icon = activity.kind === 'task' ? ListTodo
    : activity.kind === 'meeting' ? Calendar : Phone;
  const tone = activity.kind === 'task' ? 'text-rose-600'
    : activity.kind === 'meeting' ? 'text-violet-600' : 'text-emerald-600';

  return (
    <Dialog open={Boolean(activity)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className={`w-5 h-5 ${tone}`} />
            {activity.title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant={activity.open ? 'default' : 'outline'}>
              {activity.open ? 'Open' : 'Closed'}
            </Badge>
            {activity.overdue && <Badge variant="outline" className="text-destructive border-destructive/40">Overdue</Badge>}
            <Badge variant="secondary" className="capitalize">{activity.kind}</Badge>
          </div>

          {activity.whenAt && (
            <p className="text-muted-foreground inline-flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              {format(activity.whenAt, "EEEE, MMM d, yyyy 'at' HH:mm")}
            </p>
          )}

          {activity.ownerName && (
            <p className="text-muted-foreground inline-flex items-center gap-1.5">
              <User className="w-3.5 h-3.5" />
              {activity.ownerName}
            </p>
          )}

          {activity.source.kind === 'meeting' && activity.source.row.location && (
            <p className="text-muted-foreground inline-flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" />
              {activity.source.row.location}
            </p>
          )}

          {activity.source.kind === 'meeting' && activity.source.row.participants.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">
                Participants ({activity.source.row.participants.length})
              </p>
              <div className="flex flex-wrap gap-1">
                {activity.source.row.participants.map((p, i) => (
                  <Badge key={i} variant="secondary" className="text-[11px]">{p.name}</Badge>
                ))}
              </div>
            </div>
          )}

          {activity.source.kind === 'meeting' && activity.source.row.googleMeetLink && (
            <a
              href={activity.source.row.googleMeetLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-emerald-600 hover:text-emerald-700 text-sm font-medium"
            >
              <Video className="w-3.5 h-3.5" /> Join Google Meet
            </a>
          )}

          {activity.description && (
            <div className="pt-2 border-t">
              <p className="text-xs font-medium text-muted-foreground mb-1">Description</p>
              <p className="whitespace-pre-wrap break-words">{activity.description}</p>
            </div>
          )}

          {activity.source.kind === 'call' && activity.source.row.outcome && (
            <div className="pt-2 border-t">
              <p className="text-xs font-medium text-muted-foreground mb-1">Outcome</p>
              <p className="whitespace-pre-wrap break-words">{activity.source.row.outcome}</p>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row gap-2">
          <Button variant="ghost" size="sm" onClick={handleDelete} disabled={busy} className="text-destructive">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          </Button>
          <span className="flex-1" />
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={handleToggleStatus} disabled={busy}>
            {activity.open ? (
              <><CheckCircle2 className="w-4 h-4 mr-1.5" /> Mark closed</>
            ) : (
              <><RotateCcw className="w-4 h-4 mr-1.5" /> Reopen</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
