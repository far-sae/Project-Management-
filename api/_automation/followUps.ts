import type { AutoStore } from "./store.js";

/**
 * Reminders for CRM follow-ups. A follow-up on a lead or an open deal has no
 * project, so the project board's own reminders never see it; without this,
 * nothing told the person it was due. On each scheduled run, every follow-up
 * that is due today or overdue, still open and has somebody to do it gets one
 * notification in the app (the bell), once.
 *
 * It runs whether or not a workspace uses automation, and it never fails the
 * run it is part of.
 */

export const FOLLOW_UPS_PAGE = "/crm/tasks";
/** The link on a reminder. It also marks the follow-up as reminded, so each one is reminded once. */
export const followUpLink = (id: string): string => `${FOLLOW_UPS_PAGE}?follow-up=${id}`;
/** Follow-ups looked at in one run. */
export const REMINDER_LIMIT = 200;

export type DueFollowUp = { id: string; title: string; dueDate: string; assignedTo: string };

const DAY = "en-GB";
const dayOf = (iso: string): string => new Date(iso).toLocaleDateString(DAY, { day: "numeric", month: "short", timeZone: "UTC" });

/** What the reminder says: due today, or since when it has been waiting. */
export function reminderMessage(followUp: Pick<DueFollowUp, "title" | "dueDate">, now: Date): string {
  const sameDay = new Date(followUp.dueDate).toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
  const title = followUp.title.trim().slice(0, 140);
  return sameDay ? `“${title}” is due today.` : `“${title}” was due on ${dayOf(followUp.dueDate)} and is still open.`;
}

/** Sends the reminders that are owed. Returns how many went out. */
export async function remindDueFollowUps(store: AutoStore, now: Date): Promise<number> {
  // Everything due up to the end of today (UTC): a follow-up due this afternoon is announced in the morning.
  const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)).toISOString();
  const due = await store.dueFollowUps(until, REMINDER_LIMIT);
  if (due.length === 0) return 0;
  const done = new Set(await store.remindedFollowUps(due.map((f) => followUpLink(f.id))));
  const owed = due.filter((f) => !done.has(followUpLink(f.id)));
  if (owed.length === 0) return 0;
  await store.notify(
    owed.map((f) => ({ userId: f.assignedTo, type: "task_reminder", title: "Follow-up due", message: reminderMessage(f, now), link: followUpLink(f.id) })),
  );
  return owed.length;
}
