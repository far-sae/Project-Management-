// src/components/clients/DealWonModal.tsx
import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Deal, closeDealToWon } from "@/services/supabase/deals";
import { PipelineStage } from "@/services/supabase/pipelines";
import { ProjectTemplate, getOrganizationTemplates } from "@/services/supabase/projectTemplates";
import { toast } from "sonner";

interface Props {
  deal: Deal;
  targetStage: PipelineStage;
  onClose: () => void;
}

const toIso = (d: Date) => d.toISOString().slice(0, 10);

export const DealWonModal: React.FC<Props> = ({ deal, targetStage: _targetStage, onClose }) => {
  const today = new Date();
  const due = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [name, setName] = useState(`${deal.clientName ?? ""} — ${deal.title}`.trim().slice(0, 120));
  const [templateId, setTemplateId] = useState<string>("none");
  const [start, setStart] = useState(toIso(today));
  const [dueDate, setDueDate] = useState(toIso(due));
  const [submitting, setSubmitting] = useState(false);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);

  useEffect(() => {
    getOrganizationTemplates(deal.organizationId).then(setTemplates);
  }, [deal.organizationId]);

  const submit = async (skip: boolean) => {
    setSubmitting(true);
    try {
      await closeDealToWon(deal.dealId, {
        skip,
        name: skip ? undefined : name,
        ownerId: skip ? undefined : (deal.ownerId ?? undefined),
        startDate: skip ? undefined : start,
        dueDate: skip ? undefined : dueDate,
        templateId: skip || templateId === "none" ? null : templateId,
      });
      toast.success(skip ? "Deal won" : "Deal won, project created");
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
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
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
