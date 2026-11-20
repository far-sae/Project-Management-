import type { AutoStore, NewNotification, Person } from "./store.js";

/**
 * Telling people through the app's own notifications (the bell): an approval
 * is waiting, a run finished with a project, a run failed, the budget was
 * reached. A notification that cannot be written is logged by name and never
 * fails the work it reports on.
 */

export const AUTOMATION_PAGE = "/crm/automation";
export const runPage = (runId: string): string => `${AUTOMATION_PAGE}/runs/${runId}`;

/** The organisation's owners and admins: the people who may change the automation. */
export const ownersOf = (people: Person[]): string[] => people.filter((p) => p.role === "owner" || p.role === "admin").map((p) => p.userId);

export async function tell(store: AutoStore, userIds: Array<string | null | undefined>, n: Omit<NewNotification, "userId">): Promise<void> {
  const to = [...new Set(userIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
  if (to.length === 0) return;
  try {
    await store.notify(to.map((userId) => ({ ...n, userId })));
  } catch (e) {
    console.error("[automation] notification not written", e instanceof Error ? e.name : "unknown");
  }
}
