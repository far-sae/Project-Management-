import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronsUpDown,
  Check,
  Boxes,
  Plus,
  LayoutGrid,
  FolderKanban,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ALL_WORKSPACES_ID,
  useSelectedWorkspace,
} from '@/hooks/useSelectedWorkspace';
import { useOrganization } from '@/context/OrganizationContext';
import { useProjects } from '@/hooks/useProjects';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { getWorkspaceDisplayName } from '@/lib/workspaceDisplay';
import { WorkspaceModal } from '@/components/workspace/WorkspaceModal';
import { NewProjectDialog } from '@/components/workspace/NewProjectDialog';
import { toast } from 'sonner';

interface WorkspaceSwitcherProps {
  className?: string;
  onCreateClick?: () => void;
}

export const WorkspaceSwitcher: React.FC<WorkspaceSwitcherProps> = ({
  className,
  onCreateClick,
}) => {
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  const { workspaces, selectedId, selected, isAll, isUnassigned, select } =
    useSelectedWorkspace();
  const { isAdmin: isOrgAdminOrOwner } = useOrganization();
  const { projects, loading: projectsLoading } = useProjects();
  const { addWorkspace } = useWorkspaces();
  const navigate = useNavigate();

  // Members + viewers only see workspaces that contain at least one project
  // they have access to. useProjects already filters by membership, so any
  // workspace referenced by one of those projects is one they're authorized
  // to browse. Owners/admins keep seeing every workspace in the org so they
  // can manage them. While projects are loading we keep the unfiltered list
  // so the dropdown does not flash an empty state mid-load.
  const visibleWorkspaces = useMemo(() => {
    if (isOrgAdminOrOwner || projectsLoading) return workspaces;
    const accessibleIds = new Set<string>();
    for (const p of projects) {
      if (p.workspaceId) accessibleIds.add(p.workspaceId);
    }
    return workspaces.filter((w) => accessibleIds.has(w.workspaceId));
  }, [workspaces, projects, projectsLoading, isOrgAdminOrOwner]);

  // If the user previously selected a workspace they no longer have access
  // to (e.g. removed from every project in it, or role downgraded), fall
  // back to "All workspaces" so the trigger label and project filter stay
  // consistent with what they're allowed to see. Wait for projects to load
  // first so we never reset based on an empty in-flight projects list.
  useEffect(() => {
    if (isOrgAdminOrOwner || projectsLoading) return;
    if (isAll || isUnassigned) return;
    if (!selectedId) return;
    const stillVisible = visibleWorkspaces.some(
      (w) => w.workspaceId === selectedId,
    );
    if (!stillVisible) select(ALL_WORKSPACES_ID);
  }, [
    isOrgAdminOrOwner,
    projectsLoading,
    isAll,
    isUnassigned,
    selectedId,
    visibleWorkspaces,
    select,
  ]);

  const triggerLabel = isAll
    ? 'All workspaces'
    : selected
        ? getWorkspaceDisplayName(selected)
        : 'Select workspace';

  const handleSaveWorkspace = async (data: { name: string; description: string }) => {
    const ws = await addWorkspace({ name: data.name });
    if (ws) {
      select(ws.workspaceId);
      toast.success('Workspace created');
    }
  };

  return (
    <>
      {/* Switcher + create button row */}
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-background px-2 text-left transition-colors hover:bg-secondary',
                className,
              )}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-foreground text-background">
                {isAll ? (
                  <LayoutGrid className="h-3 w-3" />
                ) : (
                  <Boxes className="h-3 w-3" />
                )}
              </span>
              <div className="flex-1 min-w-0">
                <p className="sr-only">Workspace</p>
                <p className="truncate text-sm font-medium leading-tight text-foreground">
                  {triggerLabel}
                </p>
              </div>
              <ChevronsUpDown className="w-4 h-4 text-muted-foreground shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            sideOffset={6}
            className="w-[15rem]"
          >
            <DropdownMenuLabel>Switch workspace</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => select(ALL_WORKSPACES_ID)}>
              <LayoutGrid className="w-4 h-4 mr-2" />
              <span className="flex-1">All workspaces</span>
              {isAll && <Check className="w-4 h-4 text-primary" />}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {visibleWorkspaces.length === 0 && (
              <DropdownMenuItem disabled>
                <span className="text-muted-foreground">No workspaces yet</span>
              </DropdownMenuItem>
            )}
            {visibleWorkspaces.map((w) => {
              const active = !isAll && !isUnassigned && w.workspaceId === selectedId;
              return (
                <DropdownMenuItem
                  key={w.workspaceId}
                  onSelect={() => select(w.workspaceId)}
                >
                  <Boxes className="w-4 h-4 mr-2" />
                  <span className="flex-1 truncate">{getWorkspaceDisplayName(w)}</span>
                  {active && <Check className="w-4 h-4 ml-2 text-primary" />}
                </DropdownMenuItem>
              );
            })}
            {/* Members/viewers can't create workspaces — that's an org-level
                admin action, so the entry would just dead-end them. */}
            {isOrgAdminOrOwner && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    if (onCreateClick) {
                      onCreateClick();
                    } else {
                      navigate('/dashboard?newWorkspace=1');
                    }
                  }}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  New workspace
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* ＋ create menu: New workspace / New project */}
        {isOrgAdminOrOwner && (
          <DropdownMenu open={createMenuOpen} onOpenChange={setCreateMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Create workspace or project"
                title="Create workspace or project"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <Plus className="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} className="w-[15rem]">
              <DropdownMenuLabel>Create new</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  setCreateMenuOpen(false);
                  setNewWorkspaceOpen(true);
                }}
              >
                <Boxes className="w-4 h-4 mr-2" />
                New workspace
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setCreateMenuOpen(false);
                  setNewProjectOpen(true);
                }}
              >
                <FolderKanban className="w-4 h-4 mr-2" />
                New project
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* New workspace modal */}
      <WorkspaceModal
        open={newWorkspaceOpen}
        onClose={() => setNewWorkspaceOpen(false)}
        onSave={handleSaveWorkspace}
      />

      {/* New project dialog */}
      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
        defaultWorkspaceId={
          !isAll && !isUnassigned && selectedId ? selectedId : undefined
        }
      />
    </>
  );
};

export default WorkspaceSwitcher;
