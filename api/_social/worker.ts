import { PublishError, publishPost, type PublishDeps, type SocialAccountRow, type SocialPost } from "./publishers.js";
import { PLATFORM_NAME, isPlatform, type PostMedia } from "./shared/platforms.js";
import { serviceIdOf, servicePost, serviceResult } from "./service.js";
import { isStale, readSecret, refreshSecret, writeSecret, type AccountSecret } from "./tokens.js";

/**
 * Sends the posts that are due. It runs every five minutes (Vercel's cron),
 * and straight away when somebody presses "Post" in the composer.
 *
 * A post that fails is marked with a sentence the person can act on, and can
 * be tried again. A post never goes out twice: it is claimed first, and only
 * the run that claimed it sends it.
 */

export type ContentRow = {
  id: string;
  organization_id: string;
  workspace_id: string;
  account_id: string | null;
  title: string;
  body: string;
  media_urls?: string[] | null;
  media?: unknown;
  options?: unknown;
  /** While a post is with the posting service: its note of that (see `handedOver`). Afterwards: where the post is. */
  external_post_id?: string | null;
};

export type WorkerStore = {
  /** The posts that are due, each now marked as being sent. */
  claim(limit: number): Promise<ContentRow[]>;
  account(id: string): Promise<SocialAccountRow | null>;
  /** The account's key as it was saved, or null when the account was never connected. */
  secret(accountId: string): Promise<string | null>;
  saveSecret(accountId: string, plain: string): Promise<void>;
  markPublished(row: ContentRow, externalId: string): Promise<void>;
  /** Notes that the posting service has taken the post (or, with null, forgets that), so it is never handed over twice. */
  markHandedOver(id: string, note: string | null): Promise<void>;
  markFailed(id: string, message: string): Promise<void>;
  /** Puts a claimed post back in the queue, untouched, for the next run. */
  release(id: string): Promise<void>;
  /** Marks the account as needing to be connected again (a sentence), or as working (null). */
  markAccount(accountId: string, problem: string | null): Promise<void>;
};

export type WorkerDeps = PublishDeps & { now: () => number };

/** A run stops starting new posts after this long, so the function always ends by itself. */
export const BUDGET_MS = 240_000;

export const NO_ACCOUNT_MESSAGE = "No account was chosen for this post.";
export const NOT_CONNECTED_MESSAGE = "This account is not connected. Connect it again, then try the post again.";
export const FAILED_MESSAGE = "The post could not be sent. Try again.";
export const TOO_LONG_MESSAGE = "Posting took too long and was stopped. Try again.";

/** How long one run waits for a platform's answer to a post the service took, and how often it looks. */
export const SERVICE_WAIT_MS = 15_000;
export const SERVICE_LOOK_MS = 3_000;
/** After this long without an answer, the post counts as not sent. */
export const SERVICE_GIVE_UP_MS = 45 * 60_000;

const HANDED_OVER = /^pfm:([A-Za-z0-9_-]{3,80}):(\d{1,16})$/;
/** The note kept on a post while the posting service has it: the service's id of the post, and when it took it. */
export const handedOverNote = (postId: string, at: number): string => `pfm:${postId}:${at}`;
export function handedOver(note: string | null | undefined): { postId: string; at: number } | null {
  const m = HANDED_OVER.exec(note ?? "");
  return m ? { postId: m[1], at: Number(m[2]) } : null;
}

const VIDEO_FILE = /\.(mp4|mov|m4v|webm)(\?|#|$)/i;

/** The file of a post: what the composer saved, or the address an older post carried. */
export function mediaOf(row: ContentRow): PostMedia | null {
  const first = Array.isArray(row.media) ? row.media[0] : null;
  if (first && typeof first === "object") {
    const m = first as Record<string, unknown>;
    const url = typeof m.url === "string" ? m.url : "";
    if (url) {
      return {
        url,
        kind: m.kind === "video" ? "video" : "image",
        mime: typeof m.mime === "string" ? m.mime : "",
        bytes: typeof m.bytes === "number" && m.bytes > 0 ? m.bytes : 0,
        name: typeof m.name === "string" ? m.name : "",
      };
    }
  }
  const url = Array.isArray(row.media_urls) && typeof row.media_urls[0] === "string" ? row.media_urls[0] : "";
  if (!url) return null;
  const isVideo = VIDEO_FILE.test(url);
  return { url, kind: isVideo ? "video" : "image", mime: isVideo ? "video/mp4" : "image/jpeg", bytes: 0, name: "" };
}

const postOf = (row: ContentRow): SocialPost => ({
  id: row.id,
  title: row.title,
  body: row.body ?? "",
  media: mediaOf(row),
  options: row.options && typeof row.options === "object" && !Array.isArray(row.options) ? (row.options as Record<string, unknown>) : {},
});

/**
 * A post for an account connected through the posting service. The service
 * takes the post at once and the platform answers a little later, so this
 * waits a short while for the answer. Null means "not answered yet": the post
 * goes back in the queue, and the next run only asks again. It is never handed
 * over a second time.
 */
async function sendViaService(store: WorkerStore, d: WorkerDeps, row: ContentRow, account: SocialAccountRow, serviceId: string): Promise<string | null> {
  if (!isPlatform(account.provider)) throw new PublishError(FAILED_MESSAGE);
  let sent = handedOver(row.external_post_id);
  if (!sent) {
    const postId = await servicePost(d, serviceId, account.provider, postOf(row));
    if (!postId) return null;
    sent = { postId, at: d.now() };
    await store.markHandedOver(row.id, handedOverNote(postId, sent.at));
  }
  const until = d.now() + SERVICE_WAIT_MS;
  for (;;) {
    const result = await serviceResult(d, sent.postId, account.provider);
    if (result?.ok) return result.id;
    if (result || d.now() - sent.at > SERVICE_GIVE_UP_MS) {
      // Over, and not sent: forget the hand-over, so "Try again" sends it afresh.
      await store.markHandedOver(row.id, null);
      throw result ? new PublishError(result.message, result.reconnect) : new PublishError(TOO_LONG_MESSAGE);
    }
    if (d.now() + SERVICE_LOOK_MS > until) return null;
    await d.wait(SERVICE_LOOK_MS);
  }
}

async function sendOne(store: WorkerStore, d: WorkerDeps, row: ContentRow): Promise<string | null> {
  if (!row.account_id) throw new PublishError(NO_ACCOUNT_MESSAGE);
  const account = await store.account(row.account_id);
  const serviceId = account ? serviceIdOf(account) : null;
  if (account && serviceId) return sendViaService(store, d, row, account, serviceId);
  const saved = account ? await store.secret(row.account_id) : null;
  if (!account || !saved) throw new PublishError(NOT_CONNECTED_MESSAGE, true);
  const name = isPlatform(account.provider) ? PLATFORM_NAME[account.provider] : "This";

  let secret: AccountSecret = readSecret(saved);
  let renewed = false;
  const renew = async (): Promise<boolean> => {
    const next = await refreshSecret(d, account.provider, secret, d.now());
    if (!next) return false;
    secret = next;
    renewed = true;
    await store.saveSecret(account.id, writeSecret(next));
    return true;
  };

  // YouTube, TikTok and X keys run out within hours: renew before using one that has.
  if (isStale(secret, d.now())) await renew();
  if (!secret.accessToken) throw new PublishError(`${name} account is not connected. Connect it again, then try the post again.`, true);

  const post = postOf(row);
  try {
    return await publishPost(d, account, post, secret.accessToken);
  } catch (e) {
    // The platform refused the key: renew it once and try once more. Nothing was posted by the refused try.
    if (e instanceof PublishError && e.reconnect && !renewed && (await renew())) {
      return await publishPost(d, account, post, secret.accessToken);
    }
    throw e;
  }
}

export type RunResult = { claimed: number; published: number; failed: number; putBack: number };

export async function runWorker(store: WorkerStore, d: WorkerDeps, limit: number): Promise<RunResult> {
  const started = d.now();
  const rows = await store.claim(limit);
  const out: RunResult = { claimed: rows.length, published: 0, failed: 0, putBack: 0 };
  for (const row of rows) {
    // Out of time: the rest wait for the next run instead of being cut off half-way.
    if (d.now() - started > BUDGET_MS) {
      await store.release(row.id);
      out.putBack += 1;
      continue;
    }
    try {
      const externalId = await sendOne(store, d, row);
      if (externalId === null) {
        // With the posting service, not answered yet: back in the queue for the next run to ask again.
        await store.release(row.id);
        out.putBack += 1;
        continue;
      }
      await store.markPublished(row, externalId);
      if (row.account_id) await store.markAccount(row.account_id, null);
      out.published += 1;
    } catch (e) {
      const known = e instanceof PublishError;
      // Only our own sentences are kept. Anything else is logged by its name and said plainly.
      if (!known) console.error("[social] a post could not be sent", e instanceof Error ? e.name : "unknown");
      const message = known ? e.message.slice(0, 500) : FAILED_MESSAGE;
      await store.markFailed(row.id, message);
      if (known && e.reconnect && row.account_id) await store.markAccount(row.account_id, message);
      out.failed += 1;
    }
  }
  return out;
}
