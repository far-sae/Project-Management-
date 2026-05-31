import React, { useMemo, useState } from 'react';
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, closestCorners, useDraggable, useDroppable,
  useSensor, useSensors,
} from '@dnd-kit/core';
import { Card, CardContent } from '@/components/ui/card';
import { GripVertical, CircleDashed, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import type { Activity } from '@/services/supabase/activities';
import {
  updateClientTask, type ClientTaskStatus,
} from '@/services/supabase/clientTasks';
import { updateMeeting, type MeetingStatus } from '@/services/supabase/meetings';
import { updateCall, type CallStatus } from '@/services/supabase/calls';
import { ActivityCard } from './ActivityCard';

interface ActivitiesStatusKanbanProps {
  activities: Activity[];
  onSelect: (a: Activity) => void;
  onChanged: () => void;
}

/** The 4 unified status columns. Each activity kind maps to one of
 *  these via the per-kind status fields (client_tasks.status,
 *  meetings.status, calls.call_status). Dragging a card between
 *  columns calls the matching update API. */
type StatusBucket = 'open' | 'in_progress' | 'done' | 'cancelled';

const STATUS_ORDER: StatusBucket[] = ['open', 'in_progress', 'done', 'cancelled'];

const STATUS_META: Record<StatusBucket, { label: string; accent: string }> = {
  open:        { label: 'Not Started',  accent: 'border-t-sky-500/40' },
  in_progress: { label: 'In Progress',  accent: 'border-t-amber-500/40' },
  done:        { label: 'Completed',    accent: 'border-t-emerald-500/40' },
  cancelled:   { label: 'Cancelled',    accent: 'border-t-rose-500/40' },
};

// Per-kind unified mapping. Tasks/meetings/calls each use slightly
// different status enums; this normalises them into the 4 columns and
// goes the other way when the user drags a card.
const bucketOf = (a: Activity): StatusBucket => {
  if (a.source.kind === 'task') {
    if (a.source.row.status === 'done')    return 'done';
    if (a.source.row.status === 'snoozed') return 'in_progress';
    return 'open'; // pending
  }
  if (a.source.kind === 'meeting') {
    const s = a.source.row.status;
    if (s === 'held')      return 'done';
    if (s === 'cancelled') return 'cancelled';
    if (s === 'no_show')   return 'cancelled';
    return 'open'; // scheduled
  }
  // call
  const s = a.source.row.callStatus;
  if (s === 'completed') return 'done';
  if (s === 'cancelled') return 'cancelled';
  if (s === 'missed')    return 'cancelled';
  return 'open'; // scheduled
};

// Drag target → status payload for the matching update API. We pick
// the "most natural" enum value for each kind+bucket so the row
// reflects what the user intended (e.g. dragging a meeting to Done
// becomes 'held', not 'completed' which doesn't exist for meetings).
const taskStatusFor = (b: StatusBucket): ClientTaskStatus =>
  b === 'done' ? 'done'
  : b === 'in_progress' ? 'snoozed'  // closest task analogue
  : b === 'cancelled' ? 'done'        // tasks don't have cancelled; close it out
  : 'pending';

const meetingStatusFor = (b: StatusBucket): MeetingStatus =>
  b === 'done' ? 'held'
  : b === 'cancelled' ? 'cancelled'
  : b === 'in_progress' ? 'scheduled'  // meetings don't have in_progress
  : 'scheduled';

const callStatusFor = (b: StatusBucket): CallStatus =>
  b === 'done' ? 'completed'
  : b === 'cancelled' ? 'cancelled'
  : b === 'in_progress' ? 'scheduled'
  : 'scheduled';

/**
 * Status-mode kanban for the Activities hub. Unlike the Category
 * kanban (which buckets by the linked entity type), this view
 * buckets by where the activity is in its lifecycle and supports
 * drag-and-drop to advance it.
 *
 * Reps' workflow:
 *   1. New task lands in Not Started.
 *   2. Drag to In Progress when they pick it up (task → snoozed,
 *      meeting/call stay scheduled).
 *   3. Drag to Completed when done (task → done, meeting → held,
 *      call → completed).
 *   4. Drag to Cancelled when it's no longer relevant.
 */
export const ActivitiesStatusKanban: React.FC<ActivitiesStatusKanbanProps> = ({
  activities, onSelect, onChanged,
}) => {
  const { user } = useAuth();
  const [dragging, setDragging] = useState<Activity | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  // Distance: 8px so a clean click registers as click (opens detail)
  // and a drag-intent gesture registers as drag. Sweet spot — too low
  // and the user can't click without accidentally starting a drag; too
  // high and the drag feels unresponsive.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const grouped = useMemo(() => {
    const out: Record<StatusBucket, Activity[]> = {
      open: [], in_progress: [], done: [], cancelled: [],
    };
    for (const a of activities) out[bucketOf(a)].push(a);
    return out;
  }, [activities]);

  const handleDragStart = (e: DragStartEvent) => {
    const a = e.active?.data?.current?.activity as Activity | undefined;
    if (a) setDragging(a);
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    setDragging(null);
    const overId = e.over?.id?.toString();
    const a = e.active?.data?.current?.activity as Activity | undefined;
    if (!overId || !a) return;
    if (!overId.startsWith('bucket:')) return;
    const target = overId.slice('bucket:'.length) as StatusBucket;
    if (target === bucketOf(a)) return; // no-op

    setSavingId(a.id);
    try {
      if (a.source.kind === 'task') {
        await updateClientTask(
          a.organizationId, a.source.row.taskId,
          { status: taskStatusFor(target) },
          { userId: user?.userId ?? '', displayName: user?.displayName ?? user?.email ?? '' },
        );
      } else if (a.source.kind === 'meeting') {
        await updateMeeting(a.source.row.meetingId, { status: meetingStatusFor(target) });
      } else {
        await updateCall(a.source.row.callId, { callStatus: callStatusFor(target) });
      }
      toast.success(`Moved "${a.title}" to ${STATUS_META[target].label}`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not move card');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {STATUS_ORDER.map((b) => (
          <StatusColumn
            key={b}
            bucket={b}
            activities={grouped[b]}
            onSelect={onSelect}
            savingId={savingId}
          />
        ))}
      </div>

      <DragOverlay>
        {dragging ? (
          <div className="opacity-90 shadow-lg rotate-1">
            <ActivityCard activity={dragging} compact />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
};

// ─── Column ────────────────────────────────────────────────────────────────
const StatusColumn: React.FC<{
  bucket: StatusBucket;
  activities: Activity[];
  onSelect: (a: Activity) => void;
  savingId: string | null;
}> = ({ bucket, activities, onSelect, savingId }) => {
  const { setNodeRef, isOver } = useDroppable({ id: `bucket:${bucket}` });
  const meta = STATUS_META[bucket];

  return (
    <Card className={cn('border-t-2', meta.accent, isOver && 'ring-2 ring-primary/40')}>
      <CardContent className="pt-3 space-y-2">
        <header className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <CircleDashed className="w-3.5 h-3.5 text-muted-foreground" />
            {meta.label}
          </h3>
          <span className="text-[11px] text-muted-foreground">{activities.length}</span>
        </header>
        <div ref={setNodeRef} className="space-y-1.5 min-h-[120px]">
          {activities.length === 0 && (
            <p className="text-[11px] text-muted-foreground italic px-1 py-2">
              Drop a card here
            </p>
          )}
          {activities.map((a) => (
            <DraggableCard
              key={a.id}
              activity={a}
              onSelect={onSelect}
              saving={savingId === a.id}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

// ─── Draggable card ────────────────────────────────────────────────────────
const DraggableCard: React.FC<{
  activity: Activity;
  onSelect: (a: Activity) => void;
  saving: boolean;
}> = ({ activity, onSelect, saving }) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: activity.id,
    data: { activity },
  });

  // Whole card is now draggable (not just a tiny grip on the left
  // edge). The sensor activation distance (8px) disambiguates a
  // click-to-open from a drag-to-move: small clicks register as
  // clicks and open the detail; ≥8px pointer movement starts a drag.
  // A small grip icon on the left still appears on hover as an
  // affordance so reps know the card is draggable.
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onSelect(activity)}
      className={cn(
        'relative group cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-30',
      )}
    >
      <ActivityCard activity={activity} compact />
      <GripVertical
        className="absolute left-0 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-60 transition-opacity pointer-events-none"
      />
      {saving && (
        <div className="absolute inset-0 grid place-items-center bg-background/60 rounded-md">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        </div>
      )}
    </div>
  );
};
