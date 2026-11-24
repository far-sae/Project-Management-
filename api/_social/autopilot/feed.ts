/**
 * Reading a page's own posts and their numbers from the posting service.
 *
 * The feed of an account is every post on it, also the ones that were not made
 * here. Each platform names its numbers in its own way (TikTok says
 * "view_count", Instagram "views", Facebook "video_views"). `numbersOf`
 * brings them down to the same six, so posts can be compared and kept in one
 * table.
 */
import { NO_NUMBERS, type PostNumbers } from "../shared/autopilot.js";
import { serviceCall, type ServiceDeps } from "../service.js";

const obj = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** The first of these names that holds a real, non-negative number. */
function pick(from: Record<string, unknown>, names: string[]): number {
  for (const name of names) {
    const value = from[name];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.floor(value);
  }
  return 0;
}

const NAMES: Record<keyof PostNumbers, string[]> = {
  views: ["views", "video_views", "view_count", "media_views", "impression_count", "impressions", "impression", "impressionCount"],
  likes: ["likes", "like_count", "reactions_total", "reaction", "likeCount", "favorite_count"],
  comments: ["comments", "comment_count", "comment", "reply_count", "replies", "commentCount"],
  shares: ["shares", "share_count", "retweet_count", "reposts", "repost_count", "shareCount"],
  saves: ["saved", "saves", "favorites", "save", "bookmark_count"],
  reach: ["reach", "unique_impressions", "uniqueImpressionsCount"],
};

/** A platform's own figures for one post, as our six numbers. Anything missing is 0. */
export function numbersOf(metrics: unknown): PostNumbers {
  const m = obj(metrics);
  // X keeps its numbers one level down, in up to three groups. The fullest one wins.
  const groups = [m, obj(m.organic_metrics), obj(m.public_metrics), obj(m.non_public_metrics), obj(m.lifetime_metrics)];
  const out: PostNumbers = { ...NO_NUMBERS };
  for (const key of Object.keys(NAMES) as Array<keyof PostNumbers>) {
    out[key] = Math.max(...groups.map((g) => pick(g, NAMES[key])));
  }
  return out;
}

/** Whether the post carries a video, a picture, or it is not known (""). */
export function kindOf(raw: Record<string, unknown>): "video" | "image" | "" {
  const metrics = obj(raw.metrics);
  if (Object.keys(metrics).some((name) => /video|watch/i.test(name))) return "video";
  let media = "";
  try { media = JSON.stringify(raw.media ?? "").toLowerCase(); } catch { media = ""; }
  if (/video|\.mp4|\.mov|reel/.test(media) || /\/(reel|reels|shorts|video|watch)\b/.test(text(raw.platform_url).toLowerCase())) return "video";
  if (/image|photo|\.jpe?g|\.png|\.webp/.test(media)) return "image";
  return "";
}

export type FeedItem = PostNumbers & {
  platformPostId: string;
  url: string;
  caption: string;
  kind: "video" | "image" | "";
  postedAt: string | null;
  /** The service's id of our own post, when this one was sent through it. */
  servicePostId: string | null;
};

const isoOrNull = (value: unknown): string | null => {
  const time = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

/** One post of a feed, or null when it has no id to know it by. */
export function feedItemOf(raw: unknown): FeedItem | null {
  const post = obj(raw);
  const platformPostId = text(post.platform_post_id).trim();
  if (!platformPostId) return null;
  const url = text(post.platform_url);
  return {
    platformPostId: platformPostId.slice(0, 200),
    url: /^https:\/\/[^\s]+$/.test(url) ? url.slice(0, 1000) : "",
    caption: text(post.caption).slice(0, 5000),
    kind: kindOf(post),
    postedAt: isoOrNull(post.posted_at),
    servicePostId: text(post.social_post_id) || null,
    ...numbersOf(post.metrics),
  };
}

/** How many posts of one account are read in a run. */
export const FEED_LIMIT = 50;

/** Why a feed could not be read. `permission`: the account was connected before reading was asked for. */
export class FeedError extends Error {
  constructor(public kind: "permission" | "failed") {
    super(kind);
    this.name = "FeedError";
  }
}

/** The latest posts of one account connected through the service, with their numbers. */
export async function readFeed(d: ServiceDeps, serviceAccountId: string): Promise<FeedItem[]> {
  let answer: { status: number; json: Record<string, unknown> };
  try {
    answer = await serviceCall(d, "GET", `/v1/social-account-feeds/${encodeURIComponent(serviceAccountId)}?expand=metrics&limit=${FEED_LIMIT}`);
  } catch {
    throw new FeedError("failed");
  }
  // The service refuses the feed of an account that was connected for posting alone.
  if (answer.status === 400 || answer.status === 403) throw new FeedError("permission");
  if (answer.status < 200 || answer.status >= 300) throw new FeedError("failed");
  const data = Array.isArray(answer.json.data) ? answer.json.data : [];
  return data.map(feedItemOf).filter((item): item is FeedItem => item !== null);
}
