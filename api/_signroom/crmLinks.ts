import { AppError } from "./errors.js";
import type { ListFilter, Store } from "./store.js";
import { isUuid } from "./validate.js";

/**
 * The ties between documents and the CRM: the deal an agreement or invoice was
 * created for, and the ?companyId / ?dealId filters of the two lists. Every
 * lookup is made inside the caller's own workspace.
 */

export const DEAL_NOT_FOUND = "Deal not found.";
export const INVALID_FILTER = "Invalid filter.";

/**
 * The optional `dealId` of a create request: null when none was given, the
 * deal's id when it is a deal of this workspace, otherwise 404 (the same answer
 * for a malformed id, an unknown deal and another workspace's deal).
 */
export async function dealOf(store: Store, workspaceId: string, value: unknown): Promise<string | null> {
  if (value === undefined || value === null || value === "") return null;
  const deal = isUuid(value) ? await store.crmDeal(workspaceId, value) : null;
  if (!deal) throw new AppError(DEAL_NOT_FOUND, 404);
  return deal.id;
}

/**
 * ?companyId (a CRM company id) and ?dealId as a store filter. A malformed id
 * is a 400, never the whole list. Null means nothing can match: the company has
 * no client in this workspace.
 */
export async function listFilter(store: Store, workspaceId: string, query: { companyId?: string; dealId?: string }): Promise<ListFilter | null> {
  const filter: ListFilter = {};
  if (query.dealId) {
    if (!isUuid(query.dealId)) throw new AppError(INVALID_FILTER);
    filter.dealId = query.dealId.toLowerCase();
  }
  if (query.companyId) {
    if (!isUuid(query.companyId)) throw new AppError(INVALID_FILTER);
    const client = await store.getClientByCompany(workspaceId, query.companyId.toLowerCase());
    if (!client) return null;
    filter.clientId = client.id;
  }
  return filter;
}
