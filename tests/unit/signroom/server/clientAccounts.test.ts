// @vitest-environment node
import { describe, expect, it } from "vitest";
import { billingAction } from "../../../../api/_signroom/billing";
import { clientAccount } from "../../../../api/_signroom/clientAccounts";
import { clientAction } from "../../../../api/_signroom/clients";
import type { Store } from "../../../../api/_signroom/store";
import type { Client, ClientAccount, ClientAccountSettings, Invoice, Payment } from "../../../../api/_signroom/shared/types";
import { withMemberRole, companyClient, seededStore, WS2, ORG2, WS } from "./helpers";

const owner = { id: "u1", email: "owner@example.com", workspaceId: WS };
const other = { id: "u2", email: "other@example.com", workspaceId: WS2 };
const member = { id: "m1", email: "member@example.com", workspaceId: WS };
const NOW = new Date("2026-06-30T12:00:00Z");
const BODY = { revision: 0, currency: "EUR", paymentTermsDays: 14, reference: "ACCT-SYNTHETIC", notes: "Internal synthetic account note" };

function withMember(store: Store): Store {
  return withMemberRole(store, member.id);
}

async function setup() {
  const store = seededStore(owner);
  const client = await companyClient(store, owner);
  return { store, client };
}
const get = (store: Store, id: string, from = "", to = "", now = NOW, user = owner) =>
  clientAccount(store, user, id, "GET", {}, from, to, now) as Promise<ClientAccount>;
const patch = (store: Store, id: string, body: Record<string, unknown>, user = owner) =>
  clientAccount(store, user, id, "PATCH", body, "", "", NOW) as Promise<ClientAccountSettings>;
const rejects = (p: Promise<unknown>, status: number, message: string) => expect(p).rejects.toMatchObject({ status, message });

async function issued(store: Store, client: Client, payments: number, createdBy = owner): Promise<Invoice> {
  const draft = (await billingAction(store, createdBy, "POST", undefined, undefined, { clientId: client.id })) as Invoice;
  const saved = (await billingAction(store, createdBy, "POST", draft.id, "save", {
    revision: draft.revision,
    currency: "GBP",
    issueDate: "2026-06-01",
    dueDate: "2026-06-30",
    lines: [{ description: "Consulting", quantity: "1", rate: "100.00" }],
    taxPercent: "0",
  })) as Invoice;
  let inv = (await billingAction(store, createdBy, "POST", saved.id, "issue", { revision: saved.revision })) as Invoice;
  for (let n = 0; n < payments; n++) {
    const p: Payment = {
      id: crypto.randomUUID(),
      amountMinor: 1000,
      paidOn: `2026-06-0${n + 2}`,
      method: "Bank transfer",
      reference: "",
      receiptNumber: `${inv.number}-R0${n + 1}`,
      receiptHash: "",
      recordedAt: NOW.toISOString(),
    };
    await store.recordPayment(inv.id, inv.revision, p, "Part paid", { at: NOW.toISOString(), type: "Payment", actor: "x" });
    inv = (await billingAction(store, createdBy, "GET", inv.id, undefined, {})) as Invoice;
  }
  return inv;
}

describe("clientAccount: settings", () => {
  it("GET gives the default settings, canManage and asOf", async () => {
    const { store, client } = await setup();
    const out = await get(store, client.id);
    expect(out.settings).toEqual({ currency: "GBP", paymentTermsDays: 30, reference: "", notes: "", revision: 0 });
    expect(out.canManage).toBe(true);
    expect(out.asOf).toBe("2026-06-30");
  });

  it("PATCH saves revision 1; the same body again is a 409 and changes nothing", async () => {
    const { store, client } = await setup();
    const s = await patch(store, client.id, BODY);
    expect(s).toEqual({ currency: "EUR", paymentTermsDays: 14, reference: "ACCT-SYNTHETIC", notes: "Internal synthetic account note", revision: 1 });
    await rejects(patch(store, client.id, { ...BODY, currency: "USD", notes: "overwritten" }), 409, "Account settings changed. Reload before saving.");
    expect((await get(store, client.id)).settings).toEqual(s);
    const again = await patch(store, client.id, { ...BODY, revision: 1, paymentTermsDays: 20 });
    expect(again.revision).toBe(2);
  });

  it("a new draft takes the currency and payment terms", async () => {
    const { store, client } = await setup();
    await patch(store, client.id, BODY);
    const d = (await billingAction(store, owner, "POST", undefined, undefined, { clientId: client.id })) as Invoice;
    expect(d.currency).toBe("EUR");
    expect((Date.parse(d.dueDate) - Date.parse(d.issueDate)) / 86400000).toBe(14);
  });

  it.each([{ paymentTermsDays: 366 }, { paymentTermsDays: -1 }, { paymentTermsDays: 1.5 }, { currency: "JPY" }])("refuses %j", async (over) => {
    const { store, client } = await setup();
    await rejects(patch(store, client.id, { ...BODY, ...over }), 400, "Choose a supported currency and payment terms from 0 to 365 days.");
  });
});

describe("clientAccount: statement", () => {
  it("has one Invoice entry and one Payment entry per payment, none for a draft", async () => {
    const { store, client } = await setup();
    await billingAction(store, owner, "POST", undefined, undefined, { clientId: client.id });
    expect((await get(store, client.id)).entries).toHaveLength(0);
    await issued(store, client, 2);
    const out = await get(store, client.id);
    expect(out.entries.map((e) => e.kind)).toEqual(["Invoice", "Payment", "Payment"]);
  });

  it("refuses bad or reversed dates", async () => {
    const { store, client } = await setup();
    await rejects(get(store, client.id, "2026-02-30"), 400, "Choose valid statement dates.");
    await rejects(get(store, client.id, "2026-03-01", "2026-02-01"), 400, "Statement start date must be before its end date.");
  });

  it("Review Focus 1: the end date defaults to London's today", async () => {
    const { store, client } = await setup();
    const out = await get(store, client.id, "2026-07-01", "", new Date("2026-06-30T23:30:00Z"));
    expect(out.asOf).toBe("2026-07-01");
    await rejects(get(store, client.id, "2026-07-01", "", new Date("2026-06-30T22:30:00Z")), 400, "Statement start date must be before its end date.");
  });
});

describe("clientAccount: who may see and change it", () => {
  it("another user, or a malformed id, gets 404", async () => {
    const { store, client } = await setup();
    // An admin of another organisation, in their own workspace, never finds it; naming this workspace is refused.
    store.seedWorkspace({ id: WS2, organizationId: ORG2, name: "Another company" });
    store.setOrgMember(WS2, other.id, "admin");
    await rejects(get(store, client.id, "", "", NOW, other), 404, "Client account not found.");
    await rejects(get(store, client.id, "", "", NOW, { ...other, workspaceId: WS }), 403, "Choose a workspace.");
    await rejects(get(store, "not-an-id"), 404, "Client account not found.");
    await rejects(patch(store, "not-an-id", BODY), 404, "Client account not found.");
  });

  it("a Member sees only their own invoices and cannot change settings", async () => {
    const { store, client } = await setup();
    await issued(store, client, 1);
    const ms = withMember(store);
    const seen = await get(ms, client.id, "", "", NOW, member);
    expect(seen.entries).toHaveLength(0);
    expect(seen.canManage).toBe(false);
    await rejects(patch(ms, client.id, BODY, member), 403, "Only workspace owners can change account settings.");
    expect((await get(ms, client.id)).entries).toHaveLength(2);
  });

  it("an archived client: PATCH is 409, canManage is false", async () => {
    const { store, client } = await setup();
    await clientAction(store, owner, "DELETE", {}, client.id);
    await rejects(patch(store, client.id, BODY), 409, "Restore this client before editing account settings.");
    expect((await get(store, client.id)).canManage).toBe(false);
  });

  it("a save that loses the race (store answers null) is a 409 and writes nothing", async () => {
    const { store, client } = await setup();
    let writes = 0;
    const racing: Store = { ...store, setClientAccount: async () => { writes++; return null; } };
    await rejects(patch(racing, client.id, BODY), 409, "Account settings changed. Reload before saving.");
    expect(writes).toBe(1);
    expect((await get(store, client.id)).settings.revision).toBe(0);
  });

  it("an upper-case client id in the path still shows that client's invoices", async () => {
    const { store, client } = await setup();
    await issued(store, client, 1);
    const out = await get(store, client.id.toUpperCase());
    expect(out.entries.map((e) => e.kind)).toEqual(["Invoice", "Payment"]);
  });

  it("DELETE is 405", async () => {
    const { store, client } = await setup();
    await rejects(clientAccount(store, owner, client.id, "DELETE", {}, "", "", NOW), 405, "Method not allowed.");
  });
});
