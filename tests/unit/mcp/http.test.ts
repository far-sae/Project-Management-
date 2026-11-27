// @vitest-environment node
import { createHash } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { describe, expect, it, vi } from "vitest";
import { mcpHandler, MAX_BODY_BYTES } from "../../../api/_mcp/entry";
import { handle, NOT_SET_UP_MESSAGE, NOT_YOURS_MESSAGE, type Action, type Connection, type ConnectionStore, type HttpRequest, type McpDeps } from "../../../api/_mcp/http";
import { SCOPE, type AuthCode, type McpAuthStore } from "../../../api/_mcp/oauth";
import { FAILED_MESSAGE, handleRpc, PROTOCOL_VERSIONS } from "../../../api/_mcp/rpc";
import { NO_ACCESS_MESSAGE, TOOLS, type EmailStore } from "../../../api/_mcp/tools";
import { warmupHandler } from "../../../api/email/warmup";

/**
 * The connector's addresses: what Claude may reach with and without a token,
 * what our own pages may reach, and what nobody else may. Nothing here
 * touches the network or a database.
 */

const SITE = "https://app.example.test";
const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
const ORG = "0b000000-0000-4000-8000-000000000001";
const WS = "0a000000-0000-4000-8000-000000000001";
const OWNER = "0c000000-0000-4000-8000-000000000001";
const MEMBER = "0c000000-0000-4000-8000-000000000003";
const OUTSIDER = "0c000000-0000-4000-8000-000000000009";

const verifier = "v".repeat(64);
const challenge = createHash("sha256").update(verifier).digest("base64url");

function world() {
  const state = { now: new Date("2026-11-27T10:00:00Z"), ready: true, n: 0 };
  const codes = new Map<string, AuthCode & { usedAt: string | null }>();
  const conns = new Map<string, Connection & { organizationId: string; revokedAt: string | null }>();
  const tokens = new Map<string, { connectionId: string; kind: "access" | "refresh"; expiresAt: string; usedAt: string | null }>();
  const actions: Action[] = [];
  const roles: Record<string, "owner" | "admin" | "member" | "viewer"> = { [OWNER]: "owner", [MEMBER]: "member" };
  const given: Record<string, string> = {};

  const auth: McpAuthStore & ConnectionStore = {
    ready: async () => state.ready,
    saveCode: async (c) => void codes.set(c.hash, { ...c, usedAt: null }),
    takeCode: async (hash, now) => {
      const c = codes.get(hash);
      if (!c || c.usedAt || c.expiresAt <= now) return null;
      c.usedAt = now;
      return c;
    },
    retireConnections: async () => {},
    createConnection: async ({ clientHash: _h, ...c }) => {
      const id = `0e300000-0000-4000-8000-${String(++state.n).padStart(12, "0")}`;
      conns.set(id, { id, ...c, createdAt: state.now.toISOString(), lastUsedAt: null, revokedAt: null });
      return id;
    },
    saveToken: async (t) => void tokens.set(t.hash, { connectionId: t.connectionId, kind: t.kind, expiresAt: t.expiresAt, usedAt: null }),
    takeRefresh: async () => null,
    readAccess: async (hash, now) => {
      const t = tokens.get(hash);
      const c = t ? conns.get(t.connectionId) : undefined;
      return t && c && t.kind === "access" && t.expiresAt > now && !c.revokedAt ? { connectionId: c.id, organizationId: c.organizationId, userId: c.userId } : null;
    },
    revokeConnection: async (id, now) => {
      const c = conns.get(id);
      if (c) c.revokedAt = now;
    },
    touchConnection: async (id, now) => {
      const c = conns.get(id);
      if (c) c.lastUsedAt = now;
    },
    connections: async (org) => [...conns.values()].filter((c) => c.organizationId === org && !c.revokedAt).map(({ organizationId: _o, revokedAt: _r, ...rest }) => rest),
    connection: async (id) => {
      const c = conns.get(id);
      return c && !c.revokedAt ? c : null;
    },
    actions: async () => actions,
  };
  // Only what these tests reach of the Email area; tools.test.ts covers the rest.
  const email = {
    orgRole: async (org: string, user: string) => (org === ORG ? roles[user] ?? null : null),
    emailGiven: async (_org: string, user: string) => given[user] ?? null,
    workspaces: async () => [{ id: WS, name: "Northwind Studio" }],
    memberWorkspaceIds: async () => [WS],
    ownOnly: async () => false,
    mailboxes: async () => [],
    countContacts: async () => 3,
  } as unknown as EmailStore;
  const deps: McpDeps = { auth, email, secret: "server-secret-for-tests", now: () => state.now, onFault: vi.fn() };

  const call = (over: Partial<HttpRequest> & { user?: string | null }) =>
    handle(deps, { method: "GET", route: "", authorization: "", origin: "", query: {}, body: {}, site: SITE, ownPage: false, signedIn: async () => (over.user ? { id: over.user } : null), ...over });

  const params = async () => {
    const reg = await call({ method: "POST", route: "register", body: { redirect_uris: [CLAUDE], client_name: "Claude" } });
    return { response_type: "code", client_id: (reg.json as { client_id: string }).client_id, redirect_uri: CLAUDE, code_challenge: challenge, code_challenge_method: "S256", state: "st-1", resource: `${SITE}/api/mcp` };
  };
  /** The whole road: register, Allow as this person, swap the code. The access token. */
  const connect = async (user = OWNER) => {
    const p = await params();
    const allowed = await call({ method: "POST", route: "consent", ownPage: true, user, body: { action: "allow", params: p, organizationId: ORG } });
    const code = new URL((allowed.json as { redirect: string }).redirect).searchParams.get("code") ?? "";
    const swapped = await call({ method: "POST", route: "token", body: { grant_type: "authorization_code", code, code_verifier: verifier, client_id: p.client_id, redirect_uri: CLAUDE } });
    return (swapped.json as { access_token: string }).access_token;
  };
  const rpc = (accessToken: string, message: unknown, over: Partial<HttpRequest> = {}) => call({ method: "POST", route: "rpc", authorization: `Bearer ${accessToken}`, body: message, ...over });
  return { state, codes, conns, tokens, actions, roles, given, deps, call, params, connect, rpc };
}

describe("the connector: what Claude finds without a token", () => {
  it("is told to get permission, and where, when it has no token or a wrong one", async () => {
    const w = world();
    for (const authorization of ["", "Bearer made-up", "Basic abc"]) {
      const out = await w.call({ method: "POST", route: "rpc", authorization, body: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
      expect(out.status).toBe(401);
      expect(out.headers?.["WWW-Authenticate"]).toBe(`Bearer resource_metadata="${SITE}/.well-known/oauth-protected-resource/api/mcp", scope="${SCOPE}"`);
    }
  });

  it("answers the two addresses that say how to connect", async () => {
    const w = world();
    expect((await w.call({ route: "well-known/protected-resource" })).json).toMatchObject({ resource: `${SITE}/api/mcp`, authorization_servers: [SITE] });
    expect((await w.call({ route: "well-known/authorization-server" })).json).toMatchObject({ issuer: SITE, token_endpoint: `${SITE}/api/mcp/token`, code_challenge_methods_supported: ["S256"] });
    expect((await w.call({ method: "POST", route: "well-known/protected-resource" })).status).toBe(405);
  });

  it("has no stream to open: only POST reaches the connector", async () => {
    const w = world();
    for (const method of ["GET", "DELETE", "PUT"]) expect(await w.call({ method, route: "rpc" })).toMatchObject({ status: 405, headers: { Allow: "POST" } });
    expect((await w.call({ method: "GET", route: "token" })).status).toBe(405);
    expect((await w.call({ method: "GET", route: "register" })).status).toBe(405);
    expect((await w.call({ route: "nothing-here" })).status).toBe(404);
  });

  it("refuses a browser page that is not Claude's or ours", async () => {
    const w = world();
    const t = await w.connect();
    const list = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    expect((await w.rpc(t, list, { origin: "https://evil.example.test" })).status).toBe(403);
    expect((await w.rpc(t, list, { origin: "https://claude.ai" })).status).toBe(200);
    expect((await w.rpc(t, list, { origin: SITE })).status).toBe(200);
    expect((await w.rpc(t, list)).status).toBe(200);
  });
});

describe("the connector: the Allow page", () => {
  it("is for our own pages and a signed-in person only", async () => {
    const w = world();
    const p = await w.params();
    expect((await w.call({ method: "POST", route: "consent", ownPage: false, user: OWNER, body: { action: "allow", params: p, organizationId: ORG } })).status).toBe(403);
    expect((await w.call({ method: "POST", route: "consent", ownPage: true, user: null, body: { action: "allow", params: p, organizationId: ORG } })).status).toBe(401);
    expect(w.codes.size).toBe(0);
  });

  it("shows who is asking and which workspaces Claude would reach, without connecting anything", async () => {
    const w = world();
    const out = await w.call({ method: "POST", route: "consent", ownPage: true, user: OWNER, body: { action: "check", params: await w.params(), organizationId: ORG } });
    expect(out.json).toMatchObject({ ok: true, allowed: true, from: "claude", clientName: "Claude", workspaces: ["Northwind Studio"] });
    expect((out.json as { deny: string }).deny).toBe(`${CLAUDE}?error=access_denied&state=st-1`);
    expect(w.codes.size).toBe(0);
  });

  it("gives no code to a person who may not use Email, or who is not in the organisation", async () => {
    const w = world();
    const p = await w.params();
    for (const user of [MEMBER, OUTSIDER]) {
      const out = await w.call({ method: "POST", route: "consent", ownPage: true, user, body: { action: "allow", params: p, organizationId: ORG } });
      expect(out.json).toMatchObject({ ok: true, allowed: false, problem: NO_ACCESS_MESSAGE });
    }
    expect(w.codes.size).toBe(0);
    w.given[MEMBER] = "use";
    expect((await w.call({ method: "POST", route: "consent", ownPage: true, user: MEMBER, body: { action: "allow", params: p, organizationId: ORG } })).json).toMatchObject({ ok: true, redirect: expect.stringContaining("code=") });
  });

  it("sends nobody anywhere for a request that did not come from Claude", async () => {
    const w = world();
    const p = { ...(await w.params()), redirect_uri: "https://evil.example.test/cb" };
    const out = await w.call({ method: "POST", route: "consent", ownPage: true, user: OWNER, body: { action: "allow", params: p, organizationId: ORG } });
    expect(out.json).toMatchObject({ ok: false, redirect: null });
    expect(w.codes.size).toBe(0);
  });

  it("says it is not set up yet while the tables are missing, to the page and to Claude", async () => {
    const w = world();
    w.state.ready = false;
    const out = await w.call({ method: "POST", route: "consent", ownPage: true, user: OWNER, body: { action: "check", params: await w.params(), organizationId: ORG } });
    expect(out.json).toMatchObject({ ok: false, notSetUp: true, problem: NOT_SET_UP_MESSAGE });
    expect((await w.call({ method: "POST", route: "token", body: { grant_type: "authorization_code" } })).status).toBe(503);
    expect((await w.call({ route: "connections", ownPage: true, user: OWNER, query: { organizationId: ORG } })).json).toMatchObject({ ready: false, address: `${SITE}/api/mcp`, connections: [] });
  });
});

describe("the connector: talking to Claude", () => {
  it("greets Claude, lists the tools and runs one, for the person who pressed Allow", async () => {
    const w = world();
    const t = await w.connect();
    const hello = await w.rpc(t, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-ai", version: "1" } } });
    expect(hello.json).toMatchObject({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "taskcalendar-email" } } });
    expect((hello.json as { result: { instructions: string } }).result.instructions).toContain("only after their yes");
    expect(await w.rpc(t, { jsonrpc: "2.0", method: "notifications/initialized" })).toMatchObject({ status: 202, json: undefined });

    const list = (await w.rpc(t, { jsonrpc: "2.0", id: 2, method: "tools/list" })).json as { result: { tools: Array<{ name: string; inputSchema: unknown; annotations: Record<string, unknown> }> } };
    expect(list.result.tools.map((x) => x.name)).toEqual(TOOLS.map((x) => x.name));
    expect(list.result.tools.find((x) => x.name === "send_campaign")?.annotations).toMatchObject({ title: "Send the campaign", destructiveHint: true });
    expect(JSON.stringify(list.result.tools)).not.toContain("run");

    const called = (await w.rpc(t, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_workspaces", arguments: {} } })).json as { result: { content: Array<{ type: string; text: string }>; isError: boolean } };
    expect(called.result.isError).toBe(false);
    expect(JSON.parse(called.result.content[0].text)).toMatchObject({ workspaces: [{ id: WS, name: "Northwind Studio", leads_with_email: 3 }] });
    expect([...w.conns.values()][0].lastUsedAt).toBe(w.state.now.toISOString());
  });

  it("speaks our newest version to a client that asks for one we do not know", async () => {
    const w = world();
    const out = await w.rpc(await w.connect(), { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } });
    expect((out.json as { result: { protocolVersion: string } }).result.protocolVersion).toBe(PROTOCOL_VERSIONS[0]);
  });

  it("answers what it does not know in the protocol's own words", async () => {
    const w = world();
    const t = await w.connect();
    expect((await w.rpc(t, { jsonrpc: "2.0", id: 1, method: "resources/list" })).json).toMatchObject({ error: { code: -32601 } });
    expect((await w.rpc(t, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "drop_everything" } })).json).toMatchObject({ error: { code: -32602 } });
    expect(await w.rpc(t, [{ jsonrpc: "2.0", id: 1, method: "ping" }])).toMatchObject({ status: 400, json: { error: { code: -32600 } } });
    expect(await w.rpc(t, { id: 1, method: "ping" })).toMatchObject({ status: 400 });
    expect((await w.rpc(t, { jsonrpc: "2.0", id: 9, method: "ping" })).json).toEqual({ jsonrpc: "2.0", id: 9, result: {} });
  });

  it("passes a refusal on as a sentence, and keeps a real fault to itself", async () => {
    const w = world();
    const t = await w.connect();
    w.roles[OWNER] = "viewer";
    const refused = (await w.rpc(t, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_workspaces" } })).json as { result: { content: Array<{ text: string }>; isError: boolean } };
    expect(refused.result).toEqual({ content: [{ type: "text", text: NO_ACCESS_MESSAGE }], isError: true });

    const onFault = vi.fn();
    const broken = { orgRole: async () => { throw new Error("relation crm_contacts is locked by pid 4411"); } } as unknown as EmailStore;
    const out = await handleRpc({ store: broken, site: SITE }, { organizationId: ORG, userId: OWNER, connectionId: "c" }, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_workspaces" } }, onFault);
    expect(out.json).toMatchObject({ result: { content: [{ type: "text", text: FAILED_MESSAGE }], isError: true } });
    expect(JSON.stringify(out.json)).not.toContain("pid");
    expect(onFault).toHaveBeenCalledTimes(1);
  });
});

describe("the connector: what is connected", () => {
  it("lists a person's own connections, and every one for the owner", async () => {
    const w = world();
    w.given[MEMBER] = "use";
    await w.connect(OWNER);
    await w.connect(MEMBER);
    w.actions.push({ at: w.state.now.toISOString(), userId: OWNER, summary: "Prepared a campaign" });
    const own = (await w.call({ route: "connections", ownPage: true, user: MEMBER, query: { organizationId: ORG } })).json as { connections: Connection[]; actions: Action[]; mayConnect: boolean };
    expect(own.connections.map((c) => c.userId)).toEqual([MEMBER]);
    expect(own.actions).toEqual([]);
    expect(own.mayConnect).toBe(true);
    const all = (await w.call({ route: "connections", ownPage: true, user: OWNER, query: { organizationId: ORG } })).json as { connections: Connection[]; actions: Action[]; address: string };
    expect(all.connections).toHaveLength(2);
    expect(all.actions).toHaveLength(1);
    expect(all.address).toBe(`${SITE}/api/mcp`);
    expect(JSON.stringify(all)).not.toMatch(/tca_|tcr_/);
    expect((await w.call({ route: "connections", ownPage: true, user: OUTSIDER, query: { organizationId: ORG } })).status).toBe(403);
    expect((await w.call({ route: "connections", ownPage: false, user: OWNER, query: { organizationId: ORG } })).status).toBe(403);
  });

  it("lets a person cut their own connection, the owner cut anybody's, and nobody else", async () => {
    const w = world();
    w.given[MEMBER] = "use";
    const ownerToken = await w.connect(OWNER);
    const memberToken = await w.connect(MEMBER);
    const [ownerConn, memberConn] = [...w.conns.keys()];
    expect(await w.call({ method: "DELETE", route: "connections", ownPage: true, user: MEMBER, query: { id: ownerConn } })).toMatchObject({ status: 403, json: { error: NOT_YOURS_MESSAGE } });
    expect((await w.call({ method: "DELETE", route: "connections", ownPage: true, user: OUTSIDER, query: { id: memberConn } })).status).toBe(403);
    expect((await w.call({ method: "DELETE", route: "connections", ownPage: true, user: OWNER, query: { id: memberConn } })).status).toBe(200);
    expect((await w.rpc(memberToken, { jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(401);
    expect((await w.rpc(ownerToken, { jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(200);
    expect((await w.call({ method: "DELETE", route: "connections", ownPage: true, user: OWNER, query: { id: memberConn } })).status).toBe(404);
  });
});

describe("the connector: its door in the email function", () => {
  function res() {
    const out: { status: number; headers: Record<string, string>; body: unknown; ended: boolean } = { status: 0, headers: {}, body: undefined, ended: false };
    const r = {
      setHeader: (k: string, v: string) => void (out.headers[k] = v),
      status: (s: number) => ((out.status = s), r),
      json: (b: unknown) => void (out.body = b),
      end: () => void (out.ended = true),
    };
    return { out, r: r as unknown as VercelResponse };
  }
  const req = (over: Record<string, unknown>) => ({ method: "POST", headers: {}, query: {}, body: {}, ...over }) as unknown as VercelRequest;

  it("hands a connector request over before the 'our own pages only' check, and nothing else", async () => {
    const connector = vi.fn(async () => {});
    const signedIn = vi.fn(async () => null);
    const handler = warmupHandler({ signedIn, route: vi.fn(), build: () => null, connector });
    const a = res();
    await handler(req({ query: { mcp: "rpc" } }), a.r);
    expect(connector).toHaveBeenCalledTimes(1);
    const b = res();
    await handler(req({ query: { do: "status" } }), b.r);
    // No Origin of ours: the warm-up routes still refuse it.
    expect(b.out.status).toBe(403);
    expect(connector).toHaveBeenCalledTimes(1);
  });

  it("reads a form as well as JSON, passes the route on, and answers with the reply's status and headers", async () => {
    const seen: HttpRequest[] = [];
    const handler = mcpHandler({
      build: () => ({}) as McpDeps,
      site: () => SITE,
      signedIn: async () => null,
      handle: async (_d, r) => {
        seen.push(r);
        return r.route === "token" ? { status: 400, headers: { "Cache-Control": "no-store" }, json: { error: "invalid_grant" } } : { status: 202 };
      },
    });
    const a = res();
    await handler(req({ query: { mcp: "token", extra: "1" }, body: "grant_type=refresh_token&refresh_token=abc", headers: { authorization: "Bearer x", origin: "https://claude.ai" } }), a.r);
    expect(seen[0]).toMatchObject({ method: "POST", route: "token", body: { grant_type: "refresh_token", refresh_token: "abc" }, query: { extra: "1" }, authorization: "Bearer x", origin: "https://claude.ai", site: SITE, ownPage: false });
    expect(a.out).toMatchObject({ status: 400, headers: { "Cache-Control": "no-store" }, body: { error: "invalid_grant" } });
    const b = res();
    await handler(req({ query: { mcp: "rpc" }, body: { jsonrpc: "2.0", method: "notifications/initialized" } }), b.r);
    expect(b.out).toMatchObject({ status: 202, ended: true });
  });

  it("refuses a body that is too large, and says only 'unavailable' when something breaks", async () => {
    const handle = vi.fn(async () => {
      throw new Error("password authentication failed for user postgres");
    });
    const handler = mcpHandler({ build: () => ({}) as McpDeps, site: () => SITE, signedIn: async () => null, handle });
    const big = res();
    await handler(req({ query: { mcp: "rpc" }, headers: { "content-length": String(MAX_BODY_BYTES + 1) } }), big.r);
    expect(big.out.status).toBe(413);
    expect(handle).not.toHaveBeenCalled();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = res();
    await handler(req({ query: { mcp: "rpc" } }), broken.r);
    expect(broken.out.status).toBe(503);
    expect(JSON.stringify(broken.out.body)).not.toContain("password");
    expect(JSON.stringify(log.mock.calls)).not.toContain("password");
    log.mockRestore();
    const none = res();
    await mcpHandler({ build: () => null, site: () => SITE, signedIn: async () => null, handle })(req({ query: { mcp: "rpc" } }), none.r);
    expect(none.out.status).toBe(503);
  });
});
