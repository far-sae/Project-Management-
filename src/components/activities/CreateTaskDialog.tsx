import React, { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ListTodo, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import {
  createClientTask, updateClientTask, deleteClientTask,
  type ClientTaskPriority, type ClientTaskType, type ClientTaskStatus,
} from '@/services/supabase/clientTasks';
import { DayPickerPopover } from '@/components/kanban/DayPickerPopover';
import { RelatedToPicker, type RelatedTo } from './RelatedToPicker';

interface CreateTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional pre-fill — useful when launched from a deal/account page. */
  defaultRelatedTo?: RelatedTo | null;
  /** When set, the dialog opens in EDIT mode: prefilled from the task,
   *  title becomes "Edit Task", and Save calls updateClientTask
   *  instead of createClientTask. Pass null to stay in Create mode. */
  editTask?: import('@/services/supabase/clientTasks').ClientTask | null;
  onCreated?: () => void;
}

/**
 * Full Zoho-style Task modal. Renders the fields shown in the
 * reference screenshot: Task Owner, Subject, Due Date, Contact /
 * Account (Related To), Status, Priority, Repeat, Description.
 *
 * Wraps `createClientTask` from the existing CRM service so the
 * task lands in the same table the deal-side task list already
 * uses — no separate table, no double-write.
 */
export const CreateTaskDialog: React.FC<CreateTaskDialogProps> = ({
  open, onOpenChange, defaultRelatedTo = null, editTask = null, onCreated,
}) => {
  const isEditing = !!editTask;
  const { user } = useAuth();
  const { organization } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const members = organization?.members ?? [];

  // Form state
  const [ownerId, setOwnerId] = useState<string>(user?.userId ?? '');
  const [subject, setSubject] = useState('');
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [relatedTo, setRelatedTo] = useState<RelatedTo | null>(defaultRelatedTo);
  const [status, setStatus] = useState<ClientTaskStatus>('pending');
  const [priority, setPriority] = useState<ClientTaskPriority>('normal');
  const [taskType, setTaskType] = useState<ClientTaskType>('todo');
  const [repeatOn, setRepeatOn] = useState(false);
  const [repeatRule, setRepeatRule] = useState('FREQ=WEEKLY');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset on open. In Create mode we blank the form; in Edit mode we
  // prefill from the supplied task so the user lands on a complete
  // editable snapshot of the row.
  useEffect(() => {
    if (!open) return;
    if (editTask) {
      setOwnerId(editTask.assignedTo ?? user?.userId ?? '');
      setSubject(editTask.title);
      setDueDate(editTask.dueAt ?? null);
      setRelatedTo(null); // Don't try to re-resolve — user can update if needed.
      setStatus(editTask.status);
      setPriority(editTask.priority ?? 'normal');
      setTaskType(editTask.type);
      setRepeatOn(!!editTask.repeatRule);
      setRepeatRule(editTask.repeatRule ?? 'FREQ=WEEKLY');
      setDescription(editTask.description ?? '');
    } else {
      setOwnerId(user?.userId ?? '');
      setSubject('');
      setDueDate(null);
      setRelatedTo(defaultRelatedTo);
      setStatus('pending');
      setPriority('normal');
      setTaskType('todo');
      setRepeatOn(false);
      setRepeatRule('FREQ=WEEKLY');
      setDescription('');
    }
  }, [open, user?.userId, defaultRelatedTo, editTask]);

  const handleSave = async (saveAndNew: boolean) => {
    if (!orgId) { toast.error('No active organization'); return; }
    if (!subject.trim()) { toast.error('Subject is required'); return; }

    setSaving(true);
    try {
      const owner = members.find((m) => m.userId === ownerId);
      if (editTask) {
        // Edit mode — single update with every field the form exposed.
        await updateClientTask(
          orgId,
          editTask.taskId,
          {
            title: subject.trim(),
            description: description.trim() || null,
            type: taskType,
            status,
            dueAt: dueDate,
            assignedTo: ownerId || null,
            assignedToName: owner?.displayName ?? null,
            priority,
            repeatRule: repeatOn ? repeatRule : null,
          },
          { userId: user?.userId ?? '', displayName: user?.displayName ?? user?.email ?? '' },
        );
        toast.success(`Task "${subject.trim()}" updated`);
      } else {
        const created = await createClientTask(
          orgId,
          user?.userId ?? '',
          user?.displayName ?? user?.email ?? '',
          {
            title: subject.trim(),
            description: description.trim() || null,
            type: taskType,
            dueAt: dueDate,
            assignedTo: ownerId || null,
            assignedToName: owner?.displayName ?? null,
            clientId: relatedTo?.clientId ?? null,
            dealId: relatedTo?.dealId ?? null,
            // Polymorphic anchor — keeps Lead Open/Closed Activities
            // populated even when the lead isn't converted yet.
            relatedToType: relatedTo?.type ?? null,
            relatedToId: relatedTo?.id ?? null,
            leadId: relatedTo?.leadId ?? null,
            priority,
            repeatRule: repeatOn ? repeatRule : null,
          },
        );
        // createClientTask always inserts with status='pending'. If the
        // user picked 'snoozed' or 'done' in the modal, follow up with an
        // updateClientTask so the row reflects their choice.
        if (status !== 'pending') {
          await updateClientTask(
            orgId,
            created.taskId,
            { status },
            { userId: user?.userId ?? '', displayName: user?.displayName ?? user?.email ?? '' },
          );
        }
        toast.success(`Task "${subject.trim()}" created`);
      }
      onCreated?.();
      if (saveAndNew) {
        // Keep the dialog open, blank the title for the next entry.
        setSubject('');
        setDescription('');
      } else {
        onOpenChange(false);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create task');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListTodo className="w-5 h-5 text-rose-600" /> {isEditing ? 'Edit Task' : 'Create Task'}
          </DialogTitle>
          {/* Screen-reader description — silences the Radix
              "Missing Description" warning + helps non-sighted users
              understand the dialog's purpose. Visually hidden. */}
          <DialogDescription className="sr-only">
            {isEditing
              ? 'Edit the task title, due date, priority, assignee, and other fields.'
              : 'Create a new task with subject, due date, priority, assignee, and optional repeat rule.'}
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Task Information
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-[160px,1fr] gap-3 items-center">
            <Label htmlFor="owner">Task Owner</Label>
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger id="owner" className="w-full"><SelectValue placeholder="Assign to…" /></SelectTrigger>
              <SelectContent>
                {members.filter((m) => m.status === 'active').map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {m.displayName} {m.userId === user?.userId && '(me)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Label htmlFor="subject" className="required">
              Subject <span className="text-destructive">*</span>
            </Label>
            <Input
              id="subject" value={subject} onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Follow up with Acme on proposal"
            />

            <Label>Due Date</Label>
            <DayPickerPopover value={dueDate} onChange={setDueDate} />

            <Label>Type</Label>
            <Select value={taskType} onValueChange={(v) => setTaskType(v as ClientTaskType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todo">To-do</SelectItem>
                <SelectItem value="call">Call</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="meeting">Meeting</SelectItem>
                <SelectItem value="followup">Follow-up</SelectItem>
              </SelectContent>
            </Select>

            <Label>Related To</Label>
            <RelatedToPicker
              organizationId={orgId}
              value={relatedTo}
              onChange={setRelatedTo}
            />

            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Not Started</SelectItem>
                <SelectItem value="snoozed">Snoozed</SelectItem>
                <SelectItem value="done">Completed</SelectItem>
              </SelectContent>
            </Select>

            <Label>Priority</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as ClientTaskPriority)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>

            <Label>Repeat</Label>
            <div className="flex items-center gap-3">
              <Switch checked={repeatOn} onCheckedChange={setRepeatOn} />
              {repeatOn && (
                <Select value={repeatRule} onValueChange={setRepeatRule}>
                  <SelectTrigger className="w-44 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FREQ=DAILY">Daily</SelectItem>
                    <SelectItem value="FREQ=WEEKLY">Weekly</SelectItem>
                    <SelectItem value="FREQ=MONTHLY">Monthly</SelectItem>
                    <SelectItem value="FREQ=YEARLY">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Description Information
          </h3>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add notes, context, or links…"
            rows={4}
          />
        </section>

        <DialogFooter className="flex flex-row gap-2">
          {/* Delete is only visible in EDIT mode — there's nothing to
              delete during creation. Confirms first because deletion
              of a task that's tagged to a deal/contact removes it from
              every drawer's Open/Closed Activities section too. */}
          {isEditing && editTask && (
            <Button
              variant="ghost" size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10 mr-auto"
              disabled={saving}
              onClick={async () => {
                if (!window.confirm(`Delete task "${editTask.title}"? This can't be undone.`)) return;
                if (!orgId) return;
                setSaving(true);
                try {
                  await deleteClientTask(orgId, editTask.taskId);
                  toast.success('Task deleted');
                  onCreated?.();
                  onOpenChange(false);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Delete failed');
                } finally {
                  setSaving(false);
                }
              }}
            >
              <Trash2 className="w-4 h-4 mr-1.5" /> Delete
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          {/* "Save and New" only makes sense for create mode. */}
          {!isEditing && (
            <Button variant="outline" onClick={() => handleSave(true)} disabled={saving}>
              Save and New
            </Button>
          )}
          <Button onClick={() => handleSave(false)} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            {isEditing ? 'Update' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
