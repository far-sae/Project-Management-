// src/components/clients/DealWonModal.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Deal, closeDealToWon } from "@/services/supabase/deals";
import { PipelineStage } from "@/services/supabase/pipelines";
import { ProjectTemplate, getOrganizationTemplates } from "@/services/supabase/projectTemplates";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { getOrganizationClients } from "@/services/supabase/clients";
import { updateProject } from "@/services/supabase/database";
import { logger } from "@/lib/logger";
import { toast } from "sonner";

interface Props {
  deal: Deal;
  targetStage: PipelineStage;
  onClose: () => void;
  /** Called AFTER the won transition succeeds. Used by the parent to open the
   *  handoff dialog. Optional so all existing callers remain unchanged. */
  onWon?: (deal: Deal) => void;
}

const toIso = (d: Date) => d.toISOString().slice(0, 10);

/** Sentinel option in the workspace <Select> that reveals an inline name
 *  input so the rep can create a workspace without leaving the dialog. */
const NEW_WORKSPACE = "__new_workspace__";

export const DealWonModal: React.FC<Props> = ({ deal, targetStage: _targetStage, onClose, onWon }) => {
  const today = new Date();
  const due = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

  const { workspaces, addWorkspace, DEFAULT_WORKSPACE_ID } = useWorkspaces();

  const [name, setName] = useState(`${deal.clientName ?? ""} — ${deal.title}`.trim().slice(0, 120));
  const [templateId, setTemplateId] = useState<string>("none");
  const [start, setStart] = useState(toIso(today));
  const [dueDate, setDueDate] = useState(toIso(due));
  const [submitting, setSubmitting] = useState(false);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);

  // Workspace selection. Defaults to the deal's account workspace when known,
  // else the org's default workspace. Picking "＋ New workspace" reveals an
  // inline name field; the workspace is created on Create project.
  const [workspaceId, setWorkspaceId] = useState<string>(DEFAULT_WORKSPACE_ID);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");

  useEffect(() => {
    getOrganizationTemplates(deal.organizationId).then(setTemplates);
  }, [deal.organizationId]);

  // Default the workspace to the deal's account workspace when available,
  // otherwise the org default. Only runs once the workspaces have loaded.
  useEffect(() => {
    let cancelled = false;
    const resolveDefault = async () => {
      if (deal.clientId) {
        try {
          const clients = await getOrganizationClients(deal.organizationId);
          const account = clients.find((c) => c.clientId === deal.clientId);
          if (account?.workspaceId && workspaces.some((w) => w.workspaceId === account.workspaceId)) {
            if (!cancelled) setWorkspaceId(account.workspaceId);
            return;
          }
        } catch (err) {
          logger.warn("DealWonModal: failed to resolve account workspace", err);
        }
      }
      if (!cancelled) setWorkspaceId(DEFAULT_WORKSPACE_ID);
    };
    void resolveDefault();
    return () => { cancelled = true; };
  }, [deal.clientId, deal.organizationId, workspaces, DEFAULT_WORKSPACE_ID]);

  const isNewWorkspace = workspaceId === NEW_WORKSPACE;

  const resolvedTitle = useMemo(
    () => `${deal.clientName ?? ""} — ${deal.title}`.trim(),
    [deal.clientName, deal.title],
  );

  const submit = async (skip: boolean) => {
    if (!skip && isNewWorkspace && !newWorkspaceName.trim()) {
      toast.error("Enter a name for the new workspace");
      return;
    }
    setSubmitting(true);
    try {
      // 1. Create the workspace first when the rep chose "＋ New workspace",
      //    so the project can be filed into it. (Skip mode never touches it.)
      let targetWorkspaceId: string | null = null;
      if (!skip) {
        if (isNewWorkspace) {
          const ws = await addWorkspace({ name: newWorkspaceName.trim() });
          if (!ws) throw new Error("Could not create the workspace");
          targetWorkspaceId = ws.workspaceId;
        } else if (workspaceId && workspaceId !== "__default__") {
          targetWorkspaceId = workspaceId;
        }
      }

      // 2. Existing project-create + source_deal_id/source_client_id handoff
      //    path (crm_close_deal_to_won) — unchanged.
      const result = await closeDealToWon(deal.dealId, {
        skip,
        name: skip ? undefined : name,
        ownerId: skip ? undefined : (deal.ownerId ?? undefined),
        startDate: skip ? undefined : start,
        dueDate: skip ? undefined : dueDate,
        templateId: skip || templateId === "none" ? null : templateId,
      });

      // 3. File the just-created project into the chosen workspace. The RPC
      //    doesn't take a workspace, so we set it on the returned project.
      if (!skip && targetWorkspaceId && result.projectId) {
        try {
          await updateProject(
            result.projectId,
            { workspaceId: targetWorkspaceId },
            deal.organizationId,
          );
        } catch (err) {
          logger.warn("DealWonModal: project created but workspace assignment failed", err);
        }
      }

      toast.success(skip ? "Deal won" : "Deal won, project created");
      onWon?.(deal);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create project from won deal</DialogTitle>
          <DialogDescription>
            Choose whether to create a delivery project now or just mark this deal as won.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Project name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={resolvedTitle} />
          </div>
          <div>
            <Label>Workspace</Label>
            <Select value={workspaceId} onValueChange={setWorkspaceId}>
              <SelectTrigger><SelectValue placeholder="Select a workspace" /></SelectTrigger>
              <SelectContent>
                {workspaces.map((w) => (
                  <SelectItem key={w.workspaceId} value={w.workspaceId}>{w.name}</SelectItem>
                ))}
                <SelectItem value={NEW_WORKSPACE}>＋ New workspace</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {isNewWorkspace && (
            <div>
              <Label>New workspace name</Label>
              <Input
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                placeholder="e.g. Delivery"
                maxLength={120}
                autoFocus
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Start</Label>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <Label>Due</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Template</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No template</SelectItem>
                {templates.map((t) => (
                  <SelectItem key={t.templateId} value={t.templateId}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">Client: {deal.clientName ?? "—"}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => submit(true)} disabled={submitting}>Skip</Button>
          <Button onClick={() => submit(false)} disabled={submitting}>
            {submitting ? "Creating…" : "Create project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
