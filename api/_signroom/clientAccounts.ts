import { AppError } from "./errors.js";
import { currentWorkspace, type SignedInUser } from "./context.js";
import type { Store } from "./store.js";
import type { ClientAccount, ClientAccountSettings } from "./shared/types.js";
import { buildStatement, londonToday } from "./shared/accounts.js";
import { CURRENCIES } from "./shared/invoiceMath.js";
import { isUuid, text } from "./validate.js";


/** A real calendar date as YYYY-MM-DD. */
function realDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date + "T00:00:00Z")) && new Date(date + "T00:00:00Z").toISOString().slice(0, 10) === date;
}

/** Port of Signroom's clientAccount (client-accounts.ts 148-221): a client's statement and account settings. */
export async function clientAccount(
  store: Store,
  user: SignedInUser,
  id: string,
  method: string,
  b: Record<string, unknown>,
  from = "",
  to = "",
  now: Date = new Date(),
): Promise<ClientAccount | ClientAccountSettings> {
  for (const date of [from, to]) if (date && !realDate(date)) throw new AppError("Choose valid statement dates.");
  const today = londonToday(now);
  if (from && from > (to || today)) throw new AppError("Statement start date must be before its end date.");
  if (method !== "GET" && method !== "PATCH") throw new AppError("Method not allowed.", 405);

  const ctx = await currentWorkspace(store, user);
  const client = isUuid(id) ? await store.getClient(ctx.workspace.id, id) : null;
  if (!client) throw new AppError("Client account not found.", 404);
  const owner = ctx.role === "Owner";

  if (method === "PATCH") {
    if (!owner) throw new AppError("Only workspace owners can change account settings.", 403);
    if (client.archived) throw new AppError("Restore this client before editing account settings.", 409);
    const stale = () => new AppError("Account settings changed. Reload before saving.", 409);
    const revision = client.account?.revision ?? 0;
    if (Number(b.revision) !== revision) throw stale();
    const currency = String(b.currency),
      paymentTermsDays = Number(b.paymentTermsDays);
    if (!CURRENCIES.includes(currency) || !Number.isInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 365)
      throw new AppError("Choose a supported currency and payment terms from 0 to 365 days.");
    const settings: ClientAccountSettings = { currency, paymentTermsDays, reference: text(b.reference, 100), notes: text(b.notes, 2000), revision: revision + 1 };
    const saved = await store.setClientAccount(ctx.workspace.id, client.id, revision, settings);
    if (!saved) throw stale();
    return saved;
  }

  const invoices = (await store.listInvoices(ctx.workspace.id)).filter((i) => i.clientId === client.id && (owner || i.createdBy === user.id));
  return {
    settings: client.account ?? { currency: "GBP", paymentTermsDays: 30, reference: "", notes: "", revision: 0 },
    canManage: owner && !client.archived,
    ...buildStatement(invoices, from, to, today),
  };
}
