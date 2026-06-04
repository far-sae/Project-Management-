import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Plus, Sparkles, Trash2 } from "lucide-react";
import {
  ACTION_TYPES, TRIGGER_TYPES,
  Recipe, RecipeAction, RecipeCondition, RecipeDraft, TriggerType, ActionType,
  upsertRecipe,
  listSlackChannels, SlackChannel,
} from "@/services/supabase/automations";
import { toast } from "sonner";

interface Props {
  organizationId: string;
  recipe: Recipe | null;
  initialDraft?: RecipeDraft | null;
  onClose: () => void;
}

const TRIGGER_LABEL: Record<TriggerType, string> = {
  deal_stage_entered: "a deal enters stage",
  deal_score_band_changed: "a deal's score band changes",
  deal_field_changed: "a deal field changes",
  form_submitted: "a form is submitted",
  client_created: "a client is created",
  client_tagged: "a client is tagged",
  workspace_created: "a workspace is created",
  project_created: "a project is created",
  task_created: "a project task is created",
  task_assigned: "a project task is assigned",
  task_status_changed: "a project task changes status",
  email_reply_received: "an email reply is received",
  task_overdue: "a task becomes overdue",
  scheduled: "scheduled time",
  agent_intake: "AI agent: draft outreach for new lead",
  slack_message_received: "a Slack message is posted",
  slack_reaction_added: "an emoji reaction is added to a message",
};

const ACTION_LABEL: Record<ActionType, string> = {
  create_task: "create task",
  create_workspace: "create workspace",
  create_project: "create project",
  create_project_task: "create project task",
  assign_task: "assign task",
  create_google_meet: "create Google Meet link",
  tag: "tag client",
  set_field: "set field",
  change_owner: "change owner",
  add_note: "add note",
  move_deal_stage: "move deal to stage",
  webhook: "call webhook",
  slack_post: "post to Slack",
  send_email: "send email",
  send_sms: "send SMS",
  notify: "notify a user in-app",
  ai_summarize: "AI: summarize",
  ai_classify_lead: "AI: classify lead",
  ai_draft_email: "AI: draft email",
  ai_extract: "AI: extract fields",
  ai_translate: "AI: translate",
  wait: "Wait",
};

const OPERATORS = ["eq", "neq", "gte", "lte", "gt", "lt", "in", "contains", "exists"] as const;

const draftFromRecipe = (r: Recipe | null, initialDraft?: RecipeDraft | null): RecipeDraft => {
  if (r) {
    return {
      name: r.name,
      description: r.description ?? "",
      enabled: r.enabled,
      trigger: { type: r.triggerType, config: r.triggerConfig },
      conditions: r.conditions,
      actions: r.actions,
      sendWindow: r.sendWindow ?? null,
    };
  }
  if (initialDraft) return initialDraft;
  return {
    name: "",
    description: "",
    enabled: true,
    trigger: { type: "deal_stage_entered", config: {} },
    conditions: [],
    actions: [{ type: "create_task", config: { title: "", assignee: "deal_owner", due_in_days: 3 } }],
  };
};

export const RecipeBuilder: React.FC<Props> = ({ organizationId, recipe, initialDraft, onClose }) => {
  const [draft, setDraft] = useState<RecipeDraft>(() => draftFromRecipe(recipe, initialDraft));
  const [saving, setSaving] = useState(false);
  const [slackChannels, setSlackChannels] = useState<SlackChannel[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(() => draft.conditions.length > 0);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Fetch Slack channels on demand when the trigger flips to slack.
  useEffect(() => {
    if (
      draft.trigger.type !== "slack_message_received" &&
      draft.trigger.type !== "slack_reaction_added"
    ) return;
    if (slackChannels.length > 0) return;
    setLoadingChannels(true);
    listSlackChannels().then((cs) => {
      setSlackChannels(cs);
      setLoadingChannels(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.trigger.type]);

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

  // Quick-add: append a specific action kind with sensible defaults so a
  // rep can build "create task → notify → assign owner" with one click
  // per action, no dropdown chooser per row. Mirrors the layout the
  // reference design uses (create task / log activity / add tag /
  // notify / assign owner / ai draft email).
  const QUICK_ADD: Array<{ type: ActionType; label: string; defaults: Record<string, unknown> }> = [
    { type: "create_task",    label: "+ create task",    defaults: { title: "Follow up", assignee: "deal_owner", due_in_days: 3 } },
    { type: "add_note",       label: "+ log activity",   defaults: { body: "" } },
    { type: "tag",            label: "+ add tag",        defaults: { tag: "" } },
    { type: "send_email",     label: "+ notify",         defaults: { to: "owner", subject: "", body: "" } },
    { type: "change_owner",   label: "+ assign owner",   defaults: { owner_id: "" } },
    { type: "ai_draft_email", label: "+ ai draft email", defaults: { prompt: "Draft a follow-up email about this deal." } },
  ];
  const quickAddAction = (type: ActionType, defaults: Record<string, unknown>) => {
    setDraft((d) => ({ ...d, actions: [...d.actions, { type, config: defaults }] }));
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

  const setSendWindow = (patch: Partial<NonNullable<RecipeDraft["sendWindow"]>> | null) => {
    setDraft((d) => ({
      ...d,
      sendWindow: patch === null ? null : {
        hours: patch.hours ?? d.sendWindow?.hours ?? [9, 18],
        days: patch.days ?? d.sendWindow?.days ?? [1, 2, 3, 4, 5],
        timezone: patch.timezone ?? d.sendWindow?.timezone ?? "Europe/London",
      },
    }));
  };

  const toggleDay = (n: number) => {
    setDraft((d) => {
      const current = d.sendWindow?.days ?? [1, 2, 3, 4, 5];
      const next = current.includes(n) ? current.filter((x) => x !== n) : [...current, n].sort();
      return {
        ...d,
        sendWindow: {
          hours: d.sendWindow?.hours ?? [9, 18],
          timezone: d.sendWindow?.timezone ?? "Europe/London",
          days: next,
        },
      };
    });
  };

  const sendWindowSummary = (sw: RecipeDraft["sendWindow"]): string => {
    if (!sw) return "(none — send any time)";
    const dayNames = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const days = sw.days.map((d) => dayNames[d]).join("/");
    return `(${sw.hours[0]}–${sw.hours[1]} ${days} · ${sw.timezone})`;
  };

  const validateForBeginners = (): string | null => {
    if (!draft.name.trim()) return "Give this automation a name first.";
    if (draft.trigger.type === "slack_message_received") {
      const channels = (draft.trigger.config.channels as string[]) ?? [];
      if (channels.length === 0) {
        return "Choose at least one Slack channel so we know where to listen.";
      }
    }
    if (draft.trigger.type === "slack_reaction_added") {
      const reactions = (draft.trigger.config.reactions as string[]) ?? [];
      if (reactions.length === 0) {
        return "Add at least one Slack emoji reaction, such as white_check_mark or eyes.";
      }
    }
    for (const action of draft.actions) {
      if (action.type === "create_task" && !(action.config.title as string)?.trim()) {
        return "Add a task title in the Then section.";
      }
      if (action.type === "create_workspace" && !(action.config.name as string)?.trim()) {
        return "Add a workspace name in the Then section.";
      }
      if (action.type === "create_project" && !(action.config.name as string)?.trim()) {
        return "Add a project name in the Then section.";
      }
      if (action.type === "create_project_task" && !(action.config.title as string)?.trim()) {
        return "Add a project task title in the Then section.";
      }
      if (action.type === "webhook" && !(action.config.url as string)?.trim()) {
        return "Add the webhook URL before saving.";
      }
      if (action.type === "slack_post" && !(action.config.channel_id as string)?.trim()) {
        return "Add the Slack channel ID for the message action.";
      }
      if (action.type === "send_email") {
        if (!(action.config.to as string)?.trim()) return "Add an email recipient.";
        if (!(action.config.subject as string)?.trim()) return "Add an email subject.";
      }
      if (action.type === "send_sms") {
        if (!(action.config.to as string)?.trim()) return "Add a phone number or template for the SMS recipient.";
        if (!(action.config.body as string)?.trim()) return "Add a message body for the SMS.";
      }
      if (action.type === "notify") {
        if (!(action.config.user as string)?.trim()) return "Choose who should receive the in-app notification.";
        if (!(action.config.title as string)?.trim()) return "Add a title for the notification.";
      }
    }
    return null;
  };

  const save = async () => {
    const validationMessage = validateForBeginners();
    if (validationMessage) {
      setSaveError(validationMessage);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await upsertRecipe(organizationId, recipe?.recipeId ?? null, draft);
      toast.success(recipe ? "Recipe updated" : "Recipe created");
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{recipe ? "Edit automation" : "New automation"}</DialogTitle>
          <DialogDescription>
            Choose a trigger, optional conditions, and the action this automation should run.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border bg-primary/5 border-primary/20 p-3 flex items-start gap-3">
            <Sparkles className="w-4 h-4 text-primary mt-0.5" />
            <div className="text-sm">
              <p className="font-medium">Build it like a sentence.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Choose when something happens, optionally add filters, then choose what the app should do.
                Advanced fields are available when you need more control.
              </p>
            </div>
          </div>

          {saveError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5" />
              <span>{saveError}</span>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3 items-end">
            <div className="col-span-2 space-y-2">
              <Label>Name</Label>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={120} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} />
              <Label>Active</Label>
            </div>
            <div className="col-span-3 space-y-2">
              <Label>Description (optional)</Label>
              <Input
                value={draft.description ?? ""}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                maxLength={240}
                placeholder="Example: Remind the owner to follow up after every new client."
              />
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <div className="flex items-start gap-3 flex-wrap">
              <div className="w-16">
                <span className="text-sm font-semibold">When</span>
                <p className="text-[11px] text-muted-foreground">the trigger</p>
              </div>
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

            {/* Slack trigger: channel multi-select + optional keyword filter */}
            {draft.trigger.type === "slack_message_received" && (
              <div className="ml-16 space-y-2 border-l pl-3 -mt-1">
                <div>
                  <Label className="text-xs text-muted-foreground">Channels (required)</Label>
                  {loadingChannels ? (
                    <p className="text-xs text-muted-foreground">Loading channels…</p>
                  ) : slackChannels.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No channels found. Make sure Slack is connected in Settings → Integrations
                      and the bot is invited to at least one public channel.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto border rounded p-2">
                      {slackChannels.map((c) => {
                        const selected = ((draft.trigger.config.channels as string[]) ?? []).includes(c.id);
                        return (
                          <label key={c.id} className="flex items-center gap-1 text-xs">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => {
                                const current = (draft.trigger.config.channels as string[]) ?? [];
                                const next = selected
                                  ? current.filter((x) => x !== c.id)
                                  : [...current, c.id];
                                setTriggerConfig({ channels: next });
                              }}
                            />
                            #{c.name}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Keyword filter (optional)</Label>
                  <Input
                    value={(draft.trigger.config.keyword as string) ?? ""}
                    onChange={(e) => setTriggerConfig({ keyword: e.target.value || undefined })}
                    placeholder="e.g. task:  or  /^todo:/i  for regex"
                    className="h-8"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Plain text = case-insensitive contains. Wrap in slashes for regex.
                    Leave blank to fire on every message in the selected channels.
                  </p>
                </div>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={!!draft.trigger.config.mention_only}
                    onChange={(e) => setTriggerConfig({ mention_only: e.target.checked || undefined })}
                  />
                  Only fire when the bot is @mentioned in the message
                </label>
              </div>
            )}

            {/* Slack reaction trigger: emoji list + optional channel filter */}
            {draft.trigger.type === "slack_reaction_added" && (
              <div className="ml-16 space-y-2 border-l pl-3 -mt-1">
                <div>
                  <Label className="text-xs text-muted-foreground">Emoji reactions (required)</Label>
                  <Input
                    value={((draft.trigger.config.reactions as string[]) ?? []).join(", ")}
                    onChange={(e) => {
                      const list = e.target.value
                        .split(",")
                        .map((s) => s.trim().replace(/^:|:$/g, ""))
                        .filter(Boolean);
                      setTriggerConfig({ reactions: list.length ? list : undefined });
                    }}
                    placeholder="white_check_mark, pushpin, eyes"
                    className="h-8"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Comma-separated Slack emoji names (no colons). The reaction
                    name is what Slack stores — e.g. ✅ is <code>white_check_mark</code>,
                    📌 is <code>pushpin</code>. Hover an emoji in Slack to see its name.
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Channels (optional — blank = any channel the bot is in)
                  </Label>
                  {loadingChannels ? (
                    <p className="text-xs text-muted-foreground">Loading channels…</p>
                  ) : slackChannels.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No channels found. Connect Slack first, then invite the bot.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto border rounded p-2">
                      {slackChannels.map((c) => {
                        const selected = ((draft.trigger.config.channels as string[]) ?? []).includes(c.id);
                        return (
                          <label key={c.id} className="flex items-center gap-1 text-xs">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => {
                                const current = (draft.trigger.config.channels as string[]) ?? [];
                                const next = selected
                                  ? current.filter((x) => x !== c.id)
                                  : [...current, c.id];
                                setTriggerConfig({ channels: next.length ? next : undefined });
                              }}
                            />
                            #{c.name}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Reactor's email goes into <code>slack.user_email</code> (use with
                  "Slack sender" assignee). Original message author is in
                  <code> slack.author_email</code>. Message text is in
                  <code> slack.text</code>.
                </p>
              </div>
            )}

            <div className="flex items-start gap-3">
              <div className="w-16 mt-1">
                <span className="text-sm font-semibold">If</span>
                <p className="text-[11px] text-muted-foreground">optional</p>
              </div>
              <div className="flex-1 rounded-md border p-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Advanced conditions</p>
                    <p className="text-xs text-muted-foreground">
                      Most automations can skip this. Use conditions only when the
                      automation should run for certain values, tags, or amounts.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAdvanced((v) => !v)}
                  >
                    {showAdvanced ? "Hide" : "Show"}
                  </Button>
                </div>
                {showAdvanced && (
                  <div className="space-y-2">
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
                    {draft.conditions.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        No filters yet. This automation will run whenever the trigger happens.
                      </p>
                    )}
                    <Button variant="outline" size="sm" onClick={addCondition}>
                      <Plus className="w-3 h-3 mr-1" /> Add condition
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-16 mt-1">
                <span className="text-sm font-semibold">Then</span>
                <p className="text-[11px] text-muted-foreground">the action</p>
              </div>
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
                {/* Quick-add buttons — one click per common action,
                    each pre-fills sensible defaults. Power users still
                    get the generic "Add custom action" below for
                    rarer types (webhook, move_deal_stage, set_field,
                    AI extract/translate, wait, create_workspace, etc.). */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {QUICK_ADD.map((q) => (
                    <Button
                      key={q.type}
                      variant="outline" size="sm"
                      className="h-7 text-xs"
                      onClick={() => quickAddAction(q.type, q.defaults)}
                    >
                      {q.label}
                    </Button>
                  ))}
                </div>
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={addAction}>
                  <Plus className="w-3 h-3 mr-1" /> Add custom action
                </Button>
              </div>
            </div>
          </div>

          {draft.actions.some((a) => a.type === "send_email") && (
            <details className="border-t pt-3" open={!!draft.sendWindow}>
              <summary className="text-sm font-semibold cursor-pointer">
                Send window {sendWindowSummary(draft.sendWindow ?? null)}
              </summary>
              <div className="pt-2 space-y-2">
                <div className="grid grid-cols-3 gap-2 items-end">
                  <div>
                    <Label>From hour (0–23)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={23}
                      value={draft.sendWindow?.hours?.[0] ?? 9}
                      onChange={(e) => setSendWindow({ hours: [Number(e.target.value), draft.sendWindow?.hours?.[1] ?? 18] })}
                    />
                  </div>
                  <div>
                    <Label>To hour (1–24)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={24}
                      value={draft.sendWindow?.hours?.[1] ?? 18}
                      onChange={(e) => setSendWindow({ hours: [draft.sendWindow?.hours?.[0] ?? 9, Number(e.target.value)] })}
                    />
                  </div>
                  <div>
                    <Label>Timezone</Label>
                    <Input
                      value={draft.sendWindow?.timezone ?? "Europe/London"}
                      onChange={(e) => setSendWindow({ timezone: e.target.value })}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {([["Mon", 1], ["Tue", 2], ["Wed", 3], ["Thu", 4], ["Fri", 5], ["Sat", 6], ["Sun", 7]] as const).map(([label, num]) => (
                    <label key={num} className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={(draft.sendWindow?.days ?? [1, 2, 3, 4, 5]).includes(num)}
                        onChange={() => toggleDay(num)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline"
                  onClick={() => setDraft((d) => ({ ...d, sendWindow: null }))}
                >
                  Remove window (send any time)
                </button>
              </div>
            </details>
          )}
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
                <SelectItem value="slack_sender">Slack sender (matched by email)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      );

    case "create_workspace":
      return (
        <div className="grid grid-cols-1 gap-2">
          <Input
            value={(cfg.name as string) ?? ""}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="Workspace name, e.g. {{client.name}} onboarding"
          />
        </div>
      );

    case "create_project":
      return (
        <div className="grid grid-cols-2 gap-2">
          <Input
            value={(cfg.name as string) ?? ""}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="Project name"
          />
          <Input
            value={(cfg.workspace_id as string) ?? ""}
            onChange={(e) => set({ workspace_id: e.target.value || undefined })}
            placeholder="Workspace UUID (optional)"
          />
          <Input
            className="col-span-2"
            value={(cfg.description as string) ?? ""}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="Description"
          />
          <Input
            value={(cfg.owner_id as string) ?? ""}
            onChange={(e) => set({ owner_id: e.target.value || undefined })}
            placeholder="Owner UUID or blank"
          />
          <Input
            value={(cfg.due_in_days as number | string) ?? ""}
            onChange={(e) => set({ due_in_days: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="Due in days"
            type="number"
          />
        </div>
      );

    case "create_project_task":
      return (
        <div className="grid grid-cols-2 gap-2">
          <Input
            value={(cfg.title as string) ?? ""}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="Task title"
          />
          <Input
            value={(cfg.project_id as string) ?? ""}
            onChange={(e) => set({ project_id: e.target.value || undefined })}
            placeholder="Project UUID or use event project"
          />
          <Input
            className="col-span-2"
            value={(cfg.description as string) ?? ""}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="Description"
          />
          <Select value={(cfg.priority as string) ?? "medium"} onValueChange={(v) => set({ priority: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="low">low</SelectItem>
              <SelectItem value="medium">medium</SelectItem>
              <SelectItem value="high">high</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={(cfg.assignee_id as string) ?? ""}
            onChange={(e) => set({ assignee_id: e.target.value || undefined })}
            placeholder="Assignee UUID"
          />
        </div>
      );

    case "assign_task":
      return (
        <div className="grid grid-cols-2 gap-2">
          <Input
            value={(cfg.task_id as string) ?? ""}
            onChange={(e) => set({ task_id: e.target.value || undefined })}
            placeholder="Task UUID or use event task"
          />
          <Input
            value={(cfg.assignee_id as string) ?? ""}
            onChange={(e) => set({ assignee_id: e.target.value })}
            placeholder="Assignee UUID"
          />
        </div>
      );

    case "create_google_meet":
      return (
        <div className="grid grid-cols-1 gap-2">
          <Input
            value={(cfg.task_id as string) ?? ""}
            onChange={(e) => set({ task_id: e.target.value || undefined })}
            placeholder="Task UUID or use event task"
          />
          <Input
            value={(cfg.summary as string) ?? ""}
            onChange={(e) => set({ summary: e.target.value })}
            placeholder="Calendar title, e.g. Meeting: {{task.title}}"
          />
          <p className="text-xs text-muted-foreground">
            Uses the task due date/time and the connected Google account of the task creator or recipe creator.
          </p>
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
            placeholder="deal_owner_email | client_email | task_assignee_email | literal@addr"
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

    case "ai_summarize":
      return (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Source</Label>
              <Select
                value={(cfg.source as string) ?? "client_notes"}
                onValueChange={(v) => set({ source: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="client_notes">client notes</SelectItem>
                  <SelectItem value="free_text">free text</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Last N notes</Label>
              <Input
                type="number"
                value={Number(cfg.limit ?? 5)}
                onChange={(e) => set({ limit: Number(e.target.value) })}
              />
            </div>
          </div>
          {((cfg.source as string) ?? "client_notes") === "free_text" && (
            <div>
              <Label>Text</Label>
              <Input
                value={(cfg.text as string) ?? ""}
                onChange={(e) => set({ text: e.target.value })}
                placeholder="Supports {{placeholders}}"
              />
            </div>
          )}
        </div>
      );

    case "ai_classify_lead":
      return (
        <p className="text-sm text-muted-foreground">
          Classifies the event's client as hot/warm/cold and writes to <code>clients.score_band</code>. No config needed.
        </p>
      );

    case "ai_draft_email":
      return (
        <div className="space-y-2">
          <div>
            <Label>Goal</Label>
            <Input
              value={(cfg.goal as string) ?? ""}
              onChange={(e) => set({ goal: e.target.value })}
              placeholder="e.g. follow up after demo"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Tone</Label>
              <Select
                value={(cfg.tone as string) ?? "formal"}
                onValueChange={(v) => set({ tone: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="formal">formal</SelectItem>
                  <SelectItem value="casual">casual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Length</Label>
              <Select
                value={(cfg.length as string) ?? "short"}
                onValueChange={(v) => set({ length: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="short">short</SelectItem>
                  <SelectItem value="medium">medium</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Output is available to downstream actions as <code>{"{{ai.output_subject}}"}</code> and <code>{"{{ai.output_body}}"}</code> (e.g. for a send_email step).
          </p>
        </div>
      );

    case "ai_extract":
      return (
        <div className="space-y-2">
          <div>
            <Label>Source text</Label>
            <Input
              value={(cfg.source_text as string) ?? ""}
              onChange={(e) => set({ source_text: e.target.value })}
              placeholder="{{form_submission.notes}}"
            />
          </div>
          <div>
            <Label>Fields (comma-separated)</Label>
            <Input
              value={(cfg.fields as string) ?? ""}
              onChange={(e) => set({ fields: e.target.value })}
              placeholder="company_size, budget, timeline"
            />
          </div>
        </div>
      );

    case "ai_translate":
      return (
        <div className="space-y-2">
          <div>
            <Label>Source text</Label>
            <Input
              value={(cfg.source_text as string) ?? ""}
              onChange={(e) => set({ source_text: e.target.value })}
              placeholder="{{placeholders}} supported"
            />
          </div>
          <div>
            <Label>Target language</Label>
            <Input
              value={(cfg.target_language as string) ?? ""}
              onChange={(e) => set({ target_language: e.target.value })}
              placeholder="English"
            />
          </div>
        </div>
      );

    case "wait":
      return (
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <Label>Wait</Label>
            <Input
              type="number"
              min={1}
              value={Number(cfg.value ?? 1)}
              onChange={(e) => set({ value: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label>Unit</Label>
            <Select value={(cfg.unit as string) ?? "days"} onValueChange={(v) => set({ unit: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="minutes">minutes</SelectItem>
                <SelectItem value="hours">hours</SelectItem>
                <SelectItem value="days">days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="col-span-2 text-xs text-muted-foreground">
            Actions after this wait fire after the delay, subject to the recipe's send window.
            Reply detection cancels pending actions for this recipe run.
          </p>
        </div>
      );

    case "send_sms":
      return (
        <div className="grid grid-cols-1 gap-2 text-sm">
          <div>
            <Label>To</Label>
            <Input
              value={(cfg.to as string) ?? ""}
              onChange={(e) => set({ to: e.target.value })}
              placeholder="client_phone | +15551234567 | {{deal.phone}}"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Use <code>client_phone</code> to look up the client's phone, an E.164 number, or a{" "}
              <code>{"{{template}}"}</code>.
            </p>
          </div>
          <div>
            <Label>Message</Label>
            <Textarea
              value={(cfg.body as string) ?? ""}
              onChange={(e) => set({ body: e.target.value })}
              placeholder="Hi {{deal.client_name}}, just a quick note from {{recipe.name}}…"
              rows={3}
            />
          </div>
        </div>
      );

    case "notify": {
      const notifyUser = (cfg.user as string) ?? "deal_owner";
      const isKeyword = notifyUser === "deal_owner" || notifyUser === "client_owner";
      const selectValue = isKeyword ? notifyUser : "specific";
      return (
        <div className="grid grid-cols-1 gap-2 text-sm">
          <div>
            <Label>Notify</Label>
            <Select
              value={selectValue}
              onValueChange={(v) => {
                if (v === "deal_owner" || v === "client_owner") {
                  set({ user: v });
                } else {
                  // Keep existing UUID if already set, else blank to prompt entry
                  set({ user: isKeyword ? "" : notifyUser });
                }
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="deal_owner">Deal owner</SelectItem>
                <SelectItem value="client_owner">Client account owner</SelectItem>
                <SelectItem value="specific">Specific member (enter user ID)</SelectItem>
              </SelectContent>
            </Select>
            {!isKeyword && (
              <Input
                className="mt-1"
                value={notifyUser}
                onChange={(e) => set({ user: e.target.value })}
                placeholder="User UUID"
              />
            )}
          </div>
          <div>
            <Label>Title</Label>
            <Input
              value={(cfg.title as string) ?? ""}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="e.g. Deal updated: {{deal.name}}"
            />
          </div>
          <div>
            <Label>Message (optional)</Label>
            <Textarea
              value={(cfg.body as string) ?? ""}
              onChange={(e) => set({ body: e.target.value })}
              placeholder="{{deal.name}} moved to a new stage. Check the deal for details."
              rows={2}
            />
          </div>
        </div>
      );
    }

    default:
      return null;
  }
};
