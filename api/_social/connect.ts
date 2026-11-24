/**
 * Connecting a social account by logging in at the platform.
 *
 * Three steps, three addresses under /api/social/connect/:
 *
 *   setup     which platforms can be connected here (their keys are set);
 *   start     an owner or admin asks to connect one: they get the platform's
 *             log-in address to go to;
 *   callback  the platform sends the browser back with a one-time code, which
 *             is traded for the account's keys. Those are stored sealed, the
 *             same way a key pasted by hand is, and the browser goes back to
 *             the Social page.
 *
 * Nothing is kept between start and callback. What was asked for travels in
 * `state`, signed, so it cannot be changed on the way; and the browser that
 * started carries a short-lived mark, so a link made by somebody else cannot
 * be finished in another person's browser.
 *
 * What a platform answers is never passed on to the screen: only how it ended.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { AccountSecret } from "./tokens.js";
import {
  CONNECT_KINDS, CONNECT_SETTINGS, SERVICE_KINDS, isConnectKind, isServiceKind,
  type ConnectOutcome, type ConnectSetup, type DirectKind as ConnectKind,
} from "./shared/connect.js";
import { SERVICE_CONNECT_FAILED, SERVICE_DISCONNECT_FAILED, serviceAccounts, serviceAuthUrl, serviceDisconnect, serviceOn } from "./service.js";

type Env = Record<string, string | undefined>;

/** One account found on a log-in, ready to be stored. */
export type SavedAccount = {
  organizationId: string;
  workspaceId: string;
  userId: string;
  /** The network the posts go to: youtube, facebook, instagram, x, tiktok or linkedin. */
  provider: string;
  externalId: string;
  name: string;
  secret: AccountSecret;
};

/** An account connected through the posting service: it keeps the keys, we keep its id of the account. */
export type SavedServiceAccount = {
  organizationId: string;
  workspaceId: string;
  userId: string;
  provider: string;
  serviceId: string;
  name: string;
};

export type ConnectStore = {
  /** True when the person is the owner or an admin of the organisation. */
  isAdmin(organizationId: string, userId: string): Promise<boolean>;
  /** The organisation a workspace belongs to, or null when there is no such workspace. */
  workspaceOrg(workspaceId: string): Promise<string | null>;
  /** Stores the account (new, or the same one connected again) with its keys sealed. */
  saveAccount(account: SavedAccount): Promise<void>;
  /** Stores an account of the posting service (new, or the same one connected again). */
  saveServiceAccount(account: SavedServiceAccount): Promise<void>;
  /** The posting service's ids of the accounts that are in our list for this workspace. */
  serviceIdsOf(workspaceId: string): Promise<string[]>;
  /** One account of our list, when it is in this workspace. */
  account(workspaceId: string, accountId: string): Promise<{ id: string; serviceId: string | null; name: string } | null>;
  /** Takes an account out of our list, with its keys. Its posts stay; they lose their account. */
  removeAccount(accountId: string): Promise<void>;
};

/** An account the posting service holds for a workspace, and whether it is in our list. */
export type FoundAccount = { serviceId: string; provider: string; name: string; added: boolean };

export type ConnectDeps = {
  fetch: typeof fetch;
  env: Env;
  now: () => number;
  /** A fresh random text for each start. */
  nonce: () => string;
  store: ConnectStore;
};

/** A refusal with a sentence the person may read. */
export class ConnectError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ConnectError";
  }
}

export const STATE_COOKIE = "tc_social_connect";
/** How long a person has to finish logging in at the platform. */
export const STATE_MINUTES = 15;
const COOKIE_PATH = "/api/social/connect";

const set = (env: Env, name: string): string => (env[name] ?? "").trim();
const META_VERSION = (env: Env): string => set(env, "META_GRAPH_VERSION") || "v24.0";
const META_SCOPES = "pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish";

/** The address every platform is told to send people back to. Https only. */
export function callbackUrl(env: Env): string | null {
  const site = set(env, "PUBLIC_SITE_URL").replace(/\/+$/, "");
  return /^https:\/\/[^/]+/.test(site) ? `${site}/api/social/connect/callback` : null;
}

export function connectSetup(env: Env): ConnectSetup {
  // With the posting service on, every platform it has can be connected, and none needs a key of ours.
  if (serviceOn(env)) {
    const site = set(env, "PUBLIC_SITE_URL").replace(/\/+$/, "");
    return {
      via: "service",
      kinds: [...SERVICE_KINDS],
      ready: Object.fromEntries(SERVICE_KINDS.map((kind) => [kind, true])),
      needs: Object.fromEntries(SERVICE_KINDS.map((kind) => [kind, []])),
      callback: /^https:\/\/[^/]+/.test(site) ? `${site}/social` : null,
    };
  }
  const callback = callbackUrl(env);
  // Needed by every platform: the site's own https address, and the key that seals what is stored.
  const base = [...(callback ? [] : ["PUBLIC_SITE_URL"]), ...(set(env, "INTEGRATION_TOKEN_KEY") ? [] : ["INTEGRATION_TOKEN_KEY"])];
  const needs = Object.fromEntries(
    CONNECT_KINDS.map((kind) => [kind, [...base, ...CONNECT_SETTINGS[kind].filter((name) => !set(env, name))]]),
  ) as Record<ConnectKind, string[]>;
  const ready = Object.fromEntries(CONNECT_KINDS.map((kind) => [kind, needs[kind].length === 0])) as Record<ConnectKind, boolean>;
  return { via: "direct", kinds: [...CONNECT_KINDS], ready, needs, callback };
}

// ── The signed state ─────────────────────────────────────────────────────────

type State = { k: ConnectKind; o: string; w: string; u: string; n: string; e: number };

const mark = (env: Env, purpose: string, text: string): Buffer =>
  createHmac("sha256", `social-connect:${set(env, "INTEGRATION_TOKEN_KEY")}`).update(`${purpose}:${text}`).digest();

function packState(env: Env, state: State): string {
  const body = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${body}.${mark(env, "state", body).toString("base64url")}`;
}

function readState(env: Env, text: string, now: number): State | null {
  const [body, signature, extra] = text.split(".");
  if (!body || !signature || extra !== undefined || !set(env, "INTEGRATION_TOKEN_KEY")) return null;
  const expected = mark(env, "state", body);
  let given: Buffer;
  try { given = Buffer.from(signature, "base64url"); } catch { return null; }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const j = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
    if (!isConnectKind(j.k)) return null;
    for (const key of ["o", "w", "u", "n"]) if (typeof j[key] !== "string" || !j[key]) return null;
    if (typeof j.e !== "number" || j.e < now) return null;
    return j as unknown as State;
  } catch {
    return null;
  }
}

/** X asks for a proof that the browser that finishes is the one that started. It is worked out from the nonce, so nothing has to be stored. */
const proof = (env: Env, nonce: string): string => mark(env, "proof", nonce).toString("base64url");
const challenge = (verifier: string): string => createHash("sha256").update(verifier).digest("base64url");

function cookieValue(header: string, name: string): string {
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return "";
}

const sameText = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

// ── Start ────────────────────────────────────────────────────────────────────

const address = (base: string, params: Record<string, string>): string =>
  `${base}?${new URLSearchParams(params).toString().replace(/\+/g, "%20")}`;

function loginAddress(kind: ConnectKind, env: Env, redirect: string, state: string, nonce: string): string {
  switch (kind) {
    case "youtube":
      return address("https://accounts.google.com/o/oauth2/v2/auth", {
        client_id: set(env, "GOOGLE_CLIENT_ID"), redirect_uri: redirect, response_type: "code",
        scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
        // "offline" and "consent" together make Google hand over the lasting key every time.
        access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
      });
    case "meta":
      return address(`https://www.facebook.com/${META_VERSION(env)}/dialog/oauth`, {
        client_id: set(env, "META_APP_ID"), redirect_uri: redirect, response_type: "code",
        scope: set(env, "META_CONNECT_SCOPES") || META_SCOPES, state,
      });
    case "x":
      return address("https://x.com/i/oauth2/authorize", {
        response_type: "code", client_id: set(env, "X_CLIENT_ID"), redirect_uri: redirect,
        scope: "tweet.read tweet.write users.read media.write offline.access", state,
        code_challenge: challenge(proof(env, nonce)), code_challenge_method: "S256",
      });
    case "tiktok":
      return address("https://www.tiktok.com/v2/auth/authorize/", {
        client_key: set(env, "TIKTOK_CLIENT_KEY"), response_type: "code", scope: "user.info.basic,video.publish",
        redirect_uri: redirect, state,
      });
    case "linkedin":
      return address("https://www.linkedin.com/oauth/v2/authorization", {
        response_type: "code", client_id: set(env, "LINKEDIN_CLIENT_ID"), redirect_uri: redirect,
        scope: "openid profile w_member_social", state,
      });
  }
}

async function mayConnect(d: ConnectDeps, organizationId: string, workspaceId: string, userId: string): Promise<boolean> {
  if (!organizationId || !workspaceId || !userId) return false;
  if (!(await d.store.isAdmin(organizationId, userId))) return false;
  return (await d.store.workspaceOrg(workspaceId)) === organizationId;
}

export async function startConnect(
  d: ConnectDeps,
  input: { kind: unknown; organizationId: string; workspaceId: string; userId: string },
): Promise<{ url: string; cookie: string }> {
  if (serviceOn(d.env)) {
    if (!isServiceKind(input.kind)) throw new ConnectError(400, "That platform cannot be connected here.");
    if (!(await mayConnect(d, input.organizationId, input.workspaceId, input.userId))) {
      throw new ConnectError(403, "Only an owner or admin can connect a social account.");
    }
    try {
      // The service does the whole log-in and sends the person back to the Social page itself.
      return { url: await serviceAuthUrl(d, input.kind, input.workspaceId), cookie: "" };
    } catch {
      throw new ConnectError(502, SERVICE_CONNECT_FAILED);
    }
  }
  if (!isConnectKind(input.kind)) throw new ConnectError(400, "That platform cannot be connected here.");
  if (!(await mayConnect(d, input.organizationId, input.workspaceId, input.userId))) {
    throw new ConnectError(403, "Only an owner or admin can connect a social account.");
  }
  const redirect = callbackUrl(d.env);
  if (!redirect || !connectSetup(d.env).ready[input.kind]) throw new ConnectError(409, "Connecting this platform is not switched on yet.");

  const nonce = d.nonce();
  const state = packState(d.env, {
    k: input.kind, o: input.organizationId, w: input.workspaceId, u: input.userId, n: nonce,
    e: d.now() + STATE_MINUTES * 60_000,
  });
  return {
    url: loginAddress(input.kind, d.env, redirect, state, nonce),
    cookie: `${STATE_COOKIE}=${nonce}; Path=${COOKIE_PATH}; Max-Age=${STATE_MINUTES * 60}; HttpOnly; Secure; SameSite=Lax`,
  };
}

/**
 * After a log-in through the posting service: brings the accounts it now holds
 * for this workspace into our own list. Safe to run at any time, and again.
 */
export async function syncConnect(
  d: ConnectDeps,
  input: { organizationId: string; workspaceId: string; userId: string; accountIds?: unknown },
): Promise<{ connected: number }> {
  if (!serviceOn(d.env)) return { connected: 0 };
  if (!(await mayConnect(d, input.organizationId, input.workspaceId, input.userId))) {
    throw new ConnectError(403, "Only an owner or admin can connect a social account.");
  }
  let found: Awaited<ReturnType<typeof serviceAccounts>>;
  try {
    const named = Array.isArray(input.accountIds) ? input.accountIds.filter((id): id is string => typeof id === "string") : [];
    found = await serviceAccounts(d, input.workspaceId, named);
  } catch {
    throw new ConnectError(502, "The accounts could not be read. Please try again.");
  }
  for (const account of found) {
    await d.store.saveServiceAccount({ organizationId: input.organizationId, workspaceId: input.workspaceId, userId: input.userId, ...account });
  }
  return { connected: found.length };
}

const ADMIN_ONLY = "Only an owner or admin can connect a social account.";

/**
 * What a log-in brought: every account the posting service holds for this
 * workspace, with whether it is in our list already. Nothing is added here.
 * One log-in at Facebook brings every Page of the person; which of them are
 * used is the person's choice (see `chooseAccounts`).
 */
export async function foundAccounts(
  d: ConnectDeps,
  input: { organizationId: string; workspaceId: string; userId: string; accountIds?: unknown },
): Promise<{ accounts: FoundAccount[] }> {
  if (!serviceOn(d.env)) return { accounts: [] };
  if (!(await mayConnect(d, input.organizationId, input.workspaceId, input.userId))) throw new ConnectError(403, ADMIN_ONLY);
  try {
    const named = Array.isArray(input.accountIds) ? input.accountIds.filter((id): id is string => typeof id === "string") : [];
    const [found, ours] = await Promise.all([serviceAccounts(d, input.workspaceId, named), d.store.serviceIdsOf(input.workspaceId)]);
    return { accounts: found.map((a) => ({ serviceId: a.serviceId, provider: a.provider, name: a.name, added: ours.includes(a.serviceId) })) };
  } catch {
    throw new ConnectError(502, "The accounts could not be read. Please try again.");
  }
}

const idList = (value: unknown): string[] => (Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string"))].slice(0, 50) : []);

/**
 * Adds the chosen accounts to our list and lets the others go at the service.
 * Only accounts the service holds for this workspace are touched, and an
 * account that is in our list is never let go from here (that is "disconnect").
 */
export async function chooseAccounts(
  d: ConnectDeps,
  input: { organizationId: string; workspaceId: string; userId: string; add: unknown; drop: unknown },
): Promise<{ connected: number }> {
  if (!serviceOn(d.env)) return { connected: 0 };
  if (!(await mayConnect(d, input.organizationId, input.workspaceId, input.userId))) throw new ConnectError(403, ADMIN_ONLY);
  const add = idList(input.add);
  const drop = idList(input.drop).filter((id) => !add.includes(id));
  let found: Awaited<ReturnType<typeof serviceAccounts>>;
  let ours: string[];
  try {
    [found, ours] = await Promise.all([serviceAccounts(d, input.workspaceId, [...add, ...drop]), d.store.serviceIdsOf(input.workspaceId)]);
  } catch {
    throw new ConnectError(502, "The accounts could not be read. Please try again.");
  }
  let connected = 0;
  for (const account of found) {
    if (add.includes(account.serviceId)) {
      await d.store.saveServiceAccount({ organizationId: input.organizationId, workspaceId: input.workspaceId, userId: input.userId, ...account });
      connected += 1;
    } else if (drop.includes(account.serviceId) && !ours.includes(account.serviceId)) {
      // Not wanted: the service throws its keys away. One that cannot be let go just now is offered again next time.
      await serviceDisconnect(d, account.serviceId).catch(() => undefined);
    }
  }
  return { connected };
}

/**
 * Disconnects one account of our list. For an account of the posting service
 * the service is told first; only when it has let the account go is it taken
 * out of our list, so an account is never half disconnected.
 */
export async function disconnectAccount(
  d: ConnectDeps,
  input: { organizationId: string; workspaceId: string; userId: string; accountId: string },
): Promise<{ ok: true }> {
  if (!(await mayConnect(d, input.organizationId, input.workspaceId, input.userId))) throw new ConnectError(403, "Only an owner or admin can disconnect a social account.");
  const account = await d.store.account(input.workspaceId, input.accountId);
  if (!account) throw new ConnectError(404, "This account is no longer in the list.");
  if (account.serviceId && serviceOn(d.env)) {
    try {
      await serviceDisconnect(d, account.serviceId);
    } catch {
      throw new ConnectError(502, SERVICE_DISCONNECT_FAILED);
    }
  }
  await d.store.removeAccount(account.id);
  return { ok: true };
}

// ── Coming back ──────────────────────────────────────────────────────────────

type Found = Pick<SavedAccount, "provider" | "externalId" | "name" | "secret">;
type Json = Record<string, unknown>;

/** The platform said no, or answered something that cannot be used. */
class Refused extends Error {}

const text = (value: unknown): string => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");
const obj = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {});

async function ask(d: ConnectDeps, url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<Json> {
  const response = await d.fetch(url, init);
  if (!response.ok) throw new Refused();
  try { return obj(await response.json()); } catch { throw new Refused(); }
}

const post = (d: ConnectDeps, url: string, form: Record<string, string>, headers: Record<string, string> = {}): Promise<Json> =>
  ask(d, url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(form).toString() });

const bearer = (token: string): { headers: Record<string, string> } => ({ headers: { Authorization: `Bearer ${token}` } });

/** The keys a platform handed over. `lasting` platforms must give a second key, or the first stops working within hours. */
function keysOf(d: ConnectDeps, j: Json, lasting: boolean): AccountSecret {
  const accessToken = text(j.access_token);
  const refreshToken = text(j.refresh_token);
  if (!accessToken || (lasting && !refreshToken)) throw new Refused();
  const seconds = Number(j.expires_in);
  return {
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    ...(Number.isFinite(seconds) && seconds > 0 ? { expiresAt: d.now() + seconds * 1000 } : {}),
  };
}

async function findAccounts(d: ConnectDeps, kind: ConnectKind, code: string, redirect: string, nonce: string): Promise<Found[]> {
  const env = d.env;
  switch (kind) {
    case "youtube": {
      const secret = keysOf(d, await post(d, "https://oauth2.googleapis.com/token", {
        code, client_id: set(env, "GOOGLE_CLIENT_ID"), client_secret: set(env, "GOOGLE_CLIENT_SECRET"),
        redirect_uri: redirect, grant_type: "authorization_code",
      }), true);
      const channels = await ask(d, "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", bearer(secret.accessToken));
      const items = Array.isArray(channels.items) ? channels.items : [];
      return items.slice(0, 1).map((item) => obj(item)).filter((item) => text(item.id)).map((item) => ({
        provider: "youtube", externalId: text(item.id), name: text(obj(item.snippet).title) || "YouTube channel", secret,
      }));
    }
    case "meta": {
      const graph = `https://graph.facebook.com/${META_VERSION(env)}`;
      const app = { client_id: set(env, "META_APP_ID"), client_secret: set(env, "META_APP_SECRET") };
      const short = text((await ask(d, address(`${graph}/oauth/access_token`, { ...app, redirect_uri: redirect, code }))).access_token);
      if (!short) throw new Refused();
      // The first key lasts an hour or two. Traded for a long one, the Pages' own keys do not run out.
      const long = text((await ask(d, address(`${graph}/oauth/access_token`, { ...app, grant_type: "fb_exchange_token", fb_exchange_token: short }))).access_token);
      if (!long) throw new Refused();
      const pages = await ask(d, address(`${graph}/me/accounts`, { fields: "id,name,access_token,instagram_business_account{id,username}", limit: "100" }), bearer(long));
      const found: Found[] = [];
      for (const raw of Array.isArray(pages.data) ? pages.data : []) {
        const page = obj(raw);
        const token = text(page.access_token);
        if (!text(page.id) || !token) continue;
        found.push({ provider: "facebook", externalId: text(page.id), name: text(page.name) || "Facebook Page", secret: { accessToken: token } });
        const instagram = obj(page.instagram_business_account);
        if (text(instagram.id)) {
          found.push({
            provider: "instagram", externalId: text(instagram.id),
            name: text(instagram.username) ? `@${text(instagram.username)}` : `${text(page.name) || "Instagram"} (Instagram)`,
            secret: { accessToken: token },
          });
        }
      }
      return found;
    }
    case "x": {
      const id = set(env, "X_CLIENT_ID");
      const secret = keysOf(d, await post(d, "https://api.x.com/2/oauth2/token", {
        code, grant_type: "authorization_code", client_id: id, redirect_uri: redirect, code_verifier: proof(env, nonce),
      }, { Authorization: `Basic ${Buffer.from(`${id}:${set(env, "X_CLIENT_SECRET")}`).toString("base64")}` }), true);
      const me = obj((await ask(d, "https://api.x.com/2/users/me", bearer(secret.accessToken))).data);
      if (!text(me.id)) throw new Refused();
      return [{ provider: "x", externalId: text(me.id), name: text(me.username) ? `@${text(me.username)}` : text(me.name) || "X account", secret }];
    }
    case "tiktok": {
      const j = await post(d, "https://open.tiktokapis.com/v2/oauth/token/", {
        client_key: set(env, "TIKTOK_CLIENT_KEY"), client_secret: set(env, "TIKTOK_CLIENT_SECRET"), code,
        grant_type: "authorization_code", redirect_uri: redirect,
      });
      const secret = keysOf(d, j, true);
      const openId = text(j.open_id);
      if (!openId) throw new Refused();
      // The name is only for the list on screen: connecting does not depend on it.
      let name = "";
      try {
        const info = await ask(d, "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name", bearer(secret.accessToken));
        name = text(obj(obj(info.data).user).display_name);
      } catch { /* keep the plain name */ }
      return [{ provider: "tiktok", externalId: openId, name: name || "TikTok account", secret }];
    }
    case "linkedin": {
      const secret = keysOf(d, await post(d, "https://www.linkedin.com/oauth/v2/accessToken", {
        grant_type: "authorization_code", code, client_id: set(env, "LINKEDIN_CLIENT_ID"),
        client_secret: set(env, "LINKEDIN_CLIENT_SECRET"), redirect_uri: redirect,
      }), false);
      const me = await ask(d, "https://api.linkedin.com/v2/userinfo", bearer(secret.accessToken));
      if (!text(me.sub)) throw new Refused();
      return [{ provider: "linkedin", externalId: `urn:li:person:${text(me.sub)}`, name: text(me.name) || "LinkedIn profile", secret }];
    }
  }
}

const back = (outcome: ConnectOutcome, kind?: ConnectKind, count?: number): { location: string } => ({
  location: `/social?connect=${outcome}${kind ? `&p=${kind}` : ""}${count ? `&n=${count}` : ""}`,
});

/** Finishes a log-in. Always answers where to send the browser: the Social page, with how it ended. */
export async function finishConnect(
  d: ConnectDeps,
  query: { state?: string; code?: string; error?: string },
  cookieHeader: string,
): Promise<{ location: string }> {
  const state = readState(d.env, query.state ?? "", d.now());
  const carried = cookieValue(cookieHeader, STATE_COOKIE);
  if (!state || !carried || !sameText(carried, state.n)) return back("expired");
  if (query.error || !query.code) return back(query.error ? "cancelled" : "failed", state.k);
  try {
    const redirect = callbackUrl(d.env);
    if (!redirect || !connectSetup(d.env).ready[state.k]) return back("failed", state.k);
    if (!(await mayConnect(d, state.o, state.w, state.u))) return back("failed", state.k);
    const found = await findAccounts(d, state.k, query.code, redirect, state.n);
    if (found.length === 0) return back("none", state.k);
    for (const account of found) {
      await d.store.saveAccount({ organizationId: state.o, workspaceId: state.w, userId: state.u, ...account });
    }
    return back("done", state.k, found.length);
  } catch (e) {
    // Only the kind of failure is written down: a platform's answer can hold keys.
    console.error("[social] connecting failed", state.k, e instanceof Refused ? "refused" : e instanceof Error ? e.name : "unknown");
    return back("failed", state.k);
  }
}

// ── The three addresses ──────────────────────────────────────────────────────

export type ConnectHttpDeps = ConnectDeps & {
  /** The signed-in person's id, or null. */
  userOf: (req: VercelRequest) => Promise<string | null>;
};

const one = (value: unknown): string => text(Array.isArray(value) ? value[0] : value);

export function connectHandler(d: ConnectHttpDeps) {
  return async function handler(req: VercelRequest, res: VercelResponse, route: string): Promise<void> {
    res.setHeader("Cache-Control", "private, no-store");

    if (route === "callback") {
      // The platform sends the browser here. There is no sign-in token on this
      // request: who asked, and for which workspace, is in the signed state.
      const { location } = await finishConnect(
        d, { state: one(req.query.state), code: one(req.query.code), error: one(req.query.error) }, text(req.headers.cookie),
      );
      res.setHeader("Set-Cookie", `${STATE_COOKIE}=; Path=${COOKIE_PATH}; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
      res.redirect(302, location);
      return;
    }
    if (!["setup", "start", "sync", "found", "choose", "disconnect"].includes(route)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (req.method !== (route === "setup" ? "GET" : "POST")) {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    const userId = await d.userOf(req);
    if (!userId) {
      res.status(401).json({ error: "Please sign in again." });
      return;
    }
    if (route === "setup") {
      res.status(200).json(connectSetup(d.env));
      return;
    }
    try {
      const body = obj(req.body);
      const who = { organizationId: text(body.organizationId), workspaceId: text(body.workspaceId), userId };
      if (route === "found") {
        res.status(200).json(await foundAccounts(d, { ...who, accountIds: body.accountIds }));
        return;
      }
      if (route === "choose") {
        res.status(200).json(await chooseAccounts(d, { ...who, add: body.add, drop: body.drop }));
        return;
      }
      if (route === "disconnect") {
        res.status(200).json(await disconnectAccount(d, { ...who, accountId: text(body.accountId) }));
        return;
      }
      if (route === "sync") {
        res.status(200).json(await syncConnect(d, {
          organizationId: text(body.organizationId), workspaceId: text(body.workspaceId), userId, accountIds: body.accountIds,
        }));
        return;
      }
      const { url, cookie } = await startConnect(d, {
        kind: body.kind, organizationId: text(body.organizationId), workspaceId: text(body.workspaceId), userId,
      });
      if (cookie) res.setHeader("Set-Cookie", cookie);
      res.status(200).json({ url });
    } catch (e) {
      if (e instanceof ConnectError) {
        res.status(e.status).json({ error: e.message });
        return;
      }
      console.error("[social] a connect could not be started", e instanceof Error ? e.name : "unknown");
      res.status(500).json({ error: "The account could not be connected. Please try again." });
    }
  };
}
