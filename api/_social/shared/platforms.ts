/**
 * What each social platform needs for a post, in one place. The composer uses
 * it to show the right boxes and to say what is still missing; the server uses
 * the same rules before it sends anything.
 *
 * The limits come from each platform's own documentation (YouTube Data API,
 * TikTok Content Posting API, Instagram and Facebook Graph API, X API v2,
 * LinkedIn Posts API).
 */

export type Platform = "youtube" | "tiktok" | "instagram" | "facebook" | "x" | "linkedin";

export const PLATFORMS: Platform[] = ["youtube", "tiktok", "instagram", "facebook", "x", "linkedin"];

export const PLATFORM_NAME: Record<Platform, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X",
  linkedin: "LinkedIn",
};

export const isPlatform = (value: unknown): value is Platform => typeof value === "string" && (PLATFORMS as string[]).includes(value);

/** The one file a post carries: a picture or a video, already uploaded where the platforms can fetch it. */
export type PostMedia = {
  url: string;
  kind: "image" | "video";
  /** For example "video/mp4" or "image/jpeg". */
  mime: string;
  bytes: number;
  name: string;
};

export type YouTubePrivacy = "public" | "unlisted" | "private";
export type TikTokPrivacy = "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY";

export type YouTubeOptions = {
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  privacy: YouTubePrivacy;
  /** YouTube asks this of every upload. Null until the person has answered. */
  madeForKids: boolean | null;
  notifySubscribers: boolean;
};

export type TikTokOptions = {
  caption: string;
  /** TikTok does not allow a ready-made choice: the person picks. "" until they have. */
  privacy: TikTokPrivacy | "";
  allowComment: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
  /** The video promotes the poster's own business. */
  brandOrganic: boolean;
  /** The video is a paid partnership for somebody else's business. */
  brandContent: boolean;
};

export type InstagramOptions = { caption: string; /** A reel is also shown in the feed. */ shareToFeed: boolean };
export type FacebookOptions = { message: string; /** The title of a video. */ title: string };
export type XOptions = { text: string };
export type LinkedInOptions = { text: string };

export type PlatformOptions = {
  youtube: YouTubeOptions;
  tiktok: TikTokOptions;
  instagram: InstagramOptions;
  facebook: FacebookOptions;
  x: XOptions;
  linkedin: LinkedInOptions;
};

export const LIMITS = {
  youtubeTitle: 100,
  youtubeDescription: 5000,
  /** All tags together, as YouTube counts them. */
  youtubeTags: 500,
  tiktokCaption: 2200,
  instagramCaption: 2200,
  instagramHashtags: 30,
  facebookMessage: 63206,
  facebookTitle: 255,
  xText: 280,
  linkedinText: 3000,
} as const;

export const YOUTUBE_CATEGORIES: Array<{ id: string; name: string }> = [
  { id: "22", name: "People & Blogs" },
  { id: "27", name: "Education" },
  { id: "28", name: "Science & Technology" },
  { id: "26", name: "Howto & Style" },
  { id: "24", name: "Entertainment" },
  { id: "25", name: "News & Politics" },
  { id: "10", name: "Music" },
  { id: "17", name: "Sports" },
  { id: "20", name: "Gaming" },
  { id: "23", name: "Comedy" },
  { id: "19", name: "Travel & Events" },
  { id: "15", name: "Pets & Animals" },
  { id: "2", name: "Autos & Vehicles" },
  { id: "1", name: "Film & Animation" },
  { id: "29", name: "Nonprofits & Activism" },
];

export const TIKTOK_PRIVACY_LABEL: Record<TikTokPrivacy, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
};

/** What the person typed once, at the top: every platform starts from it. */
export type SharedText = { title: string; text: string; tags: string[] };

const cut = (value: string, max: number): string => (value.length > max ? value.slice(0, max) : value);

/** "#Dental care, tips" → ["Dental care", "tips"]: tags as YouTube takes them, without the # and without repeats. */
export function readTags(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(/[,\n]/)) {
    const tag = part.trim().replace(/^#+/, "").replace(/\s+/g, " ").trim();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** The tags as hashtags at the end of a caption: "#dentalcare #tips". */
export const hashtags = (tags: string[]): string => tags.map((t) => `#${t.replace(/[^\p{L}\p{N}_]/gu, "")}`).filter((t) => t.length > 1).join(" ");

const withTags = (text: string, tags: string[]): string => {
  const tail = hashtags(tags);
  return tail ? (text.trim() ? `${text.trim()}\n\n${tail}` : tail) : text.trim();
};

/**
 * What each platform starts with, made from what was typed once. A caption
 * gets the tags as hashtags; YouTube gets them as tags. Nothing is published
 * from this without the person seeing it first.
 */
export function startingOptions<P extends Platform>(platform: P, shared: SharedText): PlatformOptions[P] {
  const title = shared.title.trim();
  const text = shared.text.trim();
  const caption = withTags(title && text ? `${title}\n\n${text}` : title || text, shared.tags);
  const all: PlatformOptions = {
    youtube: {
      title: cut(title || text.split("\n")[0] || "", LIMITS.youtubeTitle),
      description: cut(text, LIMITS.youtubeDescription),
      tags: shared.tags,
      categoryId: "22",
      privacy: "public",
      madeForKids: null,
      notifySubscribers: true,
    },
    tiktok: { caption: cut(caption, LIMITS.tiktokCaption), privacy: "", allowComment: true, allowDuet: false, allowStitch: false, brandOrganic: false, brandContent: false },
    instagram: { caption: cut(caption, LIMITS.instagramCaption), shareToFeed: true },
    facebook: { message: cut(caption, LIMITS.facebookMessage), title: cut(title, LIMITS.facebookTitle) },
    x: { text: cut(withTags(title || text, shared.tags), LIMITS.xText) },
    linkedin: { text: cut(caption, LIMITS.linkedinText) },
  };
  return all[platform];
}

/** YouTube counts a tag with a space as two characters longer (it is quoted), and one character for each comma between tags. */
export const youtubeTagsLength = (tags: string[]): number =>
  tags.reduce((sum, tag) => sum + tag.length + (/\s/.test(tag) ? 2 : 0), 0) + Math.max(0, tags.length - 1);

const countHashtags = (text: string): number => (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;

const over = (what: string, length: number, max: number): string | null =>
  length > max ? `${what} is ${length - max} ${length - max === 1 ? "character" : "characters"} too long (the limit is ${max.toLocaleString("en-GB")}).` : null;

/**
 * Everything still wrong with one platform's part of a post, as sentences for
 * the person. An empty list means it can be posted.
 */
export function postProblems<P extends Platform>(platform: P, options: PlatformOptions[P], media: PostMedia | null): string[] {
  const problems: Array<string | null> = [];
  const name = PLATFORM_NAME[platform];
  if (platform === "youtube") {
    const o = options as YouTubeOptions;
    if (!media || media.kind !== "video") problems.push("YouTube needs a video.");
    if (!o.title.trim()) problems.push("YouTube needs a title.");
    if (/[<>]/.test(o.title)) problems.push("A YouTube title cannot contain < or >.");
    problems.push(over("The YouTube title", o.title.length, LIMITS.youtubeTitle));
    problems.push(over("The YouTube description", o.description.length, LIMITS.youtubeDescription));
    if (/[<>]/.test(o.description)) problems.push("A YouTube description cannot contain < or >.");
    problems.push(over("The YouTube tags together", youtubeTagsLength(o.tags), LIMITS.youtubeTags));
    if (o.madeForKids === null) problems.push("Say whether the video is made for kids. YouTube asks this of every video.");
  } else if (platform === "tiktok") {
    const o = options as TikTokOptions;
    if (!media || media.kind !== "video") problems.push("TikTok needs a video.");
    if (!o.privacy) problems.push("Choose who can see the video on TikTok.");
    problems.push(over("The TikTok caption", o.caption.length, LIMITS.tiktokCaption));
    // TikTok's rule: a paid partnership cannot be posted to "Only me".
    if (o.brandContent && o.privacy === "SELF_ONLY") problems.push("A paid partnership on TikTok cannot be set to “Only me”.");
  } else if (platform === "instagram") {
    const o = options as InstagramOptions;
    if (!media) problems.push("Instagram needs a picture or a video.");
    else if (media.kind === "image" && !/^image\/jpe?g$/i.test(media.mime)) problems.push("Instagram takes JPEG pictures only. Save the picture as a JPEG and upload it again.");
    problems.push(over("The Instagram caption", o.caption.length, LIMITS.instagramCaption));
    if (countHashtags(o.caption) > LIMITS.instagramHashtags) problems.push(`Instagram allows ${LIMITS.instagramHashtags} hashtags in a post.`);
  } else if (platform === "facebook") {
    const o = options as FacebookOptions;
    if (!media && !o.message.trim()) problems.push("Facebook needs some text, a picture or a video.");
    problems.push(over("The Facebook text", o.message.length, LIMITS.facebookMessage));
    problems.push(over("The Facebook video title", o.title.length, LIMITS.facebookTitle));
  } else if (platform === "x") {
    const o = options as XOptions;
    if (!media && !o.text.trim()) problems.push("X needs some text, a picture or a video.");
    problems.push(over("The X post", o.text.length, LIMITS.xText));
  } else {
    const o = options as LinkedInOptions;
    if (!o.text.trim()) problems.push(`${name} needs some text.`);
    problems.push(over("The LinkedIn text", o.text.length, LIMITS.linkedinText));
  }
  return problems.filter((p): p is string => p !== null);
}

/** What a platform does with the file, for the line under its name: "Posted as a Reel", "Text only". */
export function mediaNote(platform: Platform, media: PostMedia | null): string {
  if (platform === "linkedin") return media ? "The text only. The file is not sent to LinkedIn." : "Text post";
  if (!media) return platform === "facebook" || platform === "x" ? "Text post" : "";
  if (platform === "youtube") return "Uploaded as a video";
  if (platform === "tiktok") return "Posted as a video";
  if (platform === "instagram") return media.kind === "video" ? "Posted as a Reel" : "Posted as a picture";
  return media.kind === "video" ? "Posted with the video" : "Posted with the picture";
}
