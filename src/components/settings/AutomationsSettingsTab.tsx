import React, { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Briefcase,
  CalendarPlus,
  FolderKanban,
  MailCheck,
  PlayCircle,
  Plus,
  Trash2,
  UserPlus,
  Zap,
  AlertCircle,
  ListTodo,
  Tag,
  Flame,
  MessageSquare,
  Activity,
  CheckCircle2,
  XCircle,
  Send,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useAutomations } from "@/hooks/useAutomations";
import {
  Recipe,
  RecipeDraft,
  deleteRecipe,
  kickAutomationWorker,
  setRecipeEnabled,
  summarizeRecipe,
  getAutomationHealth,
  sendTestAutomationEvent,
  draftAutomationFromText,
  type AutomationHealth,
} from "@/services/supabase/automations";
import { RecipeBuilder } from "./RecipeBuilder";
import { RecipeRunsList } from "./RecipeRunsList";
import { toast } from "sonner";

const AUTOMATION_TEMPLATES: Array<{
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  draft: RecipeDraft;
}> = [
  {
    title: "Follow up with every new client",
    description: "When a client is added, create a task for the account owner.",
    icon: ListTodo,
    draft: {
      name: "New client follow-up",
      description: "Create a reminder whenever a new client is added.",
      enabled: true,
      trigger: { type: "client_created", config: {} },
      conditions: [],
      actions: [
        {
          type: "create_task",
          config: {
            title: "Follow up with {{client.name}}",
            assignee: "client_owner",
            due_in_days: 1,
          },
        },
      ],
    },
  },
  {
    title: "Organize form leads",
    description: "When a form is submitted, tag the client and add a note.",
    icon: Tag,
    draft: {
      name: "Tag new form leads",
      description: "Mark new form submissions so the team can review them.",
      enabled: true,
      trigger: { type: "form_submitted", config: {} },
      conditions: [],
      actions: [
        { type: "tag", config: { tag: "new-form-lead", mode: "add" } },
        {
          type: "add_note",
          config: {
            body: "New lead came from a form submission. Review and follow up.",
          },
        },
      ],
    },
  },
  {
    title: "Act on hot deals",
    description: "When a deal becomes hot, create a same-day follow-up task.",
    icon: Flame,
    draft: {
      name: "Hot deal follow-up",
      description: "Create an urgent task whenever a deal reaches the hot score band.",
      enabled: true,
      trigger: { type: "deal_score_band_changed", config: { band: "hot" } },
      conditions: [],
      actions: [
        {
          type: "create_task",
          config: {
            title: "Follow up on hot deal",
            assignee: "deal_owner",
            due_in_days: 0,
          },
        },
      ],
    },
  },
  {
    title: "Turn Slack messages into tasks",
    description: "When Slack mentions a task, create a CRM task for the sender.",
    icon: MessageSquare,
    draft: {
      name: "Slack task intake",
      description: "Create a CRM task from Slack task messages.",
      enabled: true,
      trigger: {
        type: "slack_message_received",
        config: { keyword: "task", mention_only: true, channels: [] },
      },
      conditions: [],
      actions: [
        {
          type: "create_task",
          config: {
            title: "{{slack.text}}",
            assignee: "slack_sender",
            due_in_days: 1,
          },
        },
      ],
    },
  },
  {
    title: "Start a project from each workspace",
    description: "When a workspace is created, create a starter project inside it.",
    icon: FolderKanban,
    draft: {
      name: "Workspace starter project",
      description: "Automatically add a project whenever a workspace is created.",
      enabled: true,
      trigger: { type: "workspace_created", config: {} },
      conditions: [],
      actions: [
        {
          type: "create_project",
          config: {
            name: "{{workspace.name}} starter project",
            description: "Created automatically from the workspace automation.",
          },
        },
      ],
    },
  },
  {
    title: "Prepare tasks for every new project",
    description: "When a project is created, add a kickoff task that can be assigned.",
    icon: Briefcase,
    draft: {
      name: "Project kickoff task",
      description: "Add a first task to every new project.",
      enabled: true,
      trigger: { type: "project_created", config: {} },
      conditions: [],
      actions: [
        {
          type: "create_project_task",
          config: {
            title: "Kick off {{project.name}}",
            description: "Review scope, owner, deadline, and next steps.",
            priority: "medium",
          },
        },
      ],
    },
  },
  {
    title: "Assign project tasks automatically",
    description: "When a task is created, assign it to a selected teammate.",
    icon: UserPlus,
    draft: {
      name: "Auto-assign new project tasks",
      description: "Assign new project tasks to the right person.",
      enabled: true,
      trigger: { type: "task_created", config: {} },
      conditions: [],
      actions: [
        {
          type: "assign_task",
          config: {
            assignee_id: "",
          },
        },
      ],
    },
  },
  {
    title: "Add Meet link to assigned tasks",
    description: "When a task is assigned, create and save a Google Meet link.",
    icon: CalendarPlus,
    draft: {
      name: "Create and share Meet for assigned task",
      description: "Attach a Google Meet link to assigned tasks and email it to the assignee.",
      enabled: true,
      trigger: { type: "task_assigned", config: {} },
      conditions: [],
      actions: [
        {
          type: "create_google_meet",
          config: {
            summary: "{{task.title}}",
          },
        },
        {
          type: "send_email",
          config: {
            to: "task_assignee_email",
            subject: "Meeting link: {{task.title}}",
            body_html: "Here is the Google Meet link for {{task.title}}: {{task.google_meet_link}}",
          },
        },
      ],
    },
  },
  {
    title: "Follow up when someone replies",
    description: "When an email reply comes in, create a task so nothing is missed.",
    icon: MailCheck,
    draft: {
      name: "Email reply follow-up",
      description: "Create a follow-up task from inbound automation replies.",
      enabled: true,
      trigger: { type: "email_reply_received", config: {} },
      conditions: [],
      actions: [
        {
          type: "create_task",
          config: {
            title: "Reply to {{email.from_address}}",
            assignee: "client_owner",
            due_in_days: 1,
          },
        },
      ],
    },
  },
];

export const AutomationsSettingsTab: React.FC = () => {
  const { organizationId, recipes, setRecipes, loading, canManage } = useAutomations();
  const [editing, setEditing] = useState<Recipe | "new" | null>(null);
  const [initialDraft, setInitialDraft] = useState<RecipeDraft | null>(null);
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [runningNow, setRunningNow] = useState(false);
  // Health snapshot — pending events / runs / last run. Refreshes
  // when the "Run pending" or "Send test event" buttons fire so the
  // user immediately sees the effect.
  const [health, setHealth] = useState<AutomationHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [testingEvent, setTestingEvent] = useState(false);
  const [describeText, setDescribeText] = useState("");
  const [drafting, setDrafting] = useState(false);

  const handleDescribeSubmit = async () => {
    if (!describeText.trim() || !organizationId) return;
    setDrafting(true);
    try {
      const d = await draftAutomationFromText(organizationId, describeText.trim());
      setInitialDraft(d);
      setEditing("new");
      setDescribeText("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI draft failed — try again");
    } finally {
      setDrafting(false);
    }
  };

  const reloadHealth = React.useCallback(async () => {
    if (!organizationId) return;
    setHealthLoading(true);
    try { setHealth(await getAutomationHealth(organizationId)); }
    finally { setHealthLoading(false); }
  }, [organizationId]);

  useEffect(() => { void reloadHealth(); }, [reloadHealth]);

  if (!canManage) {
    return <p className="text-sm text-muted-foreground">Only admins can manage automations.</p>;
  }
  if (!organizationId) return null;

  const toggle = async (recipe: Recipe, next: boolean) => {
    // Optimistic update — flip the switch instantly so the rep doesn't
    // see the lag of a server round-trip + subscription refetch. Roll
    // back on failure.
    setRecipes((prev) => prev.map((r) => (r.recipeId === recipe.recipeId ? { ...r, enabled: next } : r)));
    try {
      await setRecipeEnabled(recipe.recipeId, next);
      toast.success(next ? "Recipe enabled" : "Recipe disabled");
    } catch (err) {
      setRecipes((prev) => prev.map((r) => (r.recipeId === recipe.recipeId ? { ...r, enabled: !next } : r)));
      toast.error(err instanceof Error ? err.message : "Toggle failed");
    }
  };

  const remove = async (recipe: Recipe) => {
    if (!confirm(`Delete "${recipe.name}"?`)) return;
    try {
      await deleteRecipe(recipe.recipeId);
      toast.success("Recipe deleted");
      if (selectedRecipeId === recipe.recipeId) setSelectedRecipeId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const openBlankBuilder = () => {
    setInitialDraft(null);
    setEditing("new");
  };

  const openTemplateBuilder = (draft: RecipeDraft) => {
    setInitialDraft(draft);
    setEditing("new");
  };

  const openExistingBuilder = (recipe: Recipe) => {
    setInitialDraft(null);
    setEditing(recipe);
  };

  const runPendingNow = async () => {
    setRunningNow(true);
    try {
      const result = await kickAutomationWorker({ force: true });
      const processed = result?.processed ?? 0;
      const pendings = result?.pendings_drained ?? 0;
      toast.success(`Automation runner checked ${processed + pendings} pending item${processed + pendings === 1 ? "" : "s"}`);
      void reloadHealth();
    } finally {
      setRunningNow(false);
    }
  };

  const sendTestEvent = async () => {
    if (!organizationId) return;
    setTestingEvent(true);
    try {
      await sendTestAutomationEvent(organizationId);
      toast.success("Test event queued — running worker now");
      // Kick the worker immediately so the rep sees the counters move
      // without waiting for the next pg_cron tick.
      await kickAutomationWorker({ force: true });
      await reloadHealth();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test event failed");
    } finally {
      setTestingEvent(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-500" />
            Automations
          </h2>
          <Button onClick={openBlankBuilder}>
            <Plus className="w-4 h-4 mr-1" /> New automation
          </Button>
          <Button variant="outline" onClick={runPendingNow} disabled={runningNow}>
            <PlayCircle className="w-4 h-4 mr-1" /> {runningNow ? "Running..." : "Run pending"}
          </Button>
          <Button
            variant="outline" onClick={sendTestEvent} disabled={testingEvent}
            title="Drop a no-op test event in the queue so you can verify the worker is alive"
          >
            {testingEvent ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}
            Test event
          </Button>
        </div>

        {/* Health snapshot — shows pending queue depth + last 24h
            success/failure counts so reps can tell at a glance whether
            the worker is keeping up. Refreshes after Run pending / Send
            test event so the effect is visible immediately. */}
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-4 h-4 text-primary" />
              <p className="text-sm font-medium">Worker health</p>
              {healthLoading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <HealthTile
                label="Pending"
                value={health ? String(health.pendingEvents) : "—"}
                tone={health && health.pendingEvents > 50 ? 'warn' : 'default'}
                hint={health?.lastEventAt
                  ? `Last event ${formatDistanceToNow(health.lastEventAt, { addSuffix: true })}`
                  : 'No events yet'}
              />
              <HealthTile
                label="Runs (24h)"
                value={health ? String(health.runsLast24h) : "—"}
                hint={health?.lastRunAt
                  ? `Last run ${formatDistanceToNow(health.lastRunAt, { addSuffix: true })}`
                  : 'No runs yet'}
              />
              <HealthTile
                label="Success (24h)"
                value={health ? String(health.successLast24h) : "—"}
                tone="good"
                icon={<CheckCircle2 className="w-3 h-3" />}
              />
              <HealthTile
                label="Failures (24h)"
                value={health ? String(health.failuresLast24h) : "—"}
                tone={health && health.failuresLast24h > 0 ? 'bad' : 'default'}
                icon={<XCircle className="w-3 h-3" />}
              />
            </div>
            {health && health.pendingEvents > 0 && health.runsLast24h === 0 && (
              <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-2">
                ⚠ Events are queueing but the worker hasn&apos;t run in 24h. Click <strong>Run pending</strong>; if that doesn&apos;t drain them, confirm the <code>crm-run-automations</code> edge function is deployed and the pg_cron job from migration 111 is active.
              </p>
            )}
          </CardContent>
        </Card>

        {/* AI-authored automation — describe in plain English */}
        <Card>
          <CardContent className="py-4 space-y-3">
            <div>
              <p className="text-sm font-medium flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                Describe an automation
              </p>
              <p className="text-xs text-muted-foreground">
                Tell the AI what you want, e.g. "when a new client is created, send them a welcome email and notify the deal owner."
              </p>
            </div>
            <div className="flex gap-2">
              <textarea
                className="flex-1 min-h-[72px] rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:opacity-50"
                placeholder="Describe the trigger and action(s) in plain English…"
                value={describeText}
                onChange={(e) => setDescribeText(e.target.value)}
                disabled={drafting || !canManage}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void handleDescribeSubmit();
                }}
              />
              <Button
                onClick={() => void handleDescribeSubmit()}
                disabled={drafting || !describeText.trim() || !canManage}
                className="self-end"
                title={canManage ? "Draft automation with AI (Cmd/Ctrl+Enter)" : "Only admins can create automations"}
              >
                {drafting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {drafting ? "Drafting…" : "Draft"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4 space-y-3">
            <div>
              <p className="text-sm font-medium">Start with a simple template</p>
              <p className="text-xs text-muted-foreground">
                Pick a common workflow, review the plain-English steps, then save it.
                You can still edit the advanced details before turning it on.
              </p>
            </div>
            <div className="grid md:grid-cols-2 gap-2">
              {AUTOMATION_TEMPLATES.map((template) => {
                const Icon = template.icon;
                return (
                  <button
                    key={template.title}
                    type="button"
                    onClick={() => openTemplateBuilder(template.draft)}
                    disabled={!canManage}
                    className="group rounded-lg border bg-background p-3 text-left hover:border-primary/60 hover:bg-primary/5 hover:shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    title={canManage ? 'Click to set up this automation' : 'Only admins can create automations'}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Icon className="w-4 h-4 text-primary" />
                      <span className="text-[10px] text-muted-foreground group-hover:text-primary font-medium uppercase tracking-wide">
                        Use template →
                      </span>
                    </div>
                    <p className="text-sm font-medium mt-2">{template.title}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {template.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : recipes.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground space-y-2">
              <Zap className="w-8 h-8 mx-auto text-muted-foreground/60" />
              <p>No automations yet.</p>
              <p>
                Use a template above if you are new, or click <strong>New automation</strong>
                to build one from scratch.
              </p>
            </CardContent>
          </Card>
        ) : (
          recipes.map((r) => (
            <Card
              key={r.recipeId}
              className={selectedRecipeId === r.recipeId ? "ring-2 ring-primary/40" : ""}
            >
              <CardContent className="py-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <Switch checked={r.enabled} onCheckedChange={(v) => toggle(r, v)} />
                    <button
                      className="font-medium text-left truncate"
                      onClick={() => setSelectedRecipeId(r.recipeId)}
                    >
                      {r.name}
                    </button>
                    {r.failCount > 0 && (
                      <Badge variant="outline" className="text-destructive border-destructive/40">
                        <AlertCircle className="w-3 h-3 mr-1" /> {r.failCount} failed
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openExistingBuilder(r)}>Edit</Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(r)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{summarizeRecipe(r as any)}</p>
                <p className="text-[11px] text-muted-foreground">
                  {r.runCount} runs · {r.lastRunAt ? `last ${r.lastRunAt.toLocaleString()}` : "never run"}
                </p>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Run history
        </h3>
        {selectedRecipeId ? (
          <RecipeRunsList recipeId={selectedRecipeId} />
        ) : (
          <p className="text-xs text-muted-foreground">Select a recipe to view its run history.</p>
        )}
      </div>

      {editing && (
        <RecipeBuilder
          organizationId={organizationId}
          recipe={editing === "new" ? null : editing}
          initialDraft={editing === "new" ? initialDraft : null}
          onClose={() => {
            setEditing(null);
            setInitialDraft(null);
          }}
        />
      )}
    </div>
  );
};

// Small KPI tile used in the worker-health panel above. Kept private
// to this file; not worth a separate module yet.
const HealthTile: React.FC<{
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'good' | 'warn' | 'bad';
  icon?: React.ReactNode;
}> = ({ label, value, hint, tone = 'default', icon }) => {
  const valueClass =
    tone === 'good' ? 'text-emerald-600 dark:text-emerald-400'
    : tone === 'warn' ? 'text-amber-600 dark:text-amber-400'
    : tone === 'bad' ? 'text-destructive'
    : 'text-foreground';
  return (
    <div className="rounded-md border bg-muted/20 px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1">
        {icon} {label}
      </p>
      <p className={`text-lg font-semibold tabular-nums ${valueClass}`}>{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground truncate">{hint}</p>}
    </div>
  );
};
