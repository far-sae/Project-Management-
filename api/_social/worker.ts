import { PublishError, publishPost, type PublishDeps, type SocialAccountRow, type SocialPost } from "./publishers.js";
import { PLATFORM_NAME, isPlatform, type PostMedia } from "./shared/platforms.js";
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
};

export type WorkerStore = {
  /** The posts that are due, each now marked as being sent. */
  claim(limit: number): Promise<ContentRow[]>;
  account(id: string): Promise<SocialAccountRow | null>;
  /** The account's key as it was saved, or null when the account was never connected. */
  secret(accountId: string): Promise<string | null>;
  saveSecret(accountId: string, plain: string): Promise<void>;
  markPublished(row: ContentRow, externalId: string): Promise<void>;
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

async function sendOne(store: WorkerStore, d: WorkerDeps, row: ContentRow): Promise<string> {
  if (!row.account_id) throw new PublishError(NO_ACCOUNT_MESSAGE);
  const [account, saved] = await Promise.all([store.account(row.account_id), store.secret(row.account_id)]);
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
