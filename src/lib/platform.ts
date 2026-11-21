/**
 * Who runs this site. Many organisations use it; the people who built it run
 * it. Only they are shown how the site is set up: which database file to run,
 * which setting is missing on the server. Everybody else is told a feature "is
 * not switched on yet" and nothing more.
 *
 * They are the app owners: the user ids in the build setting
 * VITE_APP_OWNER_USER_IDS (see lib/app-owner.ts and docs/ORGANIZATION_OWNER.md).
 * This only decides what is SHOWN; what a person may DO is decided by the
 * server and the database, never here.
 */

export const APP_OWNER_SETTING = 'VITE_APP_OWNER_USER_IDS';

/** The user ids in the setting, with commas between them. */
export function appOwnerIds(setting: string | undefined | null): string[] {
  return (setting ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

/** The app owners, as built into this copy of the app. */
export const APP_OWNERS: string[] = appOwnerIds(import.meta.env?.VITE_APP_OWNER_USER_IDS as string | undefined);

/**
 * Whether this person is shown how the site is set up.
 *
 * With app owners named: they, and nobody else.
 * With none named yet (the site is still being set up, and nobody can be told
 * apart): the owner of each organisation, so the set-up can be finished.
 * Somebody who is not signed in is never shown it.
 */
export function canSeeInternals(
  appOwners: string[],
  userId: string | null | undefined,
  role: { isOwner: boolean },
): boolean {
  if (!userId) return false;
  if (appOwners.length === 0) return role.isOwner;
  return appOwners.includes(userId);
}
