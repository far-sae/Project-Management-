// @vitest-environment node
import { describe, expect, it } from "vitest";
import { billingAction } from "../../../../api/_signroom/billing";
import { StoreError } from "../../../../api/_signroom/errors";
import { projectAction } from "../../../../api/_signroom/projects";
import { route } from "../../../../api/_signroom/router";
import { MORE_MISSING_MESSAGE } from "../../../../api/_signroom/setupMessages";
import type { ClientProject, Invoice, ProjectList } from "../../../../api/_signroom/shared/types";
import type { Store } from "../../../../api/_signroom/store";
import { companyClient, seededStore, withMemberRole, WS } from "./helpers";

/**
 * A Draft invoice can be linked to one of its client's billing plans (the
 * field is `projectId`, as in the source app). The link lives in a column that
 * migration 186 adds, so every save that does not use it must work without it.
 */
const owner = { id: "u1", email: "owner@example.com", workspaceId: WS };
const member = { id: "m1", email: "member@example.com", workspaceId: WS };
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const LINES = [{ description: "Consulting", quantity: "1", rate: "100.00" }];
const fields = {
  name: "Synthetic plan accounting", billingType: "Monthly", billingLabel: "", currency: "GBP", monthlyFee: "100",
  contractValue: "1200", annualTarget: "0", startMonth: "2020-01", endMonth: "", status: "Active", notes: "",
};
const year = () => day(0).slice(0, 4);

async function withPlan() {
  const store = seededStore(owner);
  const client = await companyClient(store, owner);
  const draft = (await billingAction(store, owner, "POST", undefined, undefined, { clientId: client.id })) as Invoice;
  const project = (await projectAction(store, owner, client.id, undefined, "POST", fields, "")) as ClientProject;
  return { store, client, draft, project };
}
const save = (store: Store, d: Invoice, body: Record<string, unknown>, user = owner) =>
  billingAction(store, user, "POST", d.id, "save", {
    revision: d.revision, currency: "GBP", issueDate: d.issueDate, dueDate: d.dueDate, lines: LINES, taxPercent: "0", ...body,
  }) as Promise<Invoice>;
const issue = (store: Store, i: Invoice, extra: Record<string, unknown> = {}) =>
  billingAction(store, owner, "POST", i.id, "issue", { revision: i.revision, ...extra }) as Promise<Invoice>;
const list = async (store: Store, clientId: string) => (await projectAction(store, owner, clientId, undefined, "GET", {}, year())) as ProjectList;

describe("an invoice's billing plan link", () => {
  it("links on save, refuses a different currency, and keeps the stored link when projectId is left out", async () => {
    const { store, draft, project } = await withPlan();
    await expect(save(store, draft, { projectId: project.id, currency: "USD" })).rejects.toMatchObject({
      status: 400,
      message: "Invoice currency must match the linked billing plan.",
    });
    const linked = await save(store, draft, { projectId: project.id });
    expect(linked.projectId).toBe(project.id);
    await expect(save(store, linked, { currency: "USD" })).rejects.toMatchObject({ status: 400, message: "Invoice currency must match the linked billing plan." });
    const again = await save(store, linked, {});
    expect(again.projectId).toBe(project.id);
  });

  it("an empty projectId clears the link", async () => {
    const { store, draft, project } = await withPlan();
    const linked = await save(store, draft, { projectId: project.id });
    const cleared = await save(store, linked, { projectId: "" });
    expect(cleared.projectId).toBeUndefined();
  });

  it("a malformed or unknown plan id is 404", async () => {
    const { store, draft } = await withPlan();
    await expect(save(store, draft, { projectId: "not-an-id" })).rejects.toMatchObject({ status: 404, message: "Billing plan not found." });
    await expect(save(store, draft, { projectId: "11111111-2222-4333-8444-555555555555" })).rejects.toMatchObject({ status: 404, message: "Billing plan not found." });
  });

  it("a plan on another client, or one a Member did not create, is 404", async () => {
    const { store, draft, project } = await withPlan();
    const second = await companyClient(store, owner, "Second", "second@example.co");
    const elsewhere = (await projectAction(store, owner, second.id, undefined, "POST", fields, "")) as ClientProject;
    await expect(save(store, draft, { projectId: elsewhere.id })).rejects.toMatchObject({ status: 404, message: "Billing plan not found." });
    withMemberRole(store, member.id);
    const theirs = (await billingAction(store, member, "POST", undefined, undefined, { clientId: draft.clientId })) as Invoice;
    await expect(save(store, theirs, { projectId: project.id }, member)).rejects.toMatchObject({ status: 404, message: "Billing plan not found." });
  });

  it("an issued invoice's receipt shows in the plan, and an archived plan refuses new links", async () => {
    const { store, client, draft, project } = await withPlan();
    const linked = await save(store, draft, { projectId: project.id });
    await issue(store, linked, { createReceipt: true, payment: { confirmed: true, amount: "25.00", paidOn: day(0) } });
    const before = (await list(store, client.id)).projects[0];
    expect(before).toMatchObject({ receivedMinor: 2500, outstandingMinor: 7500 });

    const archived = (await projectAction(store, owner, client.id, project.id, "PATCH", { revision: project.revision, action: "archive" }, "")) as ClientProject;
    const next = (await billingAction(store, owner, "POST", undefined, undefined, { clientId: client.id })) as Invoice;
    await expect(save(store, next, { projectId: project.id })).rejects.toMatchObject({
      status: 409,
      message: "Restore the billing plan before linking invoices.",
    });
    expect((await list(store, client.id)).projects[0].receivedMinor).toBe(2500);

    const restored = (await projectAction(store, owner, client.id, project.id, "PATCH", { revision: archived.revision, action: "restore" }, "")) as ClientProject;
    await expect(
      projectAction(store, owner, client.id, project.id, "PATCH", { ...fields, revision: restored.revision, currency: "USD" }, ""),
    ).rejects.toMatchObject({ status: 409, message: "Billing plan currency cannot change after invoices have been linked." });
  });
});

describe("before migration 186 is run", () => {
  /** The store as the database is with 184 alone: no sr_projects table and no sr_invoices.project_id column. */
  function without186(store: Store): Store {
    const gone = (name: string) => async () => {
      throw new StoreError(`Could not find the table 'public.${name}' in the schema cache`);
    };
    return {
      ...store,
      listProjects: gone("sr_projects"),
      getProject: gone("sr_projects"),
      insertProject: gone("sr_projects"),
      updateProject: gone("sr_projects"),
      updateDraft: async (workspaceId, id, revision, patch, event) => {
        if ("projectId" in patch) throw new StoreError("Could not find the 'project_id' column of 'sr_invoices' in the schema cache");
        return store.updateDraft(workspaceId, id, revision, patch, event);
      },
    };
  }
  const call = (store: Store, method: string, path: string, body: Record<string, unknown> = {}, query: Record<string, string> = {}) =>
    route({ mail: { store } as never }, { method, path: path.split("/"), query, body, user: owner, origin: "https://app.example.com" });

  it("invoices are still created, listed, saved, issued and paid, with or without an empty projectId in the save", async () => {
    const real = seededStore(owner);
    const client = await companyClient(real, owner);
    const store = without186(real);
    const draft = (await call(store, "POST", "billing", { clientId: client.id })).json as Invoice;
    expect(draft.status).toBe("Draft");
    const body = { currency: "GBP", issueDate: draft.issueDate, dueDate: draft.dueDate, lines: LINES, taxPercent: "0" };
    const first = await call(store, "POST", `billing/${draft.id}/save`, { ...body, revision: draft.revision });
    expect(first.status).toBe(200);
    const second = await call(store, "POST", `billing/${draft.id}/save`, { ...body, revision: (first.json as Invoice).revision, projectId: "" });
    expect(second.status).toBe(200);
    expect((await call(store, "GET", "billing")).status).toBe(200);
    const issued = await call(store, "POST", `billing/${draft.id}/issue`, { revision: (second.json as Invoice).revision });
    expect([issued.status, (issued.json as Invoice).status]).toEqual([200, "Issued"]);
    const paid = await call(store, "POST", `billing/${draft.id}/payment`, { revision: (issued.json as Invoice).revision, amount: "10", paidOn: day(0) });
    expect(paid.status).toBe(200);
  });

  it("the plan routes and a save that names a plan answer 503 with the sentence that names the file", async () => {
    const real = seededStore(owner);
    const client = await companyClient(real, owner);
    const draft = (await billingAction(real, owner, "POST", undefined, undefined, { clientId: client.id })) as Invoice;
    const store = without186(real);
    const expected = { status: 503, json: { error: MORE_MISSING_MESSAGE } };
    expect(MORE_MISSING_MESSAGE).toBe("This part of Documents is not set up yet: run supabase/migrations/186_signroom_more.sql in the Supabase SQL editor.");
    expect(await call(store, "GET", `client-projects/${client.id}`, {}, { year: "2026" })).toEqual(expected);
    expect(await call(store, "POST", `client-projects/${client.id}`, fields)).toEqual(expected);
    expect(await call(store, "GET", "accounts-overview", {}, { year: "2026" })).toEqual(expected);
    const save = { revision: draft.revision, currency: "GBP", issueDate: draft.issueDate, dueDate: draft.dueDate, lines: LINES, taxPercent: "0" };
    expect(await call(store, "POST", `billing/${draft.id}/save`, { ...save, projectId: "11111111-2222-4333-8444-555555555555" })).toEqual(expected);
  });
});
