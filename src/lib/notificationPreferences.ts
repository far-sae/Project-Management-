import { supabase } from "@/services/supabase/config";
import { logger } from "@/lib/logger";
import type { NotificationType } from "@/types/notification";

/** Matches Settings / localStorage `user_notification_prefs` keys. */
export type UserNotificationPreferences = {
  email: boolean;
  push: boolean;
  taskAssigned: boolean;
  taskCompleted: boolean;
  projectUpdates: boolean;
  projectChatMessage: boolean;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: UserNotificationPreferences = {
  email: true,
  push: true,
  taskAssigned: true,
  taskCompleted: true,
  projectUpdates: true,
  projectChatMessage: true,
};

const NOTIFICATION_TYPE_TO_CATEGORY: Record<
  NotificationType,
  keyof Omit<UserNotificationPreferences, "email" | "push">
> = {
  task_created: "projectUpdates",
  task_assigned: "taskAssigned",
  task_updated: "projectUpdates",
  task_completed: "taskCompleted",
  comment_mention: "projectUpdates",
  project_invite: "projectUpdates",
  subscription_renewed: "projectUpdates",
  task_reminder: "projectUpdates",
  comment_added: "projectUpdates",
  project_chat_message: "projectChatMessage",
};

function mergePrefs(raw: unknown): UserNotificationPreferences {
  const b = (k: keyof UserNotificationPreferences) =>
    (raw as Record<string, boolean>)?.[k] !== false;
  const r = raw as Record<string, boolean> | null | undefined;
  if (!r || typeof r !== "object") return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  return {
    email: b("email"),
    push: b("push"),
    taskAssigned: b("taskAssigned"),
    taskCompleted: b("taskCompleted"),
    projectUpdates: b("projectUpdates"),
    projectChatMessage: b("projectChatMessage"),
  };
}

/** JSON from DB or API — merge with defaults. */
export function normalizeNotificationPreferences(
  raw: unknown,
): UserNotificationPreferences {
  return mergePrefs(raw);
}

const prefsCache = new Map<string, { prefs: UserNotificationPreferences; at: number }>();
const CACHE_MS = 45_000;

/**
 * Fetches merged delivery prefs for a user (any recipient). Uses a short in-memory cache to
 * avoid an RPC on every notification in a tight loop.
 */
export async function getUserNotificationPreferences(
  userId: string,
): Promise<UserNotificationPreferences> {
  const now = Date.now();
  const hit = prefsCache.get(userId);
  if (hit && now - hit.at < CACHE_MS) {
    return hit.prefs;
  }

  try {
    const { data, error } = await supabase.rpc("get_notification_preferences", {
      p_user_id: userId,
    });
    if (error) {
      logger.warn("get_notification_preferences:", error.message);
      return { ...DEFAULT_NOTIFICATION_PREFERENCES };
    }
    const prefs = mergePrefs(data);
    prefsCache.set(userId, { prefs, at: now });
    return prefs;
  } catch (e) {
    logger.warn("get_notification_preferences failed:", e);
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }
}

export function invalidateNotificationPreferencesCache(userId?: string): void {
  if (userId) prefsCache.delete(userId);
  else prefsCache.clear();
}

/** In-app (bell) rows: topic category must be on. Push is reserved for future web push. */
export function isInAppNotificationAllowed(
  prefs: UserNotificationPreferences,
  type: NotificationType,
): boolean {
  const cat = NOTIFICATION_TYPE_TO_CATEGORY[type];
  if (!cat) return true;
  return prefs[cat] !== false;
}

/** Transactional / marketing email for tasks. */
export function isEmailForTaskEventAllowed(
  prefs: UserNotificationPreferences,
  type: "task_assigned" | "task_completed" | "task_updated" | "comment_added",
): boolean {
  if (prefs.email === false) return false;
  if (type === "task_assigned" && prefs.taskAssigned === false) return false;
  if (type === "task_completed" && prefs.taskCompleted === false) return false;
  if (type === "task_updated" && prefs.projectUpdates === false) return false;
  if (type === "comment_added" && prefs.projectUpdates === false) return false;
  return true;
}
