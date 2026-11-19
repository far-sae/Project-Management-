import { AppError } from "./errors.js";
import { currentWorkspace, type SignedInUser } from "./context.js";
import type { CrmCompany, Store } from "./store.js";
import type { Client } from "./shared/types.js";
import { email, isUuid, text } from "./validate.js";

type Body = Record<string, unknown>;

export const COMPANY_NOT_FOUND = "Company not found.";

/**
 * The client details a CRM company gives: its name; the contact name and email
 * of its first contact that has a usable email, else the company's own email;
 * and the billing address put together from the address parts.
 */
function fromCompany(company: CrmCompany): Pick<Client, "name" | "contactName" | "email" | "billingAddress"> {
  const usable = (value: string): string => {
    try {
      return value ? email(value) : "";
    } catch {
      return "";
    }
  };
  let contactName = "";
  let address = "";
  for (const c of company.contacts) {
    address = usable(c.email);
    if (address) {
      contactName = text(c.name, 150);
      break;
    }
  }
  if (!address) address = usable(company.email);
  const billingAddress = [company.address, [company.city, company.state].filter(Boolean).join(", "), company.postalCode, company.country]
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  return { name: text(company.name, 150), contactName, email: address, billingAddress: text(billingAddress, 2000) };
}

/**
 * POST clients/from-company { companyId }: the workspace's client for a CRM
 * company. The company must belong to the caller's workspace (404 otherwise,
 * the same answer as for one that does not exist). An existing client is
 * returned with its name, contact, email and billing address first refreshed
 * from the CRM, so a corrected email reaches the next document. Documents that
 * are already out keep their own copy of those details (an issued invoice's
 * `customer`, a sent agreement's frozen recipients), so nothing on record
 * changes. An archived client is left alone. With no client yet, one is
 * created from the company.
 */
export async function clientFromCompany(store: Store, user: SignedInUser, body: Body): Promise<Client> {
  const { workspace } = await currentWorkspace(store, user);
  const company = isUuid(body.companyId) ? await store.crmCompany(workspace.id, body.companyId) : null;
  if (!company) throw new AppError(COMPANY_NOT_FOUND, 404);
  const details = fromCompany(company);
  if (!details.name) throw new AppError("Give this company a name in the CRM first.");

  const existing = await store.getClientByCompany(workspace.id, company.id);
  if (!existing) {
    return store.insertClient({
      workspaceId: workspace.id,
      crmCompanyId: company.id,
      ...details,
      companyNumber: "",
      notes: "",
      archived: false,
    });
  }
  if (existing.archived) return existing;
  const same =
    existing.name === details.name &&
    existing.contactName === details.contactName &&
    existing.email === details.email &&
    (existing.billingAddress ?? "") === (details.billingAddress ?? "");
  return same ? existing : store.updateClient(workspace.id, existing.id, details);
}

/**
 * The clients routes that remain: the list (the screens need names for
 * existing documents), archive and restore. A client is never typed in or
 * edited here: it is made from a CRM company (clientFromCompany).
 */
export async function clientAction(
  store: Store,
  user: SignedInUser,
  method: string,
  body: Body,
  clientId?: string,
): Promise<unknown> {
  const { workspace } = await currentWorkspace(store, user);
  if (method === "GET" && !clientId) {
    const list = await store.listClients(workspace.id, !!body.includeDeleted);
    return list.map((c) => ({ ...c, agreementCount: 0 }));
  }
  if (clientId) {
    const c = isUuid(clientId) ? await store.getClient(workspace.id, clientId) : null;
    if (!c) throw new AppError("Client not found.", 404);
    if (method === "DELETE") {
      await currentWorkspace(store, user, { owner: true });
      await store.updateClient(workspace.id, c.id, { archived: true });
      return { ok: true };
    }
    if (method === "PATCH" && body.action === "restore") {
      await currentWorkspace(store, user, { owner: true });
      return store.updateClient(workspace.id, c.id, { archived: false });
    }
  }
  throw new AppError("Unknown client action.");
}
