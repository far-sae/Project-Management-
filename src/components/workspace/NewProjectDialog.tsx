import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
import { Loader2 } from 'lucide-react';
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
import {
  ColorSwatchRow,
  DIALOG_FOOTER,
  FIELD_LABEL,
  FormError,
  PROJECT_COLORS,
  TemplatePicker,
} from '@/components/workspace/ProjectFormParts';

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
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
          </DialogHeader>

          <Tabs value={createTab} onValueChange={(v) => setCreateTab(v as 'blank' | 'template')}>
            <TabsList className="w-full">
              <TabsTrigger value="blank">Blank project</TabsTrigger>
              <TabsTrigger value="template">From template</TabsTrigger>
            </TabsList>

            <TabsContent value="template" className="mt-3">
              <TemplatePicker
                templates={templates}
                loading={templatesLoading}
                selectedId={selectedTemplate?.id}
                onSelect={setSelectedTemplate}
              />
            </TabsContent>
          </Tabs>

          <form onSubmit={handleSubmit} className="space-y-4">
            {createError && <FormError>{createError}</FormError>}

            <div className="space-y-2">
              <Label className={FIELD_LABEL}>Workspace</Label>
              <Select value={selectedWorkspaceId} onValueChange={setSelectedWorkspaceId}>
                <SelectTrigger className="sm:w-[240px]">
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
              <Label htmlFor="np-name" className={FIELD_LABEL}>Project Name</Label>
              <Input
                id="np-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter project name"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="np-description" className={FIELD_LABEL}>Description</Label>
              <Input
                id="np-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter project description"
              />
            </div>

            <div className="space-y-2">
              <Label className={FIELD_LABEL}>Color</Label>
              <ColorSwatchRow value={selectedColor} onChange={setSelectedColor} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="np-start" className={FIELD_LABEL}>Start Date</Label>
                <Input
                  id="np-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="np-end" className={FIELD_LABEL}>End Date</Label>
                <Input
                  id="np-end"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter className={DIALOG_FOOTER}>
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
                disabled={
                  creating ||
                  !name.trim() ||
                  (createTab === 'template' && !selectedTemplate)
                }
              >
                {creating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Project'
                )}
              </Button>
            </DialogFooter>
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
