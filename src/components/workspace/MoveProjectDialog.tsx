import React, { useEffect, useMemo, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { getWorkspaceDisplayName } from '@/lib/workspaceDisplay';
import { moveProjectToWorkspace } from '@/services/supabase/projectMove';
import type { Workspace } from '@/types/workspace';

/** Sentinel for "No workspace" in the option list. */
const NO_WORKSPACE = '__none__';

interface MoveProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: { projectId: string; name: string; workspaceId?: string | null } | null;
  workspaces: Workspace[];
}

/**
 * Pick another workspace and move the whole project there. Tasks, comments,
 * files and chat belong to the project, so they move with it.
 */
export const MoveProjectDialog: React.FC<MoveProjectDialogProps> = ({
  open,
  onOpenChange,
  project,
  workspaces,
}) => {
  const [choice, setChoice] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    if (open) setChoice(null);
  }, [open, project?.projectId]);

  const currentId = project?.workspaceId ?? null;
  const options = useMemo(() => {
    const list = workspaces
      .filter((w) => w.workspaceId !== currentId)
      .map((w) => ({ id: w.workspaceId, label: getWorkspaceDisplayName(w) }));
    if (currentId) list.push({ id: NO_WORKSPACE, label: 'No workspace' });
    return list;
  }, [workspaces, currentId]);

  const handleMove = async () => {
    if (!project || !choice) return;
    const target = options.find((o) => o.id === choice);
    setMoving(true);
    try {
      await moveProjectToWorkspace(project.projectId, choice === NO_WORKSPACE ? null : choice);
      toast.success(`Moved "${project.name}" to ${target?.label ?? 'the new workspace'}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not move the project');
    } finally {
      setMoving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !moving && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="break-words">Move “{project?.name}”</DialogTitle>
          <DialogDescription>
            Choose where this project should live. Everything in it — tasks, comments, files and
            chat — moves with it.
          </DialogDescription>
        </DialogHeader>

        {options.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            There's no other workspace to move to. Create one first.
          </p>
        ) : (
          <div role="radiogroup" aria-label="Destination workspace" className="max-h-72 space-y-1.5 overflow-y-auto">
            {options.map((o) => {
              const selected = choice === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={o.label}
                  disabled={moving}
                  onClick={() => setChoice(o.id)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                    selected
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border hover:bg-secondary',
                  )}
                >
                  <span className="truncate">{o.label}</span>
                  {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
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
