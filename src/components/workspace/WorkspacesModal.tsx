import React from 'react';
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
import { FolderKanban, MoreHorizontal, Edit, Trash2, Plus } from 'lucide-react';

interface WorkspacesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaces: Workspace[];
  projects: Project[];
  onEditWorkspace: (workspaceId: string) => void;
  onDeleteWorkspace: (workspaceId: string) => void;
  onCreateWorkspace: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
  defaultWorkspaceId: string;
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
  defaultWorkspaceId,
}) => {
  const getProjectCount = (workspaceId: string) => {
    if (workspaceId === defaultWorkspaceId) {
      return projects.filter(p => !p.workspaceId || p.workspaceId === defaultWorkspaceId).length;
    }
    return projects.filter(p => p.workspaceId === workspaceId).length;
  };

  const handleSelectWorkspace = (workspaceId: string) => {
    onSelectWorkspace(workspaceId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>All Workspaces</DialogTitle>
          <DialogDescription>
            Manage your workspaces and see project counts
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
          {workspaces.map((workspace) => {
            const projectCount = getProjectCount(workspace.workspaceId);
            const isPrimary = workspace.isDefault;

            return (
              <Card
                key={workspace.workspaceId}
                className="cursor-pointer hover:shadow-lg transition-shadow group relative"
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div
                      className="flex-1"
                      onClick={() => handleSelectWorkspace(workspace.workspaceId)}
                    >
                      <CardTitle className="text-lg flex items-center gap-2">
                        <FolderKanban className="w-5 h-5 text-orange-500" />
                        {workspace.name}
                      </CardTitle>
                      <CardDescription className="mt-2">
                        {projectCount} {projectCount === 1 ? 'project' : 'projects'}
                      </CardDescription>
                    </div>

                    {!isPrimary && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              onEditWorkspace(workspace.workspaceId);
                              onOpenChange(false);
                            }}
                          >
                            <Edit className="w-4 h-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-red-600"
                            onClick={() => {
                              onDeleteWorkspace(workspace.workspaceId);
                              onOpenChange(false);
                            }}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </CardHeader>
                <CardContent onClick={() => handleSelectWorkspace(workspace.workspaceId)}>
                  <Button variant="outline" size="sm" className="w-full">
                    View Projects
                  </Button>
                </CardContent>
              </Card>
            );
          })}

          {/* Create new workspace card */}
          <Card
            className="border-dashed cursor-pointer hover:border-orange-300 hover:bg-orange-50 transition-colors"
            onClick={() => {
              onCreateWorkspace();
              onOpenChange(false);
            }}
          >
            <CardContent className="flex flex-col items-center justify-center h-full min-h-[180px]">
              <Plus className="w-8 h-8 text-gray-400 mb-2" />
              <p className="text-gray-500 font-medium">Create Workspace</p>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
};
