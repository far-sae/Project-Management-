// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CHOOSE_WORKSPACE_MESSAGE, currentWorkspace, orgRoleOf } from "../../../../api/_signroom/context";
import { fakeStore } from "../../../../api/_signroom/fakeStore";
import { ORG, ORG2, WS, WS2 } from "./helpers";

/** Tenancy = the TaskCalendar workspace named by X-Signroom-Workspace; membership = its organisation's. */

const user = (id: string, workspaceId: string | null = WS) => ({ id, email: `${id}@example.com`, ...(workspaceId === null ? {} : { workspaceId }) });

function setup() {
  const store = fakeStore();
  store.seedWorkspace({ id: WS, organizationId: ORG, name: "Design team", ownerId: "org-owner" });
  store.seedWorkspace({ id: WS2, organizationId: ORG2, name: "Other company" });
  store.setOrgMember(WS, "admin", "admin");
  store.setOrgMember(WS, "member", "member");
  store.setOrgMember(WS, "viewer", "viewer");
  store.setOrgMember(WS2, "elsewhere", "owner");
  return store;
}

const refused = async (p: Promise<unknown>) => {
  await expect(p).rejects.toMatchObject({ status: 403, message: CHOOSE_WORKSPACE_MESSAGE });
};

describe("orgRoleOf", () => {
  const members = [
    { userId: "a", role: "admin", status: "active" },
    { userId: "m", role: "member", status: "active" },
    { userId: "v", role: "viewer", status: "active" },
    { userId: "gone", role: "admin", status: "removed" },
    { userId: "invited", role: "member", status: "invited" },
    { userId: "legacy", role: "member" },
    { userId: "o", role: "owner", status: "active" },
  ];

  it("reads the role of an active member", () => {
    expect(orgRoleOf({ owner_id: "boss", members }, "a")).toBe("admin");
    expect(orgRoleOf({ owner_id: "boss", members }, "m")).toBe("member");
    expect(orgRoleOf({ owner_id: "boss", members }, "v")).toBe("viewer");
    expect(orgRoleOf({ owner_id: "boss", members }, "o")).toBe("owner");
  });

  it("the organisation's owner is an owner even without a members entry", () => {
    expect(orgRoleOf({ owner_id: "boss", members }, "boss")).toBe("owner");
    expect(orgRoleOf({ owner_id: "boss", members: null }, "boss")).toBe("owner");
  });

  it("a removed or only-invited person has no role; an entry with no status counts as active (as the app does)", () => {
    expect(orgRoleOf({ owner_id: "boss", members }, "gone")).toBeNull();
    expect(orgRoleOf({ owner_id: "boss", members }, "invited")).toBeNull();
    expect(orgRoleOf({ owner_id: "boss", members }, "legacy")).toBe("member");
  });

  it("an outsider, an unknown role and malformed members have no role", () => {
    expect(orgRoleOf({ owner_id: "boss", members }, "nobody")).toBeNull();
    expect(orgRoleOf({ owner_id: "boss", members: [{ userId: "x", role: "superuser", status: "active" }] }, "x")).toBeNull();
    expect(orgRoleOf({ owner_id: "boss", members: "not a list" }, "x")).toBeNull();
    expect(orgRoleOf({ owner_id: "boss", members: [null, 7, "x"] }, "x")).toBeNull();
    expect(orgRoleOf({ owner_id: null, members: [] }, "")).toBeNull();
  });

  it("with duplicate entries the highest active role wins and a removed one never counts", () => {
    const dup = [
      { userId: "d", role: "admin", status: "removed" },
      { userId: "d", role: "viewer", status: "active" },
      { userId: "d", role: "member", status: "active" },
    ];
    expect(orgRoleOf({ owner_id: "boss", members: dup }, "d")).toBe("member");
  });
});

describe("currentWorkspace", () => {
  it("an organisation owner or admin is a Signroom Owner", async () => {
    const store = setup();
    expect((await currentWorkspace(store, user("org-owner"))).role).toBe("Owner");
    expect((await currentWorkspace(store, user("admin"))).role).toBe("Owner");
    store.setOrgMember(WS, "listed-owner", "owner");
    expect((await currentWorkspace(store, user("listed-owner"))).role).toBe("Owner");
  });

  it("an organisation member is a Signroom Member, and is refused owner-only work", async () => {
    const store = setup();
    expect((await currentWorkspace(store, user("member"))).role).toBe("Member");
    await expect(currentWorkspace(store, user("member"), { owner: true })).rejects.toMatchObject({
      status: 403,
      message: "Only the workspace owner can do that.",
    });
    expect((await currentWorkspace(store, user("admin"), { owner: true })).role).toBe("Owner");
  });

  it("a viewer, an outsider and a member of another organisation are refused", async () => {
    const store = setup();
    await refused(currentWorkspace(store, user("viewer")));
    await refused(currentWorkspace(store, user("stranger")));
    await refused(currentWorkspace(store, user("elsewhere")));
    // The other organisation's admin in their own workspace is fine.
    expect((await currentWorkspace(store, user("elsewhere", WS2))).role).toBe("Owner");
    await refused(currentWorkspace(store, user("admin", WS2)));
  });

  it("the workspace header is required: none, a malformed one and an unknown workspace are refused", async () => {
    const store = setup();
    await refused(currentWorkspace(store, user("admin", null)));
    await refused(currentWorkspace(store, user("admin", "")));
    await refused(currentWorkspace(store, user("admin", "w1")));
    await refused(currentWorkspace(store, user("admin", "0a000000-0000-4000-8000-00000000ffff")));
    // No workspace was created for anyone along the way.
    expect((store.dump() as { workspaces: unknown[] }).workspaces).toHaveLength(0);
  });

  it("creates the Signroom workspace on first use with the TaskCalendar workspace's id and name, once", async () => {
    const store = setup();
    const first = await currentWorkspace(store, user("member"));
    expect(first.workspace.id).toBe(WS);
    expect(first.workspace.name).toBe("Design team");
    const second = await currentWorkspace(store, user("admin"));
    expect(second.workspace.id).toBe(WS);
    expect((store.dump() as { workspaces: unknown[] }).workspaces).toHaveLength(1);
  });

  it("a refused caller never creates the workspace row", async () => {
    const store = setup();
    await refused(currentWorkspace(store, user("viewer")));
    await refused(currentWorkspace(store, user("stranger")));
    expect((store.dump() as { workspaces: unknown[] }).workspaces).toHaveLength(0);
  });

  it("checks membership on every request: a removed person loses access at once", async () => {
    const store = setup();
    expect((await currentWorkspace(store, user("member"))).role).toBe("Member");
    store.setOrgMember(WS, "member", "member", "removed");
    await refused(currentWorkspace(store, user("member")));
    store.setOrgMember(WS, "admin", "viewer");
    await refused(currentWorkspace(store, user("admin")));
  });

  it("returns the user it was given", async () => {
    const store = setup();
    const u = user("admin");
    expect((await currentWorkspace(store, u)).user).toBe(u);
  });
});
