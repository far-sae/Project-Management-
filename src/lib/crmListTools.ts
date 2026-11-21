/**
 * Sorting the Leads list, and doing one thing to many leads at once. Pure
 * functions only.
 */

export type LeadSortKey = 'name' | 'company' | 'step' | 'owner' | 'added';
export type SortDirection = 'asc' | 'desc';
export interface LeadSort { key: LeadSortKey; direction: SortDirection }

export interface SortableLead {
  id: string;
  name: string;
  company: string;
  /** The step's place in the flow: 0 for New, rising to Customer; Unqualified last. */
  stepOrder: number;
  owner: string;
  createdAt: Date;
}

const text = (a: string, b: string): number => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

/**
 * The ids of the leads in the order asked for. Leads with nothing in the
 * sorted column (no company, no owner) go last whichever way the list is
 * sorted: an empty value is not "smaller", it is missing. Ties keep the order
 * the list already had.
 */
export function sortLeadIds(leads: SortableLead[], sort: LeadSort): string[] {
  const sign = sort.direction === 'asc' ? 1 : -1;
  const value = (lead: SortableLead): string | number => {
    switch (sort.key) {
      case 'name': return lead.name;
      case 'company': return lead.company;
      case 'owner': return lead.owner;
      case 'step': return lead.stepOrder;
      case 'added': return lead.createdAt.getTime();
    }
  };
  return leads
    .map((lead, index) => ({ lead, index, v: value(lead) }))
    .sort((a, b) => {
      const emptyA = a.v === '';
      const emptyB = b.v === '';
      if (emptyA !== emptyB) return emptyA ? 1 : -1;
      const order = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : text(String(a.v), String(b.v));
      return order !== 0 ? order * sign : a.index - b.index;
    })
    .map((row) => row.lead.id);
}

/** Pressing a column heading: a new column starts A to Z (newest first for "added"); the same column turns round. */
export function nextSort(current: LeadSort | null, key: LeadSortKey): LeadSort {
  if (current && current.key === key) return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  return { key, direction: key === 'added' ? 'desc' : 'asc' };
}

/** How many leads are changed at the same moment when one thing is done to many. */
export const BULK_CHUNK = 10;

/**
 * Does `work` for every id, a few at a time, and says how many succeeded. One
 * failure does not stop the rest: the caller reports "8 of 10" and the list
 * shows what was done.
 */
export async function forEachLead(ids: string[], work: (id: string) => Promise<unknown>): Promise<{ done: number; failed: number }> {
  let done = 0;
  let failed = 0;
  for (let i = 0; i < ids.length; i += BULK_CHUNK) {
    const results = await Promise.allSettled(ids.slice(i, i + BULK_CHUNK).map((id) => work(id)));
    for (const result of results) {
      if (result.status === 'fulfilled') done += 1;
      else failed += 1;
    }
  }
  return { done, failed };
}
