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
};

export const DEFAULT_SETTINGS: AutopilotSettings = {
  mode: "off", brief: "", audience: "", tone: "", language: "English", postsPerWeek: 4,
  formats: ["image", "video"], voice: "mixed", accountIds: [], tiktokPrivacy: "", budgetCents: 3000, timezone: "Europe/London",
};

export const SETTING_LIMITS = { brief: 2000, audience: 600, tone: 300, language: 40, postsMin: 1, postsMax: 14, budgetMax: 100000 } as const;

/** The least the autopilot needs to know before it can be switched on. */
export const BRIEF_MIN = 20;

/** What is still missing before the switch can go on, as sentences. Empty: it can. */
export function settingProblems(s: AutopilotSettings): string[] {
  const problems: string[] = [];
  if (s.mode === "off") return problems;
  if (s.brief.trim().length < BRIEF_MIN) problems.push("Say in a sentence or two what your business does. The autopilot writes from it.");
  if (s.formats.length === 0) problems.push("Choose pictures, videos or both.");
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
};

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

/** What one run did, for the "Run now" button. */
export type RunReport = { did: string[]; next: string };
