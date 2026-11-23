/**
 * The Apollo settings, read from Vercel's environment variables. The key is
 * never sent to a browser and never written to a log.
 *
 * The key belongs to one Apollo account, and its credits are that account's.
 * So, unlike most settings, it works for no organisation until one is named in
 * APOLLO_ALLOWED_ORGS: nobody else on the site can spend it by accident.
 */

export const KEY_SETTING = "APOLLO_API_KEY";
/** The organisations that may use the key: ids with commas between them. */
export const ORGS_SETTING = "APOLLO_ALLOWED_ORGS";

export type ProspectConfig = { key: string; allowedOrgs: string[] };

/** The settings, or null while there is no key. */
export function readProspectConfig(env: Record<string, string | undefined> = process.env): ProspectConfig | null {
  const key = (env[KEY_SETTING] ?? "").trim();
  if (!key) return null;
  const allowedOrgs = (env[ORGS_SETTING] ?? "")
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
  return { key, allowedOrgs };
}

export const orgMayProspect = (config: ProspectConfig, organizationId: string): boolean =>
  config.allowedOrgs.includes(organizationId.toLowerCase());
