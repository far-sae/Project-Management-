// @vitest-environment node
import { describe, expect, it } from "vitest";
import { agreementAction, createAgreement, getAgreement, listAgreements } from "../../../../api/_signroom/agreements";
import { billingAction } from "../../../../api/_signroom/billing";
import { clientFromCompany } from "../../../../api/_signroom/clients";
import { route, type RouteDeps } from "../../../../api/_signroom/router";
import type { Agreement, AgreementSummary, Invoice } from "../../../../api/_signroom/shared/types";
import { ORG, ORG2, OWNER, seededStore, WS, WS2, type FakeStore } from "./helpers";

/** An agreement or invoice can be tied to a CRM deal when it is created; the tie never changes. */

const COMPANY_A = "0c000000-0000-4000-8000-00000000000a";
const COMPANY_B = "0c000000-0000-4000-8000-00000000000b";
const DEAL_A = "0d000000-0000-4000-8000-00000000000a";
const DEAL_B = "0d000000-0000-4000-8000-00000000000b";
const FOREIGN_DEAL = "0d000000-0000-4000-8000-0000000000ff";

async function setup() {
  const store = seededStore();
  store.seedWorkspace({ id: WS2, organizationId: ORG2, name: "Another company" });
  store.seedCompany({ id: COMPANY_A, workspaceId: WS, organizationId: ORG, name: "Alpha Ltd", email: "a@alpha.example" });
  store.seedCompany({ id: COMPANY_B, workspaceId: WS, organizationId: ORG, name: "Beta Ltd", email: "b@beta.example" });
  store.seedDeal({ id: DEAL_A, workspaceId: WS, companyId: COMPANY_A });
  store.seedDeal({ id: DEAL_B, workspaceId: WS, companyId: COMPANY_B });
  store.seedDeal({ id: FOREIGN_DEAL, workspaceId: WS2, companyId: null });
  const a = await clientFromCompany(store, OWNER, { companyId: COMPANY_A });
  const b = await clientFromCompany(store, OWNER, { companyId: COMPANY_B });
  return { store, a, b };
}

const deps = (store: FakeStore) => ({ mail: { store } }) as unknown as RouteDeps;
const get = (store: FakeStore, path: string[], query: Record<string, string> = {}) =>
  route(deps(store), { method: "GET", path, query, body: {}, user: OWNER, origin: "https://app.example.com" });
const post = (store: FakeStore, path: string[], body: Record<string, unknown>) =>
  route(deps(store), { method: "POST", path, query: {}, body, user: OWNER, origin: "https://app.example.com" });

describe("dealId on agreements", () => {
  it("is stored when the agreement is created and comes back on the agreement and its summary", async () => {
    const { store, a } = await setup();
    const made = await createAgreement(store, OWNER, { clientId: a.id, type: "NDA", dealId: DEAL_A });
    expect(made.dealId).toBe(DEAL_A);
    expect((await getAgreement(store, OWNER, made.id)).dealId).toBe(DEAL_A);
    expect((await listAgreements(store, OWNER))[0].dealId).toBe(DEAL_A);
  });

  it("is optional: none, null and an empty string mean no deal", async () => {
    const { store, a } = await setup();
    for (const dealId of [undefined, null, ""]) {
      const made = await createAgreement(store, OWNER, { clientId: a.id, type: "NDA", dealId });
      expect(made.dealId ?? null).toBeNull();
    }
  });

  it("refuses a deal of another workspace, an unknown one and a malformed id, creating nothing", async () => {
    const { store, a } = await setup();
    for (const dealId of [FOREIGN_DEAL, "0d000000-0000-4000-8000-00000000dead", "deal-1", 7])
      await expect(createAgreement(store, OWNER, { clientId: a.id, type: "NDA", dealId })).rejects.toMatchObject({ status: 404, message: "Deal not found." });
    expect(await listAgreements(store, OWNER)).toHaveLength(0);
  });

  it("never changes afterwards: a save that names another deal leaves it as it was", async () => {
    const { store, a } = await setup();
    const made = await createAgreement(store, OWNER, { clientId: a.id, type: "NDA", dealId: DEAL_A });
    const saved = (await agreementAction(store, OWNER, made.id, "save", { revision: made.revision, title: "Renamed", dealId: DEAL_B })) as Agreement;
    expect(saved.title).toBe("Renamed");
    expect(saved.dealId).toBe(DEAL_A);
  });

  it("the store itself refuses to move or clear the deal, even on a draft", async () => {
    const { store, a } = await setup();
    const made = await createAgreement(store, OWNER, { clientId: a.id, type: "NDA", dealId: DEAL_A });
    const row = (await store.getAgreement(WS, made.id))!;
    await expect(store.updateAgreement(WS, made.id, row.rowVersion, { dealId: DEAL_B } as never)).rejects.toThrow("The linked deal cannot change.");
    await expect(store.updateAgreement(WS, made.id, row.rowVersion, { dealId: null } as never)).rejects.toThrow("The linked deal cannot change.");
    const none = await createAgreement(store, OWNER, { clientId: a.id, type: "NDA" });
    const noneRow = (await store.getAgreement(WS, none.id))!;
    await expect(store.updateAgreement(WS, none.id, noneRow.rowVersion, { dealId: DEAL_A } as never)).rejects.toThrow("The linked deal cannot change.");
  });

  it("a duplicate keeps the deal of the original", async () => {
    const { store, a } = await setup();
    const made = await createAgreement(store, OWNER, { clientId: a.id, type: "NDA", dealId: DEAL_A });
    const copy = (await agreementAction(store, OWNER, made.id, "duplicate", {})) as Agreement;
    expect(copy.id).not.toBe(made.id);
    expect(copy.dealId).toBe(DEAL_A);
  });

  it("GET agreements filters by ?dealId and by ?companyId (the CRM company)", async () => {
    const { store, a, b } = await setup();
    const forA = await createAgreement(store, OWNER, { clientId: a.id, type: "NDA", dealId: DEAL_A });
    const forANoDeal = await createAgreement(store, OWNER, { clientId: a.id, type: "Contract" });
    const forB = await createAgreement(store, OWNER, { clientId: b.id, type: "NDA", dealId: DEAL_B });
    const ids = async (query: Record<string, string>) => ((await get(store, ["agreements"], query)).json as AgreementSummary[]).map((x) => x.id).sort();

    expect(await ids({})).toEqual([forA.id, forANoDeal.id, forB.id].sort());
    expect(await ids({ dealId: DEAL_A })).toEqual([forA.id]);
    expect(await ids({ companyId: COMPANY_A })).toEqual([forA.id, forANoDeal.id].sort());
    expect(await ids({ companyId: COMPANY_B, dealId: DEAL_B })).toEqual([forB.id]);
    expect(await ids({ companyId: COMPANY_A, dealId: DEAL_B })).toEqual([]);
    // A company with no client here, and a deal nothing is tied to, match nothing.
    expect(await ids({ companyId: "0c000000-0000-4000-8000-00000000dead" })).toEqual([]);
    expect(await ids({ dealId: FOREIGN_DEAL })).toEqual([]);
  });

  it("a malformed filter is a 400, never the whole list", async () => {
    const { store, a } = await setup();
    await createAgreement(store, OWNER, { clientId: a.id, type: "NDA", dealId: DEAL_A });
    expect(await get(store, ["agreements"], { dealId: "nope" })).toMatchObject({ status: 400, json: { error: "Invalid filter." } });
    expect(await get(store, ["agreements"], { companyId: "nope" })).toMatchObject({ status: 400, json: { error: "Invalid filter." } });
    expect(await get(store, ["billing"], { dealId: "nope" })).toMatchObject({ status: 400, json: { error: "Invalid filter." } });
    expect(await get(store, ["billing"], { companyId: "nope" })).toMatchObject({ status: 400, json: { error: "Invalid filter." } });
  });

  it("POST agreements takes dealId through the router", async () => {
    const { store, a } = await setup();
    const out = await post(store, ["agreements"], { clientId: a.id, type: "NDA", dealId: DEAL_A });
    expect(out.status).toBe(200);
    expect((out.json as Agreement).dealId).toBe(DEAL_A);
    expect((await post(store, ["agreements"], { clientId: a.id, type: "NDA", dealId: FOREIGN_DEAL })).status).toBe(404);
  });
});

describe("dealId on invoices", () => {
  const create = (store: FakeStore, body: Record<string, unknown>) => billingAction(store, OWNER, "POST", undefined, undefined, body) as Promise<Invoice>;

  it("is stored when the invoice is created and comes back on it and in the list", async () => {
    const { store, a } = await setup();
    const made = await create(store, { clientId: a.id, dealId: DEAL_A });
    expect(made.dealId).toBe(DEAL_A);
    expect(((await billingAction(store, OWNER, "GET", made.id, undefined, {})) as Invoice).dealId).toBe(DEAL_A);
    expect(((await billingAction(store, OWNER, "GET", undefined, undefined, {})) as Invoice[])[0].dealId).toBe(DEAL_A);
  });

  it("is optional, and a deal of another workspace or a malformed id is refused without taking a number", async () => {
    const { store, a } = await setup();
    for (const dealId of [FOREIGN_DEAL, "deal-1"])
      await expect(create(store, { clientId: a.id, dealId })).rejects.toMatchObject({ status: 404, message: "Deal not found." });
    const first = await create(store, { clientId: a.id });
    expect(first.dealId ?? null).toBeNull();
    expect(first.number).toMatch(/-00001$/);
  });

  it("never changes afterwards: a draft save that names another deal leaves it as it was", async () => {
    const { store, a } = await setup();
    const made = await create(store, { clientId: a.id, dealId: DEAL_A });
    const saved = (await billingAction(store, OWNER, "POST", made.id, "save", {
      revision: made.revision,
      currency: "GBP",
      issueDate: "2026-11-01",
      dueDate: "2026-11-30",
      lines: [{ description: "Work", quantity: "1", rate: "100" }],
      taxPercent: "0",
      dealId: DEAL_B,
    })) as Invoice;
    expect(saved.totalMinor).toBe(10000);
    expect(saved.dealId).toBe(DEAL_A);
    await expect(store.updateDraft(WS, made.id, saved.revision, { dealId: DEAL_B } as never, { at: new Date().toISOString(), type: "x", actor: "x" })).rejects.toThrow(
      "The linked deal cannot change.",
    );
  });

  it("GET billing filters by ?dealId and by ?companyId", async () => {
    const { store, a, b } = await setup();
    const forA = await create(store, { clientId: a.id, dealId: DEAL_A });
    const forANoDeal = await create(store, { clientId: a.id });
    const forB = await create(store, { clientId: b.id, dealId: DEAL_B });
    const ids = async (query: Record<string, string>) => ((await get(store, ["billing"], query)).json as Invoice[]).map((x) => x.id).sort();

    expect(await ids({})).toEqual([forA.id, forANoDeal.id, forB.id].sort());
    expect(await ids({ dealId: DEAL_A })).toEqual([forA.id]);
    expect(await ids({ companyId: COMPANY_A })).toEqual([forA.id, forANoDeal.id].sort());
    expect(await ids({ companyId: COMPANY_A, dealId: DEAL_B })).toEqual([]);
    expect(await ids({ companyId: "0c000000-0000-4000-8000-00000000dead" })).toEqual([]);
  });

  it("POST billing takes dealId through the router", async () => {
    const { store, b } = await setup();
    const out = await post(store, ["billing"], { clientId: b.id, dealId: DEAL_B });
    expect(out.status).toBe(200);
    expect((out.json as Invoice).dealId).toBe(DEAL_B);
  });
});
