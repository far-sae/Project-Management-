// Is this a real organization id, or the placeholder the app uses before one
// has resolved?
//
// Pure: no React, no Supabase, no network, no Node built-ins.
//
// AuthContext sets `organizationId` to `local-<user id>` the moment a session
// appears, so that the interface has something to render against before
// OrganizationContext has finished fetching the real one. Several features
// already know to check for it — ClockGate does — but the email screens did
// not, and the consequence was not a blank list. It was worse:
//
//   GET /rest/v1/email_campaigns?organization_id=eq.local-da9c3923-…  →  400
//
// Every organization_id in this feature is a `uuid` column, and `local-…` is
// not a uuid, so PostgREST rejects the filter outright. Campaigns, accounts
// and mailbox health all failed together, and because the failure arrives as a
// generic 400 rather than a missing table, it reads like a broken feature
// rather than a page that asked its question a few hundred milliseconds early.

/** The prefix AuthContext uses for a not-yet-resolved organization. */
const PLACEHOLDER_PREFIX = 'local-';

/**
 * True when this id is safe to put in a query.
 *
 * Anything not yet resolved — empty, undefined, or the `local-` placeholder —
 * is not, and the caller should wait rather than ask.
 */
export function isRealOrgId(id: string | null | undefined): boolean {
  if (!id) return false;
  return !id.startsWith(PLACEHOLDER_PREFIX);
}

/**
 * The id to query with: the real one, or `''` meaning "do not query yet".
 *
 * Empty string rather than null because every screen in this feature already
 * guards on `if (!orgId) return` — this makes a placeholder take the path
 * those guards were written for instead of reaching the database.
 */
export function queryableOrgId(id: string | null | undefined): string {
  return isRealOrgId(id) ? String(id) : '';
}
