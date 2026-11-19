import type { SignedInUser } from "./context.js";
import { openAgreement } from "./agreements.js";
import { billingAction } from "./billing.js";
import type { Delivery, Invoice } from "./shared/types.js";
import type { Store } from "./store.js";

/**
 * The email log of one document: every email sent (or tried) for an invoice or
 * an agreement, newest first. Only for someone who may open that document: the
 * same check as opening it, with the same 404 for everything else.
 */
export const DELIVERY_LOG_LIMIT = 100;

/**
 * One line of the log. `route` is how it went out: "mailbox" from the
 * workspace's own mailbox, "securovix" (the log's stored name) from the
 * platform's address. No document, participant or job ids.
 */
export type DeliveryLine = Pick<Delivery, "id" | "recipient" | "subject" | "purpose" | "route" | "status" | "error" | "created">;

const lineOf = (d: Delivery): DeliveryLine => ({
  id: d.id,
  recipient: d.recipient,
  subject: d.subject,
  purpose: d.purpose,
  ...(d.route ? { route: d.route } : {}),
  status: d.status,
  ...(d.error ? { error: d.error } : {}),
  created: d.created,
});

/** GET billing/:id/deliveries. */
export async function invoiceDeliveries(store: Store, user: SignedInUser, id: string): Promise<{ deliveries: DeliveryLine[] }> {
  const invoice = (await billingAction(store, user, "GET", id, undefined, {})) as Invoice;
  const rows = await store.listDocumentDeliveries(invoice.workspaceId, { invoiceId: invoice.id }, DELIVERY_LOG_LIMIT);
  return { deliveries: rows.map(lineOf) };
}

/** GET agreements/:id/deliveries. */
export async function agreementDeliveries(store: Store, user: SignedInUser, id: string): Promise<{ deliveries: DeliveryLine[] }> {
  const { a } = await openAgreement(store, user, id, "get");
  const rows = await store.listDocumentDeliveries(a.workspaceId, { agreementId: a.id }, DELIVERY_LOG_LIMIT);
  return { deliveries: rows.map(lineOf) };
}
