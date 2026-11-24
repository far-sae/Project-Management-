// @vitest-environment node
// Deleting an invoice for good. The owner asked for it, so that a workspace of
// test invoices can be removed. It is the owner's alone to do, it takes the
// invoice's payments, receipts, history and stored files with it, and it
// touches nothing else.
import { describe, expect, it } from "vitest";
import { billingAction, deleteInvoice } from "../../../../api/_signroom/billing";
import { route } from "../../../../api/_signroom/router";
import type { Store } from "../../../../api/_signroom/store";
import type { Invoice } from "../../../../api/_signroom/shared/types";
import { withMemberRole, companyClient, seededStore, WS } from "./helpers";

const owner = { id: "u1", email: "owner@example.com", workspaceId: WS };
const member = { id: "u2", email: "member@example.com", workspaceId: WS };
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const LINES = [{ description: "Consulting", quantity: "1", rate: "100.00" }];

async function draft(store: Store, by = owner) {
  const client = await companyClient(store, owner);
  return (await billingAction(store, by, "POST", undefined, undefined, { clientId: client.id })) as Invoice;
}
const saved = (store: Store, d: Invoice) =>
  billingAction(store, owner, "POST", d.id, "save", { revision: d.revision, currency: "GBP", issueDate: d.issueDate, dueDate: d.dueDate, lines: LINES, taxPercent: "0" }) as Promise<Invoice>;
const issue = (store: Store, i: Invoice) => billingAction(store, owner, "POST", i.id, "issue", { revision: i.revision, createReceipt: false }) as Promise<Invoice>;
const pay = (store: Store, i: Invoice, amount: string) =>
  billingAction(store, owner, "POST", i.id, "payment", { revision: i.revision, amount, paidOn: day(0) }) as Promise<Invoice>;
const list = (store: Store) => billingAction(store, owner, "GET", undefined, undefined, {}) as Promise<Invoice[]>;

describe("deleting an invoice", () => {
  it("removes a draft", async () => {
    const store = seededStore(owner);
    const d = await draft(store);
    expect(await deleteInvoice(store, owner, d.id)).toEqual({ deleted: true, number: d.number });
    expect(await list(store)).toEqual([]);
    expect(await store.getInvoice(WS, d.id)).toBeNull();
  });

  it("removes an issued and a paid invoice too, with its payments, and its stored files", async () => {
    const store = seededStore(owner);
    const paid = await pay(store, await issue(store, await saved(store, await draft(store))), "100.00");
    expect(paid.status).toBe("Paid");
    expect(paid.payments).toHaveLength(1);
    const hashes = [paid.invoiceHash, ...paid.payments.map((p) => p.receiptHash)].filter(Boolean) as string[];
    expect(hashes.length).toBeGreaterThan(0);
    for (const hash of hashes) expect(await store.blobInUse(WS, hash)).toBe(true);

    await deleteInvoice(store, owner, paid.id);

    expect(await store.getInvoice(WS, paid.id)).toBeNull();
    for (const hash of hashes) {
      expect(await store.blobInUse(WS, hash)).toBe(false);
      // The file itself is gone from the store, not only the record of it.
      expect(await store.getBlob(WS, hash).then(() => 'still there').catch(() => null)).toBeNull();
    }
  });

  it("leaves every other invoice exactly as it was", async () => {
    const store = seededStore(owner);
    const keep = await issue(store, await saved(store, await draft(store)));
    const gone = await issue(store, await saved(store, await draft(store)));
    await deleteInvoice(store, owner, gone.id);
    const left = await list(store);
    expect(left.map((i) => i.id)).toEqual([keep.id]);
    expect((await store.getInvoice(WS, keep.id))?.invoiceHash).toBe(keep.invoiceHash);
    expect(await store.blobInUse(WS, keep.invoiceHash as string)).toBe(true);
  });

  it("does not hand the deleted invoice's number out again", async () => {
    const store = seededStore(owner);
    const first = await draft(store);
    await deleteInvoice(store, owner, first.id);
    const next = await draft(store);
    expect(next.number).not.toBe(first.number);
  });

  it("is for the owner only: a member cannot delete, not even their own draft", async () => {
    const store = withMemberRole(seededStore(owner), member.id);
    const theirs = await draft(store, member);
    await expect(deleteInvoice(store, member, theirs.id)).rejects.toMatchObject({ status: 403, message: "Only the owner can delete an invoice." });
    expect(await store.getInvoice(WS, theirs.id)).not.toBeNull();
  });

  it("says not found for an invoice that is not there, or is another workspace's", async () => {
    const store = seededStore(owner);
    await expect(deleteInvoice(store, owner, "0d000000-0000-4000-8000-000000000999")).rejects.toMatchObject({ status: 404 });
    await expect(deleteInvoice(store, owner, "not-an-id")).rejects.toMatchObject({ status: 404 });
    const d = await draft(store);
    await deleteInvoice(store, owner, d.id);
    await expect(deleteInvoice(store, owner, d.id)).rejects.toMatchObject({ status: 404 });
  });

  it("has an address of its own, asked for with POST", async () => {
    const store = seededStore(owner);
    const d = await draft(store);
    const deps = { mail: { store } } as never;
    const asked = { path: ["billing", d.id, "delete"], query: {}, body: {}, user: owner, origin: "https://app.example.com" };
    expect((await route(deps, { ...asked, method: "GET" } as never)).status).toBe(404);
    const out = await route(deps, { ...asked, method: "POST" } as never);
    expect(out.status).toBe(200);
    expect(out.json).toEqual({ deleted: true, number: d.number });
    expect(await store.getInvoice(WS, d.id)).toBeNull();
  });
});
