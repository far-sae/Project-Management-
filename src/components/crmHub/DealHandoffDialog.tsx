import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Briefcase, FolderPlus, Link as LinkIcon, Loader2, Trophy } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
import { useProjects } from '@/hooks/useProjects';
import { createProject } from '@/services/supabase/database';
import { linkDealHandoff } from '@/services/supabase/crmHub/deals';
import type { CrmDeal } from '@/types/crmHub';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface Props {
  deal: CrmDeal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLinked: () => void | Promise<void>;
}

export const DealHandoffDialog: React.FC<Props> = ({ deal, open, onOpenChange, onLinked }) => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const { selected } = useSelectedWorkspace();
  const { projects } = useProjects();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'create' | 'link'>('create');
  const [projectName, setProjectName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);

  const workspaceId = deal?.workspaceId ?? selected?.workspaceId ?? null;
  const workspaceProjects = useMemo(
    () => projects.filter((project) => project.workspaceId === workspaceId),
    [projects, workspaceId],
  );

  useEffect(() => {
    if (!open || !deal) return;
    setMode('create');
    setProjectName(deal.name.trim() || 'New project');
    setProjectId('');
  }, [deal, open]);

  if (!deal) return null;

  const finish = async (linkedProjectId: string, message: string) => {
    toast.success(message);
    await onLinked();
    onOpenChange(false);
    navigate(`/project/${linkedProjectId}`);
  };

  const handleCreate = async () => {
    if (!organization || !user || !workspaceId || !projectName.trim()) return;
    if (deal.workspaceId && selected && deal.workspaceId !== selected.workspaceId) {
      toast.error('Switch to the deal workspace before creating its project.');
      return;
    }
    setBusy(true);
    try {
      const project = await createProject(
        user.userId,
        user.email ?? '',
        user.displayName ?? '',
        user.photoURL ?? '',
        {
          name: projectName.trim(),
          description: `Handoff from won deal: ${deal.name}`,
          coverColor: '#f97316',
          workspaceId,
          columns: [],
        },
        organization.organizationId,
      );
      await linkDealHandoff(deal.id, { workspaceId, projectId: project.projectId });
      await finish(project.projectId, `Created ${project.name} in ${selected?.name ?? 'this workspace'}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Handoff failed');
    } finally {
      setBusy(false);
    }
  };

  const handleLink = async () => {
    if (!workspaceId || !projectId) return;
    const project = workspaceProjects.find((item) => item.projectId === projectId);
    if (!project || project.workspaceId !== workspaceId) {
      toast.error('Choose a project from the same workspace as this deal.');
      return;
    }
    setBusy(true);
    try {
      await linkDealHandoff(deal.id, { workspaceId, projectId: project.projectId });
      await finish(project.projectId, `Linked to ${project.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Link failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-emerald-500" />
            Hand off “{deal.name}”
          </DialogTitle>
          <DialogDescription>
            Create or link a Kanban project inside <strong>{selected?.name ?? 'the deal workspace'}</strong>.
            Deals can never be handed to a different workspace.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(value) => setMode(value as 'create' | 'link')}>
          <TabsList className="grid grid-cols-2">
            <TabsTrigger value="create"><FolderPlus className="w-4 h-4 mr-1.5" />Create project</TabsTrigger>
            <TabsTrigger value="link"><LinkIcon className="w-4 h-4 mr-1.5" />Link project</TabsTrigger>
          </TabsList>
          <TabsContent value="create" className="space-y-3 mt-4">
            <div>
              <Label>Project name</Label>
              <Input value={projectName} onChange={(event) => setProjectName(event.target.value)} disabled={busy} />
            </div>
          </TabsContent>
          <TabsContent value="link" className="space-y-3 mt-4">
            <div>
              <Label>Project in {selected?.name}</Label>
              <Select value={projectId} onValueChange={setProjectId} disabled={busy}>
                <SelectTrigger><SelectValue placeholder="Choose a project" /></SelectTrigger>
                <SelectContent>
                  {workspaceProjects.map((project) => (
                    <SelectItem key={project.projectId} value={project.projectId}>{project.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {workspaceProjects.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1">No projects exist here yet. Create the first one.</p>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button
            onClick={mode === 'create' ? handleCreate : handleLink}
            disabled={busy || !workspaceId || (mode === 'create' ? !projectName.trim() : !projectId)}
          >
            {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            <Briefcase className="w-4 h-4 mr-1" />
            {mode === 'create' ? 'Create and open' : 'Link and open'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DealHandoffDialog;
