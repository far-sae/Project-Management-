import React, { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Search, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createNotification } from '@/services/supabase/database';
import { toast } from 'sonner';

export interface NotifyMember {
  userId: string;
  displayName: string;
  email: string;
  photoURL: string;
}

interface NotifyModalProps {
  open: boolean;
  onClose: () => void;
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string;
  members: NotifyMember[];
  actorUserId: string;
  actorDisplayName: string;
}

export const NotifyModal: React.FC<NotifyModalProps> = ({
  open,
  onClose,
  taskId,
  taskTitle,
  projectId,
  projectName,
  members,
  actorUserId,
  actorDisplayName,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const filteredMembers = useMemo(() => {
    if (!searchQuery.trim()) return members;
    const q = searchQuery.toLowerCase().trim();
    return members.filter(
      (m) =>
        m.displayName?.toLowerCase().includes(q) ||
        m.email?.toLowerCase().includes(q)
    );
  }, [members, searchQuery]);

  const recipientIds = useMemo(
    () => [...selectedIds].filter((id) => id !== actorUserId),
    [selectedIds, actorUserId]
  );

  const toggleMember = (userId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filteredMembers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredMembers.map((m) => m.userId)));
    }
  };

  const handleDone = async () => {
    if (recipientIds.length === 0) {
      toast.info('Select at least one person to notify');
      return;
    }
    setLoading(true);
    try {
      const results = await Promise.all(
        recipientIds.map((userId) =>
          createNotification({
            userId,
            type: 'task_updated',
            title: 'Task update',
            body: `${actorDisplayName} wants to notify you about "${taskTitle}" in ${projectName}`,
            taskId,
            projectId,
            actorUserId,
            actorDisplayName,
          }),
        ),
      );
      const n = recipientIds.length;
      const saved = results.filter((r) => r.status === 'ok').length;
      const filtered = results.filter((r) => r.status === 'filtered').length;
      const rls = results.filter((r) => r.status === 'rls').length;
      if (saved === n) {
        toast.success(`Notification sent to ${saved} ${saved === 1 ? 'person' : 'people'}`);
        onClose();
        setSelectedIds(new Set());
      } else if (saved > 0) {
        const parts: string[] = [];
        if (filtered > 0) {
          parts.push(
            `${filtered} skipped (in-app off for this type in preferences).`,
          );
        }
        if (rls > 0) {
          parts.push(
            `${rls} blocked by database policy — check notifications table and RLS migrations.`,
          );
        }
        const extra = parts.length ? ` ${parts.join(' ')}` : '';
        toast.warning(`Only ${saved} of ${n} notifications were saved.${extra}`);
        onClose();
        setSelectedIds(new Set());
      } else if (rls > 0) {
        toast.error(
          'Notifications could not be saved. Check that the notifications table exists and RLS allows inserts (Supabase migrations).',
        );
      } else if (filtered === n) {
        toast.info(
          'No notifications sent — recipients have in-app alerts turned off for this type in their preferences.',
        );
      } else {
        toast.error('Notifications could not be saved.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send notifications');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[400px]" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Notify</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              placeholder="Search by name or email..."
              aria-label="Search by name or email"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>

          <div className="max-h-56 space-y-0.5 overflow-y-auto">
            {filteredMembers.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-muted-foreground">
                No team members found
              </p>
            ) : (
              filteredMembers.map((m) => {
                const selected = selectedIds.has(m.userId);
                return (
                  <button
                    key={m.userId}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleMember(m.userId)}
                    className="flex min-h-11 w-full items-center gap-2.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none"
                  >
                    <Avatar className="h-7 w-7 shrink-0">
                      <AvatarImage src={m.photoURL} alt="" />
                      <AvatarFallback className="bg-secondary text-xs font-semibold text-foreground">
                        {(m.displayName || m.email || '?').charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-foreground">
                        {m.displayName || m.email || 'Unknown'}
                      </span>
                      {m.email && (
                        <span className="block truncate text-xs text-muted-foreground">{m.email}</span>
                      )}
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors',
                        selected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-input bg-background',
                      )}
                    >
                      {selected && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={selectAll}
            className="text-muted-foreground hover:text-foreground"
          >
            Select All / None
          </Button>

          <Button
            type="button"
            onClick={handleDone}
            disabled={loading || recipientIds.length === 0}
            className="w-full"
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default NotifyModal;
