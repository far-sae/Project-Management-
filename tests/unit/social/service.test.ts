// @vitest-environment node
// The posting service: one account with it replaces a developer app at every
// platform. It gives the log-in address for connecting an account, lists the
// accounts connected for a workspace, takes a post, and says how it went.
import { describe, expect, it } from "vitest";
import {
  SERVICE_REF, serviceAccounts, serviceAuthUrl, serviceConfiguration, serviceIdOf, serviceOn, servicePost, serviceResult, workspaceTag,
  type ServiceDeps,
} from "../../../api/_social/service";
import { PublishError, type SocialPost } from "../../../api/_social/publishers";
import { startingOptions } from "../../../api/_social/shared/platforms";

const ENV = { POST_FOR_ME_API_KEY: "pfm_key" };
const WS = "11111111-1111-4111-8111-111111111111";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
type Reply = { status?: number; json?: unknown; text?: string };

function setUp(reply: (call: Call, n: number) => Reply = () => ({})) {
  const calls: Call[] = [];
  const deps: ServiceDeps = {
    env: ENV,
    fetch: (async (input: unknown, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      const call: Call = { url: String(input), method: init?.method ?? "GET", headers: init?.headers ?? {}, body: init?.body ? JSON.parse(init.body) : undefined };
      calls.push(call);
      const r = reply(call, calls.length);
      return new Response(r.text ?? JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
    }) as unknown as typeof fetch,
  };
  return { deps, calls };
}

const shared = { title: "Five tips", text: "What works for a brighter smile.", tags: ["dental", "tips"] };
const video = { url: "https://abc.supabase.co/storage/v1/object/public/social-media/ws/clip.mp4", kind: "video" as const, mime: "video/mp4", bytes: 1000, name: "clip.mp4" };
const post = (platform: Parameters<typeof startingOptions>[0], over: Record<string, unknown> = {}, media: SocialPost["media"] = video): SocialPost => ({
  id: "post-1", title: shared.title, body: shared.text, media, options: { ...startingOptions(platform, shared), ...over },
});

describe("the posting service: is it on", () => {
  it("is on with its key, off without", () => {
    expect(serviceOn(ENV)).toBe(true);
    expect(serviceOn({ POST_FOR_ME_API_KEY: "  " })).toBe(false);
    expect(serviceOn({})).toBe(false);
  });

  it("knows which of our accounts are connected through it", () => {
    expect(serviceIdOf({ id: "a", provider: "youtube", external_account_id: "spc_1", credential_ref: `${SERVICE_REF}spc_1` })).toBe("spc_1");
    expect(serviceIdOf({ id: "a", provider: "youtube", external_account_id: "UC1", credential_ref: "social_account_secrets:a" })).toBeNull();
    expect(serviceIdOf({ id: "a", provider: "youtube", external_account_id: "UC1" })).toBeNull();
  });
});

describe("the posting service: connecting an account", () => {
  it("asks for a log-in address for the platform, marked with the workspace", async () => {
    const s = setUp(() => ({ json: { platform: "youtube", url: "https://accounts.google.com/o/oauth2/auth?x=1" } }));
    expect(await serviceAuthUrl(s.deps, "youtube", WS)).toBe("https://accounts.google.com/o/oauth2/auth?x=1");
    expect(s.calls[0].url).toBe("https://api.postforme.dev/v1/social-accounts/auth-url");
    expect(s.calls[0].method).toBe("POST");
    expect(s.calls[0].headers.Authorization).toBe("Bearer pfm_key");
    expect(s.calls[0].body).toEqual({ platform: "youtube", external_id: workspaceTag(WS) });
  });

  it("connects LinkedIn the way the service's own apps require", async () => {
    const s = setUp(() => ({ json: { url: "https://www.linkedin.com/oauth/v2/authorization?x=1" } }));
    await serviceAuthUrl(s.deps, "linkedin", WS);
    expect(s.calls[0].body).toMatchObject({ platform: "linkedin", platform_data: { linkedin: { connection_type: "organization" } } });
  });

  it("tries Instagram's own log-in first, and the plain request when that is refused", async () => {
    const s = setUp((call, n) => (n === 1 ? { status: 400, json: { message: "bad" } } : { json: { url: "https://www.instagram.com/oauth/authorize?x=1" } }));
    expect(await serviceAuthUrl(s.deps, "instagram", WS)).toContain("instagram.com");
    expect(s.calls[0].body).toMatchObject({ platform: "instagram", platform_data: { instagram: { connection_type: "instagram" } } });
    expect(s.calls[1].body).toEqual({ platform: "instagram", external_id: workspaceTag(WS) });
  });

  it("says plainly when no address can be had, and only accepts an https address", async () => {
    const refused = setUp(() => ({ status: 401, json: { message: "Invalid API key sk_live_secret" } }));
    await expect(serviceAuthUrl(refused.deps, "x", WS)).rejects.toThrow("The account could not be connected. Please try again.");
    const odd = setUp(() => ({ json: { url: "javascript:alert(1)" } }));
    await expect(serviceAuthUrl(odd.deps, "tiktok", WS)).rejects.toThrow("The account could not be connected. Please try again.");
  });

  it("lists the accounts connected for one workspace, and never their keys", async () => {
    const s = setUp(() => ({ json: { data: [
      { id: "spc_1", platform: "youtube", username: "Northwind channel", user_id: "UC1", status: "connected", access_token: "ya29.secret", refresh_token: "1//secret", external_id: workspaceTag(WS) },
      { id: "spc_2", platform: "tiktok_business", username: null, user_id: "tt1", status: "connected", access_token: "secret", external_id: workspaceTag(WS) },
      { id: "spc_3", platform: "pinterest", username: "pins", user_id: "p1", status: "connected", external_id: workspaceTag(WS) },
      { id: "spc_4", platform: "x", username: "northwind", user_id: "x1", status: "disconnected", external_id: workspaceTag(WS) },
      { id: "spc_5", platform: "facebook", username: "Harbour Dental", user_id: "f1", status: "connected", external_id: "tc_someone-else" },
      { id: "not an id", platform: "facebook", username: "x", status: "connected", external_id: workspaceTag(WS) },
    ] } }));
    const found = await serviceAccounts(s.deps, WS);
    expect(found).toEqual([
      { serviceId: "spc_1", provider: "youtube", name: "Northwind channel" },
      // TikTok's two kinds are one network here; an account without a name gets a plain one.
      { serviceId: "spc_2", provider: "tiktok", name: "TikTok account" },
    ]);
    expect(JSON.stringify(found)).not.toContain("secret");
    const url = new URL(s.calls[0].url);
    expect(url.pathname).toBe("/v1/social-accounts");
    expect(url.searchParams.get("external_id")).toBe(workspaceTag(WS));
    expect(url.searchParams.get("status")).toBe("connected");
  });
});

describe("the posting service: accounts named on the way back", () => {
  const TAG = workspaceTag(WS);
  const byTag = { data: [{ id: "spc_1", platform: "youtube", username: "Northwind channel", status: "connected", external_id: TAG }] };

  it("also takes an account the log-in named that carries no workspace yet, and marks it as this workspace's", async () => {
    const s = setUp((call) => {
      if (call.method === "PATCH") return { json: {} };
      return new URL(call.url).searchParams.has("id")
        ? { json: { data: [
          { id: "spc_7", platform: "instagram", username: "northwind.studio", status: "connected", external_id: null },
          { id: "spc_8", platform: "facebook", username: "Other workspace", status: "connected", external_id: "tc_another" },
        ] } }
        : { json: byTag };
    });
    const found = await serviceAccounts(s.deps, WS, ["spc_7", "spc_8", "bad id!"]);
    expect(found.map((a) => a.serviceId)).toEqual(["spc_1", "spc_7"]);
    const asked = new URL(s.calls[1].url);
    // Only ids that look like ids are asked for.
    expect(asked.searchParams.getAll("id")).toEqual(["spc_7", "spc_8"]);
    const patch = s.calls.find((c) => c.method === "PATCH");
    expect(patch?.url).toBe("https://api.postforme.dev/v1/social-accounts/spc_7");
    expect(patch?.body).toEqual({ external_id: TAG });
  });

  it("never takes an account that belongs to another workspace, and never one that was not named", async () => {
    const s = setUp((call) => (new URL(call.url).searchParams.has("id")
      ? { json: { data: [{ id: "spc_99", platform: "x", username: "stranger", status: "connected", external_id: null }] } }
      : { json: byTag }));
    // The service answered with an account that was not asked for: it is left alone.
    expect((await serviceAccounts(s.deps, WS, ["spc_7"])).map((a) => a.serviceId)).toEqual(["spc_1"]);
  });

  it("still lists the workspace's accounts when the named ones cannot be read", async () => {
    const s = setUp((call) => (new URL(call.url).searchParams.has("id") ? { status: 500, text: "down" } : { json: byTag }));
    expect((await serviceAccounts(s.deps, WS, ["spc_7"])).map((a) => a.serviceId)).toEqual(["spc_1"]);
  });
});

describe("the posting service: a post's own fields", () => {
  it("gives YouTube its title, description, tags, category, who can watch and the made-for-kids answer", () => {
    const c = serviceConfiguration("youtube", post("youtube", { privacy: "unlisted", madeForKids: false, categoryId: "27" }));
    expect(c).toMatchObject({ title: "Five tips", privacy_status: "unlisted", made_for_kids: false, category_id: "27", tags: ["dental", "tips"] });
    expect(String(c.description)).toContain("What works");
  });

  it("gives TikTok who can watch and what is allowed, and never makes a video more public than asked", () => {
    const open = serviceConfiguration("tiktok", post("tiktok", { privacy: "PUBLIC_TO_EVERYONE", allowComment: true, allowDuet: false, allowStitch: true, brandOrganic: true }));
    expect(open).toMatchObject({ privacy_status: "public", allow_comment: true, allow_duet: false, allow_stitch: true, disclose_your_brand: true, disclose_branded_content: false });
    for (const privacy of ["SELF_ONLY", "FOLLOWER_OF_CREATOR", "MUTUAL_FOLLOW_FRIENDS", ""]) {
      expect(serviceConfiguration("tiktok", post("tiktok", { privacy })).privacy_status).toBe("private");
    }
  });

  it("gives Instagram a reel for a video and a feed post for a picture", () => {
    expect(serviceConfiguration("instagram", post("instagram", { shareToFeed: false }))).toMatchObject({ placement: "reels", share_to_feed: false });
    const picture = { ...video, kind: "image" as const, mime: "image/jpeg", url: "https://abc.supabase.co/x.jpg" };
    expect(serviceConfiguration("instagram", post("instagram", {}, picture)).placement).toBe("timeline");
  });
});

describe("the posting service: sending a post", () => {
  it("hands over the text, the file's address and the account's own fields", async () => {
    const s = setUp(() => ({ json: { id: "sp_123", status: "processing" } }));
    expect(await servicePost(s.deps, "spc_1", "youtube", post("youtube", { madeForKids: false }))).toBe("sp_123");
    expect(s.calls[0].url).toBe("https://api.postforme.dev/v1/social-posts");
    const body = s.calls[0].body as Record<string, any>;
    expect(body.social_accounts).toEqual(["spc_1"]);
    expect(body.media).toEqual([{ url: video.url }]);
    expect(body.external_id).toBe("post-1");
    expect(typeof body.caption).toBe("string");
    expect(body.account_configurations).toEqual([{ social_account_id: "spc_1", configuration: serviceConfiguration("youtube", post("youtube", { madeForKids: false })) }]);
    expect(body.scheduled_at).toBeUndefined();
  });

  it("sends a post without a file as text only", async () => {
    const s = setUp(() => ({ json: { id: "sp_9" } }));
    await servicePost(s.deps, "spc_x", "x", post("x", {}, null));
    expect((s.calls[0].body as Record<string, unknown>).media).toBeUndefined();
  });

  it("asks to wait when the service is busy or down, so the post is tried again and not lost", async () => {
    for (const status of [429, 500, 503]) {
      const s = setUp(() => ({ status, text: "busy" }));
      expect(await servicePost(s.deps, "spc_1", "x", post("x"))).toBeNull();
    }
    const down = setUp();
    down.deps.fetch = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    expect(await servicePost(down.deps, "spc_1", "x", post("x"))).toBeNull();
  });

  it("says the post could not be sent when the service refuses it, without its inner words", async () => {
    const s = setUp(() => ({ status: 400, json: { statusCode: 400, message: "account_configurations.0.configuration must be an object" } }));
    const error = await servicePost(s.deps, "spc_1", "x", post("x")).catch((e) => e);
    expect(error).toBeInstanceOf(PublishError);
    expect(error.message).toBe("The post could not be sent. Try again.");
  });

  it("says the account must be connected again when the service no longer knows the key or the account", async () => {
    for (const status of [401, 403, 404]) {
      const s = setUp(() => ({ status, json: { message: "nope" } }));
      const error = await servicePost(s.deps, "spc_1", "youtube", post("youtube", { madeForKids: false })).catch((e) => e);
      expect(error).toBeInstanceOf(PublishError);
      expect(status === 404 ? error.reconnect : true).toBe(true);
    }
  });
});

describe("the posting service: how a post went", () => {
  it("is not known yet while the platform is still working", async () => {
    const s = setUp(() => ({ json: { data: [] } }));
    expect(await serviceResult(s.deps, "sp_123", "youtube")).toBeNull();
    const url = new URL(s.calls[0].url);
    expect(url.pathname).toBe("/v1/social-post-results");
    expect(url.searchParams.get("post_id")).toBe("sp_123");
  });

  it("gives the address of the published post", async () => {
    const s = setUp(() => ({ json: { data: [{ id: "spr_1", success: true, error: null, platform_data: { id: "abc", url: "https://youtu.be/abc" } }] } }));
    expect(await serviceResult(s.deps, "sp_123", "youtube")).toEqual({ ok: true, id: "https://youtu.be/abc" });
    const bare = setUp(() => ({ json: { data: [{ success: true, platform_data: {} }] } }));
    expect(await serviceResult(bare.deps, "sp_123", "x")).toEqual({ ok: true, id: "sp_123" });
  });

  it("passes on the platform's reason in a plain sentence", async () => {
    const s = setUp(() => ({ json: { data: [{ success: false, error: "Video is too long for this account.", platform_data: {} }] } }));
    expect(await serviceResult(s.deps, "sp_1", "tiktok")).toEqual({ ok: false, message: "TikTok did not accept the post: Video is too long for this account.", reconnect: false });
    const object = setUp(() => ({ json: { data: [{ success: false, error: { message: "Image aspect ratio not supported" } }] } }));
    expect(await serviceResult(object.deps, "sp_1", "instagram")).toMatchObject({ message: "Instagram did not accept the post: Image aspect ratio not supported." });
  });

  it("says to connect the account again when the platform refused the connection itself", async () => {
    const s = setUp(() => ({ json: { data: [{ success: false, error: "Error validating access token: session has expired" }] } }));
    expect(await serviceResult(s.deps, "sp_1", "facebook")).toEqual({
      ok: false, reconnect: true, message: "Facebook account needs to be connected again. Connect it again, then try the post again.",
    });
  });

  it("never shows the inside of a failure that is not a sentence", async () => {
    for (const error of [{ code: 500, stack: "at Object.<anonymous> (/srv/app.js:1:1)" }, '{"error":{"code":190}}', "x".repeat(900), null]) {
      const s = setUp(() => ({ json: { data: [{ success: false, error }] } }));
      const out = (await serviceResult(s.deps, "sp_1", "x")) as { message: string };
      expect(out.message.length).toBeLessThan(260);
      expect(out.message).not.toMatch(/[{}<>]|stack|srv/);
      expect(out.message.startsWith("X did not accept the post")).toBe(true);
    }
  });

  it("is not known when the service cannot be asked", async () => {
    const s = setUp(() => ({ status: 500, text: "down" }));
    expect(await serviceResult(s.deps, "sp_1", "x")).toBeNull();
  });
});
