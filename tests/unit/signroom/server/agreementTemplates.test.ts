// @vitest-environment node
import { describe, expect, it } from "vitest";
import { agreementAction, createAgreement, getAgreement } from "../../../../api/_signroom/agreements";
import { StoreError } from "../../../../api/_signroom/errors";
import { route } from "../../../../api/_signroom/router";
import { MORE_MISSING_MESSAGE } from "../../../../api/_signroom/setupMessages";
import type { Agreement, AgreementTemplate, AgreementTemplateSummary } from "../../../../api/_signroom/shared/types";
import type { Store } from "../../../../api/_signroom/store";
import { companyClient, ORG2, seededStore, withMemberRole, WS, WS2 } from "./helpers";

/** Managing saved agreement templates: open one, rename it (every version), delete a version. */
const owner = { id: "u1", email: "owner@example.com", workspaceId: WS };
const member = { id: "m1", email: "member@example.com", workspaceId: WS };
const other = { id: "u2", email: "other@example.com", workspaceId: WS2 };
type User = typeof owner;

const call = (store: Store, user: User | null, method: string, path: string, body: Record<string, unknown> = {}) =>
  route({ mail: { store } as never }, { method, path: path.split("/"), query: {}, body, user, origin: "https://app.example.com" });
const NOT_FOUND = { status: 404, json: { error: "Template not found." } };

async function setup() {
  const store = seededStore(owner);
  withMemberRole(store, member.id);
  store.seedWorkspace({ id: WS2, organizationId: ORG2, name: "Other Studio" });
  store.setOrgMember(WS2, other.id, "admin");
  const client = await companyClient(store, owner);
  const draft = await createAgreement(store, owner, { clientId: client.id, type: "NDA", title: "Mutual NDA" });
  const saved = (await agreementAction(store, owner, draft.id, "save", { ...draft, content: "# Terms\n\nBody text." })) as Agreement;
  const template = (name: string) => agreementAction(store, owner, saved.id, "template", { name }) as Promise<AgreementTemplate>;
  const v1 = await template("NDA standard");
  const v2 = await template("NDA standard");
  const sow = await template("Statement of work");
  return { store, client, saved, v1, v2, sow };
}
const names = async (store: Store) =>
  ((await call(store, owner, "GET", "templates")).json as AgreementTemplateSummary[]).map((t) => `${t.name} v${t.version}`).sort();

describe("GET templates/:id", () => {
  it("gives any member of the workspace the whole template", async () => {
    const t = await setup();
    for (const user of [owner, member]) {
      const out = await call(t.store, user, "GET", `templates/${t.v2.id}`);
      expect(out.status).toBe(200);
      expect(out.json).toMatchObject({ id: t.v2.id, name: "NDA standard", type: "NDA", version: 2, content: "# Terms\n\nBody text.", roles: expect.any(Array), fields: expect.any(Array), workspaceId: WS });
    }
  });

  it("is 404 for an unknown id, a malformed id and another workspace's template", async () => {
    const t = await setup();
    expect(await call(t.store, owner, "GET", "templates/11111111-2222-4333-8444-555555555555")).toEqual(NOT_FOUND);
    expect(await call(t.store, owner, "GET", "templates/not-an-id")).toEqual(NOT_FOUND);
    expect(await call(t.store, other, "GET", `templates/${t.v1.id}`)).toEqual(NOT_FOUND);
  });

  it("needs a sign-in and a workspace the caller belongs to", async () => {
    const t = await setup();
    expect((await call(t.store, null, "GET", `templates/${t.v1.id}`)).status).toBe(401);
    expect((await call(t.store, { id: "x9", email: "x@example.com", workspaceId: WS }, "GET", `templates/${t.v1.id}`)).status).toBe(403);
  });
});

describe("POST templates/:id/rename", () => {
  it("renames every version of that template and answers with the summary", async () => {
    const t = await setup();
    const out = await call(t.store, member, "POST", `templates/${t.v1.id}/rename`, { name: "  NDA 2026  " });
    expect(out).toEqual({ status: 200, json: { id: t.v1.id, name: "NDA 2026", type: "NDA", version: 1, created: t.v1.created } });
    expect(await names(t.store)).toEqual(["NDA 2026 v1", "NDA 2026 v2", "Statement of work v1"]);
  });

  it("is 409 when another template already has the name, and nothing changes", async () => {
    const t = await setup();
    expect(await call(t.store, owner, "POST", `templates/${t.v1.id}/rename`, { name: "Statement of work" })).toEqual({
      status: 409,
      json: { error: "A template with that name already exists." },
    });
    expect(await names(t.store)).toEqual(["NDA standard v1", "NDA standard v2", "Statement of work v1"]);
  });

  it("keeping the same name is fine and changes nothing", async () => {
    const t = await setup();
    const out = await call(t.store, owner, "POST", `templates/${t.v2.id}/rename`, { name: "NDA standard" });
    expect(out.status).toBe(200);
    expect((out.json as AgreementTemplateSummary).name).toBe("NDA standard");
  });

  it("wants 1 to 120 characters after trimming", async () => {
    const t = await setup();
    const bad = { status: 400, json: { error: "Enter a template name of 1 to 120 characters." } };
    for (const name of ["", "   ", "x".repeat(121), 5, undefined, null, ["a"]]) {
      expect(await call(t.store, owner, "POST", `templates/${t.v1.id}/rename`, { name }), String(name)).toEqual(bad);
    }
    expect((await call(t.store, owner, "POST", `templates/${t.v1.id}/rename`, { name: "x".repeat(120) })).status).toBe(200);
  });

  it("is 404 for an unknown, malformed or other workspace's template, before the name is looked at", async () => {
    const t = await setup();
    expect(await call(t.store, owner, "POST", "templates/11111111-2222-4333-8444-555555555555/rename", { name: "" })).toEqual(NOT_FOUND);
    expect(await call(t.store, owner, "POST", "templates/not-an-id/rename", { name: "X" })).toEqual(NOT_FOUND);
    expect(await call(t.store, other, "POST", `templates/${t.v1.id}/rename`, { name: "Taken over" })).toEqual(NOT_FOUND);
    expect(await names(t.store)).toEqual(["NDA standard v1", "NDA standard v2", "Statement of work v1"]);
  });

  it("another workspace may use the same name: names are per workspace", async () => {
    const t = await setup();
    const theirClient = await companyClient(t.store, other, "Their client", "t@their.co");
    const theirs = await createAgreement(t.store, other, { clientId: theirClient.id, type: "NDA", title: "Theirs" });
    await agreementAction(t.store, other, theirs.id, "template", { name: "NDA 2026" });
    expect((await call(t.store, owner, "POST", `templates/${t.v1.id}/rename`, { name: "NDA 2026" })).status).toBe(200);
  });
});

describe("DELETE templates/:id", () => {
  it("an Owner deletes that version; the others stay", async () => {
    const t = await setup();
    expect(await call(t.store, owner, "DELETE", `templates/${t.v1.id}`)).toEqual({ status: 200, json: { ok: true } });
    expect(await names(t.store)).toEqual(["NDA standard v2", "Statement of work v1"]);
    expect(await call(t.store, owner, "GET", `templates/${t.v1.id}`)).toEqual(NOT_FOUND);
    expect(await call(t.store, owner, "DELETE", `templates/${t.v1.id}`)).toEqual(NOT_FOUND);
  });

  it("a Member is refused and nothing is deleted", async () => {
    const t = await setup();
    const out = await call(t.store, member, "DELETE", `templates/${t.v1.id}`);
    expect(out).toEqual({ status: 403, json: { error: "Only the workspace owner can do that." } });
    expect(await names(t.store)).toHaveLength(3);
  });

  it("is 404 for an unknown, malformed or other workspace's template", async () => {
    const t = await setup();
    expect(await call(t.store, owner, "DELETE", "templates/11111111-2222-4333-8444-555555555555")).toEqual(NOT_FOUND);
    expect(await call(t.store, owner, "DELETE", "templates/not-an-id")).toEqual(NOT_FOUND);
    expect(await call(t.store, other, "DELETE", `templates/${t.v1.id}`)).toEqual(NOT_FOUND);
    expect(await names(t.store)).toHaveLength(3);
  });

  it("an agreement made from the template keeps its own copy and still opens, saves and makes a new template", async () => {
    const t = await setup();
    const made = await createAgreement(t.store, owner, { clientId: t.client.id, type: "NDA", title: "From template", templateId: t.v2.id });
    expect(made.templateVersionId).toBe(t.v2.id);
    expect((await call(t.store, owner, "DELETE", `templates/${t.v2.id}`)).status).toBe(200);
    const after = await getAgreement(t.store, owner, made.id);
    expect(after.content).toBe("# Terms\n\nBody text.");
    expect(after.templateVersionId).toBe(t.v2.id);
    const saved = (await agreementAction(t.store, owner, made.id, "save", { ...after, title: "Still editable" })) as Agreement;
    expect(saved.title).toBe("Still editable");
    const again = (await agreementAction(t.store, owner, made.id, "template", { name: "NDA standard" })) as AgreementTemplate;
    // v1 is still there, so the next version of that name is 2 again.
    expect([again.name, again.version]).toEqual(["NDA standard", 2]);
    expect((await call(t.store, owner, "POST", "agreements", { clientId: t.client.id, type: "NDA", title: "Gone", templateId: t.v2.id })).status).toBe(404);
  });

  it("other methods and longer paths are plain 404s", async () => {
    const t = await setup();
    for (const [method, path] of [["PATCH", `templates/${t.v1.id}`], ["POST", `templates/${t.v1.id}`], ["GET", `templates/${t.v1.id}/rename`], ["POST", `templates/${t.v1.id}/explode`], ["DELETE", "templates"], ["DELETE", `templates/${t.v1.id}/rename`]]) {
      expect(await call(t.store, owner, method, path), `${method} ${path}`).toEqual({ status: 404, json: { error: "Not found." } });
    }
  });
});

describe("before migration 186 is run", () => {
  /** 184 alone: its trigger refuses every update and delete of a template with this sentence. */
  const frozen = (store: Store): Store => ({
    ...store,
    renameAgreementTemplate: async () => {
      throw new StoreError("Templates cannot change.");
    },
    deleteAgreementTemplate: async () => {
      throw new StoreError("Templates cannot change.");
    },
  });

  it("templates are still listed, opened, saved and used; rename and delete name the file to run", async () => {
    const t = await setup();
    const store = frozen(t.store);
    expect((await call(store, owner, "GET", "templates")).status).toBe(200);
    expect((await call(store, owner, "GET", `templates/${t.v1.id}`)).status).toBe(200);
    expect((await call(store, owner, "POST", `agreements/${t.saved.id}/template`, { name: "Another" })).status).toBe(200);
    expect((await call(store, owner, "POST", "agreements", { clientId: t.client.id, type: "NDA", title: "From template", templateId: t.v1.id })).status).toBe(200);
    const expected = { status: 503, json: { error: MORE_MISSING_MESSAGE } };
    expect(await call(store, owner, "POST", `templates/${t.v1.id}/rename`, { name: "New name" })).toEqual(expected);
    expect(await call(store, owner, "DELETE", `templates/${t.v1.id}`)).toEqual(expected);
  });
});
