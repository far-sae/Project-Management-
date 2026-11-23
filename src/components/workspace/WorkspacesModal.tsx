import React, { useMemo } from 'react';
import { Workspace } from '@/types/workspace';
import { Project } from '@/types/project';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Edit,
  FolderKanban,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { getWorkspaceDisplayName } from '@/lib/workspaceDisplay';

interface WorkspacesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaces: Workspace[];
  projects: Project[];
  onEditWorkspace: (workspaceId: string) => void;
  onDeleteWorkspace: (workspaceId: string) => void;
  onCreateWorkspace: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
  loading?: boolean;
  onRefresh?: () => void;
}

export const WorkspacesModal: React.FC<WorkspacesModalProps> = ({
  open,
  onOpenChange,
  workspaces,
  projects,
  onEditWorkspace,
  onDeleteWorkspace,
  onCreateWorkspace,
  onSelectWorkspace,
  loading = false,
  onRefresh,
}) => {
  const projectCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const project of projects) {
      if (!project.workspaceId) continue;
      counts.set(project.workspaceId, (counts.get(project.workspaceId) ?? 0) + 1);
    }
    return counts;
  }, [projects]);

  const handleSelectWorkspace = (workspaceId: string) => {
    onSelectWorkspace(workspaceId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overscroll-contain sm:max-h-[85vh] sm:max-w-3xl">
        <DialogHeader className="pr-10">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0 text-left">
              <DialogTitle className="text-balance">All Workspaces</DialogTitle>
              <DialogDescription className="mt-1 text-pretty">
                Manage your workspaces and see project counts.
              </DialogDescription>
            </div>
            {onRefresh ? (
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={onRefresh}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw aria-hidden="true" />
                )}
                Refresh
              </Button>
            ) : null}
          </div>
        </DialogHeader>

        <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))]">
          {workspaces.map((workspace) => {
            const projectCount = projectCounts.get(workspace.workspaceId) ?? 0;
            const isPrimary = workspace.isDefault;

            return (
              <div
                key={workspace.workspaceId}
                className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20"
              >
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <button
                    type="button"
                    className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                    onClick={() => handleSelectWorkspace(workspace.workspaceId)}
                  >
                    <span className="flex min-h-7 min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
                      <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="truncate">{getWorkspaceDisplayName(workspace)}</span>
                    </span>
                    <span className="mt-1 block text-xs tabular-nums text-muted-foreground">
                      {projectCount} {projectCount === 1 ? 'project' : 'projects'}
                    </span>
                  </button>

                  {/* The main workspace can be renamed like any other. It cannot be deleted: every plan includes it. */}
                  {(
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Workspace actions for ${getWorkspaceDisplayName(workspace)}`}
                          className="w-10 shrink-0 px-0 text-muted-foreground md:w-7"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreHorizontal aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            onEditWorkspace(workspace.workspaceId);
                            onOpenChange(false);
                          }}
                        >
                          <Edit className="mr-2 h-4 w-4" aria-hidden="true" />
                          Edit
                        </DropdownMenuItem>
                        {!isPrimary && (
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => {
                              onDeleteWorkspace(workspace.workspaceId);
                              onOpenChange(false);
                            }}
                          >
                            <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                            Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-auto w-full"
                  onClick={() => handleSelectWorkspace(workspace.workspaceId)}
                >
                  View Projects
                </Button>
              </div>
            );
          })}

          {/* Create new workspace card */}
          <button
            type="button"
            className="flex min-h-28 items-center justify-center gap-1.5 rounded-lg border border-dashed border-foreground/20 bg-background p-4 text-sm font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
              onCreateWorkspace();
              onOpenChange(false);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Create Workspace
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
