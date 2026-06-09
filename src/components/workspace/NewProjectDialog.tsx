import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, LayoutTemplate } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getWorkspaceDisplayName } from '@/lib/workspaceDisplay';
import { useProjects } from '@/hooks/useProjects';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { UNASSIGNED_WORKSPACE_ID } from '@/hooks/useSelectedWorkspace';
import { fetchProjectTemplates } from '@/services/supabase/templates';
import type { ProjectTemplate } from '@/types/projectTemplate';
import { createTask } from '@/services/supabase/database';
import LimitReachedModal from '@/components/ui/LimitReachedModal';

const PROJECT_COLORS = [
  '#f97316', '#ef4444', '#22c55e', '#3b82f6',
  '#a855f7', '#ec4899', '#14b8a6', '#f59e0b',
];

interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultWorkspaceId?: string;
  /** Called after the project is successfully created. Receives the project id. */
  onCreated?: (projectId: string) => void;
}

export const NewProjectDialog: React.FC<NewProjectDialogProps> = ({
  open,
  onOpenChange,
  defaultWorkspaceId,
  onCreated,
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { organization } = useOrganization();
  const {
    addProject,
    error: projectsError,
    limitModal,
    closeLimitModal,
  } = useProjects();
  const { workspaces } = useWorkspaces();

  const orgId =
    organization?.organizationId ||
    user?.organizationId ||
    (user ? `local-${user.userId}` : '');

  const [createTab, setCreateTab] = useState<'blank' | 'template'>('blank');
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<ProjectTemplate | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedColor, setSelectedColor] = useState(PROJECT_COLORS[0]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(
    defaultWorkspaceId ?? UNASSIGNED_WORKSPACE_ID,
  );
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Sync defaultWorkspaceId when it changes externally
  useEffect(() => {
    if (defaultWorkspaceId) setSelectedWorkspaceId(defaultWorkspaceId);
  }, [defaultWorkspaceId]);

  // Load templates when dialog opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setTemplatesLoading(true);
    fetchProjectTemplates({
      ownerId: user?.userId ?? null,
      organizationId: orgId || null,
    })
      .then((rows) => { if (!cancelled) setTemplates(rows); })
      .catch((err) => { console.warn('Failed to load templates', err); })
      .finally(() => { if (!cancelled) setTemplatesLoading(false); });
    return () => { cancelled = true; };
  }, [open, user?.userId, orgId]);

  // Pre-fill name from template
  useEffect(() => {
    if (createTab === 'template' && selectedTemplate && !name.trim()) {
      setName(selectedTemplate.name);
    }
  }, [createTab, selectedTemplate, name]);

  // Sync inline error from hook
  useEffect(() => {
    if (open && projectsError) setCreateError(projectsError);
  }, [open, projectsError]);

  const resetAndClose = () => {
    setName('');
    setDescription('');
    setStartDate('');
    setEndDate('');
    setSelectedColor(PROJECT_COLORS[0]);
    setSelectedWorkspaceId(defaultWorkspaceId ?? UNASSIGNED_WORKSPACE_ID);
    setSelectedTemplate(null);
    setCreateTab('blank');
    setCreateError(null);
    onOpenChange(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setCreating(true);
    setCreateError(null);
    const toastId = toast.loading('Creating project...');

    try {
      const useTemplate = createTab === 'template' && selectedTemplate;

      const project = await addProject({
        name,
        description: description || (useTemplate ? selectedTemplate!.description ?? '' : ''),
        coverColor: selectedColor,
        workspaceId:
          selectedWorkspaceId === UNASSIGNED_WORKSPACE_ID ? undefined : selectedWorkspaceId,
        startDate: startDate || null,
        endDate: endDate || null,
        columns: useTemplate ? selectedTemplate!.columns : undefined,
      });

      if (project) {
        if (useTemplate && selectedTemplate!.tasks.length > 0 && user) {
          try {
            for (const seed of selectedTemplate!.tasks) {
              await createTask(
                user.userId,
                {
                  projectId: project.projectId,
                  title: seed.title,
                  description: seed.description ?? '',
                  status: seed.status ?? selectedTemplate!.columns[0]?.id ?? 'undefined',
                  priority: seed.priority ?? 'medium',
                  tags: seed.tags ?? [],
                },
                orgId,
              );
            }
          } catch (seedErr) {
            console.warn('Template seed task creation failed', seedErr);
          }
        }

        toast.success('Project created', { id: toastId });
        resetAndClose();
        if (onCreated) {
          onCreated(project.projectId);
        } else {
          navigate(`/project/${project.projectId}`);
        }
      } else {
        const msg = projectsError || 'Failed to create project. Please try again.';
        setCreateError(msg);
        toast.error(msg, { id: toastId });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create project.';
      setCreateError(msg);
      toast.error(msg, { id: toastId });
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) resetAndClose(); }}>
        <DialogContent aria-describedby={undefined} className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
          </DialogHeader>

          <Tabs value={createTab} onValueChange={(v) => setCreateTab(v as 'blank' | 'template')}>
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="blank">Blank project</TabsTrigger>
              <TabsTrigger value="template">From template</TabsTrigger>
            </TabsList>

            <TabsContent value="template" className="pt-3">
              {templatesLoading ? (
                <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Loading templates...
                </div>
              ) : templates.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-8">
                  No templates available yet.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
                  {templates.map((tpl) => {
                    const isSelected = selectedTemplate?.id === tpl.id;
                    return (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => setSelectedTemplate(tpl)}
                        className={cn(
                          'text-left rounded-lg border p-3 transition-colors hover:border-primary/40 hover:bg-primary/5',
                          isSelected ? 'border-primary bg-primary/10' : 'border-border bg-card',
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <div className="rounded-md bg-primary/10 text-primary p-1.5">
                            <LayoutTemplate className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-foreground truncate">{tpl.name}</p>
                              {tpl.isBuiltin && (
                                <span className="text-[10px] uppercase tracking-wide bg-muted text-muted-foreground rounded px-1.5 py-0.5">
                                  Built-in
                                </span>
                              )}
                            </div>
                            {tpl.description && (
                              <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                                {tpl.description}
                              </p>
                            )}
                            <p className="text-[11px] text-muted-foreground mt-1">
                              {tpl.columns.length} columns · {tpl.tasks.length} starter tasks
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          </Tabs>

          <form onSubmit={handleSubmit} className="space-y-4 mt-3">
            {createError && (
              <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{createError}</p>
            )}

            <div className="space-y-2">
              <Label>Workspace</Label>
              <Select value={selectedWorkspaceId} onValueChange={setSelectedWorkspaceId}>
                <SelectTrigger className="w-[200px] shadow-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED_WORKSPACE_ID}>No workspace</SelectItem>
                  {workspaces.map((w) => (
                    <SelectItem key={w.workspaceId} value={w.workspaceId}>
                      {getWorkspaceDisplayName(w)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="np-name">Project Name</Label>
              <Input
                id="np-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter project name"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="np-description">Description</Label>
              <Input
                id="np-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter project description"
              />
            </div>

            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex gap-2">
                {PROJECT_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setSelectedColor(color)}
                    className={cn(
                      'w-8 h-8 rounded-full transition-transform',
                      selectedColor === color && 'ring-2 ring-offset-2 ring-border scale-110',
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="np-start">Start Date</Label>
                <Input
                  id="np-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="np-end">End Date</Label>
                <Input
                  id="np-end"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={resetAndClose}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-gradient-to-r from-orange-500 to-red-500"
                disabled={
                  creating ||
                  !name.trim() ||
                  (createTab === 'template' && !selectedTemplate)
                }
              >
                {creating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Project'
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <LimitReachedModal
        open={limitModal.open}
        onClose={closeLimitModal}
        title="Project Limit Reached"
        message={limitModal.message}
      />
    </>
  );
};

export default NewProjectDialog;
