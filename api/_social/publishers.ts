import {
  PLATFORM_NAME, isPlatform, postProblems, startingOptions,
  type FacebookOptions, type InstagramOptions, type LinkedInOptions, type Platform, type PlatformOptions,
  type PostMedia, type TikTokOptions, type XOptions, type YouTubeOptions,
} from "./shared/platforms.js";

/**
 * Sends one post to one platform, the way that platform's own API asks:
 *
 *   YouTube    resumable upload (start a session with the details, then send the file)
 *   TikTok     Content Posting API, direct post, file upload in chunks
 *   Instagram  a container for the picture or reel, wait until it is ready, publish it
 *   Facebook   a Page post: text, a photo by address, or a video by address
 *   X          chunked media upload (initialize, append, finalize, status), then the post
 *   LinkedIn   a text post
 *
 * Nothing here knows about the database. It is given an account, a post and a
 * working access token, and answers with the platform's id of what was made.
 */

export type PublishDeps = {
  fetch: typeof fetch;
  /** Pause between checks while a platform prepares a video. */
  wait: (ms: number) => Promise<void>;
  env: Record<string, string | undefined>;
};

export type SocialAccountRow = { id: string; provider: string; external_account_id: string | null };

export type SocialPost = {
  id: string;
  title: string;
  body: string;
  media: PostMedia | null;
  /** This platform's own fields, as the composer saved them. Empty on posts made before the composer. */
  options: Record<string, unknown>;
};

/**
 * A post that was not accepted. `message` is a sentence for the person who
 * made the post. `reconnect` says the platform refused the connection itself,
 * so a fresh token (or connecting the account again) is what would help.
 */
export class PublishError extends Error {
  constructor(message: string, readonly reconnect = false) {
    super(message);
    this.name = "PublishError";
  }
}

const META_VERSION = (env: PublishDeps["env"]): string => env.META_GRAPH_VERSION ?? "v24.0";

/** The platform's own reason, shortened and on one line, to put after ours. Never a token. */
function reasonOf(json: unknown): string {
  const j = (json && typeof json === "object" ? json : {}) as Record<string, any>;
  const raw = j.error?.message ?? j.error_description ?? j.detail ?? j.title ?? j.message ?? (typeof j.error === "string" ? j.error : "");
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
}

async function readJson(response: Response): Promise<Record<string, any>> {
  try {
    const value = await response.json();
    return value && typeof value === "object" ? (value as Record<string, any>) : {};
  } catch {
    return {};
  }
}

/** A platform's answer, or a PublishError that says which platform refused and why. */
async function answer(platform: Platform, response: Response): Promise<Record<string, any>> {
  const json = await readJson(response);
  if (response.ok) return json;
  const name = PLATFORM_NAME[platform];
  const reason = reasonOf(json);
  if (response.status === 401 || response.status === 403) {
    throw new PublishError(`${name} did not accept the connection. Connect the ${name} account again.${reason ? ` (${reason})` : ""}`, true);
  }
  if (response.status === 429) throw new PublishError(`${name} says too many posts were made in a short time. Try again later.`);
  throw new PublishError(reason ? `${name} did not accept the post: ${reason}` : `${name} did not accept the post.`);
}

/** This platform's fields for the post: what the composer saved, or made from the title and text for an older post. */
export function optionsOf<P extends Platform>(platform: P, post: SocialPost): PlatformOptions[P] {
  const start = startingOptions(platform, { title: post.title, text: post.body, tags: [] });
  const saved = post.options && typeof post.options === "object" ? post.options : {};
  return { ...start, ...saved } as PlatformOptions[P];
}

/**
 * The file, opened from our own storage. The address comes from a row a person
 * made, so it is fetched only when it is in this project's own public bucket:
 * the server never fetches an address somebody else chose.
 */
async function openMedia(d: PublishDeps, media: PostMedia): Promise<{ response: Response; size: number }> {
  const base = (d.env.SUPABASE_URL ?? d.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
  let ours = false;
  try {
    const url = new URL(media.url);
    ours = base !== "" && url.origin === new URL(base).origin && url.pathname.startsWith("/storage/v1/object/public/social-media/");
  } catch {
    ours = false;
  }
  if (!ours) throw new PublishError("The file of this post is not one that was uploaded here. Upload it again and post again.");
  const response = await d.fetch(media.url);
  if (!response.ok || !response.body) throw new PublishError("The file of this post could not be read. Upload it again and post again.");
  const length = Number(response.headers.get("content-length"));
  const size = Number.isFinite(length) && length > 0 ? length : media.bytes;
  if (!size || size <= 0) throw new PublishError("The file of this post is empty. Upload it again and post again.");
  return { response, size };
}

/** The file cut into pieces of `chunk` bytes; the last piece carries what is left over when `mergeTail` is set. */
async function* pieces(response: Response, size: number, chunk: number, mergeTail: boolean): AsyncGenerator<Uint8Array> {
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const count = mergeTail ? Math.max(1, Math.floor(size / chunk)) : Math.ceil(size / chunk);
  let pending: Uint8Array[] = [];
  let have = 0;
  let sent = 0;
  const take = (n: number): Uint8Array => {
    const out = new Uint8Array(n);
    let at = 0;
    while (at < n) {
      const head = pending[0];
      const need = n - at;
      if (head.length <= need) {
        out.set(head, at);
        at += head.length;
        pending.shift();
      } else {
        out.set(head.subarray(0, need), at);
        pending[0] = head.subarray(need);
        at += need;
      }
    }
    have -= n;
    return out;
  };
  for (let index = 0; index < count; index += 1) {
    const last = index === count - 1;
    const want = last ? size - sent : chunk;
    while (have < want) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length) {
        pending.push(value);
        have += value.length;
      }
    }
    if (have < want) throw new PublishError("The file of this post could not be read to the end. Try again.");
    const piece = take(want);
    sent += piece.length;
    yield piece;
  }
  pending = [];
}

// ── LinkedIn ────────────────────────────────────────────────────────────────

async function toLinkedIn(d: PublishDeps, account: SocialAccountRow, post: SocialPost, token: string): Promise<string> {
  if (!account.external_account_id) throw new PublishError("The LinkedIn account has no author id. Connect it again.", true);
  const o = optionsOf("linkedin", post) as LinkedInOptions;
  const response = await d.fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Restli-Protocol-Version": "2.0.0", "Linkedin-Version": d.env.LINKEDIN_API_VERSION ?? "202607" },
    body: JSON.stringify({
      author: account.external_account_id, commentary: o.text, visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false,
    }),
  });
  await answer("linkedin", response);
  return response.headers.get("x-restli-id") ?? `linkedin:${post.id}`;
}

// ── X ───────────────────────────────────────────────────────────────────────

/** X asks for pieces of at most 5 MB. */
export const X_CHUNK = 4 * 1024 * 1024;
const X_STATUS_TRIES = 40;

async function xMedia(d: PublishDeps, media: PostMedia, token: string): Promise<string> {
  const { response: file, size } = await openMedia(d, media);
  const auth = { Authorization: `Bearer ${token}` };
  const init = await answer("x", await d.fetch("https://api.x.com/2/media/upload/initialize", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ media_type: media.mime, total_bytes: size, media_category: media.kind === "video" ? "tweet_video" : "tweet_image" }),
  }));
  const id = String(init.data?.id ?? "");
  if (!id) throw new PublishError("X did not start the upload. Try again.");
  let segment = 0;
  for await (const piece of pieces(file, size, X_CHUNK, false)) {
    const form = new FormData();
    form.append("segment_index", String(segment));
    form.append("media", new Blob([piece as unknown as BlobPart], { type: media.mime }), media.name || "media");
    await answer("x", await d.fetch(`https://api.x.com/2/media/upload/${id}/append`, { method: "POST", headers: auth, body: form }));
    segment += 1;
  }
  let state = (await answer("x", await d.fetch(`https://api.x.com/2/media/upload/${id}/finalize`, { method: "POST", headers: auth }))).data?.processing_info;
  for (let tries = 0; state && state.state !== "succeeded"; tries += 1) {
    if (state.state === "failed") throw new PublishError("X could not use this file. Try a different format (MP4 for video, JPEG or PNG for a picture).");
    if (tries >= X_STATUS_TRIES) throw new PublishError("X is still preparing the video. Try again in a few minutes.");
    await d.wait(Math.min(Math.max(Number(state.check_after_secs) || 2, 1), 10) * 1000);
    state = (await answer("x", await d.fetch(`https://api.x.com/2/media/upload?command=STATUS&media_id=${id}`, { headers: auth }))).data?.processing_info;
  }
  return id;
}

async function toX(d: PublishDeps, post: SocialPost, token: string): Promise<string> {
  const o = optionsOf("x", post) as XOptions;
  const mediaId = post.media ? await xMedia(d, post.media, token) : null;
  const result = await answer("x", await d.fetch("https://api.x.com/2/tweets", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: o.text, ...(mediaId ? { media: { media_ids: [mediaId] } } : {}) }),
  }));
  return String(result.data?.id ?? `x:${post.id}`);
}

// ── Facebook ────────────────────────────────────────────────────────────────

async function toFacebook(d: PublishDeps, account: SocialAccountRow, post: SocialPost, token: string): Promise<string> {
  if (!account.external_account_id) throw new PublishError("The Facebook account has no Page id. Connect it again.", true);
  const o = optionsOf("facebook", post) as FacebookOptions;
  const page = `https://graph.facebook.com/${META_VERSION(d.env)}/${encodeURIComponent(account.external_account_id)}`;
  const send = async (edge: string, body: Record<string, unknown>) =>
    answer("facebook", await d.fetch(`${page}/${edge}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, access_token: token }) }));
  if (!post.media) return String((await send("feed", { message: o.message })).id ?? `facebook:${post.id}`);
  if (post.media.kind === "image") {
    const result = await send("photos", { url: post.media.url, ...(o.message ? { caption: o.message } : {}) });
    return String(result.post_id ?? result.id ?? `facebook:${post.id}`);
  }
  const result = await send("videos", { file_url: post.media.url, ...(o.title ? { title: o.title } : {}), ...(o.message ? { description: o.message } : {}) });
  return String(result.id ?? `facebook:${post.id}`);
}

// ── Instagram ───────────────────────────────────────────────────────────────

/** How often, and how many times, a reel's container is asked whether it is ready: up to about three minutes. */
export const IG_WAIT_MS = 5000;
export const IG_TRIES = 36;

async function toInstagram(d: PublishDeps, account: SocialAccountRow, post: SocialPost, token: string): Promise<string> {
  if (!account.external_account_id) throw new PublishError("The Instagram account has no account id. Connect it again.", true);
  const o = optionsOf("instagram", post) as InstagramOptions;
  const media = post.media as PostMedia;
  const base = `https://graph.facebook.com/${META_VERSION(d.env)}`;
  const user = `${base}/${encodeURIComponent(account.external_account_id)}`;
  const send = async (url: string, body: Record<string, unknown>) =>
    answer("instagram", await d.fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, access_token: token }) }));

  const container = await send(`${user}/media`, media.kind === "video"
    ? { media_type: "REELS", video_url: media.url, caption: o.caption, share_to_feed: o.shareToFeed }
    : { image_url: media.url, caption: o.caption });
  const containerId = String(container.id ?? "");
  if (!containerId) throw new PublishError("Instagram did not accept the file.");

  if (media.kind === "video") {
    // Instagram fetches and prepares the video itself; it can only be published once that is done.
    for (let tries = 0; ; tries += 1) {
      const status = await answer("instagram", await d.fetch(`${base}/${containerId}?fields=status_code&access_token=${encodeURIComponent(token)}`));
      if (status.status_code === "FINISHED") break;
      if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
        throw new PublishError("Instagram could not use this video. Reels need an MP4 or MOV video, upright or square, up to 15 minutes.");
      }
      if (tries >= IG_TRIES) throw new PublishError("Instagram is still preparing the video. Try again in a few minutes.");
      await d.wait(IG_WAIT_MS);
    }
  }
  const result = await send(`${user}/media_publish`, { creation_id: containerId });
  return String(result.id ?? `instagram:${post.id}`);
}

// ── YouTube ─────────────────────────────────────────────────────────────────

async function toYouTube(d: PublishDeps, post: SocialPost, token: string): Promise<string> {
  const o = optionsOf("youtube", post) as YouTubeOptions;
  const media = post.media as PostMedia;
  const { response: file, size } = await openMedia(d, media);
  const start = await d.fetch(
    `https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=${o.notifySubscribers ? "true" : "false"}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(size),
        "X-Upload-Content-Type": media.mime || "video/*",
      },
      body: JSON.stringify({
        snippet: { title: o.title, description: o.description, tags: o.tags, categoryId: o.categoryId },
        status: { privacyStatus: o.privacy, selfDeclaredMadeForKids: o.madeForKids === true },
      }),
    },
  );
  if (!start.ok) await answer("youtube", start);
  const session = start.headers.get("location");
  if (!session) throw new PublishError("YouTube did not start the upload. Try again.");
  // The file goes from our storage straight on to YouTube, without being held in memory.
  const sent = await d.fetch(session, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Length": String(size), "Content-Type": media.mime || "video/*" },
    body: file.body,
    duplex: "half",
  } as RequestInit);
  const result = await answer("youtube", sent);
  const id = String(result.id ?? "");
  if (!id) throw new PublishError("YouTube took the video but gave no id for it. Check the channel before posting again.");
  return id;
}

// ── TikTok ──────────────────────────────────────────────────────────────────

/** TikTok takes pieces of 5 to 64 MB; a file up to 64 MB goes as one piece. */
export const TIKTOK_WHOLE_MAX = 64 * 1024 * 1024;
export const TIKTOK_CHUNK = 16 * 1024 * 1024;

/** How TikTok wants the file cut: the last piece carries what is left over. */
export function tiktokChunks(size: number): { chunkSize: number; count: number } {
  if (size <= TIKTOK_WHOLE_MAX) return { chunkSize: size, count: 1 };
  return { chunkSize: TIKTOK_CHUNK, count: Math.floor(size / TIKTOK_CHUNK) };
}

async function toTikTok(d: PublishDeps, post: SocialPost, token: string): Promise<string> {
  const o = optionsOf("tiktok", post) as TikTokOptions;
  const media = post.media as PostMedia;
  const { response: file, size } = await openMedia(d, media);
  const plan = tiktokChunks(size);
  const init = await d.fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({
      post_info: {
        title: o.caption,
        privacy_level: o.privacy,
        disable_comment: !o.allowComment,
        disable_duet: !o.allowDuet,
        disable_stitch: !o.allowStitch,
        brand_content_toggle: o.brandContent,
        brand_organic_toggle: o.brandOrganic,
      },
      source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: plan.chunkSize, total_chunk_count: plan.count },
    }),
  });
  const started = await answer("tiktok", init);
  // TikTok answers 200 with its own code as well: anything but "ok" is a refusal.
  if (started.error?.code && started.error.code !== "ok") {
    throw new PublishError(`TikTok did not accept the post: ${String(started.error.message || started.error.code).slice(0, 240)}`);
  }
  const publishId = String(started.data?.publish_id ?? "");
  const uploadUrl = String(started.data?.upload_url ?? "");
  if (!publishId || !uploadUrl) throw new PublishError("TikTok did not start the upload. Try again.");

  let first = 0;
  for await (const piece of pieces(file, size, plan.chunkSize, true)) {
    const last = first + piece.length - 1;
    const sent = await d.fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": media.mime || "video/mp4", "Content-Length": String(piece.length), "Content-Range": `bytes ${first}-${last}/${size}` },
      body: piece as unknown as BodyInit,
    });
    if (!sent.ok) throw new PublishError("TikTok did not take the whole video. Try again.");
    first = last + 1;
  }
  return publishId;
}

// ── One post to one platform ────────────────────────────────────────────────

/** Sends the post and answers with the platform's id of it. Throws PublishError with a sentence for the person. */
export async function publishPost(d: PublishDeps, account: SocialAccountRow, post: SocialPost, token: string): Promise<string> {
  const platform = account.provider;
  if (!isPlatform(platform)) throw new PublishError("Posting to this kind of account is not available.");
  // The same check the composer made, again, before anything leaves: a post that is missing something is never half-sent.
  const problems = postProblems(platform, optionsOf(platform, post), post.media);
  if (problems.length) throw new PublishError(problems[0]);
  try {
    if (platform === "youtube") return await toYouTube(d, post, token);
    if (platform === "tiktok") return await toTikTok(d, post, token);
    if (platform === "instagram") return await toInstagram(d, account, post, token);
    if (platform === "facebook") return await toFacebook(d, account, post, token);
    if (platform === "x") return await toX(d, post, token);
    return await toLinkedIn(d, account, post, token);
  } catch (e) {
    if (e instanceof PublishError) throw e;
    // A network failure, or an answer nobody could read: say which platform, and nothing of the error itself.
    throw new PublishError(`${PLATFORM_NAME[platform]} could not be reached. Try again.`);
  }
}
