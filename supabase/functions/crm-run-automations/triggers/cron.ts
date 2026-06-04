// supabase/functions/crm-run-automations/triggers/cron.ts
// Enqueues task_overdue + scheduled events that aren't fired by DB row changes.

import { targetDateFor } from "./dateMatch.ts";

export const enqueueCronEvents = async (admin: any): Promise<void> => {
  await enqueueTaskOverdue(admin);
  await enqueueScheduledRecipes(admin);
  await enqueueDateRelative(admin);
  await enqueueDealInactive(admin);
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

// ── Shared dedup helper ────────────────────────────────────────────────────
// Returns true if an event of eventType for sourceId was already enqueued
// within the last 20 hours, preventing duplicates across daily cron runs.
const alreadyEnqueued = async (
  admin: any,
  eventType: string,
  sourceId: string,
): Promise<boolean> => {
  const since = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
  const { data } = await admin
    .from("automation_events")
    .select("event_id")
    .eq("event_type", eventType)
    .eq("source_id", sourceId)
    .gt("enqueued_at", since)
    .maybeSingle();
  return !!data;
};

// ── date_relative ─────────────────────────────────────────────────────────
// For each enabled date_relative recipe, scan deals whose expected_close_date
// matches today offset by the recipe's offset_days, then enqueue one event
// per deal (deduped within a 20h window so a re-run doesn't double-fire).
const enqueueDateRelative = async (admin: any): Promise<void> => {
  const { data: recipes } = await admin
    .from("automation_recipes")
    .select("recipe_id, organization_id, trigger_config")
    .eq("trigger_type", "date_relative")
    .eq("enabled", true);

  for (const r of recipes ?? []) {
    const cfg = (r.trigger_config ?? {}) as { date_field?: string; offset_days?: number };
    const field = cfg.date_field || "expected_close_date";
    if (field !== "expected_close_date") continue; // v1: deals.expected_close_date only

    const target = targetDateFor(Number(cfg.offset_days ?? 0));

    const { data: deals } = await admin
      .from("deals")
      .select("deal_id, organization_id, title, client_id, expected_close_date")
      .eq("organization_id", r.organization_id)
      .eq("expected_close_date", target)
      .limit(500);

    for (const d of deals ?? []) {
      if (await alreadyEnqueued(admin, "date_relative", d.deal_id)) continue;
      await admin.from("automation_events").insert({
        organization_id: d.organization_id,
        event_type: "date_relative",
        payload: {
          deal_id: d.deal_id,
          client_id: d.client_id,
          title: d.title,
          recipe_id: r.recipe_id,
          date_field: field,
        },
        source_table: "deals",
        source_id: d.deal_id,
      });
    }
  }
};

// ── deal_inactive ──────────────────────────────────────────────────────────
// For each enabled deal_inactive recipe, scan deals whose updated_at is older
// than the configured inactivity window (default 14 days), then enqueue one
// event per deal (deduped within a 20h window).
//
// v1 staleness proxy: deals.updated_at (the deal row updates on stage/field/
// note changes). A true last-activity join across comments+tasks is a future
// refinement.
const enqueueDealInactive = async (admin: any): Promise<void> => {
  const { data: recipes } = await admin
    .from("automation_recipes")
    .select("recipe_id, organization_id, trigger_config")
    .eq("trigger_type", "deal_inactive")
    .eq("enabled", true);

  for (const r of recipes ?? []) {
    const days = Number((r.trigger_config as { days?: number })?.days ?? 14);
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();

    const { data: deals } = await admin
      .from("deals")
      .select("deal_id, organization_id, title, client_id, updated_at")
      .eq("organization_id", r.organization_id)
      .lt("updated_at", cutoff)
      .limit(500);

    for (const d of deals ?? []) {
      if (await alreadyEnqueued(admin, "deal_inactive", d.deal_id)) continue;
      await admin.from("automation_events").insert({
        organization_id: d.organization_id,
        event_type: "deal_inactive",
        payload: {
          deal_id: d.deal_id,
          client_id: d.client_id,
          title: d.title,
          recipe_id: r.recipe_id,
          inactive_days: days,
        },
        source_table: "deals",
        source_id: d.deal_id,
      });
    }
  }
};
