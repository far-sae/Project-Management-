import React, { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useAgentSettings } from "@/hooks/useAgentSettings";
import { toast } from "sonner";

export const AgentSettingsTab: React.FC = () => {
  const { settings, loading, saving, save, canManage } = useAgentSettings();
  const [draft, setDraft] = useState(settings);

  useEffect(() => { setDraft(settings); }, [settings]);

  if (!canManage) return <p className="text-sm text-muted-foreground">Admins only.</p>;
  if (loading) return (
    <p className="text-sm text-muted-foreground flex items-center gap-2">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading settings…
    </p>
  );

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  const submit = async () => {
    try {
      await save(draft);
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  return (
    <div className="space-y-4 max-w-xl">
      <div className="flex items-center gap-3">
        <Switch
          checked={draft.enabled}
          onCheckedChange={(v) => setDraft({ ...draft, enabled: v })}
        />
        <Label>Enable AI Sales Agent</Label>
      </div>

      <div>
        <Label>Daily Apollo enrichment cap</Label>
        <Input
          type="number" min={0} max={500}
          value={draft.apolloDailyCap}
          onChange={(e) => setDraft({ ...draft, apolloDailyCap: Number(e.target.value) })}
        />
        <p className="text-xs text-muted-foreground mt-1">
          Apollo Basic plan = ~500 credits/mo. Default 20/day stays within plan thanks to the 30-day cache.
        </p>
      </div>

      <div>
        <Label>Daily LLM draft cap</Label>
        <Input
          type="number" min={0} max={500}
          value={draft.draftDailyCap}
          onChange={(e) => setDraft({ ...draft, draftDailyCap: Number(e.target.value) })}
        />
        <p className="text-xs text-muted-foreground mt-1">
          Each draft costs about $0.05 in Anthropic tokens.
        </p>
      </div>

      <Button onClick={submit} disabled={!dirty || saving}>
        {saving ? "Saving…" : "Save"}
      </Button>

      <p className="text-xs text-muted-foreground border-t pt-3">
        Per-pipeline staleness threshold is configured in Settings → Pipelines
        (each pipeline gets its own "stale after N days" value, default 14).
      </p>
    </div>
  );
};
