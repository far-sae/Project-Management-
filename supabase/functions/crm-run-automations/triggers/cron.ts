// supabase/functions/crm-run-automations/triggers/cron.ts
// Enqueues task_overdue + scheduled events that aren't fired by DB row changes.

export const enqueueCronEvents = async (admin: any): Promise<void> => {
  await enqueueTaskOverdue(admin);
  await enqueueScheduledRecipes(admin);
};

const enqueueTaskOverdue = async (admin: any): Promise<void> => {
  // Find newly-overdue tasks for which we haven't already enqueued an event in 24h.
  const { data: tasks } = await admin
    .from("client_tasks")
    .select("task_id, organization_id, client_id, title, due_at")
    .lt("due_at", new Date().toISOString())
    .neq("status", "done")
    .limit(500);

  for (const t of tasks ?? []) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: prior } = await admin
      .from("automation_events")
      .select("event_id")
      .eq("event_type", "task_overdue")
      .eq("source_id", t.task_id)
      .gt("enqueued_at", since)
      .maybeSingle();
    if (prior) continue;

    await admin.from("automation_events").insert({
      organization_id: t.organization_id,
      event_type: "task_overdue",
      payload: { task_id: t.task_id, client_id: t.client_id, title: t.title, due_at: t.due_at },
      source_table: "client_tasks",
      source_id: t.task_id,
    });
  }
};

const enqueueScheduledRecipes = async (admin: any): Promise<void> => {
  // For v1, "scheduled" recipes use cron config like { "every": "0 9 * * 1" } (cron expr)
  // or { "minutes_past_hour": 0 } for hourly. The worker checks rough fit per minute.
  const { data: recipes } = await admin
    .from("automation_recipes")
    .select("recipe_id, organization_id, trigger_config")
    .eq("trigger_type", "scheduled")
    .eq("enabled", true);

  const now = new Date();
  for (const r of recipes ?? []) {
    if (!shouldFireSchedule(r.trigger_config ?? {}, now)) continue;

    await admin.from("automation_events").insert({
      organization_id: r.organization_id,
      event_type: "scheduled",
      payload: { recipe_id: r.recipe_id, now: now.toISOString() },
      source_table: "automation_recipes",
      source_id: r.recipe_id,
    });
  }
};

const shouldFireSchedule = (config: Record<string, unknown>, now: Date): boolean => {
  // Minimal cron-like fit for v1: { weekday, hour, minute }
  const weekday = config.weekday as number | undefined;   // 0=Sun .. 6=Sat
  const hour = config.hour as number | undefined;
  const minute = config.minute as number | undefined;
  if (weekday !== undefined && now.getUTCDay() !== weekday) return false;
  if (hour !== undefined && now.getUTCHours() !== hour) return false;
  if (minute !== undefined && now.getUTCMinutes() !== minute) return false;
  // If none provided, fire every minute (probably not desired but explicit).
  return weekday !== undefined || hour !== undefined || minute !== undefined;
};
