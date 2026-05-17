import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus } from "lucide-react";
import {
  ACTION_TYPES, TRIGGER_TYPES,
  Recipe, RecipeAction, RecipeCondition, RecipeDraft, TriggerType, ActionType,
  upsertRecipe,
} from "@/services/supabase/automations";
import { toast } from "sonner";

interface Props {
  organizationId: string;
  recipe: Recipe | null;
  onClose: () => void;
}

const TRIGGER_LABEL: Record<TriggerType, string> = {
  deal_stage_entered: "a deal enters stage",
  deal_score_band_changed: "a deal's score band changes",
  deal_field_changed: "a deal field changes",
  form_submitted: "a form is submitted",
  client_created: "a client is created",
  client_tagged: "a client is tagged",
  task_overdue: "a task becomes overdue",
  scheduled: "scheduled time",
};

const ACTION_LABEL: Record<ActionType, string> = {
  create_task: "create task",
  tag: "tag client",
  set_field: "set field",
  change_owner: "change owner",
  add_note: "add note",
  move_deal_stage: "move deal to stage",
  webhook: "call webhook",
  slack_post: "post to Slack",
  send_email: "send email",
  ai_summarize: "AI: summarize",
  ai_classify_lead: "AI: classify lead",
  ai_draft_email: "AI: draft email",
  ai_extract: "AI: extract fields",
  ai_translate: "AI: translate",
};

const OPERATORS = ["eq", "neq", "gte", "lte", "gt", "lt", "in", "contains", "exists"] as const;

const draftFromRecipe = (r: Recipe | null): RecipeDraft => r
  ? {
      name: r.name,
      description: r.description ?? "",
      enabled: r.enabled,
      trigger: { type: r.triggerType, config: r.triggerConfig },
      conditions: r.conditions,
      actions: r.actions,
    }
  : {
      name: "",
      description: "",
      enabled: true,
      trigger: { type: "deal_stage_entered", config: {} },
      conditions: [],
      actions: [{ type: "create_task", config: { title: "", assignee: "deal_owner", due_in_days: 3 } }],
    };

export const RecipeBuilder: React.FC<Props> = ({ organizationId, recipe, onClose }) => {
  const [draft, setDraft] = useState<RecipeDraft>(() => draftFromRecipe(recipe));
  const [saving, setSaving] = useState(false);

  const setTriggerConfig = (patch: Record<string, unknown>) => {
    setDraft((d) => ({ ...d, trigger: { ...d.trigger, config: { ...d.trigger.config, ...patch } } }));
  };

  const addCondition = () => {
    setDraft((d) => ({ ...d, conditions: [...d.conditions, { field: "deal.value", operator: "gte", value: 0 }] }));
  };

  const updateCondition = (i: number, patch: Partial<RecipeCondition>) => {
    setDraft((d) => ({
      ...d,
      conditions: d.conditions.map((c, ci) => (ci === i ? { ...c, ...patch } : c)),
    }));
  };

  const removeCondition = (i: number) => {
    setDraft((d) => ({ ...d, conditions: d.conditions.filter((_, ci) => ci !== i) }));
  };

  const addAction = () => {
    setDraft((d) => ({
      ...d,
      actions: [
        ...d.actions,
        { type: "create_task", config: { title: "", assignee: "deal_owner", due_in_days: 3 } },
      ],
    }));
  };

  const updateAction = (i: number, patch: Partial<RecipeAction>) => {
    setDraft((d) => ({
      ...d,
      actions: d.actions.map((a, ai) => (ai === i ? { ...a, ...patch } : a)),
    }));
  };

  const removeAction = (i: number) => {
    setDraft((d) => ({ ...d, actions: d.actions.filter((_, ai) => ai !== i) }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await upsertRecipe(organizationId, recipe?.recipeId ?? null, draft);
      toast.success(recipe ? "Recipe updated" : "Recipe created");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{recipe ? "Edit automation" : "New automation"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3 items-end">
            <div className="col-span-2">
              <Label>Name</Label>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={120} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} />
              <Label>Active</Label>
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-semibold w-16">When</span>
              <Select
                value={draft.trigger.type}
                onValueChange={(v) => setDraft({ ...draft, trigger: { type: v as TriggerType, config: {} } })}
              >
                <SelectTrigger className="w-[280px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRIGGER_TYPES.map((t) => <SelectItem key={t} value={t}>{TRIGGER_LABEL[t]}</SelectItem>)}
                </SelectContent>
              </Select>

              {draft.trigger.type === "deal_stage_entered" && (
                <Input
                  className="flex-1 min-w-[200px]"
                  placeholder="Stage UUID (or leave blank for any)"
                  value={(draft.trigger.config.stage_id as string) ?? ""}
                  onChange={(e) => setTriggerConfig({ stage_id: e.target.value || undefined })}
                />
              )}
              {draft.trigger.type === "client_tagged" && (
                <Input
                  className="flex-1 min-w-[200px]"
                  placeholder="Tag (or blank for any)"
                  value={(draft.trigger.config.tag as string) ?? ""}
                  onChange={(e) => setTriggerConfig({ tag: e.target.value || undefined })}
                />
              )}
              {draft.trigger.type === "deal_score_band_changed" && (
                <Select
                  value={(draft.trigger.config.band as string) ?? "any"}
                  onValueChange={(v) => setTriggerConfig({ band: v === "any" ? undefined : v })}
                >
                  <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">any</SelectItem>
                    <SelectItem value="hot">hot</SelectItem>
                    <SelectItem value="warm">warm</SelectItem>
                    <SelectItem value="cold">cold</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="flex items-start gap-3">
              <span className="text-sm font-semibold w-16 mt-1">If</span>
              <div className="flex-1 space-y-2">
                {draft.conditions.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={c.field}
                      onChange={(e) => updateCondition(i, { field: e.target.value })}
                      className="w-[180px]"
                      placeholder="deal.value"
                    />
                    <Select
                      value={c.operator}
                      onValueChange={(v) => updateCondition(i, { operator: v as RecipeCondition["operator"] })}
                    >
                      <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {OPERATORS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input
                      value={typeof c.value === "string" ? c.value : JSON.stringify(c.value)}
                      onChange={(e) => {
                        const raw = e.target.value;
                        let v: unknown = raw;
                        try { v = JSON.parse(raw); } catch { /* keep raw */ }
                        updateCondition(i, { value: v });
                      }}
                      placeholder='1000 or "VIP" or ["a","b"]'
                    />
                    <Button variant="ghost" size="icon" onClick={() => removeCondition(i)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addCondition}>
                  <Plus className="w-3 h-3 mr-1" /> Add condition
                </Button>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="text-sm font-semibold w-16 mt-1">Then</span>
              <div className="flex-1 space-y-3">
                {draft.actions.map((a, i) => (
                  <div key={i} className="border rounded-md p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Select
                        value={a.type}
                        onValueChange={(v) => updateAction(i, { type: v as ActionType, config: {} })}
                      >
                        <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ACTION_TYPES.map((t) => <SelectItem key={t} value={t}>{ACTION_LABEL[t]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" onClick={() => removeAction(i)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    <ActionConfigEditor
                      action={a}
                      onChange={(cfg) => updateAction(i, { config: cfg })}
                    />
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addAction}>
                  <Plus className="w-3 h-3 mr-1" /> Add action
                </Button>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// Per-action-type config editor. Lives in the same file to keep imports tight.
// ────────────────────────────────────────────────────────────────────────────

const ActionConfigEditor: React.FC<{
  action: RecipeAction;
  onChange: (cfg: Record<string, unknown>) => void;
}> = ({ action, onChange }) => {
  const cfg = action.config ?? {};
  const set = (patch: Record<string, unknown>) => onChange({ ...cfg, ...patch });

  switch (action.type) {
    case "create_task":
      return (
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="col-span-2">
            <Label>Title</Label>
            <Input value={(cfg.title as string) ?? ""} onChange={(e) => set({ title: e.target.value })} />
          </div>
          <div>
            <Label>Due in (days)</Label>
            <Input
              type="number"
              value={Number(cfg.due_in_days ?? 3)}
              onChange={(e) => set({ due_in_days: Number(e.target.value) })}
            />
          </div>
          <div className="col-span-3">
            <Label>Assignee</Label>
            <Select value={(cfg.assignee as string) ?? "deal_owner"} onValueChange={(v) => set({ assignee: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="deal_owner">Deal owner</SelectItem>
                <SelectItem value="client_owner">Client account owner</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      );

    case "tag":
      return (
        <div className="grid grid-cols-3 gap-2">
          <Input
            className="col-span-2"
            value={(cfg.tag as string) ?? ""}
            onChange={(e) => set({ tag: e.target.value })}
            placeholder="tag"
          />
          <Select value={(cfg.mode as string) ?? "add"} onValueChange={(v) => set({ mode: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="add">add</SelectItem>
              <SelectItem value="remove">remove</SelectItem>
            </SelectContent>
          </Select>
        </div>
      );

    case "set_field":
      return (
        <div className="grid grid-cols-3 gap-2">
          <Select value={(cfg.entity as string) ?? "deal"} onValueChange={(v) => set({ entity: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="deal">deal</SelectItem>
              <SelectItem value="client">client</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={(cfg.field as string) ?? ""}
            onChange={(e) => set({ field: e.target.value })}
            placeholder="field name"
          />
          <Input
            value={typeof cfg.value === "string" ? cfg.value : JSON.stringify(cfg.value ?? "")}
            onChange={(e) => {
              const raw = e.target.value;
              let v: unknown = raw;
              try { v = JSON.parse(raw); } catch { /* keep raw */ }
              set({ value: v });
            }}
            placeholder="value"
          />
        </div>
      );

    case "change_owner":
      return (
        <div className="grid grid-cols-2 gap-2">
          <Select value={(cfg.entity as string) ?? "deal"} onValueChange={(v) => set({ entity: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="deal">deal</SelectItem>
              <SelectItem value="client">client</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={(cfg.owner_id as string) ?? ""}
            onChange={(e) => set({ owner_id: e.target.value })}
            placeholder="user uuid or 'creator' / 'previous_owner'"
          />
        </div>
      );

    case "add_note":
      return (
        <div className="grid grid-cols-1 gap-2">
          <Input
            value={(cfg.subject as string) ?? ""}
            onChange={(e) => set({ subject: e.target.value })}
            placeholder="Subject (supports {{placeholders}})"
          />
          <Input
            value={(cfg.body as string) ?? ""}
            onChange={(e) => set({ body: e.target.value })}
            placeholder="Body"
          />
        </div>
      );

    case "move_deal_stage":
      return (
        <Input
          value={(cfg.stage_id as string) ?? ""}
          onChange={(e) => set({ stage_id: e.target.value })}
          placeholder="stage uuid or 'next'/'previous'"
        />
      );

    case "webhook":
      return (
        <div className="grid grid-cols-1 gap-2">
          <Input
            value={(cfg.url as string) ?? ""}
            onChange={(e) => set({ url: e.target.value })}
            placeholder="https://example.com/hook"
          />
          <Input
            value={(cfg.secret as string) ?? ""}
            onChange={(e) => set({ secret: e.target.value })}
            placeholder="HMAC secret (optional)"
          />
        </div>
      );

    case "slack_post":
      return (
        <div className="grid grid-cols-1 gap-2">
          <Input
            value={(cfg.channel_id as string) ?? ""}
            onChange={(e) => set({ channel_id: e.target.value })}
            placeholder="Channel ID"
          />
          <Input
            value={(cfg.text as string) ?? ""}
            onChange={(e) => set({ text: e.target.value })}
            placeholder="Message text"
          />
        </div>
      );

    case "send_email":
      return (
        <div className="grid grid-cols-1 gap-2">
          <Input
            value={(cfg.to as string) ?? ""}
            onChange={(e) => set({ to: e.target.value })}
            placeholder="deal_owner_email | client_email | literal@addr"
          />
          <Input
            value={(cfg.subject as string) ?? ""}
            onChange={(e) => set({ subject: e.target.value })}
            placeholder="Subject"
          />
          <Input
            value={(cfg.body_html as string) ?? ""}
            onChange={(e) => set({ body_html: e.target.value })}
            placeholder="HTML body"
          />
        </div>
      );

    default:
      return null;
  }
};
