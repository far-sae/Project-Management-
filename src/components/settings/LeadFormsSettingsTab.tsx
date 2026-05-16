// src/components/settings/LeadFormsSettingsTab.tsx
import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useLeadForms } from "@/hooks/useLeadForms";
import { usePipelines } from "@/hooks/usePipelines";
import { createForm, deleteForm } from "@/services/supabase/leadForms";
import { LeadFormEditor } from "./LeadFormEditor";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

const DEFAULT_FIELDS = [
  { key: "name", label: "Full name", type: "text", required: true, maxLength: 120 },
  { key: "email", label: "Email", type: "email", required: true },
  { key: "company", label: "Company", type: "text", required: true, maxLength: 120 },
  { key: "notes", label: "Notes", type: "textarea", required: false, maxLength: 2000 },
];

export const LeadFormsSettingsTab: React.FC = () => {
  const { organizationId, forms, canManage } = useLeadForms();
  const { pipelines, defaultPipeline } = usePipelines();
  const [newSlug, setNewSlug] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newPipelineId, setNewPipelineId] = useState<string>("");

  React.useEffect(() => {
    if (!newPipelineId && defaultPipeline) setNewPipelineId(defaultPipeline.pipelineId);
  }, [newPipelineId, defaultPipeline]);

  if (!canManage) return <p className="text-sm text-muted-foreground">Only admins can manage lead forms.</p>;
  if (!organizationId) return null;

  const createNew = async () => {
    try {
      await createForm(organizationId, {
        pipelineId: newPipelineId,
        slug: newSlug,
        title: newTitle,
        fields: DEFAULT_FIELDS as any,
      });
      setNewSlug(""); setNewTitle("");
      toast.success("Form created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4 grid grid-cols-12 gap-2 items-end">
          <div className="col-span-3">
            <Label>Title</Label>
            <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          </div>
          <div className="col-span-3">
            <Label>Slug</Label>
            <Input value={newSlug} onChange={(e) => setNewSlug(e.target.value)} placeholder="acme-newbiz" />
          </div>
          <div className="col-span-3">
            <Label>Pipeline</Label>
            <Select value={newPipelineId} onValueChange={setNewPipelineId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {pipelines.map((p) => (<SelectItem key={p.pipelineId} value={p.pipelineId}>{p.name}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <Button className="col-span-3" onClick={createNew} disabled={!newSlug || !newTitle || !newPipelineId}>
            <Plus className="w-4 h-4 mr-1" /> Create form
          </Button>
        </CardContent>
      </Card>

      {forms.length === 0 ? (
        <p className="text-sm text-muted-foreground">No lead forms yet.</p>
      ) : (
        <Tabs defaultValue={forms[0].formId}>
          <TabsList className="flex flex-wrap">
            {forms.map((f) => (<TabsTrigger key={f.formId} value={f.formId}>{f.title} · /{f.slug}</TabsTrigger>))}
          </TabsList>
          {forms.map((f) => (
            <TabsContent key={f.formId} value={f.formId} className="mt-4 space-y-3">
              <div className="flex justify-end">
                <Button variant="ghost" size="icon" onClick={async () => {
                  if (confirm(`Delete form "${f.title}"?`)) {
                    await deleteForm(f.formId);
                    toast.success("Deleted");
                  }
                }}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              <LeadFormEditor form={f} onChanged={() => undefined} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
};
