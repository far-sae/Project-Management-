// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ACCESS_SECONDS,
  allowRequest,
  authorizationServerMetadata,
  CODE_SECONDS,
  REFRESH_GRACE_SECONDS,
  hashOf,
  isAllowedRedirect,
  protectedResourceMetadata,
  readAuthRequest,
  readClient,
  registerClient,
  SCOPE,
  token,
  whoIs,
  type AuthCode,
  type McpAuthStore,
  type OAuthDeps,
} from "../../../api/_mcp/oauth";

/**
 * How Claude gets permission to use one person's account: it registers,
 * the person presses Allow on our own page, Claude swaps the code for
 * tokens. Nothing here touches the network or a database.
 */

const SITE = "https://app.example.test";
const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
const ORG = "0b000000-0000-4000-8000-000000000001";
const USER = "0c000000-0000-4000-8000-000000000001";

const verifier = "v".repeat(64);
const challenge = createHash("sha256").update(verifier).digest("base64url");

function world() {
  const state = { now: new Date("2026-11-27T10:00:00Z") };
  const codes = new Map<string, AuthCode & { usedAt: string | null }>();
  const connections = new Map<string, { id: string; organizationId: string; userId: string; clientName: string; clientHash: string; revokedAt: string | null; lastUsedAt: string | null }>();
  const tokens = new Map<string, { connectionId: string; kind: "access" | "refresh"; expiresAt: string; usedAt: string | null }>();
  let n = 0;
  const store: McpAuthStore = {
    saveCode: async (code) => void codes.set(code.hash, { ...code, usedAt: null }),
    takeCode: async (hash, now) => {
      const c = codes.get(hash);
      if (!c || c.usedAt || c.expiresAt <= now) return null;
      c.usedAt = now;
      return c;
    },
    retireConnections: async (c, now) => {
      for (const conn of connections.values()) if (conn.organizationId === c.organizationId && conn.userId === c.userId && conn.clientName === c.clientName && !conn.revokedAt) conn.revokedAt = now;
    },
    createConnection: async (c) => {
      const id = `conn-${++n}`;
      connections.set(id, { id, ...c, revokedAt: null, lastUsedAt: null });
      return id;
    },
    saveToken: async (t) => void tokens.set(t.hash, { connectionId: t.connectionId, kind: t.kind, expiresAt: t.expiresAt, usedAt: null }),
    takeRefresh: async (hash, now, clientHash) => {
      const t = tokens.get(hash);
      if (!t || t.kind !== "refresh") return null;
      const conn = connections.get(t.connectionId);
      if (!conn || conn.revokedAt) return null;
      if (clientHash && conn.clientHash !== clientHash) return null;
      if (t.usedAt) return { connectionId: t.connectionId, again: true, usedAt: t.usedAt };
      if (t.expiresAt <= now) return null;
      t.usedAt = now;
      return { connectionId: t.connectionId, again: false, usedAt: now };
    },
    readAccess: async (hash, now) => {
      const t = tokens.get(hash);
      if (!t || t.kind !== "access" || t.expiresAt <= now) return null;
      const conn = connections.get(t.connectionId);
      if (!conn || conn.revokedAt) return null;
      return { connectionId: conn.id, organizationId: conn.organizationId, userId: conn.userId };
    },
    revokeConnection: async (id, now) => {
      const conn = connections.get(id);
      if (conn) conn.revokedAt = now;
    },
    touchConnection: async (id, now) => {
      const conn = connections.get(id);
      if (conn) conn.lastUsedAt = now;
    },
  };
  const deps: OAuthDeps = { store, secret: "server-secret-for-tests", site: SITE, now: () => state.now };
  const client = (redirects = [CLAUDE], name = "Claude") => {
    const out = registerClient(deps, { redirect_uris: redirects, client_name: name });
    if (out.status !== 201) throw new Error("not registered");
    return (out.json as { client_id: string }).client_id;
  };
  const ask = (clientId: string, over: Record<string, string> = {}) => ({
    response_type: "code", client_id: clientId, redirect_uri: CLAUDE, code_challenge: challenge, code_challenge_method: "S256", state: "st-1", resource: `${SITE}/api/mcp`, ...over,
  });
  /** The person presses Allow; the code Claude is sent back with. */
  const allow = async (clientId: string, over: Record<string, string> = {}) => {
    const out = await allowRequest(deps, ask(clientId, over), { organizationId: ORG, userId: USER });
    if (!out.ok) throw new Error(out.problem);
    return new URL(out.redirect).searchParams.get("code") ?? "";
  };
  const swap = (clientId: string, code: string, over: Record<string, string> = {}) =>
    token(deps, { grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: CLAUDE, resource: `${SITE}/api/mcp`, ...over });
  return { state, codes, connections, tokens, store, deps, client, ask, allow, swap };
}

type Tokens = { access_token: string; refresh_token: string; expires_in: number; token_type: string; scope: string };

describe("the connector's sign-in: what Claude is told about us", () => {
  it("says where to ask for permission, for the address the person typed", () => {
    expect(protectedResourceMetadata(SITE)).toEqual({ resource: `${SITE}/api/mcp`, authorization_servers: [SITE], scopes_supported: [SCOPE], bearer_methods_supported: ["header"] });
  });

  it("describes the sign-in server: the code flow only, with the proof key, and registering by itself", () => {
    const m = authorizationServerMetadata(SITE);
    expect(m).toMatchObject({
      issuer: SITE,
      authorization_endpoint: `${SITE}/connect/authorize`,
      token_endpoint: `${SITE}/api/mcp/token`,
      registration_endpoint: `${SITE}/api/mcp/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [SCOPE],
    });
  });
});

describe("the connector's sign-in: who may register", () => {
  it("takes Claude's own return address, and a program on this computer (Claude Code)", () => {
    expect(isAllowedRedirect(CLAUDE)).toBe(true);
    expect(isAllowedRedirect("https://claude.com/api/mcp/auth_callback")).toBe(true);
    expect(isAllowedRedirect("http://localhost:3118/callback")).toBe(true);
    expect(isAllowedRedirect("http://127.0.0.1:51234/callback")).toBe(true);
  });

  it("refuses every other return address, look-alikes included", () => {
    for (const bad of [
      "https://claude.ai.evil.test/api/mcp/auth_callback",
      "https://evil.test/api/mcp/auth_callback",
      "http://claude.ai/api/mcp/auth_callback",
      "https://claude.ai/api/mcp/auth_callback?next=https://evil.test",
      "https://user@claude.ai/api/mcp/auth_callback",
      "http://localhost.evil.test/callback",
      "http://localhost:3118/other",
      "https://localhost:3118/callback",
      "javascript:alert(1)",
      "",
    ]) expect(isAllowedRedirect(bad), bad).toBe(false);
  });

  it("gives a client its id, and reads the same client back from that id alone", () => {
    const w = world();
    const out = registerClient(w.deps, { redirect_uris: [CLAUDE], client_name: "Claude", token_endpoint_auth_method: "none" });
    expect(out.status).toBe(201);
    const json = out.json as { client_id: string; redirect_uris: string[]; token_endpoint_auth_method: string; client_name: string };
    expect(json).toMatchObject({ redirect_uris: [CLAUDE], token_endpoint_auth_method: "none", client_name: "Claude", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] });
    expect(readClient(w.deps, json.client_id)).toEqual({ redirectUris: [CLAUDE], name: "Claude" });
  });

  it("refuses a registration with a return address that is not Claude's", () => {
    const w = world();
    const out = registerClient(w.deps, { redirect_uris: [CLAUDE, "https://evil.test/cb"], client_name: "Claude" });
    expect(out.status).toBe(400);
    expect(out.json).toMatchObject({ error: "invalid_redirect_uri" });
    expect(registerClient(w.deps, { client_name: "x" }).status).toBe(400);
    expect(registerClient(w.deps, { redirect_uris: [] }).status).toBe(400);
  });

  it("does not accept a client id that was changed or made up", () => {
    const w = world();
    const id = w.client();
    const [head, body, sig] = id.split(".");
    const forged = Buffer.from(JSON.stringify({ r: ["https://evil.test/cb"], n: "Claude", t: 1 })).toString("base64url");
    expect(readClient(w.deps, `${head}.${forged}.${sig}`)).toBeNull();
    expect(readClient(w.deps, `${head}.${body}.${"A".repeat(sig.length)}`)).toBeNull();
    expect(readClient(w.deps, "nonsense")).toBeNull();
    expect(readClient({ ...w.deps, secret: "another-secret" }, id)).toBeNull();
  });

  it("keeps a long or odd client name short and plain", () => {
    const w = world();
    const id = w.client([CLAUDE], `  Claude\n<script>${"x".repeat(300)}`);
    const name = readClient(w.deps, id)?.name ?? "";
    expect(name.length).toBeLessThanOrEqual(60);
    expect(name).not.toMatch(/[\n<>]/);
  });
});

describe("the connector's sign-in: the request the person is shown", () => {
  it("reads a good request, and says who is asking from the return address, not from the name it gave", () => {
    const w = world();
    const out = readAuthRequest(w.deps, w.ask(w.client([CLAUDE], "Totally Your Bank")));
    expect(out).toMatchObject({ ok: true, from: "claude", redirectUri: CLAUDE, state: "st-1" });
    const local = readAuthRequest(w.deps, w.ask(w.client(["http://localhost:3118/callback"]), { redirect_uri: "http://localhost:40000/callback" }));
    expect(local).toMatchObject({ ok: true, from: "this_computer" });
  });

  it("never sends the person anywhere for an unknown client or return address", () => {
    const w = world();
    expect(readAuthRequest(w.deps, w.ask("made-up"))).toMatchObject({ ok: false, redirect: null });
    expect(readAuthRequest(w.deps, w.ask(w.client(), { redirect_uri: "https://claude.com/api/mcp/auth_callback" }))).toMatchObject({ ok: false, redirect: null });
  });

  it("sends a wrong request back to Claude with the reason, once the return address is known to be Claude's", () => {
    const w = world();
    const id = w.client();
    const noKey = readAuthRequest(w.deps, w.ask(id, { code_challenge: "" }));
    expect(noKey.ok).toBe(false);
    if (!noKey.ok) {
      const back = new URL(noKey.redirect ?? "");
      expect(back.origin + back.pathname).toBe(CLAUDE);
      expect(back.searchParams.get("error")).toBe("invalid_request");
      expect(back.searchParams.get("state")).toBe("st-1");
    }
    expect(readAuthRequest(w.deps, w.ask(id, { code_challenge_method: "plain" })).ok).toBe(false);
    expect(readAuthRequest(w.deps, w.ask(id, { response_type: "token" })).ok).toBe(false);
    // A permission asked for another server is not ours to give.
    expect(readAuthRequest(w.deps, w.ask(id, { resource: "https://other.example.test/api/mcp" })).ok).toBe(false);
  });

  it("accepts our address with or without the last slash, and a request that names no server", () => {
    const w = world();
    const id = w.client();
    expect(readAuthRequest(w.deps, w.ask(id, { resource: `${SITE}/api/mcp/` })).ok).toBe(true);
    const { resource: _r, ...rest } = w.ask(id);
    expect(readAuthRequest(w.deps, rest).ok).toBe(true);
  });
});

describe("the connector's sign-in: Allow, then the tokens", () => {
  it("sends Claude back with a code and its own state, and keeps only a fingerprint of the code", async () => {
    const w = world();
    const out = await allowRequest(w.deps, w.ask(w.client()), { organizationId: ORG, userId: USER });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const back = new URL(out.redirect);
    expect(back.origin + back.pathname).toBe(CLAUDE);
    expect(back.searchParams.get("state")).toBe("st-1");
    const code = back.searchParams.get("code") ?? "";
    expect(code.length).toBeGreaterThan(30);
    expect([...w.codes.keys()]).toEqual([hashOf(code)]);
    expect(JSON.stringify([...w.codes.values()])).not.toContain(code);
  });

  it("swaps the code for an access token and a refresh token, once", async () => {
    const w = world();
    const id = w.client();
    const code = await w.allow(id);
    const out = await w.swap(id, code);
    expect(out.status).toBe(200);
    const t = out.json as Tokens;
    expect(t).toMatchObject({ token_type: "Bearer", expires_in: ACCESS_SECONDS, scope: SCOPE });
    expect(await whoIs(w.deps, t.access_token)).toMatchObject({ organizationId: ORG, userId: USER });
    expect([...w.connections.values()]).toMatchObject([{ organizationId: ORG, userId: USER, clientName: "Claude" }]);
    // Tokens are kept as fingerprints only.
    expect(JSON.stringify([...w.tokens.entries()])).not.toContain(t.access_token);
    expect(JSON.stringify([...w.tokens.entries()])).not.toContain(t.refresh_token);
    // The same code a second time gives nothing.
    expect(await w.swap(id, code)).toMatchObject({ status: 400, json: { error: "invalid_grant" } });
  });

  it("refuses the code without the right proof key, for another client, another return address, or too late", async () => {
    const w = world();
    const id = w.client();
    expect(await w.swap(id, await w.allow(id), { code_verifier: "w".repeat(64) })).toMatchObject({ status: 400, json: { error: "invalid_grant" } });
    expect(await w.swap(id, await w.allow(id), { code_verifier: "" })).toMatchObject({ status: 400 });
    expect(await w.swap(w.client([CLAUDE], "Other"), await w.allow(id))).toMatchObject({ status: 400, json: { error: "invalid_grant" } });
    expect(await w.swap(id, await w.allow(id), { redirect_uri: "https://claude.com/api/mcp/auth_callback" })).toMatchObject({ status: 400, json: { error: "invalid_grant" } });
    const late = await w.allow(id);
    w.state.now = new Date(w.state.now.getTime() + (CODE_SECONDS + 1) * 1000);
    expect(await w.swap(id, late)).toMatchObject({ status: 400, json: { error: "invalid_grant" } });
    expect(w.connections.size).toBe(0);
  });

  it("stops the access token after its hour, and gives a new pair for the refresh token", async () => {
    const w = world();
    const id = w.client();
    const first = (await w.swap(id, await w.allow(id))).json as Tokens;
    w.state.now = new Date(w.state.now.getTime() + (ACCESS_SECONDS + 1) * 1000);
    expect(await whoIs(w.deps, first.access_token)).toBeNull();
    const again = await token(w.deps, { grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: id });
    expect(again.status).toBe(200);
    const second = again.json as Tokens;
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(await whoIs(w.deps, second.access_token)).toMatchObject({ userId: USER });
    expect(w.connections.size).toBe(1);
  });

  it("cuts the whole connection when an already used refresh token comes back (it was copied)", async () => {
    const w = world();
    const id = w.client();
    const first = (await w.swap(id, await w.allow(id))).json as Tokens;
    const second = (await token(w.deps, { grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: id })).json as Tokens;
    w.state.now = new Date(w.state.now.getTime() + (REFRESH_GRACE_SECONDS + 1) * 1000);
    expect(await token(w.deps, { grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: id })).toMatchObject({ status: 400, json: { error: "invalid_grant" } });
    expect(await whoIs(w.deps, second.access_token)).toBeNull();
    expect(await token(w.deps, { grant_type: "refresh_token", refresh_token: second.refresh_token, client_id: id })).toMatchObject({ status: 400, json: { error: "invalid_grant" } });
  });

  it("does not cut the connection when the same refresh token comes twice within a minute (Claude asked twice at once)", async () => {
    const w = world();
    const id = w.client();
    const first = (await w.swap(id, await w.allow(id))).json as Tokens;
    const second = (await token(w.deps, { grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: id })).json as Tokens;
    w.state.now = new Date(w.state.now.getTime() + 5_000);
    // The second ask gets nothing, but the pair the first ask got still works.
    expect(await token(w.deps, { grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: id })).toMatchObject({ status: 400, json: { error: "invalid_grant" } });
    expect(await whoIs(w.deps, second.access_token)).toMatchObject({ userId: USER });
    expect((await token(w.deps, { grant_type: "refresh_token", refresh_token: second.refresh_token, client_id: id })).status).toBe(200);
  });

  it("gives a refresh token nothing in the hands of another client", async () => {
    const w = world();
    const id = w.client();
    const t = (await w.swap(id, await w.allow(id))).json as Tokens;
    w.state.now = new Date(w.state.now.getTime() + 2_000);
    const other = w.client([CLAUDE], "Claude");
    expect(other).not.toBe(id);
    expect(await token(w.deps, { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: other })).toMatchObject({ status: 400, json: { error: "invalid_grant" } });
    expect(await token(w.deps, { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: "made-up" })).toMatchObject({ status: 400 });
    // The real client is not punished for somebody else's try: its pass still works, and so does its refresh.
    expect(await whoIs(w.deps, t.access_token)).toMatchObject({ userId: USER });
    expect((await token(w.deps, { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: id })).status).toBe(200);
  });

  it("ends a person's earlier connection of the same client when they connect again", async () => {
    const w = world();
    const id = w.client();
    const old = (await w.swap(id, await w.allow(id))).json as Tokens;
    w.state.now = new Date(w.state.now.getTime() + 60_000);
    const again = w.client();
    const fresh = (await w.swap(again, await w.allow(again), {})).json as Tokens;
    expect(await whoIs(w.deps, old.access_token)).toBeNull();
    expect(await whoIs(w.deps, fresh.access_token)).toMatchObject({ userId: USER });
    expect([...w.connections.values()].filter((c) => !c.revokedAt)).toHaveLength(1);
  });

  it("gives nothing after the person disconnected", async () => {
    const w = world();
    const id = w.client();
    const t = (await w.swap(id, await w.allow(id))).json as Tokens;
    await w.store.revokeConnection([...w.connections.keys()][0], w.state.now.toISOString());
    expect(await whoIs(w.deps, t.access_token)).toBeNull();
    expect(await token(w.deps, { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: id })).toMatchObject({ status: 400, json: { error: "invalid_grant" } });
  });

  it("answers the token address in the words the standard asks for", async () => {
    const w = world();
    expect(await token(w.deps, { grant_type: "password" })).toMatchObject({ status: 400, json: { error: "unsupported_grant_type" } });
    expect(await token(w.deps, { grant_type: "authorization_code" })).toMatchObject({ status: 400, json: { error: "invalid_request" } });
    expect(await token(w.deps, { grant_type: "refresh_token", refresh_token: "made-up" })).toMatchObject({ status: 400, json: { error: "invalid_grant" } });
    expect(await whoIs(w.deps, "")).toBeNull();
    expect(await whoIs(w.deps, "made-up")).toBeNull();
  });
});
