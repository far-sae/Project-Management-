import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useClientTasks } from '@/hooks/useClientTasks';
import {
  ClientTaskType, TASK_TYPE_LABEL,
} from '@/services/supabase/clientTasks';
import { Client } from '@/services/supabase/clients';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clients: Client[];
  defaultClientId?: string | null;
}

const TYPE_ORDER: ClientTaskType[] = ['todo', 'call', 'email', 'meeting', 'followup'];

const toLocalDatetime = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const NewClientTaskDialog: React.FC<Props> = ({
  open,
  onOpenChange,
  clients,
  defaultClientId = null,
}) => {
  const { create } = useClientTasks();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    type: 'todo' as ClientTaskType,
    dueAt: '',
    clientId: defaultClientId ?? 'none',
  });

  useEffect(() => {
    if (!open) return;
    // Default due time = end of today (5pm) — most-common for follow-ups.
    const today5pm = new Date();
    today5pm.setHours(17, 0, 0, 0);
    setForm({
      title: '',
      description: '',
      type: 'todo',
      dueAt: toLocalDatetime(today5pm),
      clientId: defaultClientId ?? 'none',
    });
  }, [open, defaultClientId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error('Title is required');
      return;
    }
    setBusy(true);
    try {
      const client =
        form.clientId !== 'none'
          ? clients.find((c) => c.clientId === form.clientId) ?? null
          : null;
      await create({
        title: form.title.trim(),
        description: form.description.trim() || null,
        type: form.type,
        dueAt: form.dueAt ? new Date(form.dueAt) : null,
        clientId: client?.clientId ?? null,
      });
      toast.success('Task added');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add task');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>
            Schedule a follow-up tied to a client. You'll see it in your task
            list with overdue / today / this-week buckets.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="t-title">Title</Label>
            <Input
              id="t-title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Call Acme to confirm pricing"
              required
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="t-type">Type</Label>
              <Select
                value={form.type}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, type: v as ClientTaskType }))
                }
              >
                <SelectTrigger id="t-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPE_ORDER.map((t) => (
                    <SelectItem key={t} value={t}>{TASK_TYPE_LABEL[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-due">Due</Label>
              <Input
                id="t-due"
                type="datetime-local"
                value={form.dueAt}
                onChange={(e) => setForm((f) => ({ ...f, dueAt: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="t-client">Client</Label>
            <Select
              value={form.clientId}
              onValueChange={(v) => setForm((f) => ({ ...f, clientId: v }))}
            >
              <SelectTrigger id="t-client"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No client</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.clientId} value={c.clientId}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="t-desc">Notes</Label>
            <Textarea
              id="t-desc"
              rows={3}
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Add task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default NewClientTaskDialog;
