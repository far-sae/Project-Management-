import React, { useState } from "react";
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
} from "lucide-react";
import { useAutomations } from "@/hooks/useAutomations";
import {
  Recipe,
  RecipeDraft,
  deleteRecipe,
  kickAutomationWorker,
  setRecipeEnabled,
  summarizeRecipe,
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
    } finally {
      setRunningNow(false);
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
        </div>

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
