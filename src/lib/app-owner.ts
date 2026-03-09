/**
 * App/product owners = the people who built TaskCalendar.
 * Their user IDs can be set in VITE_APP_OWNER_USER_IDS (comma-separated) so they
 * always have full access (no subscription or limit checks).
 */

function getRawAppOwnerIds(): string {
  try {
    const e = import.meta.env as unknown as { VITE_APP_OWNER_USER_IDS?: string };
    return typeof e?.VITE_APP_OWNER_USER_IDS === "string" ? e.VITE_APP_OWNER_USER_IDS : "";
  } catch {
    return "";
  }
}

const raw = getRawAppOwnerIds();

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
