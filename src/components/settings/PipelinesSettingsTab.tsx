import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { usePipelines } from "@/hooks/usePipelines";
import { PipelineEditor } from "./PipelineEditor";
import {
  createPipeline,
  updatePipeline,
  deletePipeline,
} from "@/services/supabase/pipelines";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const PipelinesSettingsTab: React.FC = () => {
  const { organizationId, pipelines, stagesByPipeline, canManage } = usePipelines();
  const [newName, setNewName] = useState("");

  const addPipeline = async () => {
    if (!organizationId || !newName.trim()) return;
    try {
      await createPipeline(organizationId, { name: newName.trim() });
      setNewName("");
      toast.success("Pipeline created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    }
  };

  if (!canManage) {
    return <p className="text-sm text-muted-foreground">Only admins can manage pipelines.</p>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4 flex gap-2 items-end">
          <div className="flex-1">
            <Input
              placeholder="New pipeline name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <Button onClick={addPipeline}>
            <Plus className="w-4 h-4 mr-1" /> Add pipeline
          </Button>
        </CardContent>
      </Card>

      <Tabs defaultValue={pipelines[0]?.pipelineId ?? ""}>
        <TabsList className="flex flex-wrap">
          {pipelines.map((p) => (
            <TabsTrigger key={p.pipelineId} value={p.pipelineId}>
              {p.name} {p.isDefault && "·default"}
            </TabsTrigger>
          ))}
        </TabsList>
        {pipelines.map((p) => (
          <TabsContent key={p.pipelineId} value={p.pipelineId} className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <Input
                defaultValue={p.name}
                onBlur={async (e) => {
                  if (e.target.value !== p.name) {
                    await updatePipeline(p.pipelineId, { name: e.target.value });
                  }
                }}
                className="max-w-[260px]"
              />
              {!p.isDefault && (
                <Button
                  variant="outline"
                  onClick={() => updatePipeline(p.pipelineId, { isDefault: true })}
                >
                  Make default
                </Button>
              )}
              {!p.isDefault && (
                <Button
                  variant="ghost"
                  onClick={async () => {
                    if (confirm("Delete this pipeline? Deals on it must be moved first.")) {
                      try {
                        await deletePipeline(p.pipelineId);
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Delete failed");
                      }
                    }
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
            <PipelineEditor
              pipeline={p}
              initialStages={stagesByPipeline[p.pipelineId] ?? []}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
};
