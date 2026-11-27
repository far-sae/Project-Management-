import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * How Claude gets permission to act for one person (OAuth 2.1, the part the
 * Model Context Protocol asks for).
 *
 *   1. Claude asks our address without a token and is told where to go
 *      (protectedResourceMetadata, authorizationServerMetadata).
 *   2. Claude registers itself (registerClient). Nothing is stored: the client
 *      id it gets back holds its return addresses and is signed by us.
 *   3. The person is sent to our own page, signed in, and presses Allow
 *      (readAuthRequest shows what is asked, allowRequest makes the code).
 *   4. Claude swaps the code for an access token (one hour) and a refresh
 *      token (token). A refresh token works once; each use gives a new pair.
 *
 * Only Claude's own return addresses are accepted, so a permission can only
 * ever be handed to Claude. Codes and tokens are kept as fingerprints
 * (SHA-256), never as themselves.
 */

export const SCOPE = "email_marketing";
export const CODE_SECONDS = 5 * 60;
export const ACCESS_SECONDS = 60 * 60;
export const REFRESH_SECONDS = 90 * 24 * 60 * 60;
/** The same refresh token twice within this time is Claude asking twice at once, not a thief. */
export const REFRESH_GRACE_SECONDS = 60;
export const NAME_MAX = 60;

/** Where the hosted Claude apps send a person back to. */
export const CLAUDE_CALLBACKS: readonly string[] = ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"];

export type AuthCode = {
  hash: string;
  organizationId: string;
  userId: string;
  /** A fingerprint of the client the code was made for. */
  clientHash: string;
  clientName: string;
  redirectUri: string;
  challenge: string;
  expiresAt: string;
};

export type Grant = { connectionId: string; organizationId: string; userId: string };

export interface McpAuthStore {
  saveCode(code: AuthCode): Promise<void>;
  /** The code, marked as used in the same step; null when unknown, used before or too old. */
  takeCode(hash: string, now: string): Promise<AuthCode | null>;
  /** Ends the live connections this person already has for a client of this name, with their tokens. */
  retireConnections(c: { organizationId: string; userId: string; clientName: string }, now: string): Promise<void>;
  createConnection(c: { organizationId: string; userId: string; clientName: string; clientHash: string }): Promise<string>;
  saveToken(t: { hash: string; connectionId: string; kind: "access" | "refresh"; expiresAt: string }): Promise<void>;
  /**
   * The refresh token, marked as used in the same step. `again` is true when
   * it had been used before (`usedAt` says when). With a `clientHash`, the
   * token is only found (and only used up) when its connection was made for
   * that client. Null when unknown, too old, another client's, or its
   * connection was cut.
   */
  takeRefresh(hash: string, now: string, clientHash: string | null): Promise<{ connectionId: string; again: boolean; usedAt: string } | null>;
  /** Whose access token this is; null when unknown, too old, or its connection was cut. */
  readAccess(hash: string, now: string): Promise<Grant | null>;
  revokeConnection(id: string, now: string): Promise<void>;
  touchConnection(id: string, now: string): Promise<void>;
}

export type OAuthDeps = {
  store: McpAuthStore;
  /** A value only this server knows; client ids are signed with it. */
  secret: string;
  /** This site's own address, without a slash at the end. */
  site: string;
  now?: () => Date;
};

export type Reply = { status: number; json: unknown };

const nowOf = (d: Pick<OAuthDeps, "now">): Date => (d.now ? d.now() : new Date());
const text = (v: unknown): string => (typeof v === "string" ? v : "");

export const hashOf = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const fresh = (prefix: string): string => `${prefix}_${randomBytes(32).toString("base64url")}`;

/** The address Claude is given for the connector. */
export const resourceOf = (site: string): string => `${site}/api/mcp`;

export function protectedResourceMetadata(site: string) {
  return { resource: resourceOf(site), authorization_servers: [site], scopes_supported: [SCOPE], bearer_methods_supported: ["header"] };
}

export function authorizationServerMetadata(site: string) {
  return {
    issuer: site,
    authorization_endpoint: `${site}/connect/authorize`,
    token_endpoint: `${site}/api/mcp/token`,
    registration_endpoint: `${site}/api/mcp/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE],
  };
}

// ── Return addresses ───────────────────────────────────────────────────────

/** A program on the person's own computer (Claude Code): http, localhost, any port, the path /callback. */
function isLoopback(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1") && u.pathname === "/callback" && !u.search && !u.hash && !u.username && !u.password;
}

export function isAllowedRedirect(uri: string): boolean {
  return typeof uri === "string" && (CLAUDE_CALLBACKS.includes(uri) || isLoopback(uri));
}

/** A registered address and the one asked for are the same; for this computer the port may differ. */
function sameRedirect(registered: string, asked: string): boolean {
  if (registered === asked) return true;
  if (!isLoopback(registered) || !isLoopback(asked)) return false;
  return new URL(registered).hostname === new URL(asked).hostname;
}

// ── Clients ────────────────────────────────────────────────────────────────

export type Client = { redirectUris: string[]; name: string };

const CLIENT_PREFIX = "tc1";

/** Letters, digits and plain punctuation only: the name is shown on the Allow page. */
function plainName(raw: unknown): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = text(raw).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, NAME_MAX).trim();
}

const sign = (secret: string, body: string): string => createHmac("sha256", secret).update(`mcp-client|${body}`, "utf8").digest("base64url");

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

export function registerClient(d: Pick<OAuthDeps, "secret" | "now">, body: Record<string, unknown>): Reply {
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(text) : [];
  if (uris.length === 0 || uris.length > 6) return { status: 400, json: { error: "invalid_redirect_uri", error_description: "redirect_uris is required." } };
  if (!uris.every(isAllowedRedirect)) return { status: 400, json: { error: "invalid_redirect_uri", error_description: "Only Claude can connect to this server." } };
  const name = plainName(body.client_name) || "Claude";
  const issued = Math.floor(nowOf(d).getTime() / 1000);
  const packed = Buffer.from(JSON.stringify({ r: uris, n: name, t: issued }), "utf8").toString("base64url");
  return {
    status: 201,
    json: {
      client_id: `${CLIENT_PREFIX}.${packed}.${sign(d.secret, packed)}`,
      client_id_issued_at: issued,
      client_name: name,
      redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: SCOPE,
    },
  };
}

/** The client a client id stands for, or null when we did not sign it. */
export function readClient(d: Pick<OAuthDeps, "secret">, clientId: string): Client | null {
  const [prefix, packed, signature, ...rest] = text(clientId).split(".");
  if (prefix !== CLIENT_PREFIX || !packed || !signature || rest.length > 0) return null;
  if (!sameText(signature, sign(d.secret, packed))) return null;
  try {
    const v = JSON.parse(Buffer.from(packed, "base64url").toString("utf8")) as { r?: unknown; n?: unknown };
    const uris = Array.isArray(v.r) ? v.r.map(text) : [];
    if (uris.length === 0 || !uris.every(isAllowedRedirect)) return null;
    return { redirectUris: uris, name: plainName(v.n) || "Claude" };
  } catch {
    return null;
  }
}

// ── The request the person is shown ────────────────────────────────────────

export type AuthParams = Record<string, string | undefined>;

export type AuthRequest =
  | {
      ok: true;
      /** Who is asking, judged by where the answer goes: the Claude apps, or a program on this computer. */
      from: "claude" | "this_computer";
      /** What the client calls itself. Its own words: shown, never trusted. */
      clientName: string;
      redirectUri: string;
      state: string;
      clientHash: string;
      challenge: string;
      /** Where the person goes when they say no. */
      deny: string;
    }
  | {
      ok: false;
      problem: string;
      /** Where to send the person with the reason, or null when the return address itself cannot be trusted. */
      redirect: string | null;
    };

export const UNKNOWN_CLIENT_MESSAGE = "This request did not come from Claude, so nothing was connected. Start again from Claude.";
export const BAD_REQUEST_MESSAGE = "Claude sent a request this page cannot use. Start again from Claude.";

function backWith(redirectUri: string, fields: Record<string, string>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(fields)) if (v) u.searchParams.set(k, v);
  return u.toString();
}

const trimSlash = (v: string): string => v.replace(/\/+$/, "");

/** The server a permission is asked for is this one (or was not named). */
function isOurResource(site: string, resource: string): boolean {
  if (!resource) return true;
  const r = trimSlash(resource);
  return r === resourceOf(site) || r === site;
}

export function readAuthRequest(d: Pick<OAuthDeps, "secret" | "site">, p: AuthParams): AuthRequest {
  const client = readClient(d, text(p.client_id));
  const redirectUri = text(p.redirect_uri);
  if (!client || !redirectUri || !isAllowedRedirect(redirectUri) || !client.redirectUris.some((r) => sameRedirect(r, redirectUri))) {
    return { ok: false, problem: UNKNOWN_CLIENT_MESSAGE, redirect: null };
  }
  const state = text(p.state);
  const refuse = (error: string, description: string): AuthRequest => ({
    ok: false,
    problem: BAD_REQUEST_MESSAGE,
    redirect: backWith(redirectUri, { error, error_description: description, state }),
  });
  if (text(p.response_type) !== "code") return refuse("unsupported_response_type", "Only the code flow is supported.");
  const challenge = text(p.code_challenge);
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(challenge) || text(p.code_challenge_method) !== "S256") return refuse("invalid_request", "A code_challenge with the S256 method is required.");
  if (!isOurResource(d.site, text(p.resource))) return refuse("invalid_target", "The resource is not this server.");
  return {
    ok: true,
    from: CLAUDE_CALLBACKS.includes(redirectUri) ? "claude" : "this_computer",
    clientName: client.name,
    redirectUri,
    state,
    clientHash: hashOf(text(p.client_id)),
    challenge,
    deny: backWith(redirectUri, { error: "access_denied", state }),
  };
}

/** The person pressed Allow: the address to send them to, with the code for Claude. */
export async function allowRequest(d: OAuthDeps, p: AuthParams, who: { organizationId: string; userId: string }): Promise<{ ok: true; redirect: string } | { ok: false; problem: string; redirect: string | null }> {
  const request = readAuthRequest(d, p);
  if (!request.ok) return request;
  const code = fresh("tcc");
  await d.store.saveCode({
    hash: hashOf(code),
    organizationId: who.organizationId,
    userId: who.userId,
    clientHash: request.clientHash,
    clientName: request.clientName,
    redirectUri: request.redirectUri,
    challenge: request.challenge,
    expiresAt: new Date(nowOf(d).getTime() + CODE_SECONDS * 1000).toISOString(),
  });
  return { ok: true, redirect: backWith(request.redirectUri, { code, state: request.state }) };
}

// ── Tokens ─────────────────────────────────────────────────────────────────

const refused = (error: string, description: string): Reply => ({ status: 400, json: { error, error_description: description } });
const INVALID_GRANT = refused("invalid_grant", "This code or token is not valid any more. Connect again.");

async function newPair(d: OAuthDeps, connectionId: string): Promise<Reply> {
  const now = nowOf(d).getTime();
  const access = fresh("tca");
  const refresh = fresh("tcr");
  await d.store.saveToken({ hash: hashOf(access), connectionId, kind: "access", expiresAt: new Date(now + ACCESS_SECONDS * 1000).toISOString() });
  await d.store.saveToken({ hash: hashOf(refresh), connectionId, kind: "refresh", expiresAt: new Date(now + REFRESH_SECONDS * 1000).toISOString() });
  return { status: 200, json: { access_token: access, token_type: "Bearer", expires_in: ACCESS_SECONDS, refresh_token: refresh, scope: SCOPE } };
}

/** The token address: a code for the first pair, a refresh token for the next. */
export async function token(d: OAuthDeps, p: AuthParams): Promise<Reply> {
  const grant = text(p.grant_type);
  const now = nowOf(d).toISOString();

  if (grant === "authorization_code") {
    const code = text(p.code);
    const verifier = text(p.code_verifier);
    if (!code || !text(p.client_id)) return refused("invalid_request", "code and client_id are required.");
    if (!isOurResource(d.site, text(p.resource))) return refused("invalid_target", "The resource is not this server.");
    // The code is used up by this try whatever comes next: a code that was shown to the wrong party must not work later.
    const row = await d.store.takeCode(hashOf(code), now);
    if (!row) return INVALID_GRANT;
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return INVALID_GRANT;
    if (!sameText(createHash("sha256").update(verifier, "utf8").digest("base64url"), row.challenge)) return INVALID_GRANT;
    if (row.clientHash !== hashOf(text(p.client_id)) || !readClient(d, text(p.client_id))) return INVALID_GRANT;
    if (text(p.redirect_uri) && text(p.redirect_uri) !== row.redirectUri) return INVALID_GRANT;
    // One live connection for a person and a client: connecting again replaces the earlier one, so none is left
    // behind that nobody uses and nobody remembers.
    const whose = { organizationId: row.organizationId, userId: row.userId, clientName: row.clientName };
    await d.store.retireConnections(whose, now);
    const connectionId = await d.store.createConnection({ ...whose, clientHash: row.clientHash });
    return newPair(d, connectionId);
  }

  if (grant === "refresh_token") {
    const refresh = text(p.refresh_token);
    if (!refresh) return refused("invalid_request", "refresh_token is required.");
    // A refresh token belongs to the client it was given to. Checked before the token is touched, so somebody
    // else's try with a copied token neither works nor uses it up.
    const clientId = text(p.client_id);
    const row = await d.store.takeRefresh(hashOf(refresh), now, clientId ? hashOf(clientId) : null);
    if (!row) return INVALID_GRANT;
    if (row.again) {
      // A refresh token works once. Seen again after a while, somebody else holds a copy: nobody keeps the
      // connection. Seen again within a minute it is Claude asking twice at once: only the second ask fails.
      const since = nowOf(d).getTime() - new Date(row.usedAt).getTime();
      if (!(since >= 0 && since <= REFRESH_GRACE_SECONDS * 1000)) await d.store.revokeConnection(row.connectionId, now);
      return INVALID_GRANT;
    }
    return newPair(d, row.connectionId);
  }

  return refused("unsupported_grant_type", "Only authorization_code and refresh_token are supported.");
}

/** Whose access token this is, or null. */
export async function whoIs(d: OAuthDeps, accessToken: string): Promise<Grant | null> {
  if (!accessToken || !accessToken.startsWith("tca_")) return null;
  const now = nowOf(d).toISOString();
  const grant = await d.store.readAccess(hashOf(accessToken), now);
  if (!grant) return null;
  try {
    await d.store.touchConnection(grant.connectionId, now);
  } catch {
    /* "last used" is a convenience: it never stops a call */
  }
  return grant;
}
