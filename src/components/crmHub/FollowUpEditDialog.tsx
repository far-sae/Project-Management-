// Change a follow-up where it is shown (the lead's page): what it says, what
// kind it is, when it is due, how urgent, how far along, whether it repeats.
// It can also be deleted from here.
import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { publicMessage } from '@/lib/publicError';
import { FOLLOW_UP_KINDS, FOLLOW_UP_KIND_LABEL, FOLLOW_UP_REPEATS, FOLLOW_UP_REPEAT_LABEL, type FollowUpKind, type FollowUpRepeat } from '@/lib/crmFollowUpKinds';
import { deleteTask, updateTask } from '@/services/supabase/crmHub/tasks';
import { TASK_PRIORITIES, TASK_STATUSES, type CrmTask, type TaskPriority, type TaskStatus } from '@/types/crmHub';

interface Props {
  /** The follow-up to change. Null keeps the window closed. */
  task: CrmTask | null;
  onOpenChange: (open: boolean) => void;
  /** Called after it was saved or deleted. */
  onChanged: () => void;
}

const SELECT = 'h-11 md:h-9 w-full rounded-md border border-input bg-background px-2 text-sm';
const STATUS_LABEL: Record<TaskStatus, string> = { pending: 'Pending', in_progress: 'In progress', completed: 'Completed' };
const PRIORITY_LABEL: Record<TaskPriority, string> = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };

const toInput = (date: Date | null): string => (date ? format(date, "yyyy-MM-dd'T'HH:mm") : '');
/** What the date-and-time box holds, as a moment. Null for an empty or broken value. */
export const fromInput = (value: string): string | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export const FollowUpEditDialog: React.FC<Props> = ({ task, onOpenChange, onChanged }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [due, setDue] = useState('');
  const [kind, setKind] = useState<FollowUpKind>('todo');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [status, setStatus] = useState<TaskStatus>('pending');
  const [repeat, setRepeat] = useState<FollowUpRepeat | ''>('');
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);

  const id = task?.id ?? null;
  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description ?? '');
    setDue(toInput(task.dueDate));
    setKind(task.kind);
    setPriority(task.priority);
    setStatus(task.status);
    setRepeat(task.repeatEvery ?? '');
    setSure(false);
    // Only when another follow-up is opened: a read of the list in the background must not wipe what is being typed.
  }, [id]);

  if (!task) return null;

  const save = async () => {
    setBusy(true);
    try {
      const saved = await updateTask(task.id, {
        title: title.trim(),
        description: description.trim() || null,
        dueDate: fromInput(due),
        priority,
        status,
        // Only when changed, so a follow-up can be edited before the newer columns exist.
        kind: kind !== task.kind ? kind : undefined,
        repeatEvery: (repeat || null) !== task.repeatEvery ? (repeat || null) : undefined,
      });
      toast.success(saved.nextFollowUp ? 'Saved. The next one was made, because it repeats.' : 'Follow-up saved');
      onChanged();
      onOpenChange(false);
    } catch (error) {
      toast.error(publicMessage(error, 'The follow-up could not be saved. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await deleteTask(task.id);
      toast.success('Follow-up deleted');
      onChanged();
      onOpenChange(false);
    } catch (error) {
      toast.error(publicMessage(error, 'The follow-up could not be deleted. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!busy) onOpenChange(open); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit follow-up</DialogTitle>
          <DialogDescription>Change what has to be done, when, and how far along it is.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div>
            <Label htmlFor="fu-title">Title</Label>
            <Input id="fu-title" maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="fu-kind">Type</Label>
              <select id="fu-kind" className={SELECT} value={kind} onChange={(e) => setKind(e.target.value as FollowUpKind)}>
                {FOLLOW_UP_KINDS.map((k) => <option key={k} value={k}>{FOLLOW_UP_KIND_LABEL[k]}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="fu-due">Due</Label>
              <Input id="fu-due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="fu-priority">Priority</Label>
              <select id="fu-priority" className={SELECT} value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
                {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="fu-status">Status</Label>
              <select id="fu-status" className={SELECT} value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
                {TASK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="fu-repeat">Repeats</Label>
              <select id="fu-repeat" className={SELECT} value={repeat} onChange={(e) => setRepeat(e.target.value as FollowUpRepeat | '')}>
                <option value="">Does not repeat</option>
                {FOLLOW_UP_REPEATS.map((r) => <option key={r} value={r}>{FOLLOW_UP_REPEAT_LABEL[r]}</option>)}
              </select>
            </div>
          </div>
          <div>
            <Label htmlFor="fu-notes">Details</Label>
            <Textarea id="fu-notes" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {sure ? (
            <span className="flex items-center gap-2 text-sm">
              Delete it for good?
              <Button variant="destructive" size="sm" disabled={busy} onClick={() => void remove()}>Yes, delete</Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setSure(false)}>No</Button>
            </span>
          ) : (
            <Button variant="ghost" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => setSure(true)}>
              <Trash2 aria-hidden />Delete
            </Button>
          )}
          <span className="flex gap-2">
            <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button disabled={busy || !title.trim()} onClick={() => void save()}>{busy && <Loader2 className="animate-spin" aria-hidden />}Save</Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default FollowUpEditDialog;
