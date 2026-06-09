// src/components/deals/DealHandoffDialog.tsx
//
// Post-won handoff dialog: after a deal is marked Won, let the user
// create a PM task on any project so delivery can pick it up immediately.
// Purely additive — cancelling leaves the deal won, no task is created.

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { useProjects } from '@/hooks/useProjects';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { createTask } from '@/services/supabase/database';
import type { Deal } from '@/services/supabase/deals';
import { NewProjectDialog } from '@/components/workspace/NewProjectDialog';
import type { OrganizationMember } from '@/types/organization';

const NEW_PROJECT_VALUE = '__new_project__';

interface DealHandoffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal: Deal | null;
  onCreated?: () => void;
}

export const DealHandoffDialog: React.FC<DealHandoffDialogProps> = ({
  open,
  onOpenChange,
  deal,
  onCreated,
}) => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const { workspaces } = useWorkspaces();
  const { projects } = useProjects();

  // Form state
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [assigneeUserId, setAssigneeUserId] = useState<string>('');
  const [title, setTitle] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [dueDate, setDueDate] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  // New project dialog
  const [showNewProject, setShowNewProject] = useState(false);

  const orgId =
    organization?.organizationId ||
    user?.organizationId ||
    (user ? `local-${user.userId}` : '');

  // Org members for assignee picker
  const orgMembers: OrganizationMember[] = organization?.members ?? [];

  // Reset form when deal changes or dialog opens
  useEffect(() => {
    if (open && deal) {
      setTitle(deal.title);
      setNote('');
      setDueDate('');
      setAssigneeUserId(user?.userId ?? '');
      setSelectedProjectId('');
      setSelectedWorkspaceId('');
    }
  }, [open, deal, user?.userId]);

  // Projects filtered to the selected workspace
  const workspaceProjects = selectedWorkspaceId
    ? projects.filter((p) => p.workspaceId === selectedWorkspaceId)
    : projects;

  const handleProjectChange = useCallback((value: string) => {
    if (value === NEW_PROJECT_VALUE) {
      setShowNewProject(true);
    } else {
      setSelectedProjectId(value);
    }
  }, []);

  const handleNewProjectCreated = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    setShowNewProject(false);
  }, []);

  const handleSubmit = async () => {
    if (!deal || !user) return;
    if (!selectedProjectId) {
      toast.error('Please select a project to hand off to.');
      return;
    }
    if (!title.trim()) {
      toast.error('Title is required.');
      return;
    }

    setSubmitting(true);
    try {
      const assignee = orgMembers.find((m) => m.userId === assigneeUserId);
      const assignees = assignee
        ? [{
            userId: assignee.userId,
            displayName: assignee.displayName,
            email: assignee.email,
            photoURL: assignee.photoURL ?? '',
          }]
        : (user.userId
            ? [{
                userId: user.userId,
                displayName: user.displayName,
                email: user.email,
                photoURL: user.photoURL ?? '',
              }]
            : []);

      const chosenProject = projects.find((p) => p.projectId === selectedProjectId);

      await createTask(
        user.userId,
        {
          projectId: selectedProjectId,
          title: title.trim(),
          description: note.trim() || undefined,
          dueDate: dueDate ? new Date(dueDate) : null,
          assignees,
          status: 'todo',
          sourceDealId: deal.dealId,
          sourceClientId: deal.clientId ?? null,
        },
        orgId,
      );

      toast.success(`Handed off to ${chosenProject?.name ?? 'project'}`);
      onCreated?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create handoff task');
    } finally {
      setSubmitting(false);
    }
  };

  if (!deal) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Deal won — hand it to delivery</DialogTitle>
            <DialogDescription>
              Create a task on your PM board so delivery can pick up{' '}
              <strong>{deal.title}</strong>. You can skip this now — the deal is
              already won.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            {/* Workspace */}
            <div>
              <Label>Workspace</Label>
              <Select value={selectedWorkspaceId} onValueChange={(v) => { setSelectedWorkspaceId(v); setSelectedProjectId(''); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Any workspace" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Any workspace</SelectItem>
                  {workspaces.map((ws) => (
                    <SelectItem key={ws.workspaceId} value={ws.workspaceId}>
                      {ws.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Project */}
            <div>
              <Label>Project <span className="text-destructive">*</span></Label>
              <Select value={selectedProjectId} onValueChange={handleProjectChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select project…" />
                </SelectTrigger>
                <SelectContent>
                  {workspaceProjects.map((p) => (
                    <SelectItem key={p.projectId} value={p.projectId}>
                      {p.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW_PROJECT_VALUE}>
                    <span className="flex items-center gap-1 text-primary">
                      <Plus className="w-3.5 h-3.5" /> New project…
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Assignee */}
            <div>
              <Label>Assignee</Label>
              <Select value={assigneeUserId} onValueChange={setAssigneeUserId}>
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Unassigned</SelectItem>
                  {orgMembers.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.displayName || m.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Title */}
            <div>
              <Label>Task title <span className="text-destructive">*</span></Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What needs to happen?"
                maxLength={200}
              />
            </div>

            {/* Note */}
            <div>
              <Label>Note <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Any context for the delivery team…"
                rows={2}
              />
            </div>

            {/* Due date */}
            <div>
              <Label>Due date <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              Not now
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Hand off
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New project sub-dialog */}
      <NewProjectDialog
        open={showNewProject}
        onOpenChange={setShowNewProject}
        defaultWorkspaceId={selectedWorkspaceId || undefined}
        onCreated={handleNewProjectCreated}
      />
    </>
  );
};
