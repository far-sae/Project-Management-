/**
 * Who runs this site. Many organisations use it; one of them owns it. Only
 * that one is shown how the site is set up: which database file to run, which
 * setting is missing on the server. Everybody else is told a feature "is not
 * switched on yet" and nothing more.
 *
 * The owning organisation is named by the build setting VITE_PLATFORM_ORG_ID
 * (one id, or several with commas between them). An organisation id is not a
 * secret. This only decides what is SHOWN; what a person may DO is decided by
 * the server and the database, never here.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The organisation ids in the setting. Anything that is not an id is ignored. */
export function platformOrgIds(setting: string | undefined | null): string[] {
  return (setting ?? '')
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter((id) => UUID.test(id));
}

export const PLATFORM_ORG_SETTING = 'VITE_PLATFORM_ORG_ID';

/** The organisations that run this site, as built into this copy of the app. */
export const PLATFORM_ORGS: string[] = platformOrgIds(import.meta.env?.VITE_PLATFORM_ORG_ID as string | undefined);

/**
 * Whether this person is shown how the site is set up.
 *
 * With organisations listed: the owner and admins of a listed organisation.
 * With none listed yet (the site is still being set up, and nobody could be
 * told apart): the owner of each organisation, so the set-up can be finished.
 * Somebody who is in no organisation is never shown it.
 */
export function canSeeInternals(
  platformOrgs: string[],
  organizationId: string | null | undefined,
  role: { isOwner: boolean; isAdmin: boolean },
): boolean {
  if (!organizationId) return false;
  if (platformOrgs.length === 0) return role.isOwner;
  return platformOrgs.includes(organizationId.toLowerCase()) && (role.isOwner || role.isAdmin);
}
