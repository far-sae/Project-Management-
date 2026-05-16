import React, { useState } from "react";
import {
  Pipeline,
  PipelineStage,
  RequiredFieldKey,
  UpsertStageInput,
  upsertStages,
} from "@/services/supabase/pipelines";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { GripVertical, Trash2, Plus } from "lucide-react";

const ALL_REQUIRED: RequiredFieldKey[] = [
  "value",
  "expected_close_date",
  "description",
  "primary_contact",
];

interface Props {
  pipeline: Pipeline;
  initialStages: PipelineStage[];
  onSaved?: (stages: PipelineStage[]) => void;
}

interface DraftStage {
  stageId?: string;
  key: string;
  label: string;
  color: string;
  position: number;
  defaultProbability: number;
  isWon: boolean;
  isLost: boolean;
  requiredFields: RequiredFieldKey[];
}

export const PipelineEditor: React.FC<Props> = ({ pipeline, initialStages, onSaved }) => {
  const [stages, setStages] = useState<DraftStage[]>(
    initialStages.map((s) => ({
      stageId: s.stageId,
      key: s.key,
      label: s.label,
      color: s.color,
      position: s.position,
      defaultProbability: s.defaultProbability,
      isWon: s.isWon,
      isLost: s.isLost,
      requiredFields: s.requiredFields,
    })),
  );
  const [saving, setSaving] = useState(false);

  const update = (idx: number, patch: Partial<DraftStage>) => {
    setStages((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const addStage = () => {
    setStages((prev) => [
      ...prev,
      {
        key: `stage_${prev.length + 1}`,
        label: "New stage",
        color: "#94A3B8",
        position: prev.length + 1,
        defaultProbability: 10,
        isWon: false,
        isLost: false,
        requiredFields: [],
      },
    ]);
  };

  const removeStage = (idx: number) => {
    setStages((prev) => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, position: i + 1 })));
  };

  const toggleRequired = (idx: number, key: RequiredFieldKey) => {
    setStages((prev) =>
      prev.map((s, i) => {
        if (i !== idx) return s;
        return s.requiredFields.includes(key)
          ? { ...s, requiredFields: s.requiredFields.filter((k) => k !== key) }
          : { ...s, requiredFields: [...s.requiredFields, key] };
      }),
    );
  };

  const save = async () => {
    setSaving(true);
    try {
      const wonCount = stages.filter((s) => s.isWon).length;
      const lostCount = stages.filter((s) => s.isLost).length;
      if (wonCount !== 1) throw new Error("Exactly one stage must be marked Won");
      if (lostCount !== 1) throw new Error("Exactly one stage must be marked Lost");
      const next = await upsertStages(
        pipeline.pipelineId,
        pipeline.organizationId,
        stages.map<UpsertStageInput>((s, i) => ({ ...s, position: i + 1 })),
      );
      toast.success("Pipeline saved");
      onSaved?.(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {stages.map((s, idx) => (
        <div key={idx} className="border rounded-lg p-3 grid grid-cols-12 gap-3">
          <div className="col-span-1 flex items-center justify-center text-muted-foreground">
            <GripVertical className="w-4 h-4" />
          </div>
          <div className="col-span-2">
            <Label>Key</Label>
            <Input
              value={s.key}
              onChange={(e) => update(idx, { key: e.target.value })}
              maxLength={40}
            />
          </div>
          <div className="col-span-2">
            <Label>Label</Label>
            <Input
              value={s.label}
              onChange={(e) => update(idx, { label: e.target.value })}
              maxLength={60}
            />
          </div>
          <div className="col-span-1">
            <Label>%</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={s.defaultProbability}
              onChange={(e) => update(idx, { defaultProbability: Number(e.target.value) || 0 })}
            />
          </div>
          <div className="col-span-1">
            <Label>Color</Label>
            <Input
              type="color"
              value={s.color}
              onChange={(e) => update(idx, { color: e.target.value })}
            />
          </div>
          <div className="col-span-1 flex items-end gap-2">
            <Switch checked={s.isWon} onCheckedChange={(v) => update(idx, { isWon: v, isLost: v ? false : s.isLost })} />
            <Label className="text-xs">Won</Label>
          </div>
          <div className="col-span-1 flex items-end gap-2">
            <Switch checked={s.isLost} onCheckedChange={(v) => update(idx, { isLost: v, isWon: v ? false : s.isWon })} />
            <Label className="text-xs">Lost</Label>
          </div>
          <div className="col-span-2 flex flex-wrap gap-1 items-end">
            {ALL_REQUIRED.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => toggleRequired(idx, k)}
                className={`text-[10px] px-2 py-1 rounded border ${
                  s.requiredFields.includes(k)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {k}
              </button>
            ))}
          </div>
          <div className="col-span-1 flex items-end justify-end">
            <Button variant="ghost" size="icon" onClick={() => removeStage(idx)}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      ))}
      <div className="flex gap-2">
        <Button variant="outline" onClick={addStage}>
          <Plus className="w-4 h-4 mr-1" /> Add stage
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save pipeline"}
        </Button>
      </div>
    </div>
  );
};
