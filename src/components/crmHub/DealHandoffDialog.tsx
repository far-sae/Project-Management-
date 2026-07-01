import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Trophy, Briefcase, FolderPlus, Link as LinkIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { linkDealHandoff } from '@/services/supabase/crmHub/deals';
import { createWorkspace, getOrganizationWorkspaces } from '@/services/supabase/workspaces';
import { createProject } from '@/services/supabase/database';
import { useProjects } from '@/hooks/useProjects';
import type { CrmDeal } from '@/types/crmHub';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

const NEW_ID = '__new__';

interface Props {
  deal: CrmDeal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLinked: () => void | Promise<void>;
}

/**
 * Deal-Won handoff — connects the sold deal to the PM side by either:
 *   • creating a new workspace + a new project inside it, or
 *   • picking an existing workspace and creating a project there, or
 *   • linking to an existing project outright.
 *
 * The chosen workspace_id + project_id get stored on the crm_deals row so
 * the Deal detail page can show a "Working on it in <workspace>/<project>"
 * chip and jump the user straight there.
 */
export const DealHandoffDialog: React.FC<Props> = ({ deal, open, onOpenChange, onLinked }) => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const { projects } = useProjects();
  const navigate = useNavigate();

  const [workspaces, setWorkspaces] = useState<{ workspaceId: string; name: string }[]>([]);
  const [wsLoading, setWsLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [newWsName, setNewWsName] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(NEW_ID);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(NEW_ID);
  const [existingWorkspaceIdForNewProject, setExistingWorkspaceIdForNewProject] = useState<string>('');

  useEffect(() => {
    if (open && deal) {
      const defaultName = deal.name.trim() || 'New workspace';
      setNewWsName(defaultName);
      setNewProjectName(deal.name.trim() || 'New project');
      setMode('new');
      setSelectedWorkspaceId(NEW_ID);
      setSelectedProjectId(NEW_ID);
      setExistingWorkspaceIdForNewProject('');
    }
  }, [open, deal]);

  useEffect(() => {
    if (!open || !organization) return;
    setWsLoading(true);
    getOrganizationWorkspaces(organization.organizationId)
      .then((rows) => setWorkspaces(rows.map((r) => ({ workspaceId: r.workspaceId, name: r.name }))))
      .catch(() => setWorkspaces([]))
      .finally(() => setWsLoading(false));
  }, [open, organization]);

  const projectsByWorkspace = useMemo(() => {
    const m = new Map<string, { projectId: string; name: string }[]>();
    for (const p of projects) {
      const wsId = p.workspaceId ?? '__unassigned__';
      if (!m.has(wsId)) m.set(wsId, []);
      m.get(wsId)!.push({ projectId: p.projectId, name: p.name });
    }
    return m;
  }, [projects]);

  if (!deal) return null;

  const handleCreateNew = async () => {
    if (!organization || !user) return;
    if (!newWsName.trim()) { toast.error('Workspace name required'); return; }
    if (!newProjectName.trim()) { toast.error('Project name required'); return; }
    setBusy(true);
    try {
      const ws = await createWorkspace({
        name: newWsName.trim(),
        organizationId: organization.organizationId,
      });
      const project = await createProject(
        user.userId,
        user.email ?? '',
        user.displayName ?? '',
        user.photoURL ?? '',
        {
          name: newProjectName.trim(),
          description: `Handoff from won deal: ${deal.name}`,
          coverColor: '#f97316',
          workspaceId: ws.workspaceId,
          columns: [],
        },
        organization.organizationId,
      );
      await linkDealHandoff(deal.id, { workspaceId: ws.workspaceId, projectId: project.projectId });
      toast.success(`Created ${ws.name} → ${project.name}`);
      await onLinked();
      onOpenChange(false);
      navigate(`/project/${project.projectId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Handoff failed');
    } finally {
      setBusy(false);
    }
  };

  const handleUseExisting = async () => {
    if (!organization || !user) return;

    // Sub-mode: existing project OR create project in existing workspace
    if (selectedProjectId !== NEW_ID) {
      const project = projects.find((p) => p.projectId === selectedProjectId);
      if (!project) { toast.error('Pick a project'); return; }
      setBusy(true);
      try {
        await linkDealHandoff(deal.id, { workspaceId: project.workspaceId ?? null, projectId: project.projectId });
        toast.success(`Linked to ${project.name}`);
        await onLinked();
        onOpenChange(false);
        navigate(`/project/${project.projectId}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Link failed');
      } finally {
        setBusy(false);
      }
      return;
    }

    // Otherwise: create new project inside existing workspace
    if (!existingWorkspaceIdForNewProject) { toast.error('Pick a workspace'); return; }
    if (!newProjectName.trim()) { toast.error('Project name required'); return; }
    setBusy(true);
    try {
      const project = await createProject(
        user.userId,
        user.email ?? '',
        user.displayName ?? '',
        user.photoURL ?? '',
        {
          name: newProjectName.trim(),
          description: `Handoff from won deal: ${deal.name}`,
          coverColor: '#f97316',
          workspaceId: existingWorkspaceIdForNewProject,
          columns: [],
        },
        organization.organizationId,
      );
      await linkDealHandoff(deal.id, {
        workspaceId: existingWorkspaceIdForNewProject,
        projectId: project.projectId,
      });
      toast.success(`Created ${project.name}`);
      await onLinked();
      onOpenChange(false);
      navigate(`/project/${project.projectId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Handoff failed');
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
            Hand off "{deal.name}" to project management
          </DialogTitle>
          <DialogDescription>
            The deal is Won — create a workspace + project to start delivering, or link to an
            existing one your team is already running.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as 'new' | 'existing')}>
          <TabsList className="grid grid-cols-2">
            <TabsTrigger value="new"><FolderPlus className="w-4 h-4 mr-1.5" />Create new</TabsTrigger>
            <TabsTrigger value="existing"><LinkIcon className="w-4 h-4 mr-1.5" />Use existing</TabsTrigger>
          </TabsList>

          <TabsContent value="new" className="space-y-3 mt-4">
            <div>
              <Label>New workspace name</Label>
              <Input
                value={newWsName}
                onChange={(e) => setNewWsName(e.target.value)}
                placeholder="e.g. Acme Corp Delivery"
                disabled={busy}
              />
              <p className="text-xs text-muted-foreground mt-1">
                A workspace is a container for the customer's projects — usually one per customer.
              </p>
            </div>
            <div>
              <Label>First project name</Label>
              <Input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="e.g. Onboarding phase 1"
                disabled={busy}
              />
            </div>
          </TabsContent>

          <TabsContent value="existing" className="space-y-3 mt-4">
            <div>
              <Label>Workspace</Label>
              <Select
                value={existingWorkspaceIdForNewProject || (selectedProjectId !== NEW_ID ? '' : '')}
                onValueChange={(v) => {
                  setExistingWorkspaceIdForNewProject(v);
                  setSelectedProjectId(NEW_ID);
                  setSelectedWorkspaceId(v);
                }}
                disabled={wsLoading || busy}
              >
                <SelectTrigger><SelectValue placeholder={wsLoading ? 'Loading…' : 'Pick a workspace'} /></SelectTrigger>
                <SelectContent>
                  {workspaces.map((ws) => (
                    <SelectItem key={ws.workspaceId} value={ws.workspaceId}>{ws.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {existingWorkspaceIdForNewProject && (
              <>
                <div>
                  <Label>Project</Label>
                  <Select
                    value={selectedProjectId}
                    onValueChange={setSelectedProjectId}
                    disabled={busy}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NEW_ID}>➕ Create new project</SelectItem>
                      {(projectsByWorkspace.get(existingWorkspaceIdForNewProject) ?? []).map((p) => (
                        <SelectItem key={p.projectId} value={p.projectId}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedProjectId === NEW_ID && (
                  <div>
                    <Label>New project name</Label>
                    <Input
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value)}
                      placeholder="e.g. Onboarding phase 1"
                      disabled={busy}
                    />
                  </div>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button
            onClick={mode === 'new' ? handleCreateNew : handleUseExisting}
            disabled={busy || (mode === 'new' ? (!newWsName.trim() || !newProjectName.trim()) : !existingWorkspaceIdForNewProject)}
          >
            {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            <Briefcase className="w-4 h-4 mr-1" />
            {mode === 'new' ? 'Create & open' : selectedProjectId === NEW_ID ? 'Create project & open' : 'Link & open'}
          </Button>
        </DialogFooter>

        {selectedWorkspaceId /* keep the value referenced */}
      </DialogContent>
    </Dialog>
  );
};

export default DealHandoffDialog;
