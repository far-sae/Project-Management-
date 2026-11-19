// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fakeStore } from "../../../../api/_signroom/fakeStore";
import type { EmailOAuth, OAuthState } from "../../../../api/_signroom/store";

const H = (c: string) => c.repeat(64);
const conn = (o: Partial<EmailOAuth> = {}): EmailOAuth => ({
  workspaceId: "w1", id: "c1", revision: 2, provider: "google", email: "a@b.co", clientId: "cid", tenant: "", secretsEnc: "v1:xyz", status: "configured", ...o,
});
const state = (o: Partial<OAuthState> = {}): OAuthState => ({
  digest: H("a"), browserDigest: H("b"), workspaceId: "w1", userId: "u1", connectionId: "c1", revision: 2, verifierEnc: "v1:ver",
  redirectUri: "https://app.example.com/api/signroom/email-connection/callback", expires: 2_000_000, ...o,
});

describe("fake store: pending OAuth sign-ins", () => {
  it("takes a row once, then null", async () => {
    const s = fakeStore();
    await s.insertOAuthState(state());
    expect(await s.takeOAuthState(H("a"), H("b"), 1_000_000)).toEqual(state());
    expect(await s.takeOAuthState(H("a"), H("b"), 1_000_000)).toBeNull();
  });
  it("refuses a wrong browser digest and keeps the row", async () => {
    const s = fakeStore();
    await s.insertOAuthState(state());
    expect(await s.takeOAuthState(H("a"), H("c"), 1_000_000)).toBeNull();
    expect(s.oauthStates()).toHaveLength(1);
  });
  it("refuses an expired row, comparing with the now argument", async () => {
    const s = fakeStore();
    await s.insertOAuthState(state({ expires: 5000 }));
    expect(await s.takeOAuthState(H("a"), H("b"), 5000)).toBeNull();
    expect(await s.takeOAuthState(H("a"), H("b"), 4999)).not.toBeNull();
  });
  it("two takes of one state: one wins", async () => {
    const s = fakeStore();
    await s.insertOAuthState(state());
    const r = await Promise.all([s.takeOAuthState(H("a"), H("b"), 1), s.takeOAuthState(H("a"), H("b"), 1)]);
    expect(r.filter(Boolean)).toHaveLength(1);
  });
  it("insert removes that workspace's earlier pending row only", async () => {
    const s = fakeStore();
    await s.insertOAuthState(state());
    await s.insertOAuthState(state({ digest: H("d"), workspaceId: "w2" }));
    await s.insertOAuthState(state({ digest: H("e") }));
    expect(s.oauthStates().map((x) => x.digest).sort()).toEqual([H("d"), H("e")]);
  });
  it("purge removes rows expired before the given time", async () => {
    const s = fakeStore();
    await s.insertOAuthState(state({ expires: 100 }));
    await s.insertOAuthState(state({ digest: H("d"), workspaceId: "w2", expires: 900 }));
    await s.purgeOAuthStates(500);
    expect(s.oauthStates().map((x) => x.digest)).toEqual([H("d")]);
  });
  it("enforces the table's shapes", async () => {
    const s = fakeStore();
    await expect(s.insertOAuthState(state({ digest: "short" }))).rejects.toThrow();
    await expect(s.insertOAuthState(state({ browserDigest: "Z".repeat(64) }))).rejects.toThrow();
    await expect(s.insertOAuthState(state({ verifierEnc: "plain" }))).rejects.toThrow();
    await expect(s.insertOAuthState(state({ redirectUri: "http://evil.test/x" }))).rejects.toThrow();
  });
  it("allows plain http only for localhost itself, as the table does", async () => {
    const s = fakeStore();
    await s.insertOAuthState(state({ redirectUri: "http://localhost:8080/api/signroom/email-connection/callback" }));
    await s.insertOAuthState(state({ digest: H("d"), redirectUri: "http://localhost/api/signroom/email-connection/callback" }));
    for (const redirectUri of ["http://localhost.evil.com/x", "http://localhostevil.com/x", "http://localhost@evil.com/x"])
      await expect(s.insertOAuthState(state({ digest: H("e"), redirectUri })), redirectUri).rejects.toThrow();
  });
});

describe("fake store: email OAuth connection", () => {
  it("replace stores the row and removes the workspace's pending rows", async () => {
    const s = fakeStore();
    await s.insertOAuthState(state());
    await s.insertOAuthState(state({ digest: H("d"), workspaceId: "w2" }));
    await s.replaceEmailOAuth(conn());
    expect(await s.getEmailOAuth("w1")).toEqual(conn());
    expect(s.oauthStates().map((x) => x.workspaceId)).toEqual(["w2"]);
    await s.replaceEmailOAuth(conn({ id: "c2", revision: 3 }));
    expect(s.oauthRows()).toHaveLength(1);
  });
  it("delete removes the row and the workspace's pending rows", async () => {
    const s = fakeStore();
    await s.replaceEmailOAuth(conn());
    await s.insertOAuthState(state());
    await s.deleteEmailOAuth("w1");
    expect(await s.getEmailOAuth("w1")).toBeNull();
    expect(s.oauthStates()).toHaveLength(0);
  });
  it("refuses values the table would refuse", async () => {
    const s = fakeStore();
    await expect(s.replaceEmailOAuth(conn({ secretsEnc: "plain" }))).rejects.toThrow();
    await expect(s.replaceEmailOAuth(conn({ provider: "microsoft", tenant: "evil.example/x" }))).rejects.toThrow();
    await expect(s.replaceEmailOAuth(conn({ provider: "microsoft", tenant: "" }))).rejects.toThrow();
    await expect(s.replaceEmailOAuth(conn({ tenant: "common" }))).rejects.toThrow();
    await expect(s.replaceEmailOAuth(conn({ email: "A@b.co" }))).rejects.toThrow();
    await expect(s.replaceEmailOAuth(conn({ challenge: { digest: "nothex", expires: 1, attempts: 0 } }))).rejects.toThrow();
    await expect(s.replaceEmailOAuth(conn({ challenge: { digest: H("a"), expires: 1, attempts: 6 } }))).rejects.toThrow();
    await s.replaceEmailOAuth(conn({ provider: "microsoft", tenant: "contoso.com" }));
  });
  it("update applies on a matching id, revision and attempts", async () => {
    const s = fakeStore();
    await s.replaceEmailOAuth(conn({ challenge: { digest: H("a"), expires: 9, attempts: 1 } }));
    expect(await s.updateEmailOAuth("w1", { id: "c1", revision: 2, attempts: 1 }, { status: "verified", verifiedAt: "2026-11-17T00:00:00.000Z", challenge: null })).toBe(true);
    const r = await s.getEmailOAuth("w1");
    expect(r).toMatchObject({ status: "verified", verifiedAt: "2026-11-17T00:00:00.000Z", revision: 2 });
    expect(r?.challenge).toBeUndefined();
  });
  it("update returns false and changes nothing for a stale revision, id or attempts", async () => {
    const s = fakeStore();
    const c = conn({ challenge: { digest: H("a"), expires: 9, attempts: 1 } });
    await s.replaceEmailOAuth(c);
    expect(await s.updateEmailOAuth("w1", { id: "c1", revision: 1 }, { status: "verified" })).toBe(false);
    expect(await s.updateEmailOAuth("w1", { id: "other", revision: 2 }, { status: "verified" })).toBe(false);
    expect(await s.updateEmailOAuth("w1", { id: "c1", revision: 2, attempts: 0 }, { status: "verified" })).toBe(false);
    expect(await s.updateEmailOAuth("w2", { id: "c1", revision: 2 }, { status: "verified" })).toBe(false);
    expect(await s.updateEmailOAuth("w1", { id: "c1", revision: 2, status: "authenticated" }, { status: "verified" })).toBe(false);
    expect(await s.getEmailOAuth("w1")).toEqual(c);
    expect(await s.updateEmailOAuth("w1", { id: "c1", revision: 2, status: "configured" }, { lastError: "x" })).toBe(true);
  });
  it("update with null clears optional fields", async () => {
    const s = fakeStore();
    await s.replaceEmailOAuth(conn({ lastError: "x", lastTestAt: "t" }));
    await s.updateEmailOAuth("w1", { id: "c1", revision: 2 }, { lastError: null, lastTestAt: null });
    const r = await s.getEmailOAuth("w1");
    expect(r?.lastError).toBeUndefined();
    expect(r?.lastTestAt).toBeUndefined();
  });
});
