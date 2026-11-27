/**
 * The social media autopilot: the words and shapes that the server and the
 * screen share. Nothing in here talks to anything.
 */
import type { Platform, TikTokPrivacy } from "./platforms.js";

/** off: does nothing. ask: makes posts and waits for a yes. auto: makes posts and sends them. */
export type AutopilotMode = "off" | "ask" | "auto";
export const AUTOPILOT_MODES: AutopilotMode[] = ["off", "ask", "auto"];
export const MODE_NAME: Record<AutopilotMode, string> = { off: "Off", ask: "Ask me first", auto: "Fully automatic" };
export const MODE_HINT: Record<AutopilotMode, string> = {
  off: "The autopilot does nothing.",
  ask: "It studies, plans and makes the posts. Each one waits for your yes before it goes out.",
  auto: "It studies, plans, makes the posts and sends them at their time. Nobody checks them first.",
};

export type MediaFormat = "image" | "video";
export type VoiceChoice = "with" | "without" | "mixed";
export const VOICE_NAME: Record<VoiceChoice, string> = { with: "Always with a voice", without: "Never a voice", mixed: "Let it choose for each video" };

/** What the posts are for. auto: the autopilot chooses from the numbers. */
export type PostGoal = "auto" | "awareness" | "followers" | "leads" | "sales";
export const GOAL_NAME: Record<PostGoal, string> = {
  auto: "Let it choose", awareness: "More people know us", followers: "More followers", leads: "More enquiries and leads", sales: "More sales",
};
export type CaptionLength = "auto" | "short" | "medium" | "long";
export const CAPTION_NAME: Record<CaptionLength, string> = { auto: "Let it choose", short: "Short (one or two sentences)", medium: "Medium (a short paragraph)", long: "Long (a small story or a list)" };
export type EmojiUse = "auto" | "none" | "few" | "many";
export const EMOJI_NAME: Record<EmojiUse, string> = { auto: "Let it choose", none: "No emoji", few: "A few", many: "Many" };
/** How pictures and videos are shared out, when both are allowed. */
export type MediaMix = "auto" | "pictures" | "even" | "videos";
export const MIX_NAME: Record<MediaMix, string> = { auto: "Let it choose", pictures: "Mostly pictures", even: "Half and half", videos: "Mostly videos" };
export const TRENDS_EVERY = [7, 3, 1] as const;
export type TrendsEvery = (typeof TRENDS_EVERY)[number];
export const TRENDS_EVERY_NAME: Record<TrendsEvery, string> = { 7: "Once a week", 3: "Twice a week", 1: "Every day" };

/** The owner's own wishes for the posts. Everything is optional: left alone, the autopilot chooses. */
export type AutopilotCustom = {
  goal: PostGoal;
  /** What to post about, in the owner's words. */
  topics: string;
  /** What never to post about or say. */
  avoid: string;
  /** What people should do after a post, for example "Book a free call". */
  callToAction: string;
  /** A link for the posts. "" for none. */
  link: string;
  captionLength: CaptionLength;
  emoji: EmojiUse;
  /** Tags that go on every post, without the # sign. */
  fixedTags: string[];
  /** How the pictures and videos should look: colours, style, what never to show. */
  look: string;
  mix: MediaMix;
  /** How often the latest trends are looked up, in days. */
  trendsEveryDays: TrendsEvery;
  /** The owner's own rules, followed in every post. */
  rules: string;
};

export const DEFAULT_CUSTOM: AutopilotCustom = {
  goal: "auto", topics: "", avoid: "", callToAction: "", link: "", captionLength: "auto", emoji: "auto", fixedTags: [], look: "", mix: "auto", trendsEveryDays: 7, rules: "",
};

export const CUSTOM_LIMITS = { topics: 600, avoid: 600, callToAction: 120, link: 300, look: 400, rules: 800, fixedTags: 5, tag: 40 } as const;

const oneOf = <T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
const words = (value: unknown, max: number): string => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** Tags as they are kept: no # sign, no spaces, each once, five at most. */
export const cleanTags = (tags: unknown): string[] =>
  Array.isArray(tags)
    ? [...new Set(tags.filter((t): t is string => typeof t === "string").map((t) => t.trim().replace(/^#+/, "").replace(/\s+/g, "").slice(0, CUSTOM_LIMITS.tag)).filter(Boolean))].slice(0, CUSTOM_LIMITS.fixedTags)
    : [];

/** "#dentist, leeds  #smile" as the person typed it → ["dentist", "leeds", "smile"]. */
export const readTags = (raw: string): string[] => cleanTags(raw.split(/[\s,;]+/));

/** A link for the posts as it is kept: an https address of a public site, or "". */
export function linkOf(raw: string): string {
  const typed = raw.trim();
  if (!typed || typed.length > CUSTOM_LIMITS.link || /\s/.test(typed)) return "";
  let url: URL;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`); } catch { return ""; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  if (url.username || url.password || !/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(url.hostname)) return "";
  url.protocol = "https:";
  return url.toString();
}

/** The owner's wishes as the app keeps them. Anything odd or missing falls back to "the autopilot chooses". */
export function cleanCustom(raw: unknown): AutopilotCustom {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    goal: oneOf<PostGoal>(r.goal, ["auto", "awareness", "followers", "leads", "sales"], "auto"),
    topics: words(r.topics, CUSTOM_LIMITS.topics),
    avoid: words(r.avoid, CUSTOM_LIMITS.avoid),
    callToAction: words(r.callToAction, CUSTOM_LIMITS.callToAction),
    link: words(r.link, CUSTOM_LIMITS.link),
    captionLength: oneOf<CaptionLength>(r.captionLength, ["auto", "short", "medium", "long"], "auto"),
    emoji: oneOf<EmojiUse>(r.emoji, ["auto", "none", "few", "many"], "auto"),
    fixedTags: cleanTags(r.fixedTags),
    look: words(r.look, CUSTOM_LIMITS.look),
    mix: oneOf<MediaMix>(r.mix, ["auto", "pictures", "even", "videos"], "auto"),
    trendsEveryDays: oneOf<TrendsEvery>(Number(r.trendsEveryDays), TRENDS_EVERY, 7),
    rules: words(r.rules, CUSTOM_LIMITS.rules),
  };
}

/**
 * A look-up of the trends that found nothing reads like an apology, not like
 * trends. Such a text is never shown as trends and never handed to a plan.
 */
export const noTrendsIn = (text: string): boolean =>
  text.trim().length < 80 || /^\W*NOTHING\W*$/i.test(text.trim())
  || /(could ?n[o']t|was not able to|unable to) (find|search|look up|get)[^.]{0,60}(current|recent|any|information|results)|usage limit|search (tool )?(is|was) (not available|unavailable)|no (search )?results (were|came)/i.test(text.slice(0, 600));

export type AutopilotSettings = {
  mode: AutopilotMode;
  /** What the business is and sells. */
  brief: string;
  audience: string;
  tone: string;
  language: string;
  postsPerWeek: number;
  formats: MediaFormat[];
  voice: VoiceChoice;
  /** The accounts it posts to. Empty: every connected account. */
  accountIds: string[];
  tiktokPrivacy: TikTokPrivacy | "";
  /** The most it may spend in a calendar month, in US cents. */
  budgetCents: number;
  timezone: string;
  /** When one of its posts does weakly, it posts a better version, once. */
  retryWeak: boolean;
  /** The business's own website: the autopilot reads it to learn the business. "" for none. */
  website: string;
  /** The weekdays it may post on (0 is Sunday). Empty: any day. */
  postDays: number[];
  /** The times it may post at, as "HH:MM". Empty: it chooses. */
  postTimes: string[];
  /** The owner's own wishes for the posts. */
  custom: AutopilotCustom;
};

export const DEFAULT_SETTINGS: AutopilotSettings = {
  mode: "off", brief: "", audience: "", tone: "", language: "English", postsPerWeek: 4,
  formats: ["image", "video"], voice: "mixed", accountIds: [], tiktokPrivacy: "", budgetCents: 3000, timezone: "Europe/London", retryWeak: true,
  website: "", postDays: [], postTimes: [], custom: DEFAULT_CUSTOM,
};

export const WEEKDAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
/** The order a week is shown in: Monday first. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
export const POST_TIMES_MAX = 6;
export const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The weekdays as the app keeps them: whole numbers 0 to 6, each once, in order. */
export const cleanDays = (days: unknown): number[] =>
  Array.isArray(days) ? [...new Set(days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b) : [];

/** "9:5" is not a time; "09:05" is. Each once, in order, six at most. */
export const cleanTimes = (times: unknown): string[] =>
  Array.isArray(times) ? [...new Set(times.filter((t): t is string => typeof t === "string" && TIME.test(t)))].sort().slice(0, POST_TIMES_MAX) : [];

/** "18:00, 9.30 , 12:15" as the person typed it → ["09:30", "12:15", "18:00"]. Anything that is not a time is left out. */
export function readTimes(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(/[,;\n]/)) {
    const m = part.trim().match(/^(\d{1,2})[:.](\d{2})$/);
    if (m) out.push(`${m[1].padStart(2, "0")}:${m[2]}`);
  }
  return cleanTimes(out);
}

export type Site = { url: string; domain: string };

/**
 * A public website address as the autopilot may read it, or null. "harbourdental.co.uk"
 * becomes "https://harbourdental.co.uk/". An address of the inside of a network
 * (localhost, 192.168..., a bare name) is not a public website.
 */
export function siteOf(raw: string): Site | null {
  const typed = raw.trim();
  if (!typed || typed.length > 300 || /\s/.test(typed)) return null;
  let url: URL;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`); } catch { return null; }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.port) return null;
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(host) || /\.(local|internal|lan|home|test|invalid|localhost)$/.test(host)) return null;
  return { url: `https://${host}${url.pathname === "/" ? "/" : url.pathname}`, domain: host.replace(/^www\./, "") };
}

export const SETTING_LIMITS = { brief: 2000, audience: 600, tone: 300, language: 40, postsMin: 1, postsMax: 14, budgetMax: 100000, website: 300, siteNotes: 4000 } as const;

/** The least the autopilot needs to know before it can be switched on. */
export const BRIEF_MIN = 20;

/** What is still missing before the switch can go on, as sentences. Empty: it can. */
export function settingProblems(s: AutopilotSettings): string[] {
  const problems: string[] = [];
  if (s.mode === "off") return problems;
  if (s.brief.trim().length < BRIEF_MIN) problems.push("Say in a sentence or two what your business does. The autopilot writes from it.");
  if (s.formats.length === 0) problems.push("Choose pictures, videos or both.");
  if (s.website.trim() && !siteOf(s.website)) problems.push("The website address does not look right. It should look like yourbusiness.com.");
  if (s.custom.link.trim() && !linkOf(s.custom.link)) problems.push("The link for the posts does not look right. It should look like yourbusiness.com/book.");
  return problems;
}

export type NoteKind = "study" | "trends" | "plan" | "problem";
export const NOTE_NAME: Record<NoteKind, string> = { study: "Study of your pages", trends: "Latest trends", plan: "Plan", problem: "Needs your attention" };

export type AutopilotNote = { id: string; kind: NoteKind; title: string; body: string; data: Record<string, unknown>; createdAt: string };

/** What a study says, kept with its note. */
export type StudyFindings = { working: string[]; notWorking: string[]; changes: string[]; bestTimes: string[] };

/** Why the autopilot made a post, kept with the post. */
export type PostIdea = {
  format: MediaFormat;
  /** The first line or first second: what makes somebody stop. */
  hook: string;
  /** Why this post, in one sentence. */
  why: string;
  /** The one thing this post tries out, so its numbers teach something. */
  experiment: string;
  tags: string[];
  /** What the picture or video shows. */
  visual: string;
  /** The words spoken in a video. "" for none. */
  spoken: string;
  /** A second try was made for this post already. */
  retried?: boolean;
  /** This post is the second try of the post with this title. */
  improves?: string;
};

/** How long a text may be that says what should be different in a picture or video made again. */
export const CHANGE_MAX = 600;
export const SPOKEN_MAX = 220;

export type JobStatus = "waiting" | "running" | "done" | "failed";

/** The numbers every platform's own figures are brought down to. */
export type PostNumbers = { views: number; likes: number; comments: number; shares: number; saves: number; reach: number };
export const NO_NUMBERS: PostNumbers = { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, reach: 0 };

/** A post on one of the workspace's own pages, made here or not. */
export type FeedPost = PostNumbers & {
  id: string;
  accountId: string;
  platform: Platform | string;
  url: string;
  caption: string;
  kind: string;
  postedAt: string | null;
  contentId: string | null;
};

/** Likes, comments, shares and saves together: the people who did something. */
export const interactions = (n: PostNumbers): number => n.likes + n.comments + n.shares + n.saves;

/**
 * One figure to compare posts of one account by. Views where the platform
 * gives them (a reel, a video), else reach, else the interactions.
 */
export const score = (n: PostNumbers): number => (n.views > 0 ? n.views : n.reach > 0 ? n.reach : interactions(n));

export const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export type Verdict = "better" | "usual" | "weaker" | "early";
export const VERDICT_NAME: Record<Verdict, string> = { better: "Better than usual", usual: "About as usual", weaker: "Weaker than usual", early: "Too early to say" };

/** A post needs this many others on its account before "usual" means anything. */
export const USUAL_NEEDS = 3;
/** Numbers of the first day say little: a post is judged after this many hours. */
export const JUDGE_AFTER_HOURS = 24;

/**
 * How a post did against the usual post of the same account: a quarter above
 * the middle one is better, a quarter below is weaker.
 */
export function verdictOf(post: FeedPost, sameAccount: FeedPost[], now: number): Verdict {
  const others = sameAccount.filter((p) => p.id !== post.id);
  const age = post.postedAt ? (now - new Date(post.postedAt).getTime()) / 3_600_000 : Infinity;
  if (others.length < USUAL_NEEDS || age < JUDGE_AFTER_HOURS) return "early";
  const usual = median(others.map(score));
  const own = score(post);
  if (usual <= 0) return own > 0 ? "better" : "early";
  if (own >= usual * 1.25) return "better";
  if (own <= usual * 0.75) return "weaker";
  return "usual";
}

/** One credit of the picture and video maker is one US cent. */
export const CREDIT_CENTS = 1;
/** What one picture and one second of video cost, in credits (the maker's price list). */
export const IMAGE_CREDITS = 1;
export const VIDEO_SECONDS = 8;
export const VIDEO_CREDITS_PER_SECOND = { voice: 15, silent: 10 } as const;
export const jobCredits = (kind: MediaFormat, withVoice: boolean): number =>
  kind === "image" ? IMAGE_CREDITS : VIDEO_SECONDS * (withVoice ? VIDEO_CREDITS_PER_SECOND.voice : VIDEO_CREDITS_PER_SECOND.silent);

/** What the screen is told about the set-up, without any setting's name or value. */
export type AutopilotReady = { writing: boolean; media: boolean; posting: boolean };

/** What the autopilot proposes after reading the business's website. */
export type SiteReading = { brief: string; audience: string; tone: string; language: string; notes: string };

/**
 * What one run did, for the "Run now" button. One run is one step (reading
 * the pages, or the trends, or the study, or the plan), because a step can
 * take minutes. `more` says another step is due right now: the page then
 * asks again by itself, so one press carries on to the plan. `next` is what
 * to tell the person when nothing more will happen: why, in a sentence.
 */
export type RunReport = { did: string[]; next: string; more?: boolean };
