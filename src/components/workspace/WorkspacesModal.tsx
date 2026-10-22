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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
      <DialogContent className="sm:max-w-4xl max-h-[85vh] overscroll-contain overflow-y-auto">
        <DialogHeader className="pr-12">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle className="text-xl text-balance">All Workspaces</DialogTitle>
              <DialogDescription className="mt-1 text-pretty">
                Manage your workspaces and see project counts.
              </DialogDescription>
            </div>
            {onRefresh ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
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

        <div className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workspaces.map((workspace) => {
            const projectCount = projectCounts.get(workspace.workspaceId) ?? 0;
            const isPrimary = workspace.isDefault;

            return (
              <Card
                key={workspace.workspaceId}
                className="group relative flex min-h-44 flex-col transition-shadow hover:shadow-lg"
              >
                <CardHeader className="p-5 pb-3">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      onClick={() => handleSelectWorkspace(workspace.workspaceId)}
                    >
                      <CardTitle className="flex min-w-0 items-center gap-2 text-base">
                        <FolderKanban className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                        <span className="truncate">{getWorkspaceDisplayName(workspace)}</span>
                      </CardTitle>
                      <CardDescription className="mt-2">
                        {projectCount} {projectCount === 1 ? 'project' : 'projects'}
                      </CardDescription>
                    </button>

                    {!isPrimary && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Workspace actions for ${getWorkspaceDisplayName(workspace)}`}
                            className="shrink-0 opacity-70 transition-opacity hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
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
                            <Edit className="mr-2" aria-hidden="true" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-red-600"
                            onSelect={() => {
                              onDeleteWorkspace(workspace.workspaceId);
                              onOpenChange(false);
                            }}
                          >
                            <Trash2 className="mr-2" aria-hidden="true" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="mt-auto p-5 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => handleSelectWorkspace(workspace.workspaceId)}
                  >
                    View Projects
                  </Button>
                </CardContent>
              </Card>
            );
          })}

          {/* Create new workspace card */}
          <button
            type="button"
            className="flex min-h-44 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card p-5 text-muted-foreground shadow-card transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            onClick={() => {
              onCreateWorkspace();
              onOpenChange(false);
            }}
          >
            <Plus className="mb-2 h-8 w-8" aria-hidden="true" />
            <span className="font-medium">Create Workspace</span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
