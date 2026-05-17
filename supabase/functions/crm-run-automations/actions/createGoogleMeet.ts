import { getProviderTokens } from "../../_shared/tokens.ts";
import { ActionHandler } from "../shared/types.ts";
import { substitute } from "../shared/substitute.ts";

const resolveRecipeCreator = async (ctx: any): Promise<string | null> => {
  const { data } = await ctx.admin
    .from("automation_recipes")
    .select("created_by")
    .eq("recipe_id", ctx.recipeId)
    .maybeSingle();
  return (data?.created_by as string) ?? null;
};

const resolveCalendarUser = async (ctx: any, task: any): Promise<string | null> => {
  if (task?.created_by) return task.created_by as string;
  const firstAssignee = Array.isArray(task?.assignees) ? task.assignees[0]?.userId : null;
  return firstAssignee ?? await resolveRecipeCreator(ctx);
};

export const createGoogleMeet: ActionHandler = async (ctx, config) => {
  const taskId =
    (config.task_id as string | undefined) ??
    ((ctx.event.payload as any).task_id as string | undefined);
  if (!taskId) return { status: "skipped", message: "No task_id available" };

  const { data: task, error: taskError } = await ctx.admin
    .from("tasks")
    .select("task_id, title, description, due_date, google_meet_link, created_by, assignees")
    .eq("task_id", taskId)
    .maybeSingle();
  if (taskError) return { status: "failure", message: taskError.message };
  if (!task) return { status: "skipped", message: "Task not found" };
  if (task.google_meet_link) {
    return { status: "skipped", message: "Task already has a Google Meet link" };
  }
  if (!task.due_date) {
    return { status: "skipped", message: "Task needs a due date before creating Meet" };
  }

  const senderUserId = await resolveCalendarUser(ctx, task);
  if (!senderUserId) return { status: "skipped", message: "Could not resolve Google Calendar user" };

  let accessToken: string;
  try {
    accessToken = (await getProviderTokens(ctx.admin, senderUserId, "google")).accessToken;
  } catch {
    return {
      status: "skipped",
      message: "No active Google Meet integration for the user — connect Google in Settings → Integrations",
    };
  }

  const start = new Date(task.due_date);
  const end = new Date(start.getTime() + Number(config.duration_minutes ?? 30) * 60_000);
  const summary = substitute(String(config.summary || task.title || "Task meeting"), {
    task,
    project: ctx.event.payload as any,
    recipe: { name: ctx.recipeName },
  });

  const requestId = `task-${taskId}-${Date.now()}`;
  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        summary,
        description: task.description ?? "",
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
        conferenceData: {
          createRequest: {
            requestId,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { status: "failure", message: `google calendar HTTP ${res.status}: ${body.slice(0, 200)}` };
  }

  const event = await res.json() as { id?: string; hangoutLink?: string };
  if (!event.hangoutLink) return { status: "failure", message: "Google did not return a Meet link" };

  const { error: updateError } = await ctx.admin
    .from("tasks")
    .update({
      google_meet_link: event.hangoutLink,
      google_event_id: event.id ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("task_id", taskId);

  if (updateError) return { status: "failure", message: updateError.message };
  return {
    status: "success",
    meta: {
      task_id: taskId,
      google_meet_link: event.hangoutLink,
      google_event_id: event.id,
      ai_output_meet_link: event.hangoutLink,
    },
  };
};
