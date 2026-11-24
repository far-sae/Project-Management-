/**
 * The posting service (Post for Me).
 *
 * Without it, every platform asks for a developer app of our own, reviewed by
 * that platform, before it lets us connect an account or publish for it. The
 * service has those apps already. With its one key set, accounts are connected
 * on its log-in pages and posts go out through it:
 *
 *   connect   it gives the platform's log-in address for a workspace;
 *   accounts  it lists the accounts connected for that workspace;
 *   post      it takes the text, the file's address and the platform's fields;
 *   result    it says, a little later, how the platform answered.
 *
 * The keys of the accounts stay with the service. We keep only its id for each
 * account. What the service or a platform answers is never passed on as it is:
 * a failure becomes one plain sentence.
 */
import { PublishError, optionsOf, type SocialAccountRow, type SocialPost } from "./publishers.js";
import { PLATFORM_NAME, type Platform } from "./shared/platforms.js";
import type { ServiceKind } from "./shared/connect.js";

type Env = Record<string, string | undefined>;
export type ServiceDeps = { fetch: typeof fetch; env: Env };

/** How an account connected through the service is marked on our own record of it. */
export const SERVICE_REF = "postforme:";

export const SERVICE_CONNECT_FAILED = "The account could not be connected. Please try again.";
export const SERVICE_POST_FAILED = "The post could not be sent. Try again.";

const key = (env: Env): string => (env.POST_FOR_ME_API_KEY ?? "").trim();
const base = (env: Env): string => ((env.POST_FOR_ME_BASE_URL ?? "").trim() || "https://api.postforme.dev").replace(/\/+$/, "");

export const serviceOn = (env: Env): boolean => Boolean(key(env));

/** The mark the service keeps on an account, so a workspace's accounts can be found again. */
export const workspaceTag = (workspaceId: string): string => `tc_${workspaceId}`;

const SERVICE_ID = /^[A-Za-z0-9_-]{3,80}$/;

/** The service's id of an account connected through it, or null for an account connected another way. */
export function serviceIdOf(account: SocialAccountRow): string | null {
  const ref = account.credential_ref ?? "";
  if (!ref.startsWith(SERVICE_REF)) return null;
  const id = ref.slice(SERVICE_REF.length);
  return SERVICE_ID.test(id) ? id : null;
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const obj = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

async function call(d: ServiceDeps, method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await d.fetch(`${base(d.env)}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key(d.env)}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let json: Record<string, unknown> = {};
  try { json = obj(await response.json()); } catch { /* not JSON: only the status counts */ }
  return { status: response.status, json };
}

/** The same call, for the parts of the app that read from the service (the autopilot's study of an account's posts). */
export const serviceCall = call;

// ── Connecting ───────────────────────────────────────────────────────────────

/**
 * What the service wants to know besides the platform. Where it is not known
 * which form it accepts, the likelier one is asked first and the plain request
 * second.
 */
const EXTRA: Partial<Record<ServiceKind, Array<Record<string, unknown> | null>>> = {
  // The service's own LinkedIn app is of the "organization" kind.
  linkedin: [{ linkedin: { connection_type: "organization" } }],
  // Instagram's own log-in needs no Facebook Page.
  instagram: [{ instagram: { connection_type: "instagram" } }, null],
  x: [null, { x: { connection_type: "oauth2" } }],
};

/** The platform's log-in address for connecting an account to this workspace. */
export async function serviceAuthUrl(d: ServiceDeps, kind: ServiceKind, workspaceId: string): Promise<string> {
  // "feeds" lets the account's own posts and their numbers be read: the autopilot
  // learns from them. Where the service does not take that for a platform, the
  // account is connected for posting alone, as before.
  const asks: Array<{ extra: Record<string, unknown> | null; feeds: boolean }> = [];
  for (const feeds of [true, false]) for (const extra of EXTRA[kind] ?? [null]) asks.push({ extra, feeds });
  for (const ask of asks) {
    let answer: { status: number; json: Record<string, unknown> };
    try {
      answer = await call(d, "POST", "/v1/social-accounts/auth-url", {
        platform: kind, external_id: workspaceTag(workspaceId), ...(ask.extra ? { platform_data: ask.extra } : {}),
        ...(ask.feeds ? { permissions: ["posts", "feeds"] } : {}),
      });
    } catch {
      break;
    }
    const url = text(answer.json.url);
    if (answer.status >= 200 && answer.status < 300 && /^https:\/\/[^\s]+$/.test(url)) return url;
    // A wrong key or a busy service will not be cured by asking in another form.
    if (answer.status === 401 || answer.status === 403 || answer.status === 429 || answer.status >= 500) break;
  }
  throw new Error(SERVICE_CONNECT_FAILED);
}

const PROVIDER_OF: Record<string, Platform> = {
  youtube: "youtube", facebook: "facebook", instagram: "instagram", x: "x", linkedin: "linkedin",
  // TikTok's two kinds of connection are one network to the person posting.
  tiktok: "tiktok", tiktok_business: "tiktok",
};

export type ServiceAccount = { serviceId: string; provider: Platform; name: string };

/** A working account on a network we post to, without its keys. Null for anything else. */
function accountOf(raw: unknown): (ServiceAccount & { tag: string }) | null {
  const account = obj(raw);
  const provider = PROVIDER_OF[text(account.platform)];
  const serviceId = text(account.id);
  if (!provider || !SERVICE_ID.test(serviceId) || account.status !== "connected") return null;
  return { serviceId, provider, name: text(account.username).trim().slice(0, 200) || `${PLATFORM_NAME[provider]} account`, tag: text(account.external_id) };
}

/** How many accounts named on the way back from one log-in are looked at. One log-in brings a handful at most. */
export const NAMED_MAX = 20;

/**
 * The accounts connected for this workspace. Their keys, which the service
 * also sends, are dropped here.
 *
 * `named` are the accounts the service named on the way back from a log-in.
 * One of them that carries no workspace yet (it was first connected in the
 * service's own dashboard) is taken too, and marked as this workspace's. One
 * that carries another workspace is never taken.
 */
export async function serviceAccounts(d: ServiceDeps, workspaceId: string, named: string[] = []): Promise<ServiceAccount[]> {
  const tag = workspaceTag(workspaceId);
  const query = new URLSearchParams({ external_id: tag, status: "connected", limit: "100" });
  const answer = await call(d, "GET", `/v1/social-accounts?${query}`);
  if (answer.status < 200 || answer.status >= 300) throw new Error(SERVICE_CONNECT_FAILED);
  const out = new Map<string, ServiceAccount>();
  for (const raw of Array.isArray(answer.json.data) ? answer.json.data : []) {
    const account = accountOf(raw);
    if (account && account.tag === tag) out.set(account.serviceId, { serviceId: account.serviceId, provider: account.provider, name: account.name });
  }

  const ids = [...new Set(named.filter((id) => typeof id === "string" && SERVICE_ID.test(id)))].filter((id) => !out.has(id)).slice(0, NAMED_MAX);
  if (ids.length > 0) {
    try {
      const asked = new URLSearchParams({ limit: "100" });
      for (const id of ids) asked.append("id", id);
      const extra = await call(d, "GET", `/v1/social-accounts?${asked}`);
      for (const raw of extra.status >= 200 && extra.status < 300 && Array.isArray(extra.json.data) ? extra.json.data : []) {
        const account = accountOf(raw);
        if (!account || !ids.includes(account.serviceId) || (account.tag && account.tag !== tag)) continue;
        out.set(account.serviceId, { serviceId: account.serviceId, provider: account.provider, name: account.name });
        // So it is found again next time without being named.
        if (!account.tag) await call(d, "PATCH", `/v1/social-accounts/${account.serviceId}`, { external_id: tag }).catch(() => undefined);
      }
    } catch {
      /* the workspace's own accounts are still listed */
    }
  }
  return [...out.values()];
}

// ── Posting ──────────────────────────────────────────────────────────────────

/** The post's main text for this platform. */
function captionOf(provider: Platform, post: SocialPost): string {
  switch (provider) {
    case "youtube": return optionsOf("youtube", post).description;
    case "tiktok": return optionsOf("tiktok", post).caption;
    case "instagram": return optionsOf("instagram", post).caption;
    case "facebook": return optionsOf("facebook", post).message;
    case "x": return optionsOf("x", post).text;
    case "linkedin": return optionsOf("linkedin", post).text;
  }
}

/** The platform's own fields, in the service's words. */
export function serviceConfiguration(provider: Platform, post: SocialPost): Record<string, unknown> {
  const caption = captionOf(provider, post);
  switch (provider) {
    case "youtube": {
      const o = optionsOf("youtube", post);
      return {
        caption, title: o.title, description: o.description, tags: o.tags, category_id: o.categoryId,
        privacy_status: o.privacy, made_for_kids: o.madeForKids === true,
      };
    }
    case "tiktok": {
      const o = optionsOf("tiktok", post);
      return {
        caption,
        // The service knows "public" and "private". Anything narrower than everyone is sent as private: never more open than asked.
        privacy_status: o.privacy === "PUBLIC_TO_EVERYONE" ? "public" : "private",
        allow_comment: o.allowComment, allow_duet: o.allowDuet, allow_stitch: o.allowStitch,
        disclose_your_brand: o.brandOrganic, disclose_branded_content: o.brandContent,
      };
    }
    case "instagram": {
      const o = optionsOf("instagram", post);
      return { caption, placement: post.media?.kind === "video" ? "reels" : "timeline", share_to_feed: o.shareToFeed };
    }
    default:
      return { caption };
  }
}

/**
 * Hands a post to the service for one account. Answers the service's id of the
 * post, or null when the service is busy or cannot be reached: nothing was
 * taken, so the post waits and is handed over again later.
 */
export async function servicePost(d: ServiceDeps, serviceId: string, provider: Platform, post: SocialPost): Promise<string | null> {
  let answer: { status: number; json: Record<string, unknown> };
  try {
    answer = await call(d, "POST", "/v1/social-posts", {
      caption: captionOf(provider, post),
      social_accounts: [serviceId],
      ...(post.media ? { media: [{ url: post.media.url }] } : {}),
      account_configurations: [{ social_account_id: serviceId, configuration: serviceConfiguration(provider, post) }],
      external_id: post.id,
    });
  } catch {
    return null;
  }
  if (answer.status === 429 || answer.status >= 500) return null;
  if (answer.status === 404) {
    throw new PublishError(`${PLATFORM_NAME[provider]} account needs to be connected again. Connect it again, then try the post again.`, true);
  }
  const id = text(answer.json.id);
  if (answer.status < 200 || answer.status >= 300 || !SERVICE_ID.test(id)) {
    console.error("[social] the posting service refused a post", answer.status);
    throw new PublishError(SERVICE_POST_FAILED);
  }
  return id;
}

/** The platform refused the connection itself, so connecting the account again is what helps. */
const CONNECTION_WORDS = /access token|token (is |has )?(expired|invalid|revoked)|session has expired|unauthori[sz]ed|not authorized|re-?authenticate|reconnect|revoked/i;
/** Marks of something that is not a sentence for a person. */
const NOT_A_SENTENCE = /^\s*[{[]|[{}<>]|\bat [\w.<>]+ \(|\/\w+\/\w+\.\w+:\d+/;

/** The platform's reason, as a short plain sentence part. Empty when there is none worth showing. */
function reasonWords(error: unknown): string {
  const raw = text(error) || text(obj(error).message);
  if (!raw || NOT_A_SENTENCE.test(raw)) return "";
  return raw.replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160).replace(/[.\s]+$/, "");
}

export type ServiceResult = { ok: true; id: string } | { ok: false; message: string; reconnect: boolean };

/** How the platform answered a post. Null while it has not answered yet, or the service cannot be asked. */
export async function serviceResult(d: ServiceDeps, postId: string, provider: Platform): Promise<ServiceResult | null> {
  let answer: { status: number; json: Record<string, unknown> };
  try {
    answer = await call(d, "GET", `/v1/social-post-results?${new URLSearchParams({ post_id: postId, limit: "5" })}`);
  } catch {
    return null;
  }
  if (answer.status < 200 || answer.status >= 300) return null;
  const first = Array.isArray(answer.json.data) ? answer.json.data[0] : undefined;
  if (!first) return null;
  const result = obj(first);
  const name = PLATFORM_NAME[provider];
  if (result.success === true) {
    const data = obj(result.platform_data);
    return { ok: true, id: text(data.url) || text(data.id) || postId };
  }
  const words = reasonWords(result.error);
  if (words && CONNECTION_WORDS.test(words)) {
    return { ok: false, reconnect: true, message: `${name} account needs to be connected again. Connect it again, then try the post again.` };
  }
  return { ok: false, reconnect: false, message: `${name} did not accept the post${words ? `: ${words}.` : "."}` };
}
