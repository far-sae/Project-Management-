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
export const SERVICE_NOT_FOUND = "Service not found.";
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * The optional `accountId` and `billingMonth` of a create request: the client
 * service the invoice bills, and the month. Null when none was given; 404 for
 * a malformed id, an unknown service and another workspace's service alike.
 * A payment recorded on the invoice is then written on that service too (by
 * the database, migration 210).
 */
export async function accountOf(store: Store, workspaceId: string, value: unknown, month: unknown): Promise<{ accountId: string; billingMonth: string | null } | null> {
  if (value === undefined || value === null || value === "") return null;
  const account = isUuid(value) ? await store.crmAccount(workspaceId, value) : null;
  if (!account) throw new AppError(SERVICE_NOT_FOUND, 404);
  return { accountId: account.id, billingMonth: typeof month === "string" && MONTH.test(month) ? month : null };
}

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
