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
      const promises = recipientIds.map((userId) =>
        createNotification({
          userId,
          type: 'task_updated',
          title: 'Task update',
          body: `${actorDisplayName} wants to notify you about "${taskTitle}" in ${projectName}`,
          taskId,
          projectId,
          actorUserId,
          actorDisplayName,
        })
      );
      await Promise.all(promises);
      toast.success(`Notification sent to ${recipientIds.length} ${recipientIds.length === 1 ? 'person' : 'people'}`);
      onClose();
      setSelectedIds(new Set());
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
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="max-h-48 overflow-y-auto space-y-1">
            {filteredMembers.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">
                No team members found
              </p>
            ) : (
              filteredMembers.map((m) => (
                <button
                  key={m.userId}
                  type="button"
                  onClick={() => toggleMember(m.userId)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 text-left"
                >
                  <Avatar className="w-8 h-8">
                    <AvatarImage src={m.photoURL} />
                    <AvatarFallback className="bg-teal-100 text-teal-700 text-sm">
                      {(m.displayName || m.email || '?').charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {m.displayName || m.email || 'Unknown'}
                    </p>
                    {m.email && (
                      <p className="text-xs text-gray-500 truncate">{m.email}</p>
                    )}
                  </div>
                  <div
                    className={cn(
                      'w-5 h-5 rounded border-2 flex items-center justify-center shrink-0',
                      selectedIds.has(m.userId)
                        ? 'bg-orange-500 border-orange-500 text-white'
                        : 'border-gray-300'
                    )}
                  >
                    {selectedIds.has(m.userId) && <Check className="w-3 h-3" />}
                  </div>
                </button>
              ))
            )}
          </div>

          <button
            type="button"
            onClick={selectAll}
            className="text-sm text-orange-600 hover:text-orange-700"
          >
            Select All / None
          </button>

          <Button
            onClick={handleDone}
            disabled={loading || recipientIds.length === 0}
            className="w-full bg-orange-500 hover:bg-orange-600"
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default NotifyModal;
