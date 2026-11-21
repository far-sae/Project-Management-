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

/**
 * The morning line about overdue follow-ups. The reminder above goes out once,
 * on the day a follow-up is due; after that nothing said it was still open.
 * So once a day, from seven in the morning (UTC), every person with an open
 * follow-up due before today gets one notification that counts them and names
 * the oldest. It comes back each morning until they are done.
 *
 * It only counts follow-ups the person was already reminded of on an earlier
 * day. One that is first seen when it is already late gets its own reminder
 * today and joins the morning line tomorrow: never two notices at once.
 */

/** The hour (UTC) from which the morning line may go out. */
export const MORNING_HOUR = 7;

/** The link on the morning line. It also marks that this person was told today. */
export const overdueLink = (day: string, userId: string): string => `${FOLLOW_UPS_PAGE}?overdue=${day}&u=${userId}`;

/** One sentence about a person's overdue follow-ups, oldest first. */
export function overdueMessage(overdue: Array<Pick<DueFollowUp, "title" | "dueDate">>): string {
  const oldest = overdue[0];
  const title = oldest.title.trim().slice(0, 140);
  return overdue.length === 1
    ? `“${title}” has been open since ${dayOf(oldest.dueDate)}.`
    : `${overdue.length} follow-ups are overdue. The oldest is “${title}”, due ${dayOf(oldest.dueDate)}.`;
}

/** Sends the morning lines that are owed. Returns how many went out. */
export async function remindOverdueDaily(store: AutoStore, now: Date): Promise<number> {
  if (now.getUTCHours() < MORNING_HOUR) return 0;
  const day = now.toISOString().slice(0, 10);
  // Everything due before today began (UTC), oldest first.
  const before = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 1).toISOString();
  const late = await store.dueFollowUps(before, REMINDER_LIMIT);
  if (late.length === 0) return 0;
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const toldEarlier = new Set(await store.remindedFollowUps(late.map((f) => followUpLink(f.id)), startOfToday));
  const overdue = late.filter((f) => toldEarlier.has(followUpLink(f.id)));
  if (overdue.length === 0) return 0;

  const byPerson = new Map<string, DueFollowUp[]>();
  for (const f of overdue) byPerson.set(f.assignedTo, [...(byPerson.get(f.assignedTo) ?? []), f]);
  const told = new Set(await store.remindedFollowUps([...byPerson.keys()].map((userId) => overdueLink(day, userId))));
  const owed = [...byPerson.entries()].filter(([userId]) => !told.has(overdueLink(day, userId)));
  if (owed.length === 0) return 0;
  await store.notify(
    owed.map(([userId, list]) => ({ userId, type: "task_reminder", title: "Overdue follow-ups", message: overdueMessage(list), link: overdueLink(day, userId) })),
  );
  return owed.length;
}
