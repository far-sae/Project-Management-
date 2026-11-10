import React, { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { moveProjectMember, type ProjectRole } from '@/services/supabase/projectMembers';
import type { Project } from '@/types';

interface MoveMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: { userId: string; email: string; displayName: string; role: ProjectRole } | null;
  currentProjectId: string;
  organizationId: string;
  projects: Project[];
  /** Called after the move (also after a half-done move) so the page can refresh. */
  onMoved?: () => void;
}

function isIn(project: Project, userId: string): boolean {
  if (project.ownerId === userId) return true;
  return (project.members ?? []).some((m) => m.userId === userId);
}

/**
 * Move a person who was added to the wrong project into the right one,
 * keeping their project role.
 */
export const MoveMemberDialog: React.FC<MoveMemberDialogProps> = ({
  open,
  onOpenChange,
  member,
  currentProjectId,
  organizationId,
  projects,
  onMoved,
}) => {
  const [choice, setChoice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [unassignTasks, setUnassignTasks] = useState(true);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    if (open) {
      setChoice(null);
      setQuery('');
      setUnassignTasks(true);
    }
  }, [open, member?.userId]);

  const candidates = useMemo(
    () =>
      member
        ? projects.filter((p) => p.projectId !== currentProjectId && !isIn(p, member.userId))
        : [],
    [projects, currentProjectId, member],
  );

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return candidates
      .filter((p) => !q || (p.name ?? '').toLowerCase().includes(q))
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  }, [candidates, query]);

  const fromName = projects.find((p) => p.projectId === currentProjectId)?.name ?? 'this project';
  const toName = projects.find((p) => p.projectId === choice)?.name ?? 'the new project';

  const handleMove = async () => {
    if (!member || !choice) return;
    setMoving(true);
    try {
      await moveProjectMember({
        fromProjectId: currentProjectId,
        toProjectId: choice,
        organizationId,
        userId: member.userId,
        email: member.email,
        role: member.role,
        unassignTasks,
      });
      toast.success(`Moved ${member.displayName} from ${fromName} to ${toName}`);
      onOpenChange(false);
      onMoved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not move this person');
      // They may have been added to the new project before the error.
      onMoved?.();
    } finally {
      setMoving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !moving && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="break-words">Move {member?.displayName} to another project</DialogTitle>
          <DialogDescription>
            They'll be removed from {fromName} and added to the project you pick, with the same
            role.
          </DialogDescription>
        </DialogHeader>

        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            They're already in every other project.
          </p>
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search projects"
                aria-label="Search projects"
                className="pl-8"
                disabled={moving}
              />
            </div>
            <div role="radiogroup" aria-label="Destination project" className="max-h-64 space-y-1.5 overflow-y-auto">
              {options.length === 0 && (
                <p className="px-1 py-2 text-sm text-muted-foreground">No projects match.</p>
              )}
              {options.map((p) => {
                const selected = choice === p.projectId;
                return (
                  <button
                    key={p.projectId}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={p.name}
                    disabled={moving}
                    onClick={() => setChoice(p.projectId)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                      selected
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border hover:bg-secondary',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: p.coverColor || 'hsl(var(--primary))' }}
                        aria-hidden
                      />
                      <span className="truncate">{p.name}</span>
                    </span>
                    {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={unassignTasks}
                onChange={(e) => setUnassignTasks(e.target.checked)}
                disabled={moving}
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <span>Unassign them from their tasks in {fromName}</span>
            </label>
          </>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={moving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleMove()} disabled={!choice || moving}>
            {moving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
