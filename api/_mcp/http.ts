import { isUuid } from "../_signroom/validate.js";
import { allowRequest, authorizationServerMetadata, protectedResourceMetadata, readAuthRequest, registerClient, SCOPE, token, whoIs, type AuthParams, type McpAuthStore } from "./oauth.js";
import { handleRpc } from "./rpc.js";
import { emailReach, NO_ACCESS_MESSAGE, type EmailStore, type TestSend } from "./tools.js";

/**
 * The connector's addresses, all served by one function.
 *
 * For Claude (no sign-in of ours, no page of ours):
 *   POST /api/mcp                                  the connector itself; needs Claude's token
 *   GET  /.well-known/oauth-protected-resource     where to ask for permission
 *   GET  /.well-known/oauth-authorization-server   how to ask
 *   POST /api/mcp/register                         Claude registers itself
 *   POST /api/mcp/token                            a code or refresh token for new tokens
 *
 * For our own pages (our pages only, signed in):
 *   POST   /api/mcp/consent       what the Allow page shows, and Allow itself
 *   GET    /api/mcp/connections   what is connected, and what Claude did
 *   DELETE /api/mcp/connections   disconnect one
 */

export type Connection = { id: string; userId: string; clientName: string; createdAt: string; lastUsedAt: string | null };
export type Action = { at: string; userId: string; summary: string };

export interface ConnectionStore {
  /** False until the connector's tables exist (215_claude_connector.sql). */
  ready(): Promise<boolean>;
  connections(organizationId: string): Promise<Connection[]>;
  connection(id: string): Promise<(Connection & { organizationId: string }) | null>;
  actions(organizationId: string, limit: number): Promise<Action[]>;
}

export type McpDeps = {
  auth: McpAuthStore & ConnectionStore;
  email: EmailStore;
  secret: string;
  sendTest?: (t: TestSend) => Promise<boolean>;
  now?: () => Date;
  /** Where a fault is written down (the server's log). */
  onFault?: (e: unknown) => void;
};

export type HttpRequest = {
  method: string;
  /** "" for the connector itself, else what follows /api/mcp/, or "well-known/…". */
  route: string;
  authorization: string;
  /** The Origin header, when the request came from a browser page. */
  origin: string;
  query: Record<string, string>;
  body: unknown;
  /** This site's own address as the caller reached it, without a slash at the end. */
  site: string;
  /** True when the request came from one of our own pages. */
  ownPage: boolean;
  /** The signed-in account of a request from our own pages, or null. */
  signedIn: () => Promise<{ id: string } | null>;
};

export type HttpReply = { status: number; headers?: Record<string, string>; json?: unknown };

export const NOT_SET_UP_MESSAGE = "Connecting Claude is not set up yet.";
export const SIGN_IN_MESSAGE = "Please sign in first.";
export const CHOOSE_ORG_MESSAGE = "Choose an organisation.";
export const NOT_YOURS_MESSAGE = "Only the person who connected it, the owner or an admin can disconnect this.";

/** Pages that may talk to the connector from a browser: Claude's own. Anything else that sends an Origin is refused. */
const CLAUDE_ORIGINS = ["https://claude.ai", "https://claude.com"];

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };
const record = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strings = (v: unknown): AuthParams => Object.fromEntries(Object.entries(record(v)).filter(([, x]) => typeof x === "string")) as AuthParams;

function bearer(header: string): string {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return m ? m[1] : "";
}

function unauthorised(site: string): HttpReply {
  return {
    status: 401,
    headers: { ...NO_STORE, "WWW-Authenticate": `Bearer resource_metadata="${site}/.well-known/oauth-protected-resource/api/mcp", scope="${SCOPE}"` },
    json: { error: "invalid_token", error_description: "Connect TaskCalendar in Claude first." },
  };
}

async function connector(d: McpDeps, r: HttpRequest): Promise<HttpReply> {
  if (r.origin && !CLAUDE_ORIGINS.includes(r.origin) && r.origin !== r.site) return { status: 403, json: { error: "forbidden" } };
  if (r.method !== "POST") return { status: 405, headers: { Allow: "POST" }, json: { error: "method_not_allowed" } };
  const oauth = { store: d.auth, secret: d.secret, site: r.site, now: d.now };
  const grant = await whoIs(oauth, bearer(r.authorization));
  if (!grant) return unauthorised(r.site);
  const out = await handleRpc({ store: d.email, site: r.site, sendTest: d.sendTest, now: d.now }, grant, r.body, d.onFault);
  return { status: out.status, headers: NO_STORE, json: out.json };
}

/** What the Allow page needs, and Allow itself. */
async function consent(d: McpDeps, r: HttpRequest): Promise<HttpReply> {
  if (r.method !== "POST") return { status: 405, headers: { Allow: "POST" }, json: { error: "method_not_allowed" } };
  if (!r.ownPage) return { status: 403, json: { error: "forbidden" } };
  const user = await r.signedIn();
  if (!user) return { status: 401, json: { error: SIGN_IN_MESSAGE } };
  const body = record(r.body);
  const params = strings(body.params);
  const oauth = { store: d.auth, secret: d.secret, site: r.site, now: d.now };

  const request = readAuthRequest(oauth, params);
  if (!request.ok) return { status: 200, headers: NO_STORE, json: { ok: false, problem: request.problem, redirect: request.redirect } };
  if (!(await d.auth.ready())) return { status: 200, headers: NO_STORE, json: { ok: false, notSetUp: true, problem: NOT_SET_UP_MESSAGE, redirect: null } };

  const organizationId = typeof body.organizationId === "string" ? body.organizationId : "";
  if (!isUuid(organizationId)) return { status: 400, json: { error: CHOOSE_ORG_MESSAGE } };
  const reach = await emailReach(d.email, organizationId, user.id);
  const shown = { ok: true, from: request.from, clientName: request.clientName, deny: request.deny };
  if (!reach) return { status: 200, headers: NO_STORE, json: { ...shown, allowed: false, problem: NO_ACCESS_MESSAGE } };

  if (body.action !== "allow") return { status: 200, headers: NO_STORE, json: { ...shown, allowed: true, workspaces: reach.workspaces.map((w) => w.name) } };
  const out = await allowRequest(oauth, params, { organizationId, userId: user.id });
  if (!out.ok) return { status: 200, headers: NO_STORE, json: { ok: false, problem: out.problem, redirect: out.redirect } };
  return { status: 200, headers: NO_STORE, json: { ok: true, redirect: out.redirect } };
}

/** What is connected for an organisation, and what Claude did there. */
async function connections(d: McpDeps, r: HttpRequest): Promise<HttpReply> {
  if (r.method !== "GET" && r.method !== "DELETE") return { status: 405, headers: { Allow: "GET, DELETE" }, json: { error: "method_not_allowed" } };
  if (!r.ownPage) return { status: 403, json: { error: "forbidden" } };
  const user = await r.signedIn();
  if (!user) return { status: 401, json: { error: SIGN_IN_MESSAGE } };
  const address = `${r.site}/api/mcp`;
  if (!(await d.auth.ready())) return { status: 200, headers: NO_STORE, json: { ready: false, address, connections: [], actions: [] } };

  if (r.method === "DELETE") {
    const id = r.query.id ?? "";
    const found = isUuid(id) ? await d.auth.connection(id) : null;
    if (!found) return { status: 404, json: { error: "This connection was not found." } };
    const role = await d.email.orgRole(found.organizationId, user.id);
    if (found.userId !== user.id && role !== "owner" && role !== "admin") return { status: 403, json: { error: NOT_YOURS_MESSAGE } };
    await d.auth.revokeConnection(found.id, (d.now ? d.now() : new Date()).toISOString());
    return { status: 200, headers: NO_STORE, json: { ok: true } };
  }

  const organizationId = r.query.organizationId ?? "";
  if (!isUuid(organizationId)) return { status: 400, json: { error: CHOOSE_ORG_MESSAGE } };
  const role = await d.email.orgRole(organizationId, user.id);
  if (!role) return { status: 403, json: { error: "forbidden" } };
  const admin = role === "owner" || role === "admin";
  // The owner and admins see every connection of the organisation; anybody else only their own.
  const all = await d.auth.connections(organizationId);
  const actions = await d.auth.actions(organizationId, 30);
  return {
    status: 200,
    headers: NO_STORE,
    json: {
      ready: true,
      address,
      mayConnect: (await emailReach(d.email, organizationId, user.id)) !== null,
      connections: admin ? all : all.filter((c) => c.userId === user.id),
      actions: admin ? actions : actions.filter((a) => a.userId === user.id),
    },
  };
}

export async function handle(d: McpDeps, r: HttpRequest): Promise<HttpReply> {
  const oauth = { store: d.auth, secret: d.secret, site: r.site, now: d.now };
  switch (r.route) {
    case "":
    case "rpc":
      return connector(d, r);
    case "well-known/protected-resource":
      return r.method === "GET" ? { status: 200, headers: { "Cache-Control": "public, max-age=300" }, json: protectedResourceMetadata(r.site) } : { status: 405, headers: { Allow: "GET" }, json: { error: "method_not_allowed" } };
    case "well-known/authorization-server":
      return r.method === "GET" ? { status: 200, headers: { "Cache-Control": "public, max-age=300" }, json: authorizationServerMetadata(r.site) } : { status: 405, headers: { Allow: "GET" }, json: { error: "method_not_allowed" } };
    case "register": {
      if (r.method !== "POST") return { status: 405, headers: { Allow: "POST" }, json: { error: "method_not_allowed" } };
      const out = registerClient(oauth, record(r.body));
      return { status: out.status, headers: NO_STORE, json: out.json };
    }
    case "token": {
      if (r.method !== "POST") return { status: 405, headers: { Allow: "POST" }, json: { error: "method_not_allowed" } };
      if (!(await d.auth.ready())) return { status: 503, headers: NO_STORE, json: { error: "temporarily_unavailable", error_description: NOT_SET_UP_MESSAGE } };
      const out = await token(oauth, strings(r.body));
      return { status: out.status, headers: NO_STORE, json: out.json };
    }
    case "consent":
      return consent(d, r);
    case "connections":
      return connections(d, r);
    default:
      return { status: 404, json: { error: "not_found" } };
  }
}
