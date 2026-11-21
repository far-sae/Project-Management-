/**
 * Telling when a lead is already in the CRM. Pure functions only.
 *
 * Two leads are the same person when they have the same email address
 * (ignoring capitals and spaces around it). Nothing else is used: two people
 * can share a name or a switchboard number, and a lead with no email cannot
 * be judged at all, so it is never called a duplicate.
 */

/** An email address as it is compared: trimmed, lower case; '' when there is none. */
export const emailKey = (email: unknown): string => (typeof email === 'string' ? email.trim().toLowerCase() : '');

/** The lead in `leads` that already has this email address, or null. */
export function findLeadByEmail<T extends { email: string | null }>(leads: T[], email: string | null | undefined): T | null {
  const key = emailKey(email);
  if (!key) return null;
  return leads.find((lead) => emailKey(lead.email) === key) ?? null;
}

/**
 * Splits rows about to be imported into the ones that are new and the ones
 * that are already in the CRM, or that repeat an earlier row of the same
 * file. `existing` is the email addresses the CRM already has.
 */
export function splitDuplicateLeads<T extends { record: Record<string, unknown> }>(
  rows: T[],
  existing: Iterable<string>,
): { fresh: T[]; duplicates: T[] } {
  const seen = new Set<string>();
  for (const email of existing) {
    const key = emailKey(email);
    if (key) seen.add(key);
  }
  const fresh: T[] = [];
  const duplicates: T[] = [];
  for (const row of rows) {
    const key = emailKey(row.record.email);
    if (key && seen.has(key)) {
      duplicates.push(row);
      continue;
    }
    if (key) seen.add(key);
    fresh.push(row);
  }
  return { fresh, duplicates };
}

/**
 * The leads that share an email address, as groups of two or more. Each group
 * lists its leads oldest first, because the oldest is usually the one with the
 * history and so the one to keep. Groups with more leads come first.
 */
export function duplicateGroups<T extends { id: string; email: string | null; createdAt: Date }>(leads: T[]): T[][] {
  const byEmail = new Map<string, T[]>();
  for (const lead of leads) {
    const key = emailKey(lead.email);
    if (!key) continue;
    const group = byEmail.get(key);
    if (group) group.push(lead);
    else byEmail.set(key, [lead]);
  }
  return [...byEmail.values()]
    .filter((group) => group.length > 1)
    .map((group) => [...group].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)))
    .sort((a, b) => b.length - a.length || emailKey(a[0].email).localeCompare(emailKey(b[0].email)));
}

