// Lead categories. A category is not a record of its own: it is a word on a
// lead ("VIP", "Warm intro"). Renaming or deleting one therefore means
// changing that word on every lead that carries it.

/** The longest name a category may have. */
export const CATEGORY_MAX = 60;

type WithCategory = { category?: string | null };

const tidy = (value: string | null | undefined): string => (value ?? '').trim();

/** Each named category with how many of the leads are in it, A to Z. */
export function categoryCounts(leads: WithCategory[], names: string[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const lead of leads) {
    const name = tidy(lead.category);
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...new Set(names.map(tidy).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, count: counts.get(name) ?? 0 }));
}

/**
 * Every way a category is written on the leads (with the spaces somebody typed
 * round it), plus the name itself. A change is made for all of them, so no
 * lead is left behind with the old word.
 */
export function categorySpellings(leads: WithCategory[], name: string): string[] {
  const out = new Set<string>([name]);
  for (const lead of leads) {
    if (lead.category && tidy(lead.category) === name) out.add(lead.category);
  }
  return [...out];
}

/** What is wrong with a category name, or null when it can be saved. */
export function categoryProblem(name: string): string | null {
  const value = name.trim();
  if (!value) return 'Give the category a name.';
  if (value.length > CATEGORY_MAX) return `Keep the name to ${CATEGORY_MAX} characters.`;
  return null;
}
