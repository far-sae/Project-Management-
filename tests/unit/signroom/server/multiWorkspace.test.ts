// @vitest-environment node
import { describe, expect, it } from "vitest";
import { route, type RouteDeps, type RouteRequest } from "../../../../api/_signroom/router";
import type { Agreement, Client, Invoice } from "../../../../api/_signroom/shared/types";
import { ORG, ORG2, seededStore, WS, WS2 } from "./helpers";

/**
 * Tenancy through the router: u1 is an admin of the organisation that owns
 * workspace A. u2 is an admin of another organisation (workspace B) and a plain
 * member of u1's. Every route acts only in the workspace the request names,
 * with the caller's role in that workspace's organisation; a workspace they do
 * not (or no longer) belong to is refused.
 */
const A = WS;
const B = WS2;
const u1 = { id: "u1", email: "owner@example.com", workspaceId: A };
const u2 = { id: "u2", email: "sam@example.com" };
const ORIGIN = "https://app.example.com";
const CHOOSE = "Choose a workspace.";
const COMPANY_A = "0c000000-0000-4000-8000-00000000000a";
const COMPANY_B = "0c000000-0000-4000-8000-00000000000b";

type Who = RouteRequest["user"];

async function setup() {
  const store = seededStore(u1);
  store.seedWorkspace({ id: B, organizationId: ORG2, name: "Sam's company" });
  store.setOrgMember(B, "u2", "owner");
  store.setOrgMember(A, "u2", "member");
  store.seedCompany({ id: COMPANY_A, workspaceId: A, organizationId: ORG, name: "Acme", email: "buyer@acme.test" });
  store.seedCompany({ id: COMPANY_B, workspaceId: B, organizationId: ORG2, name: "Own client", email: "own@client.test" });
  const deps: RouteDeps = { mail: { store } as never };
  const call = async (user: Who, method: string, path: string, body: Record<string, unknown> = {}, query: Record<string, string> = {}) =>
    route(deps, { method, path: path.split("/").filter(Boolean), query, body, user, origin: ORIGIN });
  const json = async <T>(user: Who, method: string, path: string, body: Record<string, unknown> = {}, query: Record<string, string> = {}) => {
    const out = await call(user, method, path, body, query);
    expect(out.status, `${method} ${path}: ${JSON.stringify(out.json)}`).toBe(200);
    return out.json as T;
  };

  // The owner's records in A: a client, an issued invoice and a draft agreement.
  const client = await json<Client>(u1, "POST", "clients/from-company", { companyId: COMPANY_A });
  const draft = await json<Invoice>(u1, "POST", "billing", { clientId: client.id });
  const saved = await json<Invoice>(u1, "POST", `billing/${draft.id}/save`, {
    revision: draft.revision, currency: "GBP", issueDate: "2026-06-01", dueDate: "2026-06-30",
    lines: [{ description: "Consulting", quantity: "1", rate: "100.00" }], taxPercent: "0",
  });
  const invoice = await json<Invoice>(u1, "POST", `billing/${saved.id}/issue`, { revision: saved.revision });
  const agreement = await json<Agreement>(u1, "POST", "agreements", { clientId: client.id });
  expect(invoice.status).toBe("Issued");

  const inA = { ...u2, workspaceId: A };
  const inB = { ...u2, workspaceId: B };
  return { store, call, json, client, invoice, agreement, inA, inB };
}

describe("a user in two workspaces", () => {
  it("naming A (a Member there): owner-only routes are 403, the owner's rows are hidden, new rows land in A as theirs", async () => {
    const t = await setup();
    const wsName = (await t.store.getWorkspace(A))?.name;

    const del = await t.call(t.inA, "DELETE", `clients/${t.client.id}`);
    expect(del).toEqual({ status: 403, json: { error: "Only the workspace owner can do that." } });
    expect((await t.store.getClient(A, t.client.id))?.archived).toBe(false);

    const settings = await t.call(t.inA, "POST", "workspaces/settings", { name: "Taken over", retentionDays: 30 });
    expect(settings).toEqual({ status: 403, json: { error: "Only the workspace owner can do that." } });
    expect((await t.store.getWorkspace(A))?.name).toBe(wsName);

    const account = await t.call(t.inA, "PATCH", `client-accounts/${t.client.id}`, { revision: 0, currency: "GBP", paymentTermsDays: 10 });
    expect(account).toEqual({ status: 403, json: { error: "Only workspace owners can change account settings." } });

    expect(await t.json<Invoice[]>(t.inA, "GET", "billing")).toEqual([]);
    expect((await t.call(t.inA, "GET", `billing/${t.invoice.id}`)).status).toBe(404);
    expect((await t.call(t.inA, "GET", `billing/${t.invoice.id}/artifact`)).status).toBe(404);
    expect((await t.call(t.inA, "GET", `agreements/${t.agreement.id}`)).status).toBe(404);
    expect(await t.json<unknown[]>(t.inA, "GET", "agreements")).toEqual([]);

    // Members see the workspace's clients and can bill them.
    expect((await t.json<Client[]>(t.inA, "GET", "clients")).map((c) => c.id)).toEqual([t.client.id]);
    const mine = await t.json<Invoice>(t.inA, "POST", "billing", { clientId: t.client.id });
    expect(mine).toMatchObject({ workspaceId: A, createdBy: "u2" });
    expect((await t.json<Invoice[]>(t.inA, "GET", "billing")).map((i) => i.id)).toEqual([mine.id]);
    // The owner sees both.
    expect(await t.json<Invoice[]>(u1, "GET", "billing")).toHaveLength(2);

    const session = await t.json<{ workspace: { id: string }; role: string }>(t.inA, "GET", "session");
    expect(session).toMatchObject({ workspace: { id: A }, role: "Member" });
  });

  it("naming B (their own organisation's): they act as Owner there and see none of A's rows", async () => {
    const t = await setup();
    expect(await t.json<Client[]>(t.inB, "GET", "clients")).toEqual([]);
    expect(await t.json<Invoice[]>(t.inB, "GET", "billing")).toEqual([]);
    expect(await t.json<unknown[]>(t.inB, "GET", "agreements")).toEqual([]);
    expect((await t.call(t.inB, "DELETE", `clients/${t.client.id}`)).status).toBe(404);
    expect((await t.call(t.inB, "PATCH", `client-accounts/${t.client.id}`, { revision: 0, currency: "GBP", paymentTermsDays: 10 })).status).toBe(404);
    expect((await t.call(t.inB, "GET", `agreements/${t.agreement.id}`)).status).toBe(404);
    expect((await t.call(t.inB, "GET", `billing/${t.invoice.id}`)).status).toBe(404);
    expect((await t.call(t.inB, "POST", "billing", { clientId: t.client.id })).status).toBe(400);
    expect((await t.call(t.inB, "POST", "agreements", { clientId: t.client.id })).status).toBe(400);
    // A's CRM company cannot become a client of B.
    expect((await t.call(t.inB, "POST", "clients/from-company", { companyId: COMPANY_A })).status).toBe(404);

    // Owner behaviour in B.
    const own = await t.json<Client>(t.inB, "POST", "clients/from-company", { companyId: COMPANY_B });
    expect(own.workspaceId).toBe(B);
    expect(await t.json(t.inB, "PATCH", `client-accounts/${own.id}`, { revision: 0, currency: "GBP", paymentTermsDays: 10 })).toMatchObject({ revision: 1 });
    expect(await t.json(t.inB, "DELETE", `clients/${own.id}`)).toEqual({ ok: true });
    expect(await t.json(t.inB, "POST", "workspaces/settings", { name: "Sam's", retentionDays: 30 })).toMatchObject({ id: B, name: "Sam's" });
    expect((await t.store.getWorkspace(A))?.name).not.toBe("Sam's");
    expect(await t.json(t.inB, "GET", "session")).toMatchObject({ workspace: { id: B }, role: "Owner" });

    // u1 has no place in B.
    expect(await t.call({ ...u1, workspaceId: B }, "GET", "clients")).toEqual({ status: 403, json: { error: CHOOSE } });
  });

  it("with no workspace named, every signed-in route is 403: there is no default workspace", async () => {
    const t = await setup();
    for (const [method, path] of [["GET", "session"], ["GET", "clients"], ["GET", "billing"], ["GET", "agreements"], ["GET", "templates"], ["POST", "billing"]]) {
      expect(await t.call(u2, method, path), `${method} ${path}`).toEqual({ status: 403, json: { error: CHOOSE } });
    }
  });

  it("after removal from the organisation, naming A is 403 everywhere, with none of A's rows and nothing written", async () => {
    const t = await setup();
    await t.json<Invoice>(t.inA, "POST", "billing", { clientId: t.client.id });
    t.store.setOrgMember(A, "u2", "member", "removed");
    const snapshot = async () => JSON.stringify([t.store.dump(), await t.store.listAgreements(A, null), await t.store.listAgreements(B, null)]);
    const before = await snapshot();

    const calls: [string, string, Record<string, unknown>?, Record<string, string>?][] = [
      ["GET", "session"],
      ["GET", "clients"],
      ["POST", "clients/from-company", { companyId: COMPANY_A }],
      ["PATCH", `clients/${t.client.id}`, { action: "restore" }],
      ["DELETE", `clients/${t.client.id}`],
      ["GET", "billing"],
      ["POST", "billing", { clientId: t.client.id }],
      ["GET", `billing/${t.invoice.id}`],
      ["GET", `billing/${t.invoice.id}/preview`],
      ["GET", `billing/${t.invoice.id}/artifact`],
      ["POST", `billing/${t.invoice.id}/send`],
      ["POST", `billing/${t.invoice.id}/void`],
      ["GET", "billing/delivery"],
      ["GET", `client-accounts/${t.client.id}`],
      ["PATCH", `client-accounts/${t.client.id}`, { revision: 0, currency: "GBP", paymentTermsDays: 10 }],
      ["GET", "agreements"],
      ["POST", "agreements", { clientId: t.client.id }],
      ["GET", `agreements/${t.agreement.id}`],
      ["GET", `agreements/${t.agreement.id}/artifact-url`],
      ["POST", `agreements/${t.agreement.id}/save`, { revision: 1, title: "Changed" }],
      ["POST", `agreements/${t.agreement.id}/prepare`, { revision: 1 }],
      ["POST", `agreements/${t.agreement.id}/upload-url`, { name: "a.pdf", size: 10, revision: 1 }],
      ["POST", `agreements/${t.agreement.id}/upload`, { uploadId: "x" }],
      ["POST", `agreements/${t.agreement.id}/send`, { revision: 1, eligible: true }],
      ["POST", `agreements/${t.agreement.id}/cancel`, { reason: "x" }],
      ["POST", `agreements/${t.agreement.id}/resend`],
      ["POST", `agreements/${t.agreement.id}/sign-first`, {}],
      ["POST", `agreements/${t.agreement.id}/release-first`],
      ["POST", `agreements/${t.agreement.id}/export`],
      ["POST", `agreements/${t.agreement.id}/delete`],
      ["POST", `agreements/${t.agreement.id}/hold`, { hold: true }],
      ["GET", "templates"],
      ["POST", "workspaces/settings", { name: "Taken", retentionDays: 30 }],
      ["POST", "workspaces/email-settings", { senderName: "X", senderEmail: "x@x.test", replyTo: "x@x.test" }],
      ["POST", "workspaces/branding", { companyName: "X" }],
      ["POST", "workspaces/branding-preview", {}],
      ["GET", "workspaces/branding-template", {}, { hash: "h" }],
    ];
    for (const [method, path, body, query] of calls) {
      const out = await t.call(t.inA, method, path, body ?? {}, query ?? {});
      expect(out, `${method} ${path}`).toEqual({ status: 403, json: { error: CHOOSE } });
    }
    expect(await snapshot()).toBe(before);
    // Their own organisation's workspace still works.
    expect(await t.json(t.inB, "GET", "session")).toMatchObject({ workspace: { id: B }, role: "Owner" });
  });

  it("a viewer of the organisation is refused like an outsider", async () => {
    const t = await setup();
    t.store.setOrgMember(A, "u2", "viewer");
    for (const [method, path] of [["GET", "session"], ["GET", "clients"], ["GET", "billing"], ["GET", "agreements"]])
      expect(await t.call(t.inA, method, path), `${method} ${path}`).toEqual({ status: 403, json: { error: CHOOSE } });
  });

  it("a malformed or unknown workspace id is refused the same way", async () => {
    const t = await setup();
    for (const workspaceId of ["not-an-id", "11111111-2222-4333-8444-555555555555", "' or 1=1 --"]) {
      expect(await t.call({ ...u2, workspaceId }, "GET", "clients")).toEqual({ status: 403, json: { error: CHOOSE } });
      expect(await t.call({ ...u1, workspaceId }, "GET", "billing")).toEqual({ status: 403, json: { error: CHOOSE } });
    }
  });

  it("the routes that were left out are gone", async () => {
    const t = await setup();
    const gone: [string, string, Record<string, unknown>?][] = [
      ["POST", "clients", { name: "Typed in" }],
      ["GET", `client-projects/${t.client.id}`],
      ["POST", `client-projects/${t.client.id}`, { name: "Retainer" }],
      ["GET", "accounts-overview"],
      ["GET", "email-connection"],
      ["POST", "email-connection/save", {}],
      ["POST", "email-connection/authorize", {}],
      ["GET", "email-connection/callback"],
      ["POST", "workspaces/members", {}],
      ["POST", "workspaces/invite", { email: "x@example.com" }],
      ["POST", "workspaces/accept-invite", { token: "t" }],
      ["POST", "workspaces/remove-member", {}],
      ["POST", `agreements/${t.agreement.id}/ai-draft`, { requirements: "x" }],
    ];
    for (const [method, path, body] of gone) {
      const out = await t.call(u1, method, path, body ?? {});
      expect(out.status, `${method} ${path}`).toBe(404);
    }
  });
});
