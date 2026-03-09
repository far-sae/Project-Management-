/**
 * App/product owners = the people who built TaskCalendar.
 * Their user IDs can be set in VITE_APP_OWNER_USER_IDS (comma-separated) so they
 * always have full access (no subscription or limit checks).
 */

const env = typeof import.meta !== "undefined" && import.meta.env;
const raw = (env?.VITE_APP_OWNER_USER_IDS as string) ?? "";

function getAppOwnerUserIds(): string[] {
  if (!raw || typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export function isAppOwner(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return getAppOwnerUserIds().includes(userId);
}
