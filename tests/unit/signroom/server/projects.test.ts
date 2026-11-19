// @vitest-environment node
import { describe, expect, it } from "vitest";
import { clientAction } from "../../../../api/_signroom/clients";
import { accountsOverview, projectAction, visibleProject } from "../../../../api/_signroom/projects";
import { billingAction } from "../../../../api/_signroom/billing";
import { currentWorkspace } from "../../../../api/_signroom/context";
import type { Client, ClientProject, Invoice, Payment, ProjectList } from "../../../../api/_signroom/shared/types";
import type { Store } from "../../../../api/_signroom/store";
import { companyClient, ORG2, seededStore, withMemberRole, WS, WS2, type FakeStore } from "./helpers";

/**
 * Billing plans: the source calls them client "projects" (the API paths, the
 * JSON fields and the sr_projects table keep that name); the sentences people
 * read say "billing plan", because TaskCalendar's own projects are something else.
 */
const owner = { id: "u1", email: "owner@example.com", workspaceId: WS };
/** An admin of another organisation's workspace. */
const other = { id: "u2", email: "other@example.com", workspaceId: WS2 };
const member = { id: "m1", email: "member@example.com", workspaceId: WS };

const projectFields = {
  name: "Synthetic project accounting",
  billingType: "Monthly",
  billingLabel: "",
  currency: "GBP",
  monthlyFee: "100",
  contractValue: "1200",
  annualTarget: "0",
  startMonth: "2026-01",
  endMonth: "2026-12",
  status: "Active",
  notes: "Synthetic accounting test",
};

/** The same store, where m1 is a Member of the owner's workspace. */
const withMember = <S extends Store>(store: S): S => withMemberRole(store, member.id);

/** WS with u1 as an admin, and WS2 (another organisation) with u2 as its admin. */
function twoWorkspaces(): FakeStore {
  const store = seededStore(owner);
  store.seedWorkspace({ id: WS2, organizationId: ORG2, name: "Other Studio" });
  store.setOrgMember(WS2, other.id, "admin");
  return store;
}

async function setup() {
  const store = twoWorkspaces();
  const client = await companyClient(store, owner);
  return { store, client };
}
const create = (store: Store, clientId: string, over: Record<string, unknown> = {}, user = owner) =>
  projectAction(store, user, clientId, undefined, "POST", { ...projectFields, ...over }, "") as Promise<ClientProject>;
const patch = (store: Store, c: string, p: ClientProject, body: Record<string, unknown>, user = owner) =>
  projectAction(store, user, c, p.id, "PATCH", { revision: p.revision, ...body }, "") as Promise<ClientProject>;
const rejects = (p: Promise<unknown>, status: number, message: string) =>
  expect(p).rejects.toMatchObject({ status, message });

describe("projectAction: create and edit", () => {
  it("POST creates a project", async () => {
    const { store, client } = await setup();
    const p = await create(store, client.id);
    expect(p).toMatchObject({ monthlyFeeMinor: 10000, contractValueMinor: 120000, revision: 1, archived: false, createdBy: "u1", clientId: client.id, status: "Active" });
  });

  it("looks the client up itself: a missing client is 404", async () => {
    const { store } = await setup();
    await rejects(create(store, "11111111-2222-4333-8444-555555555555"), 404, "Client not found.");
  });

  it("answers 405 for a wrong method and PATCH without an id", async () => {
    const { store, client } = await setup();
    await rejects(projectAction(store, owner, client.id, undefined, "PATCH", projectFields, ""), 405, "Use POST to create a billing plan or PATCH with a billing plan ID.");
    await rejects(projectAction(store, owner, client.id, undefined, "DELETE", {}, ""), 405, "Method not allowed.");
    const p = await create(store, client.id);
    await rejects(projectAction(store, owner, client.id, p.id, "POST", projectFields, ""), 405, "Use POST to create a billing plan or PATCH with a billing plan ID.");
  });

  it("validates the fields", async () => {
    const { store, client } = await setup();
    await rejects(create(store, client.id, { endMonth: "2025-12" }), 400, "Choose valid start/end months, with the end after the start.");
    await rejects(create(store, client.id, { currency: "JPY" }), 400, "Enter a billing plan name and supported billing type, currency and status.");
    await rejects(create(store, client.id, { name: "" }), 400, "Enter a billing plan name and supported billing type, currency and status.");
    await rejects(create(store, client.id, { billingType: "Custom" }), 400, "Describe the custom billing type.");
    expect((await create(store, client.id, { billingType: "Custom", billingLabel: "Retainer" })).billingLabel).toBe("Retainer");
    expect((await create(store, client.id, { billingType: "One-off", billingLabel: "Retainer" })).billingLabel).toBe("");
  });

  it("PATCH edits the fields and bumps the revision", async () => {
    const { store, client } = await setup();
    const p = await create(store, client.id);
    const out = await patch(store, client.id, p, { ...projectFields, name: "Renamed" });
    expect(out).toMatchObject({ name: "Renamed", revision: 2 });
  });

  it("a stale revision is 409 and nothing changes (Review Focus 2)", async () => {
    const { store, client } = await setup();
    const p = await create(store, client.id);
    await rejects(patch(store, client.id, { ...p, revision: 99 }, { ...projectFields, name: "Changed" }), 409, "Billing plan changed. Reload before editing.");
    expect(await store.getProject(p.workspaceId, p.id)).toMatchObject({ name: p.name, revision: 1 });
  });

  it("the store refusing a stale update is also 409", async () => {
    const { store, client } = await setup();
    const p = await create(store, client.id);
    const racing: Store = { ...store, updateProject: async () => null };
    await rejects(patch(racing, client.id, p, { ...projectFields, name: "x" }), 409, "Billing plan changed. Reload before editing.");
  });
});

describe("projectAction: months", () => {
  it("stores a month and resets it", async () => {
    const { store, client } = await setup();
    const p = await create(store, client.id);
    const out = await patch(store, client.id, p, { action: "month", month: "2026-11", paid: "30", expected: "100", notes: "x" });
    expect(out.monthlyEntries?.["2026-11"]).toMatchObject({ paidMinor: 3000, expectedMinor: 10000, notes: "x", updatedBy: "u1" });
    expect(out.revision).toBe(2);
    const cleared = await patch(store, client.id, out, { action: "month", month: "2026-11", reset: true });
    expect(cleared.monthlyEntries?.["2026-11"]).toBeUndefined();
  });

  it("refuses a bad month or amount", async () => {
    const { store, client } = await setup();
    const p = await create(store, client.id);
    await rejects(patch(store, client.id, p, { action: "month", month: "2026-13", paid: "1", expected: "1" }), 400, "Choose a valid month.");
    await rejects(patch(store, client.id, p, { action: "month", month: "2026-11", paid: "-1", expected: "1" }), 400, "Enter a valid positive decimal amount.");
  });

  it("refuses months on an archived project", async () => {
    const { store, client } = await setup();
    const archived = await patch(store, client.id, await create(store, client.id), { action: "archive" });
    await rejects(patch(store, client.id, archived, { action: "month", month: "2026-11", paid: "1", expected: "1" }), 409, "Restore this billing plan before editing months.");
  });

  it("archive then restore flips archived and bumps the revision each time", async () => {
    const { store, client } = await setup();
    const a = await patch(store, client.id, await create(store, client.id), { action: "archive" });
    expect(a).toMatchObject({ archived: true, revision: 2 });
    const r = await patch(store, client.id, a, { action: "restore" });
    expect(r).toMatchObject({ archived: false, revision: 3 });
  });
});

describe("projectAction: archived client", () => {
  it("refuses POST and PATCH, still lets GET through", async () => {
    const { store, client } = await setup();
    const p = await create(store, client.id);
    await clientAction(store, owner, "DELETE", {}, client.id);
    await rejects(create(store, client.id), 409, "Restore this client before changing billing plans.");
    await rejects(patch(store, client.id, p, projectFields), 409, "Restore this client before changing billing plans.");
    const list = (await projectAction(store, owner, client.id, undefined, "GET", {}, "2026")) as ProjectList;
    expect(list.projects).toHaveLength(1);
  });
});

describe("projectAction: GET", () => {
  it("checks the year", async () => {
    const { store, client } = await setup();
    await rejects(projectAction(store, owner, client.id, undefined, "GET", {}, "1999"), 400, "Choose a year from 2000 to 2100.");
    await rejects(projectAction(store, owner, client.id, undefined, "GET", {}, "2101"), 400, "Choose a year from 2000 to 2100.");
    await rejects(projectAction(store, owner, client.id, undefined, "GET", {}, "abc"), 400, "Choose a year from 2000 to 2100.");
  });

  it("defaults to the current London year", async () => {
    const { store, client } = await setup();
    const at = new Date("2026-12-31T23:30:00Z");
    expect(((await projectAction(store, owner, client.id, undefined, "GET", {}, "", at)) as ProjectList).year).toBe(2026);
    const next = new Date("2027-01-01T00:30:00Z");
    expect(((await projectAction(store, owner, client.id, undefined, "GET", {}, "", next)) as ProjectList).year).toBe(2027);
  });

  it("returns the client name and the year rows", async () => {
    const { store, client } = await setup();
    await create(store, client.id);
    const list = (await projectAction(store, owner, client.id, undefined, "GET", {}, "2026")) as ProjectList;
    expect(list).toMatchObject({ year: 2026, clientName: "Bloom & Co." });
    expect(list.projects[0]).toMatchObject({ targetMinor: 120000, months: Array(12).fill(0) });
    expect(list.projects[0].expectedMonths).toEqual(Array(12).fill(10000));
  });

  it("an upper-case client id in the path behaves like the lower-case one", async () => {
    const { store, client } = await setup();
    const p = await create(store, client.id);
    const up = client.id.toUpperCase();
    const list = (await projectAction(store, owner, up, undefined, "GET", {}, "2026")) as ProjectList;
    expect(list.projects).toHaveLength(1);
    const edited = (await projectAction(store, owner, up, p.id, "PATCH", { ...projectFields, revision: p.revision, name: "Renamed" }, "")) as ClientProject;
    expect(edited.name).toBe("Renamed");
  });

  it("a GET with a project id returns the list, as SR does", async () => {
    const { store, client } = await setup();
    const p = await create(store, client.id);
    const list = (await projectAction(store, owner, client.id, p.id, "GET", {}, "2026")) as ProjectList;
    expect(list.projects).toHaveLength(1);
  });
});

describe("projectAction: who can see what (Review Focus 5)", () => {
  it("another workspace gets 404 for GET, POST and PATCH, and its own list stays empty", async () => {
    const { store, client } = await setup();
    const p = await create(store, client.id);
    await rejects(patch(store, client.id, p, { action: "archive" }, other), 404, "Client not found.");
    const theirs = await companyClient(store, other, "Their client", "t@their.co");
    await rejects(projectAction(store, other, theirs.id, p.id, "PATCH", { revision: p.revision, action: "archive" }, ""), 404, "Billing plan not found.");
    expect(((await projectAction(store, other, theirs.id, undefined, "GET", {}, "2026")) as ProjectList).projects).toEqual([]);
    expect(await store.getProject(WS, p.id)).toMatchObject({ archived: false, revision: 1 });
    await rejects(projectAction(store, other, client.id, undefined, "GET", {}, "2026"), 404, "Client not found.");
    await rejects(create(store, client.id, {}, other), 404, "Client not found.");
  });

  it("a malformed client id is 404, a malformed project id is 404", async () => {
    const { store, client } = await setup();
    await rejects(projectAction(store, owner, "not-an-id", undefined, "GET", {}, "2026"), 404, "Client not found.");
    await rejects(projectAction(store, owner, "not-an-id", undefined, "POST", projectFields, ""), 404, "Client not found.");
    await rejects(projectAction(store, owner, client.id, "not-an-id", "PATCH", { revision: 1 }, ""), 404, "Billing plan not found.");
  });

  it("someone outside the organisation is refused before anything is read (403)", async () => {
    const { store, client } = await setup();
    const outsider = { id: "x9", email: "x@example.com", workspaceId: WS };
    await rejects(projectAction(store, outsider, client.id, undefined, "GET", {}, "2026"), 403, "Choose a workspace.");
    await rejects(create(store, client.id, {}, outsider), 403, "Choose a workspace.");
    await rejects(accountsOverview(store, outsider, "2026"), 403, "Choose a workspace.");
  });

  it("a Member lists only the projects they created, and cannot open another's", async () => {
    const store = withMember(twoWorkspaces());
    const client = await companyClient(store, owner, "Bloom");
    const mine = await create(store, client.id, { name: "Mine" }, member);
    const theirs = await create(store, client.id, { name: "Owners" });
    const asMember = (await projectAction(store, member, client.id, undefined, "GET", {}, "2026")) as ProjectList;
    expect(asMember.projects.map((p) => p.id)).toEqual([mine.id]);
    const asOwner = (await projectAction(store, owner, client.id, undefined, "GET", {}, "2026")) as ProjectList;
    expect(asOwner.projects).toHaveLength(2);
    await rejects(patch(store, client.id, theirs, { action: "archive" }, member), 404, "Billing plan not found.");
  });
});

describe("visibleProject", () => {
  it("is 404 for a project on another client", async () => {
    const { store, client } = await setup();
    const p = await create(store, client.id);
    const ctx = await currentWorkspace(store, owner);
    await expect(visibleProject(store, ctx, client.id, p.id)).resolves.toMatchObject({ id: p.id });
    await rejects(visibleProject(store, ctx, "11111111-2222-4333-8444-555555555555", p.id), 404, "Billing plan not found.");
  });
});

describe("accountsOverview", () => {
  const AT = new Date("2026-06-30T23:30:00Z");
  const BEFORE = new Date("2026-06-30T22:30:00Z");

  async function seed(store: Store, client: Client, createdBy = owner, over: { pay?: boolean; issueDate?: string } = {}) {
    const draft = (await billingAction(store, createdBy, "POST", undefined, undefined, { clientId: client.id })) as Invoice;
    const saved = (await billingAction(store, createdBy, "POST", draft.id, "save", {
      revision: draft.revision,
      currency: "GBP",
      issueDate: over.issueDate ?? "2026-06-01",
      dueDate: "2026-06-30",
      lines: [{ description: "Consulting", quantity: "1", rate: "100.00" }],
      taxPercent: "0",
    })) as Invoice;
    let inv = (await billingAction(store, createdBy, "POST", saved.id, "issue", { revision: saved.revision })) as Invoice;
    const pay: Payment = { id: "11111111-1111-4111-8111-111111111111", amountMinor: 2500, paidOn: "2026-07-01", method: "Bank transfer", reference: "", receiptNumber: inv.number + "-R01", receiptHash: "", recordedAt: AT.toISOString() };
    if (over.pay !== false) await store.recordPayment(inv.id, inv.revision, pay, "Part paid", { at: AT.toISOString(), type: "Payment", actor: "x" });
    inv = (await billingAction(store, createdBy, "GET", inv.id, undefined, {})) as Invoice;
    return inv;
  }

  it("Review Focus 1: at 23:30 UTC on 30 June it is already 1 July in London", async () => {
    const { store, client } = await setup();
    await create(store, client.id);
    const inv = await seed(store, client);
    const out = await accountsOverview(store, owner, "2026", AT);
    expect(out.today).toBe("2026-07-01");
    expect(out.year).toBe(2026);
    const plan = out.rows.filter((r) => r.source === "Project plan");
    expect(plan).toHaveLength(12);
    plan.forEach((r, n) => {
      expect(r.period).toBe(`2026-${String(n + 1).padStart(2, "0")}`);
      expect(r.status).toBe(n < 6 ? "overdue" : "upcoming");
      expect(r.remainingMinor).toBe(10000);
      expect(r.reference).toBe("Synthetic project accounting");
    });
    const row = out.rows.find((r) => r.source === "Invoice")!;
    expect(row).toMatchObject({ id: inv.id, status: "overdue", paidMinor: 2500, remainingMinor: 7500, period: "2026-06-30", reference: inv.number, clientName: "Bloom & Co." });
  });

  it("at 22:30 UTC the same day nothing is overdue yet and the payment does not count", async () => {
    const { store, client } = await setup();
    await create(store, client.id);
    await seed(store, client);
    const out = await accountsOverview(store, owner, "2026", BEFORE);
    expect(out.today).toBe("2026-06-30");
    expect(out.rows.find((r) => r.period === "2026-06")!.status).toBe("upcoming");
    const row = out.rows.find((r) => r.source === "Invoice")!;
    expect(row).toMatchObject({ status: "upcoming", paidMinor: 0, remainingMinor: 10000 });
  });

  it("leaves out drafts, voided invoices, other years, and months with nothing due or paid", async () => {
    const { store, client } = await setup();
    await create(store, client.id, { billingType: "One-off", monthlyFee: "0", startMonth: "2026-03", endMonth: "2026-03" });
    await billingAction(store, owner, "POST", undefined, undefined, { clientId: client.id });
    const v = await seed(store, client, owner, { pay: false });
    await billingAction(store, owner, "POST", v.id, "void", { revision: v.revision, reason: "Synthetic" });
    await seed(store, client, owner, { issueDate: "2025-06-01" });
    const out = await accountsOverview(store, owner, "2026", AT);
    expect(out.rows).toHaveLength(0);
  });

  it("a fully paid month is 'paid'", async () => {
    const { store, client } = await setup();
    const p = await create(store, client.id);
    await projectAction(store, owner, client.id, p.id, "PATCH", { revision: p.revision, action: "month", month: "2026-02", paid: "100", expected: "100" }, "");
    const out = await accountsOverview(store, owner, "2026", AT);
    expect(out.rows.find((r) => r.period === "2026-02")).toMatchObject({ status: "paid", paidMinor: 10000, remainingMinor: 0 });
    expect(out.rows.find((r) => r.period === "2026-01")!.status).toBe("overdue");
  });

  it("archived clients and archived projects mark their rows", async () => {
    const { store, client } = await setup();
    const p = await create(store, client.id);
    await projectAction(store, owner, client.id, p.id, "PATCH", { revision: p.revision, action: "archive" }, "");
    expect((await accountsOverview(store, owner, "2026", AT)).rows.every((r) => r.archived)).toBe(true);
    const c2 = await companyClient(store, owner, "Second", "second@example.co");
    await create(store, c2.id);
    await clientAction(store, owner, "DELETE", {}, c2.id);
    const rows = (await accountsOverview(store, owner, "2026", AT)).rows;
    expect(rows.filter((r) => r.clientId === c2.id).every((r) => r.archived)).toBe(true);
  });

  it("refuses a bad year; another workspace sees none of the rows; a Member sees only their own", async () => {
    const { store, client } = await setup();
    await create(store, client.id);
    await seed(store, client);
    await rejects(accountsOverview(store, owner, "bad", AT), 400, "Choose a year from 2000 to 2099.");
    await rejects(accountsOverview(store, owner, "2100", AT), 400, "Choose a year from 2000 to 2099.");
    expect((await accountsOverview(store, other, "2026", AT)).rows).toHaveLength(0);
    expect((await accountsOverview(withMember(store), member, "2026", AT)).rows).toHaveLength(0);
    expect((await accountsOverview(store, owner, "2026", AT)).rows.length).toBeGreaterThan(0);
  });

  it("the year defaults to London's current year", async () => {
    const { store } = await setup();
    expect((await accountsOverview(store, owner, "", new Date("2026-12-31T23:30:00Z"))).year).toBe(2026);
    expect((await accountsOverview(store, owner, "", new Date("2027-01-01T00:30:00Z"))).year).toBe(2027);
  });
});
