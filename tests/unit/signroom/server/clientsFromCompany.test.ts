// @vitest-environment node
import { describe, expect, it } from "vitest";
import { billingAction } from "../../../../api/_signroom/billing";
import { clientAction, clientFromCompany } from "../../../../api/_signroom/clients";
import { createAgreement } from "../../../../api/_signroom/agreements";
import { route, type RouteDeps } from "../../../../api/_signroom/router";
import type { Client } from "../../../../api/_signroom/shared/types";
import { inWorkspace, ORG, ORG2, OWNER, seededStore, WS, WS2, type FakeStore } from "./helpers";

/** Clients come from the CRM: POST clients/from-company { companyId }. */

const COMPANY = "0c000000-0000-4000-8000-000000000001";
const OTHER_COMPANY = "0c000000-0000-4000-8000-000000000002";
const FOREIGN_COMPANY = "0c000000-0000-4000-8000-0000000000ff";
const MEMBER = inWorkspace({ id: "u2", email: "member@example.com" });

function setup(): FakeStore {
  const store = seededStore();
  store.setOrgMember(WS, MEMBER.id, "member");
  store.seedWorkspace({ id: WS2, organizationId: ORG2, name: "Another company" });
  store.setOrgMember(WS2, "u9", "admin");
  store.seedCompany({
    id: COMPANY,
    workspaceId: WS,
    organizationId: ORG,
    name: "Bloom & Co.",
    email: "hello@bloom.co",
    address: "12 High Street",
    city: "London",
    state: "Greater London",
    postalCode: "SW1A 1AA",
    country: "United Kingdom",
  });
  store.seedCompany({ id: OTHER_COMPANY, workspaceId: WS, organizationId: ORG, name: "No Contact Ltd", email: "info@nocontact.example" });
  store.seedCompany({ id: FOREIGN_COMPANY, workspaceId: WS2, organizationId: ORG2, name: "Foreign Ltd", email: "x@foreign.example" });
  return store;
}

const count = (store: FakeStore) => (store.dump() as { clients: Client[] }).clients.length;

describe("clientFromCompany", () => {
  it("creates the client from the company: name, the first contact with an email, and the assembled address", async () => {
    const store = setup();
    store.seedContact({ companyId: COMPANY, firstName: "Nora", lastName: "NoEmail", created: "2026-01-01T00:00:00Z" });
    store.seedContact({ companyId: COMPANY, firstName: "Bea", lastName: "Bloom", email: "Bea@Bloom.co", created: "2026-01-02T00:00:00Z" });
    store.seedContact({ companyId: COMPANY, firstName: "Later", lastName: "Person", email: "later@bloom.co", created: "2026-01-03T00:00:00Z" });

    const c = await clientFromCompany(store, OWNER, { companyId: COMPANY });
    expect(c).toMatchObject({
      workspaceId: WS,
      crmCompanyId: COMPANY,
      name: "Bloom & Co.",
      contactName: "Bea Bloom",
      email: "bea@bloom.co",
      billingAddress: "12 High Street\nLondon, Greater London\nSW1A 1AA\nUnited Kingdom",
      archived: false,
    });
    expect(count(store)).toBe(1);
  });

  it("uses the company's own email when no contact has one", async () => {
    const store = setup();
    store.seedContact({ companyId: OTHER_COMPANY, firstName: "Nora", lastName: "NoEmail" });
    const c = await clientFromCompany(store, OWNER, { companyId: OTHER_COMPANY });
    expect(c).toMatchObject({ name: "No Contact Ltd", contactName: "", email: "info@nocontact.example" });
    expect(c.billingAddress ?? "").toBe("");
  });

  it("a contact whose email is not a usable address is skipped, never stored", async () => {
    const store = setup();
    store.seedContact({ companyId: OTHER_COMPANY, firstName: "Odd", lastName: "One", email: "not an address" });
    const c = await clientFromCompany(store, OWNER, { companyId: OTHER_COMPANY });
    expect(c).toMatchObject({ contactName: "", email: "info@nocontact.example" });
  });

  it("returns the same client the second time, for a Member too", async () => {
    const store = setup();
    const first = await clientFromCompany(store, OWNER, { companyId: COMPANY });
    const second = await clientFromCompany(store, MEMBER, { companyId: COMPANY });
    expect(second.id).toBe(first.id);
    expect(count(store)).toBe(1);
  });

  it("two calls at once still make one client", async () => {
    const store = setup();
    const [a, b] = await Promise.all([
      clientFromCompany(store, OWNER, { companyId: COMPANY }),
      clientFromCompany(store, MEMBER, { companyId: COMPANY }),
    ]);
    expect(a.id).toBe(b.id);
    expect(count(store)).toBe(1);
  });

  it("refreshes the details from the CRM while the client has no issued invoice or sent agreement", async () => {
    const store = setup();
    const first = await clientFromCompany(store, OWNER, { companyId: COMPANY });
    // A draft invoice and a draft agreement do not freeze the details.
    await billingAction(store, OWNER, "POST", undefined, undefined, { clientId: first.id });
    await createAgreement(store, OWNER, { clientId: first.id, type: "NDA" });
    store.seedCompany({ id: COMPANY, workspaceId: WS, organizationId: ORG, name: "Bloom Group", email: "accounts@bloom.co", address: "1 New Road", city: "Leeds" });
    const again = await clientFromCompany(store, OWNER, { companyId: COMPANY });
    expect(again.id).toBe(first.id);
    expect(again).toMatchObject({ name: "Bloom Group", email: "accounts@bloom.co", billingAddress: "1 New Road\nLeeds" });
  });

  it("keeps the client's own notes, company number and account settings when it refreshes", async () => {
    const store = setup();
    const first = await clientFromCompany(store, OWNER, { companyId: COMPANY });
    await store.updateClient(WS, first.id, { notes: "Pays late", companyNumber: "0123" });
    const again = await clientFromCompany(store, OWNER, { companyId: COMPANY });
    expect(again).toMatchObject({ notes: "Pays late", companyNumber: "0123" });
  });

  it("still follows the CRM after an invoice has been issued, while the issued invoice keeps its own copy", async () => {
    const store = setup();
    const first = await clientFromCompany(store, OWNER, { companyId: COMPANY });
    const draft = (await billingAction(store, OWNER, "POST", undefined, undefined, { clientId: first.id })) as { id: string; revision: number };
    const saved = (await billingAction(store, OWNER, "POST", draft.id, "save", {
      revision: draft.revision,
      currency: "GBP",
      issueDate: "2026-11-01",
      dueDate: "2026-11-30",
      lines: [{ description: "Work", quantity: "1", rate: "100" }],
      taxPercent: "0",
    })) as { id: string; revision: number };
    await billingAction(store, OWNER, "POST", saved.id, "issue", { revision: saved.revision });

    store.seedCompany({ id: COMPANY, workspaceId: WS, organizationId: ORG, name: "Renamed Ltd", email: "new@renamed.example" });
    const again = await clientFromCompany(store, OWNER, { companyId: COMPANY });
    expect(again.id).toBe(first.id);
    expect(again).toMatchObject({ name: "Renamed Ltd", email: "new@renamed.example" });
    const issued = (await billingAction(store, OWNER, "GET", saved.id, undefined, {})) as { customer?: { name: string; email: string } };
    expect(issued.customer).toMatchObject({ name: "Bloom & Co.", email: "hello@bloom.co" });
  });

  it("still follows the CRM after an agreement has been sent", async () => {
    const store = setup();
    const first = await clientFromCompany(store, OWNER, { companyId: COMPANY });
    const a = await createAgreement(store, OWNER, { clientId: first.id, type: "NDA" });
    const row = (await store.getAgreement(WS, a.id))!;
    await store.updateAgreement(WS, a.id, row.rowVersion, { status: "Awaiting signatures" });

    store.seedCompany({ id: COMPANY, workspaceId: WS, organizationId: ORG, name: "Renamed Ltd", email: "new@renamed.example" });
    const again = await clientFromCompany(store, OWNER, { companyId: COMPANY });
    expect(again).toMatchObject({ name: "Renamed Ltd", email: "new@renamed.example" });
  });

  it("an archived client is returned as it is, never refreshed or restored", async () => {
    const store = setup();
    const first = await clientFromCompany(store, OWNER, { companyId: COMPANY });
    await store.updateClient(WS, first.id, { archived: true });
    store.seedCompany({ id: COMPANY, workspaceId: WS, organizationId: ORG, name: "Renamed Ltd", email: "new@renamed.example" });
    const again = await clientFromCompany(store, OWNER, { companyId: COMPANY });
    expect(again).toMatchObject({ id: first.id, archived: true, name: "Bloom & Co." });
  });

  it("refuses a company of another workspace, an unknown one and a malformed id, creating nothing", async () => {
    const store = setup();
    for (const companyId of [FOREIGN_COMPANY, "0c000000-0000-4000-8000-00000000dead", "c1", "", undefined, 7])
      await expect(clientFromCompany(store, OWNER, { companyId })).rejects.toMatchObject({ status: 404, message: "Company not found." });
    expect(count(store)).toBe(0);
    // The other workspace's own admin can use its company, and gets its own client there.
    const theirs = await clientFromCompany(store, { id: "u9", email: "u9@example.com", workspaceId: WS2 }, { companyId: FOREIGN_COMPANY });
    expect(theirs.workspaceId).toBe(WS2);
  });

  it("a company with no workspace (an unassigned CRM row) is refused", async () => {
    const store = setup();
    const LOOSE = "0c000000-0000-4000-8000-0000000000aa";
    store.seedCompany({ id: LOOSE, workspaceId: null, organizationId: ORG, name: "Loose Ltd" });
    await expect(clientFromCompany(store, OWNER, { companyId: LOOSE })).rejects.toMatchObject({ status: 404 });
  });

  it("a viewer or an outsider is refused before the company is read", async () => {
    const store = setup();
    store.setOrgMember(WS, "viewer", "viewer");
    await expect(clientFromCompany(store, inWorkspace({ id: "viewer", email: "v@example.com" }), { companyId: COMPANY })).rejects.toMatchObject({ status: 403 });
    await expect(clientFromCompany(store, inWorkspace({ id: "u9", email: "u9@example.com" }), { companyId: COMPANY })).rejects.toMatchObject({ status: 403 });
    expect(count(store)).toBe(0);
  });
});

describe("the clients routes", () => {
  const deps = (store: FakeStore) => ({ mail: { store } }) as unknown as RouteDeps;
  const call = (store: FakeStore, method: string, path: string[], body: Record<string, unknown> = {}, user = OWNER) =>
    route(deps(store), { method, path, query: {}, body, user, origin: "https://app.example.com" });

  it("POST clients/from-company answers the Client", async () => {
    const store = setup();
    const out = await call(store, "POST", ["clients", "from-company"], { companyId: COMPANY });
    expect(out.status).toBe(200);
    expect(out.json).toMatchObject({ crmCompanyId: COMPANY, name: "Bloom & Co.", workspaceId: WS });
  });

  it("POST clients/from-company for another workspace's company is 404", async () => {
    const store = setup();
    const out = await call(store, "POST", ["clients", "from-company"], { companyId: FOREIGN_COMPANY });
    expect(out).toMatchObject({ status: 404, json: { error: "Company not found." } });
  });

  it("only POST reaches clients/from-company", async () => {
    const store = setup();
    for (const method of ["GET", "PATCH", "DELETE"]) expect((await call(store, method, ["clients", "from-company"], { companyId: COMPANY })).status).toBe(404);
  });

  it("GET clients lists them with their company ids", async () => {
    const store = setup();
    await call(store, "POST", ["clients", "from-company"], { companyId: COMPANY });
    const out = await call(store, "GET", ["clients"]);
    expect(out.status).toBe(200);
    expect(out.json).toMatchObject([{ crmCompanyId: COMPANY, name: "Bloom & Co." }]);
  });

  it("a client can no longer be typed in or edited: POST clients and a PATCH with details are refused", async () => {
    const store = setup();
    expect((await call(store, "POST", ["clients"], { name: "Typed In Ltd" })).status).toBe(404);
    const made = (await call(store, "POST", ["clients", "from-company"], { companyId: COMPANY })).json as Client;
    const edit = await call(store, "PATCH", ["clients", made.id], { name: "Edited Ltd", email: "edited@example.com" });
    expect(edit.status).toBe(400);
    expect((await store.getClient(WS, made.id))!.name).toBe("Bloom & Co.");
    await expect(clientAction(store, OWNER, "POST", { name: "Typed In Ltd" })).rejects.toMatchObject({ status: 400 });
    expect(count(store)).toBe(1);
  });

  it("archive and restore stay, for owners only", async () => {
    const store = setup();
    const made = (await call(store, "POST", ["clients", "from-company"], { companyId: COMPANY })).json as Client;
    expect((await call(store, "DELETE", ["clients", made.id], {}, MEMBER)).status).toBe(403);
    expect((await call(store, "DELETE", ["clients", made.id])).status).toBe(200);
    expect((await store.getClient(WS, made.id))!.archived).toBe(true);
    expect((await call(store, "PATCH", ["clients", made.id], { action: "restore" }, MEMBER)).status).toBe(403);
    expect((await call(store, "PATCH", ["clients", made.id], { action: "restore" })).status).toBe(200);
    expect((await store.getClient(WS, made.id))!.archived).toBe(false);
  });
});
