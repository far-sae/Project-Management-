import { publicMessage } from '@/lib/publicError';
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useDealMoney } from '@/hooks/useDealMoney';
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
import { useProjects } from '@/hooks/useProjects';
import { getCompany } from '@/services/supabase/crmHub/companies';
import { getContact } from '@/services/supabase/crmHub/contacts';
import { linkDealHandoff } from '@/services/supabase/crmHub/deals';
import { HandoffLinkError, handoffDealToNewProject } from '@/services/supabase/crmHub/flow';
import {
  defaultHandoffTasks, handoffDescription, handoffProjectName, leadName, type HandoffTaskDraft,
} from '@/lib/crmFlow';
import type { CrmDeal } from '@/types/crmHub';
import { PriorityPill } from '@/components/common/TaskBadges';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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

interface TaskRow extends HandoffTaskDraft {
  on: boolean;
}

/**
 * The step between sales and delivery: a won deal becomes a project that
 * already knows who the customer is and what to do first.
 */
export const DealHandoffDialog: React.FC<Props> = ({ deal, open, onOpenChange, onLinked }) => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const { formatDeal } = useDealMoney();
  const { selected } = useSelectedWorkspace();
  const { projects } = useProjects();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'create' | 'link'>('create');
  const [projectName, setProjectName] = useState('');
  const [description, setDescription] = useState('');
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [assignToMe, setAssignToMe] = useState(true);
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);
  /** A project an earlier attempt created before the link step failed. */
  const [madeProjectId, setMadeProjectId] = useState<string | null>(null);

  const workspaceId = deal?.workspaceId ?? selected?.workspaceId ?? null;
  const workspaceProjects = useMemo(
    () => projects.filter((project) => project.workspaceId === workspaceId),
    [projects, workspaceId],
  );

  const dealId = deal?.id;
  useEffect(() => {
    if (!open || !deal) return;
    let cancelled = false;
    setMode('create');
    setProjectId('');
    setMadeProjectId(null);
    setAssignToMe(true);
    // Fill in what is known straight away, then improve it once the customer loads.
    const fill = (companyName: string | null, contactName: string | null, contactEmail: string | null) => {
      setProjectName(handoffProjectName(deal, companyName ? { name: companyName } : null));
      setDescription(
        handoffDescription({
          dealName: deal.name,
          // In the deal's own currency: that is what was agreed with the customer.
          value: deal.value > 0 ? formatDeal(deal) : null,
          companyName,
          contactName,
          contactEmail,
          notes: deal.notes,
        }),
      );
      setRows(defaultHandoffTasks(contactName).map((t) => ({ ...t, on: true })));
    };
    fill(null, null, null);
    void Promise.all([
      deal.companyId ? getCompany(deal.companyId).catch(() => null) : null,
      deal.contactId ? getContact(deal.contactId).catch(() => null) : null,
    ]).then(([company, contact]) => {
      if (cancelled || (!company && !contact)) return;
      fill(company?.name ?? null, contact ? leadName(contact) : null, contact?.email ?? null);
    });
    return () => { cancelled = true; };
    // Re-run only when the dialog opens for a (different) deal.
  }, [open, dealId]);

  if (!deal) return null;

  const wrongWorkspace = Boolean(deal.workspaceId && selected && deal.workspaceId !== selected.workspaceId);
  const chosenTasks = rows.filter((r) => r.on && r.title.trim());

  const finish = async (linkedProjectId: string, message: string) => {
    toast.success(message);
    await onLinked();
    onOpenChange(false);
    navigate(`/project/${linkedProjectId}`);
  };

  const handleCreate = async () => {
    if (!organization || !user || !workspaceId || !projectName.trim()) return;
    setBusy(true);
    try {
      const result = await handoffDealToNewProject({
        deal,
        organizationId: organization.organizationId,
        workspaceId,
        actor: {
          userId: user.userId,
          email: user.email ?? '',
          displayName: user.displayName ?? '',
          photoURL: user.photoURL ?? '',
        },
        projectName,
        description,
        tasks: chosenTasks.map(({ title, dueInDays, priority }) => ({ title: title.trim(), dueInDays, priority })),
        assignee: assignToMe
          ? { userId: user.userId, displayName: user.displayName ?? user.email ?? 'Me', email: user.email ?? undefined, photoURL: user.photoURL ?? undefined }
          : null,
        existingProjectId: madeProjectId,
      });
      const made = result.tasksCreated;
      const taskText = made === 0 ? '' : ` with ${made} starter task${made === 1 ? '' : 's'}`;
      if (result.tasksFailed > 0) {
        toast.warning(`${result.tasksFailed} starter task${result.tasksFailed === 1 ? '' : 's'} could not be created. Add them on the board.`);
      }
      await finish(result.projectId, `Project created${taskText}`);
    } catch (error) {
      if (error instanceof HandoffLinkError) {
        // The project exists; only the link is missing. Trying again must not make a second one.
        setMadeProjectId(error.projectId);
        toast.error('The project was created but could not be linked to the deal. Press "Try again".');
      } else {
        toast.error(publicMessage(error, 'Hand-off failed'));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleLink = async () => {
    if (!workspaceId || !projectId) return;
    const project = workspaceProjects.find((item) => item.projectId === projectId);
    if (!project) return;
    setBusy(true);
    try {
      await linkDealHandoff(deal.id, { workspaceId, projectId: project.projectId });
      await finish(project.projectId, `Linked to ${project.name}`);
    } catch (error) {
      toast.error(publicMessage(error, 'Could not link the project'));
    } finally {
      setBusy(false);
    }
  };

  const setRow = (index: number, patch: Partial<TaskRow>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Hand off “{deal.name}” to delivery</DialogTitle>
          <DialogDescription>
            The deal is won. Turn it into a project so the team knows who the customer is and what to do first.
          </DialogDescription>
        </DialogHeader>

        {wrongWorkspace ? (
          <p className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground">
            This deal belongs to another workspace. Switch to that workspace in the sidebar, then hand it off.
          </p>
        ) : (
          <Tabs value={mode} onValueChange={(value) => setMode(value as 'create' | 'link')}>
            <TabsList>
              <TabsTrigger value="create">New project</TabsTrigger>
              <TabsTrigger value="link">Existing project</TabsTrigger>
            </TabsList>

            <TabsContent value="create" className="mt-4 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="handoff-name">Project name</Label>
                <Input
                  id="handoff-name"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  disabled={busy || Boolean(madeProjectId)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="handoff-brief">Brief for the team</Label>
                <Textarea
                  id="handoff-brief"
                  rows={6}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  disabled={busy || Boolean(madeProjectId)}
                />
                <p className="text-xs text-muted-foreground">Saved as the project description.</p>
              </div>
              <fieldset className="flex flex-col gap-1.5" disabled={busy || Boolean(madeProjectId)}>
                <legend className="mb-1.5 text-sm font-medium">Starter tasks</legend>
                <ul className="divide-y divide-border rounded-md border border-border">
                  {rows.map((row, index) => (
                    <li key={index} className="flex items-center gap-2 px-2.5 py-1.5">
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 accent-primary"
                        checked={row.on}
                        onChange={(event) => setRow(index, { on: event.target.checked })}
                        aria-label={`Create task: ${row.title}`}
                      />
                      <input
                        className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
                        value={row.title}
                        onChange={(event) => setRow(index, { title: event.target.value })}
                        disabled={!row.on}
                        aria-label="Task title"
                      />
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        in {row.dueInDays} day{row.dueInDays === 1 ? '' : 's'}
                      </span>
                      <PriorityPill priority={row.priority} />
                    </li>
                  ))}
                </ul>
                <label className="mt-1 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={assignToMe}
                    onChange={(event) => setAssignToMe(event.target.checked)}
                  />
                  Assign these tasks to me
                </label>
              </fieldset>
            </TabsContent>

            <TabsContent value="link" className="mt-4 flex flex-col gap-1.5">
              <Label>Project in {selected?.name ?? 'this workspace'}</Label>
              <Select value={projectId} onValueChange={setProjectId} disabled={busy}>
                <SelectTrigger><SelectValue placeholder="Choose a project" /></SelectTrigger>
                <SelectContent>
                  {workspaceProjects.map((project) => (
                    <SelectItem key={project.projectId} value={project.projectId}>{project.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {workspaceProjects.length === 0
                  ? 'This workspace has no projects yet. Create a new one instead.'
                  : 'Use this when the work for this customer is already running in a project.'}
              </p>
            </TabsContent>
          </Tabs>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Not now</Button>
          {!wrongWorkspace && (
            <Button
              onClick={mode === 'create' ? handleCreate : handleLink}
              disabled={busy || !workspaceId || (mode === 'create' ? !projectName.trim() : !projectId)}
            >
              {busy && <Loader2 className="animate-spin" />}
              {mode === 'link' ? 'Link and open' : madeProjectId ? 'Try again' : 'Create project'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DealHandoffDialog;
