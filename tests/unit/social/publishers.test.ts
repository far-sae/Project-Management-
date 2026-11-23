// @vitest-environment node
// One post to one platform: what is sent, in which order, and what is said
// when the platform says no. Nothing here touches the network.
import { describe, expect, it, vi } from "vitest";
import {
  IG_TRIES, PublishError, TIKTOK_CHUNK, TIKTOK_WHOLE_MAX, X_CHUNK, publishPost, tiktokChunks,
  type PublishDeps, type SocialAccountRow, type SocialPost,
} from "../../../api/_social/publishers";
import { isStale, readSecret, refreshSecret, writeSecret } from "../../../api/_social/tokens";
import { startingOptions, type PostMedia } from "../../../api/_social/shared/platforms";

const STORE = "https://abc.supabase.co";
const VIDEO_URL = `${STORE}/storage/v1/object/public/social-media/ws/clip.mp4`;
const video = (bytes = 1000): PostMedia => ({ url: VIDEO_URL, kind: "video", mime: "video/mp4", bytes, name: "clip.mp4" });
const jpeg: PostMedia = { url: `${STORE}/storage/v1/object/public/social-media/ws/photo.jpg`, kind: "image", mime: "image/jpeg", bytes: 500, name: "photo.jpg" };
const shared = { title: "Five tips", text: "What works.", tags: ["tips"] };
const TOKEN = "token-for-tests";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown; raw: unknown };
type Reply = { status?: number; json?: unknown; headers?: Record<string, string>; bytes?: number };

function setUp(reply: (call: Call, n: number) => Reply | undefined, fileBytes = 1000) {
  const calls: Call[] = [];
  const fetchFake = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith(`${STORE}/storage/`)) {
      return new Response(new Uint8Array(fileBytes).fill(7), { status: 200, headers: { "content-length": String(fileBytes) } });
    }
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    let body: unknown = init?.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { /* a form: keep the text */ }
    }
    const call: Call = { url: u, method: String(init?.method ?? "GET"), headers, body, raw: init?.body };
    calls.push(call);
    const out = reply(call, calls.length) ?? {};
    return new Response(JSON.stringify(out.json ?? {}), { status: out.status ?? 200, headers: { "content-type": "application/json", ...(out.headers ?? {}) } });
  });
  const wait = vi.fn(async () => {});
  const deps: PublishDeps = { fetch: fetchFake as unknown as typeof fetch, wait, env: { SUPABASE_URL: STORE } };
  return { deps, calls, wait };
}

const account = (provider: string, external: string | null = "ext-1"): SocialAccountRow => ({ id: "acc", provider, external_account_id: external });
const post = (over: Partial<SocialPost> = {}): SocialPost => ({ id: "post-1", title: shared.title, body: shared.text, media: null, options: {}, ...over });

describe("YouTube", () => {
  const options = { ...startingOptions("youtube", shared), madeForKids: false, privacy: "unlisted" as const, notifySubscribers: false };

  it("starts an upload with the details, then sends the file to the address it is given", async () => {
    const { deps, calls } = setUp((call) => {
      if (call.url.includes("uploadType=resumable")) return { headers: { location: "https://upload.youtube.example/session-1" } };
      return { json: { id: "yt-video-9" } };
    }, 5000);
    const id = await publishPost(deps, account("youtube"), post({ media: video(5000), options }), TOKEN);
    expect(id).toBe("yt-video-9");
    const [start, put] = calls;
    const url = new URL(start.url);
    expect(url.origin + url.pathname).toBe("https://www.googleapis.com/upload/youtube/v3/videos");
    expect(url.searchParams.get("part")).toBe("snippet,status");
    expect(url.searchParams.get("notifySubscribers")).toBe("false");
    expect(start.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(start.headers["X-Upload-Content-Length"]).toBe("5000");
    expect(start.headers["X-Upload-Content-Type"]).toBe("video/mp4");
    expect(start.body).toEqual({
      snippet: { title: "Five tips", description: "What works.", tags: ["tips"], categoryId: "22" },
      status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false },
    });
    expect(put.url).toBe("https://upload.youtube.example/session-1");
    expect(put.method).toBe("PUT");
    expect(put.headers["Content-Length"]).toBe("5000");
  });

  it("is not sent at all while something YouTube needs is missing", async () => {
    const { deps, calls } = setUp(() => ({}));
    await expect(publishPost(deps, account("youtube"), post({ media: video(), options: { ...options, madeForKids: null } }), TOKEN))
      .rejects.toThrow("Say whether the video is made for kids. YouTube asks this of every video.");
    await expect(publishPost(deps, account("youtube"), post({ media: jpeg, options }), TOKEN)).rejects.toThrow("YouTube needs a video.");
    expect(calls).toHaveLength(0);
  });

  it("says to connect again when YouTube refuses the token", async () => {
    const { deps } = setUp(() => ({ status: 401, json: { error: { message: "Invalid Credentials" } } }));
    const error = await publishPost(deps, account("youtube"), post({ media: video(), options }), TOKEN).catch((e) => e);
    expect(error).toBeInstanceOf(PublishError);
    expect(error.reconnect).toBe(true);
    expect(error.message).toContain("Connect the YouTube account again");
    expect(error.message).not.toContain(TOKEN);
  });
});

describe("TikTok", () => {
  const options = { ...startingOptions("tiktok", shared), privacy: "PUBLIC_TO_EVERYONE" as const, allowComment: true, allowDuet: false, allowStitch: true };

  it("starts a direct post with who can see it, then sends the file with its byte range", async () => {
    const { deps, calls } = setUp((call) => (call.url.includes("/video/init/")
      ? { json: { data: { publish_id: "v_pub~1", upload_url: "https://upload.tiktok.example/video?upload_id=1" }, error: { code: "ok" } } }
      : { status: 201 }), 3000);
    const id = await publishPost(deps, account("tiktok"), post({ media: video(3000), options }), TOKEN);
    expect(id).toBe("v_pub~1");
    expect(calls[0].url).toBe("https://open.tiktokapis.com/v2/post/publish/video/init/");
    expect(calls[0].body).toEqual({
      post_info: {
        title: "Five tips\n\nWhat works.\n\n#tips", privacy_level: "PUBLIC_TO_EVERYONE",
        disable_comment: false, disable_duet: true, disable_stitch: false, brand_content_toggle: false, brand_organic_toggle: false,
      },
      source_info: { source: "FILE_UPLOAD", video_size: 3000, chunk_size: 3000, total_chunk_count: 1 },
    });
    expect(calls[1].method).toBe("PUT");
    expect(calls[1].headers["Content-Range"]).toBe("bytes 0-2999/3000");
    expect(calls[1].headers["Content-Length"]).toBe("3000");
    expect((calls[1].raw as Uint8Array).length).toBe(3000);
  });

  it("cuts a large file the way TikTok asks: the last piece carries what is left over", async () => {
    expect(tiktokChunks(TIKTOK_WHOLE_MAX)).toEqual({ chunkSize: TIKTOK_WHOLE_MAX, count: 1 });
    const size = TIKTOK_CHUNK * 4 + 123;
    expect(tiktokChunks(size + TIKTOK_WHOLE_MAX)).toEqual({ chunkSize: TIKTOK_CHUNK, count: Math.floor((size + TIKTOK_WHOLE_MAX) / TIKTOK_CHUNK) });
  });

  it("treats TikTok's own error code as a refusal, even on a 200", async () => {
    const { deps, calls } = setUp(() => ({ json: { error: { code: "spam_risk_too_many_posts", message: "Daily post cap reached" } } }));
    await expect(publishPost(deps, account("tiktok"), post({ media: video(), options }), TOKEN)).rejects.toThrow("TikTok did not accept the post: Daily post cap reached");
    expect(calls).toHaveLength(1);
  });

  it("is not sent until somebody chose who can see it", async () => {
    const { deps, calls } = setUp(() => ({}));
    await expect(publishPost(deps, account("tiktok"), post({ media: video(), options: { ...options, privacy: "" } }), TOKEN)).rejects.toThrow("Choose who can see the video on TikTok.");
    expect(calls).toHaveLength(0);
  });
});

describe("Instagram", () => {
  const options = startingOptions("instagram", shared);

  it("posts a picture: a container, then publish", async () => {
    const { deps, calls } = setUp((call) => (call.url.endsWith("/media") ? { json: { id: "container-1" } } : { json: { id: "ig-post-1" } }));
    expect(await publishPost(deps, account("instagram", "ig-user"), post({ media: jpeg, options }), TOKEN)).toBe("ig-post-1");
    expect(calls[0].url).toBe("https://graph.facebook.com/v24.0/ig-user/media");
    expect(calls[0].body).toEqual({ image_url: jpeg.url, caption: options.caption, access_token: TOKEN });
    expect(calls[1].url).toBe("https://graph.facebook.com/v24.0/ig-user/media_publish");
    expect(calls[1].body).toEqual({ creation_id: "container-1", access_token: TOKEN });
  });

  it("posts a video as a Reel, and waits until Instagram has prepared it", async () => {
    let checks = 0;
    const { deps, calls, wait } = setUp((call) => {
      if (call.url.endsWith("/media")) return { json: { id: "container-2" } };
      if (call.url.includes("fields=status_code")) { checks += 1; return { json: { status_code: checks < 3 ? "IN_PROGRESS" : "FINISHED" } }; }
      return { json: { id: "ig-reel-1" } };
    });
    expect(await publishPost(deps, account("instagram", "ig-user"), post({ media: video(), options: { ...options, shareToFeed: false } }), TOKEN)).toBe("ig-reel-1");
    expect(calls[0].body).toEqual({ media_type: "REELS", video_url: VIDEO_URL, caption: options.caption, share_to_feed: false, access_token: TOKEN });
    expect(checks).toBe(3);
    expect(wait).toHaveBeenCalledTimes(2);
    expect(calls.at(-1)!.url).toContain("/media_publish");
  });

  it("says so when Instagram cannot use the video, or is still preparing it", async () => {
    const failing = setUp((call) => (call.url.endsWith("/media") ? { json: { id: "c" } } : { json: { status_code: "ERROR" } }));
    await expect(publishPost(failing.deps, account("instagram"), post({ media: video(), options }), TOKEN)).rejects.toThrow(/Instagram could not use this video/);
    const slow = setUp((call) => (call.url.endsWith("/media") ? { json: { id: "c" } } : { json: { status_code: "IN_PROGRESS" } }));
    await expect(publishPost(slow.deps, account("instagram"), post({ media: video(), options }), TOKEN)).rejects.toThrow("Instagram is still preparing the video. Try again in a few minutes.");
    expect(slow.wait).toHaveBeenCalledTimes(IG_TRIES);
  });
});

describe("Facebook", () => {
  const options = startingOptions("facebook", shared);

  it("posts text to the Page feed", async () => {
    const { deps, calls } = setUp(() => ({ json: { id: "page_post" } }));
    expect(await publishPost(deps, account("facebook", "page-1"), post({ options }), TOKEN)).toBe("page_post");
    expect(calls[0].url).toBe("https://graph.facebook.com/v24.0/page-1/feed");
    expect(calls[0].body).toEqual({ message: options.message, access_token: TOKEN });
  });

  it("posts a picture by its address, with the text as its caption", async () => {
    const { deps, calls } = setUp(() => ({ json: { id: "photo-1", post_id: "page_post-2" } }));
    expect(await publishPost(deps, account("facebook", "page-1"), post({ media: jpeg, options }), TOKEN)).toBe("page_post-2");
    expect(calls[0].url).toBe("https://graph.facebook.com/v24.0/page-1/photos");
    expect(calls[0].body).toEqual({ url: jpeg.url, caption: options.message, access_token: TOKEN });
  });

  it("posts a video by its address, with a title and a description", async () => {
    const { deps, calls } = setUp(() => ({ json: { id: "video-1" } }));
    expect(await publishPost(deps, account("facebook", "page-1"), post({ media: video(), options }), TOKEN)).toBe("video-1");
    expect(calls[0].url).toBe("https://graph.facebook.com/v24.0/page-1/videos");
    expect(calls[0].body).toEqual({ file_url: VIDEO_URL, title: "Five tips", description: options.message, access_token: TOKEN });
  });
});

describe("X", () => {
  const options = startingOptions("x", shared);

  it("posts text alone", async () => {
    const { deps, calls } = setUp(() => ({ json: { data: { id: "tweet-1" } } }));
    expect(await publishPost(deps, account("x"), post({ options }), TOKEN)).toBe("tweet-1");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.x.com/2/tweets");
    expect(calls[0].body).toEqual({ text: options.text });
  });

  it("uploads a video in pieces (start, append each piece, finish, wait), then attaches it", async () => {
    const size = X_CHUNK + 10;
    let status = 0;
    const { deps, calls } = setUp((call) => {
      if (call.url.endsWith("/initialize")) return { json: { data: { id: "media-7" } } };
      if (call.url.endsWith("/finalize")) return { json: { data: { id: "media-7", processing_info: { state: "pending", check_after_secs: 1 } } } };
      if (call.url.includes("command=STATUS")) { status += 1; return { json: { data: { processing_info: { state: status < 2 ? "in_progress" : "succeeded", check_after_secs: 1 } } } }; }
      if (call.url.endsWith("/2/tweets")) return { json: { data: { id: "tweet-2" } } };
      return {};
    }, size);
    expect(await publishPost(deps, account("x"), post({ media: video(size), options }), TOKEN)).toBe("tweet-2");
    expect(calls[0].url).toBe("https://api.x.com/2/media/upload/initialize");
    expect(calls[0].body).toEqual({ media_type: "video/mp4", total_bytes: size, media_category: "tweet_video" });
    const appends = calls.filter((c) => c.url.endsWith("/media-7/append"));
    expect(appends).toHaveLength(2);
    expect((appends[0].raw as FormData).get("segment_index")).toBe("0");
    expect((appends[1].raw as FormData).get("segment_index")).toBe("1");
    expect(((appends[1].raw as FormData).get("media") as Blob).size).toBe(10);
    expect(status).toBe(2);
    expect(calls.at(-1)!.body).toEqual({ text: options.text, media: { media_ids: ["media-7"] } });
  });
});

describe("LinkedIn and anything else", () => {
  it("posts the text to LinkedIn", async () => {
    const { deps, calls } = setUp(() => ({ headers: { "x-restli-id": "urn:li:share:1" } }));
    expect(await publishPost(deps, account("linkedin", "urn:li:person:1"), post({ options: startingOptions("linkedin", shared) }), TOKEN)).toBe("urn:li:share:1");
    expect((calls[0].body as { commentary: string }).commentary).toContain("Five tips");
  });

  it("refuses a kind of account it cannot post to", async () => {
    const { deps } = setUp(() => ({}));
    await expect(publishPost(deps, account("other"), post(), TOKEN)).rejects.toThrow("Posting to this kind of account is not available.");
  });
});

describe("the file", () => {
  it("is fetched only from this project's own storage, never from an address somebody chose", async () => {
    const { deps, calls } = setUp(() => ({}));
    const elsewhere: PostMedia = { ...video(), url: "https://internal.example/secret.mp4" };
    const options = { ...startingOptions("youtube", shared), madeForKids: false };
    await expect(publishPost(deps, account("youtube"), post({ media: elsewhere, options }), TOKEN)).rejects.toThrow(/not one that was uploaded here/);
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("says only which platform could not be reached when the network fails", async () => {
    const deps: PublishDeps = { fetch: (async () => { throw new TypeError("fetch failed: ECONNRESET 10.0.0.4"); }) as unknown as typeof fetch, wait: async () => {}, env: { SUPABASE_URL: STORE } };
    await expect(publishPost(deps, account("x"), post({ options: startingOptions("x", shared) }), TOKEN)).rejects.toThrow("X could not be reached. Try again.");
  });
});

describe("the key of an account", () => {
  it("is a bare token, or a token with what renews it", () => {
    expect(readSecret("abc")).toEqual({ accessToken: "abc" });
    expect(readSecret('{"accessToken":"a","refreshToken":"r","expiresAt":5}')).toEqual({ accessToken: "a", refreshToken: "r", expiresAt: 5 });
    expect(writeSecret({ accessToken: "abc" })).toBe("abc");
    expect(readSecret(writeSecret({ accessToken: "a", refreshToken: "r", expiresAt: 5 }))).toEqual({ accessToken: "a", refreshToken: "r", expiresAt: 5 });
    expect(readSecret("{not json")).toEqual({ accessToken: "" });
  });

  it("is renewed when it has run out, and only when it can be", () => {
    expect(isStale({ accessToken: "a" }, 1000)).toBe(false);
    expect(isStale({ accessToken: "a", refreshToken: "r" }, 1000)).toBe(true);
    expect(isStale({ accessToken: "a", refreshToken: "r", expiresAt: 1000 + 60_000 }, 1000)).toBe(true);
    expect(isStale({ accessToken: "a", refreshToken: "r", expiresAt: 1000 + 3_600_000 }, 1000)).toBe(false);
  });

  it("asks Google for a new YouTube token with the app's own keys", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchFake = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return new Response(JSON.stringify({ access_token: "new-token", expires_in: 3600 }), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await refreshSecret({ fetch: fetchFake, env: { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "cs" } }, "youtube", { accessToken: "old", refreshToken: "r" }, 1000);
    expect(out).toEqual({ accessToken: "new-token", refreshToken: "r", expiresAt: 1000 + 3_600_000 });
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(Object.fromEntries(new URLSearchParams(calls[0].body))).toEqual({ client_id: "cid", client_secret: "cs", refresh_token: "r", grant_type: "refresh_token" });
  });

  it("keeps the new refresh token TikTok hands out, and gives up quietly when it cannot renew", async () => {
    const ok = (async () => new Response(JSON.stringify({ access_token: "t2", refresh_token: "r2", expires_in: 86400 }), { status: 200 })) as unknown as typeof fetch;
    expect(await refreshSecret({ fetch: ok, env: { TIKTOK_CLIENT_KEY: "k", TIKTOK_CLIENT_SECRET: "s" } }, "tiktok", { accessToken: "t", refreshToken: "r" }, 0))
      .toEqual({ accessToken: "t2", refreshToken: "r2", expiresAt: 86_400_000 });
    // The app's keys are not set, the platform has no renewal, or it says no.
    expect(await refreshSecret({ fetch: ok, env: {} }, "tiktok", { accessToken: "t", refreshToken: "r" }, 0)).toBeNull();
    expect(await refreshSecret({ fetch: ok, env: {} }, "facebook", { accessToken: "t", refreshToken: "r" }, 0)).toBeNull();
    const no = (async () => new Response("{}", { status: 400 })) as unknown as typeof fetch;
    expect(await refreshSecret({ fetch: no, env: { X_CLIENT_ID: "x" } }, "x", { accessToken: "t", refreshToken: "r" }, 0)).toBeNull();
  });
});
