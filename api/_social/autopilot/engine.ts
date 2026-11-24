/**
 * The autopilot's loop, one workspace at a time.
 *
 * A run does the cheap work every time and at most one piece of thinking:
 *
 *   media    looks at the pictures and videos being made: a finished one is
 *            kept and its posts are released; a waiting one is started;
 *   read     every six hours, reads the workspace's pages and keeps the day's
 *            numbers of every post;
 *   think    one of: look up the trends, study the records, plan the week.
 *            Each is due once a week.
 *
 * So a workspace that has just been switched on reads its pages and looks up
 * the trends in its first run, studies in the second, plans in the third, and
 * its first pictures are ready a run or two later.
 *
 * Money: a calendar month has a budget. Writing and making stop when it is
 * used up, and a note says so. Nothing here posts anything: a finished post is
 * handed to the posts list as "waiting for a yes" or "scheduled", and the
 * publisher that sends every other post sends these too.
 */
import type { AutoClaude, AiDeps } from "../../_automation/ai.js";
import { AiError } from "../../_automation/ai.js";
import { monthStart } from "../../_automation/cost.js";
import { isPlatform, startingOptions, type Platform, type PlatformOptions, type PostMedia } from "../shared/platforms.js";
import {
  CHANGE_MAX, CREDIT_CENTS, SPOKEN_MAX, jobCredits, median, score, siteOf, verdictOf,
  type AutopilotSettings, type MediaFormat, type NoteKind, type PostIdea,
} from "../shared/autopilot.js";
import { FeedError, readFeed, type FeedItem } from "./feed.js";
import { MakerError, fetchMade, imageRequest, makerOn, startMaking, taskState, videoPrompt, videoRequest } from "./runway.js";
import { STUDY_NEEDS, STUDY_READS, findingsOf, howItDid, improve as askImprove, plan as askPlan, readSite, study as askStudy, takes, trends as askTrends, usable, type StudyPost } from "./brain.js";

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
export const WEEK_MS = 7 * DAY_MS;
/** The pages are read again after this long. */
export const READ_EVERY_MS = 6 * HOUR_MS;
/** A piece of thinking that failed is tried again after this long, not at the next run. */
export const RETRY_MS = 6 * HOUR_MS;
/** A study that found too few posts looks again after this long. */
export const STUDY_AGAIN_MS = 2 * DAY_MS;
/** The business's website is read again after this long: what it sells and offers changes. */
export const SITE_EVERY_MS = 30 * DAY_MS;
/** A post is looked at for a second try once it has been out this long, and not any more after this long. */
export const SECOND_TRY_AFTER_MS = 2 * DAY_MS;
export const SECOND_TRY_UNTIL_MS = 10 * DAY_MS;
/** How many posts of the pages are looked through for a weak one. */
export const REVIEW_READS = 200;
/** How many pictures or videos one run starts, and how many it looks at. */
export const START_PER_RUN = 3;
export const WATCH_PER_RUN = 10;
/** A picture or video is asked for at most this often. */
export const MAX_ATTEMPTS = 3;
/** A run that stopped half-way leaves its workspace marked busy: after this long another run may take it. */
export const BUSY_FOR_MS = 10 * 60_000;

export const MEDIA_FAILED = "The picture or video for this post could not be made. Add your own, or delete the post.";
export const MEDIA_REFUSED = "The picture and video maker would not make this one. Add your own picture or video, or delete the post.";

export type PilotRow = {
  workspaceId: string;
  organizationId: string;
  settings: AutopilotSettings;
  playbook: string;
  collectedAt: string | null;
  studiedAt: string | null;
  trendsAt: string | null;
  plannedAt: string | null;
  reviewedAt: string | null;
  /** What the business's website says, and when it was last read. */
  siteNotes: string;
  siteAt: string | null;
};

/** The posts of one idea (one for each account). */
export type PilotGroup = {
  groupId: string;
  campaignId: string | null;
  title: string;
  body: string;
  idea: PostIdea | null;
  scheduledAt: string | null;
  posts: Array<{ id: string; accountId: string | null; status: string }>;
};

export type PilotAccount = { id: string; provider: string; name: string; status: string; serviceId: string | null };

export type JobRow = { id: string; groupId: string; kind: MediaFormat; prompt: string; withVoice: boolean; taskId: string | null; attempts: number };

export type NewPost = {
  accountId: string;
  groupId: string;
  campaignId: string | null;
  title: string;
  body: string;
  options: unknown;
  scheduledAt: string;
  idea: PostIdea;
};

export type NewNote = { kind: NoteKind; title: string; body: string; data?: Record<string, unknown>; costMicroUsd?: number };
export type Stamp = "collected_at" | "studied_at" | "trends_at" | "planned_at" | "reviewed_at" | "site_at";

export type PilotStore = {
  /** One workspace's row, whatever its state. Null when the autopilot was never set up there. */
  get(workspaceId: string): Promise<PilotRow | null>;
  /** The autopilot's posts of one idea, found by the idea or by one of its posts. */
  group(workspaceId: string, by: { groupId: string } | { contentId: string }): Promise<PilotGroup | null>;
  /** Gives up the pictures or videos still waiting or being made for one idea. */
  cancelJobs(groupId: string): Promise<void>;
  /** Puts the posts of one idea that are not out yet back to "waiting for their file", with the changed idea. */
  resetGroup(workspaceId: string, groupId: string, idea: PostIdea): Promise<void>;
  /** Remembers on the posts of one idea that a second try was made. */
  markRetried(workspaceId: string, groupId: string): Promise<void>;
  /** The workspaces whose autopilot is on (or just this one), the one that waited longest first, each now marked busy. */
  claim(limit: number, now: Date, workspaceId?: string): Promise<PilotRow[]>;
  /** Lets a workspace go. `workedAt` is null when the run did not get to it: it then keeps its place at the front. */
  release(workspaceId: string, workedAt: Date | null): Promise<void>;
  stamp(workspaceId: string, what: Stamp, at: Date): Promise<void>;
  savePlaybook(workspaceId: string, playbook: string): Promise<void>;
  saveSiteNotes(workspaceId: string, notes: string): Promise<void>;
  accounts(workspaceId: string): Promise<PilotAccount[]>;
  /** Keeps the posts of one account and their numbers of today. */
  saveFeed(row: PilotRow, accountId: string, platform: string, items: FeedItem[], now: Date): Promise<void>;
  /** The latest posts of the workspace's pages, newest first. */
  feed(workspaceId: string, limit: number): Promise<StudyPost[]>;
  addNote(row: PilotRow, note: NewNote): Promise<void>;
  latestNote(workspaceId: string, kind: NoteKind): Promise<{ title: string; body: string; createdAt: string } | null>;
  /** What was spent since `since` on writing and on pictures and videos, in US cents. */
  spentCents(workspaceId: string, since: string): Promise<number>;
  /** Titles of the workspace's posts made since `since`. */
  recentTitles(workspaceId: string, since: string): Promise<string[]>;
  createCampaign(row: PilotRow, name: string, goal: string): Promise<string>;
  createPosts(row: PilotRow, posts: NewPost[]): Promise<void>;
  createJob(row: PilotRow, job: { groupId: string; kind: MediaFormat; prompt: string; withVoice: boolean }): Promise<void>;
  jobs(workspaceId: string, status: "waiting" | "running", limit: number): Promise<JobRow[]>;
  updateJob(id: string, patch: { status?: "waiting" | "running" | "done" | "failed"; taskId?: string | null; credits?: number; url?: string; error?: string | null; attempts?: number }): Promise<void>;
  /** Puts the finished file on the posts of one idea and releases them: waiting for a yes, or scheduled. */
  attachMedia(groupId: string, media: PostMedia, release: "in_review" | "scheduled", now: Date): Promise<void>;
  /** Says on the posts of one idea why they have no picture. */
  failGroup(groupId: string, message: string): Promise<void>;
  /** Keeps a file where the platforms can fetch it. Returns its public address. */
  saveFile(workspaceId: string, name: string, bytes: Uint8Array, mime: string): Promise<string>;
};

export type EngineDeps = {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  now: () => number;
  uuid: () => string;
  /** Null when writing is not switched on. */
  claude: AutoClaude | null;
};

const due = (last: string | null, every: number, now: number): boolean => !last || now - new Date(last).getTime() >= every;
/** The time to write down so that the step is due again `after` from now, for a step that is due every week. */
const dueAgainIn = (after: number, now: number): Date => new Date(now - WEEK_MS + after);

// ── Dates in the workspace's own time ────────────────────────────────────

function partsIn(timeZone: string, at: number): { y: number; m: number; d: number; h: number; min: number; s: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(at));
  const n = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: n("year"), m: n("month"), d: n("day"), h: n("hour"), min: n("minute"), s: n("second") };
}

/** A time zone the server knows, or UTC. */
export function safeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

/** The moment that is `hhmm` on the day `days` after today, in the given time zone. */
export function localTime(now: number, days: number, hhmm: string, timeZone: string): Date {
  const zone = safeZone(timeZone);
  const today = partsIn(zone, now);
  const [h, min] = hhmm.split(":").map(Number);
  const wall = Date.UTC(today.y, today.m - 1, today.d + days, h, min, 0);
  const offsetAt = (at: number): number => {
    const p = partsIn(zone, at);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(at / 1000) * 1000;
  };
  let utc = wall - offsetAt(wall);
  // Around a clock change the first guess can be an hour out: one more look settles it.
  utc = wall - offsetAt(utc);
  return new Date(utc);
}

/** The weekday (0 is Sunday) of the day `days` after today, in the given time zone. */
export function weekdayIn(now: number, days: number, timeZone: string): number {
  const p = partsIn(safeZone(timeZone), now);
  return new Date(Date.UTC(p.y, p.m - 1, p.d + days)).getUTCDay();
}

const minutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * A planned day and time, moved to where the owner posts: the first allowed
 * weekday on or after the planned day, and the allowed time nearest to the
 * planned one. With nothing set by the owner it comes back as it was.
 */
export function fitSchedule(day: number, time: string, s: Pick<AutopilotSettings, "postDays" | "postTimes" | "timezone">, now: number): { day: number; time: string } {
  let fitDay = day;
  if (s.postDays.length > 0 && s.postDays.length < 7) {
    for (let step = 0; step < 7 && !s.postDays.includes(weekdayIn(now, fitDay, s.timezone)); step++) fitDay += 1;
  }
  const fitTime = s.postTimes.length === 0 ? time : s.postTimes.reduce((best, t) => (Math.abs(minutes(t) - minutes(time)) < Math.abs(minutes(best) - minutes(time)) ? t : best));
  return { day: fitDay, time: fitTime };
}

const todayWords = (now: number, timeZone: string): string =>
  new Intl.DateTimeFormat("en-GB", { timeZone: safeZone(timeZone), weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(now));

// ── Helpers ──────────────────────────────────────────────────────────────

/** A meter for one piece of thinking: what its calls cost together. */
function metered(claude: AutoClaude | null): { ai: AiDeps; cost: () => number } {
  let micro = 0;
  return { ai: { claude, store: { insertUsage: async (u) => { micro += u.costMicroUsd; } } }, cost: () => micro };
}

/** A note about a problem, once a day at most for the same problem. */
async function problem(store: PilotStore, row: PilotRow, title: string, body: string, now: number): Promise<void> {
  const last = await store.latestNote(row.workspaceId, "problem");
  if (last && last.title === title && now - new Date(last.createdAt).getTime() < DAY_MS) return;
  await store.addNote(row, { kind: "problem", title, body });
}

/** The accounts the autopilot works with: the chosen ones, or all, that are connected and on a platform we post to. */
export function chosenAccounts(settings: AutopilotSettings, accounts: PilotAccount[]): Array<PilotAccount & { provider: Platform }> {
  const wanted = new Set(settings.accountIds);
  return accounts.filter((a): a is PilotAccount & { provider: Platform } =>
    isPlatform(a.provider) && a.status === "connected" && (wanted.size === 0 || wanted.has(a.id)));
}

/** What one account's part of a post holds, with the answers a platform asks of every post already given. */
export function optionsFor(platform: Platform, shared: { title: string; text: string; tags: string[] }, settings: AutopilotSettings): PlatformOptions[Platform] {
  const options = startingOptions(platform, shared);
  // Posts for a business's customers are not made for children.
  if (platform === "youtube") return { ...(options as PlatformOptions["youtube"]), madeForKids: false };
  // TikTok: who may see it is the owner's own choice, made once in the settings; the video promotes the poster's own business.
  if (platform === "tiktok") return { ...(options as PlatformOptions["tiktok"]), privacy: settings.tiktokPrivacy, brandOrganic: true };
  return options;
}

// ── Media ────────────────────────────────────────────────────────────────

async function media(store: PilotStore, d: EngineDeps, row: PilotRow, spent: { cents: number }, did: string[]): Promise<void> {
  if (!makerOn(d.env)) return;
  const now = new Date(d.now());
  const release = row.settings.mode === "auto" ? "scheduled" : "in_review";

  for (const job of await store.jobs(row.workspaceId, "running", WATCH_PER_RUN)) {
    try {
      const state = job.taskId ? await taskState(d, job.taskId) : ({ state: "failed", refused: false } as const);
      if (state.state === "working") continue;
      if (state.state === "done") {
        const file = await fetchMade(d, state.url, job.kind);
        const name = `autopilot-${job.id}.${job.kind === "video" ? "mp4" : "jpg"}`;
        const url = await store.saveFile(row.workspaceId, name, file.bytes, file.mime);
        await store.attachMedia(job.groupId, { url, kind: job.kind, mime: file.mime, bytes: file.bytes.length, name }, release, now);
        await store.updateJob(job.id, { status: "done", url, error: null, ...(state.credits > 0 ? { credits: state.credits } : {}) });
        did.push(job.kind === "video" ? "finished a video" : "finished a picture");
        continue;
      }
      // It failed. Ask once more unless the maker refuses this one for good.
      if (!state.refused && job.attempts < MAX_ATTEMPTS) {
        await store.updateJob(job.id, { status: "waiting", taskId: null, credits: 0 });
      } else {
        await store.updateJob(job.id, { status: "failed", credits: 0, error: state.refused ? "refused" : "failed" });
        await store.failGroup(job.groupId, state.refused ? MEDIA_REFUSED : MEDIA_FAILED);
        await problem(store, row, "A picture or video could not be made", "One planned post has no picture or video. Open it in the posts list to add your own, or delete it.", d.now());
      }
    } catch (e) {
      // The maker or the storage could not be reached: the job stays as it is for the next run.
      if (!(e instanceof MakerError)) console.error("[autopilot] a finished file was not kept", e instanceof Error ? e.name : "unknown");
    }
  }

  for (const job of await store.jobs(row.workspaceId, "waiting", START_PER_RUN)) {
    const cost = jobCredits(job.kind, job.withVoice) * CREDIT_CENTS;
    if (spent.cents + cost > row.settings.budgetCents) {
      await problem(store, row, "This month's budget is used up", "The autopilot has stopped making pictures and videos until next month. Raise the monthly budget in the autopilot's settings to carry on now.", d.now());
      break;
    }
    try {
      const taskId = await startMaking(d, job.kind === "video" ? videoRequest(job.prompt, job.withVoice) : imageRequest(job.prompt));
      await store.updateJob(job.id, { status: "running", taskId, attempts: job.attempts + 1, credits: cost / CREDIT_CENTS });
      spent.cents += cost;
      did.push(job.kind === "video" ? "started a video" : "started a picture");
    } catch (e) {
      if (!(e instanceof MakerError)) throw e;
      if (e.kind === "refused" || job.attempts + 1 >= MAX_ATTEMPTS) {
        await store.updateJob(job.id, { status: "failed", attempts: job.attempts + 1, error: e.kind });
        await store.failGroup(job.groupId, e.kind === "refused" ? MEDIA_REFUSED : MEDIA_FAILED);
      } else {
        await store.updateJob(job.id, { attempts: job.attempts + 1 });
      }
    }
  }
}

/** Looks at the pictures and videos of one workspace now (after one was asked for again). */
export async function runMedia(store: PilotStore, d: EngineDeps, row: PilotRow): Promise<string[]> {
  const did: string[] = [];
  await media(store, d, row, { cents: await store.spentCents(row.workspaceId, monthStart(new Date(d.now()))) }, did);
  return did;
}

const NOT_OUT_YET = ["draft", "in_review", "scheduled"];
const cut = (value: string, max: number): string => (value.length > max ? value.slice(0, max) : value);

/**
 * Makes the picture or video of one idea again. `change` says what should be
 * different; `spoken` (videos) replaces the voice's words, "" for no voice.
 * The posts go back to waiting for their file, and come back to be approved
 * (or scheduled) when it is there. "gone": nothing of the idea can still be changed.
 */
export async function remake(store: PilotStore, d: EngineDeps, row: PilotRow, groupId: string, input: { change: string; spoken?: string }): Promise<"ok" | "gone"> {
  const group = await store.group(row.workspaceId, { groupId });
  const idea = group?.idea;
  if (!group || !idea?.format || !group.posts.some((p) => NOT_OUT_YET.includes(p.status))) return "gone";
  const change = cut(input.change.trim(), CHANGE_MAX);
  // Only the latest wish is kept: a row of wishes on top of each other confuses the maker.
  const base = idea.visual.split(" Change: ")[0];
  const visual = change ? `${cut(base, 1500 - change.length - 9)} Change: ${change}` : base;
  const spoken = idea.format === "video" ? (input.spoken === undefined ? idea.spoken : cut(input.spoken.trim(), SPOKEN_MAX)) : "";
  await store.cancelJobs(groupId);
  await store.resetGroup(row.workspaceId, groupId, { ...idea, visual, spoken });
  await store.createJob(row, { groupId, kind: idea.format, prompt: idea.format === "video" ? videoPrompt(visual, spoken) : visual, withVoice: idea.format === "video" && spoken !== "" });
  return "ok";
}

/** The clock time of a moment in a time zone, as "HH:MM". */
function clockIn(iso: string | null, timeZone: string): string {
  if (!iso) return "18:00";
  const p = partsIn(safeZone(timeZone), new Date(iso).getTime());
  return `${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`;
}

/**
 * A second try: a better version of one of the autopilot's posts that is out,
 * posted as a new post tomorrow at the same hour, to the same accounts. Once
 * for each post. "gone": no such post, or no account left to post it to.
 */
export async function improvePost(store: PilotStore, d: EngineDeps, row: PilotRow, contentId: string): Promise<"ok" | "done before" | "gone"> {
  const s = row.settings;
  const group = await store.group(row.workspaceId, { contentId });
  const idea = group?.idea;
  if (!group || !idea?.format) return "gone";
  if (idea.retried) return "done before";
  const accounts = chosenAccounts(s, await store.accounts(row.workspaceId))
    .filter((a) => group.posts.some((p) => p.accountId === a.id) && takes(a.provider, idea.format) && (a.provider !== "tiktok" || s.tiktokPrivacy !== ""));
  if (accounts.length === 0) return "gone";

  const feed = await store.feed(row.workspaceId, REVIEW_READS);
  const record = feed.find((p) => p.contentId !== null && group.posts.some((g) => g.id === p.contentId)) ?? null;
  const usual = record ? median(feed.filter((p) => p.accountId === record.accountId && p.id !== record.id).map(score)) : 0;
  const meter = metered(d.claude);
  const answer = await askImprove(meter.ai, { workspaceId: row.workspaceId, feature: "step" }, { settings: s, playbook: row.playbook, title: group.title, caption: group.body, idea, did: howItDid(record, usual) });
  if (!answer.caption || !answer.visual) return "gone";

  const groupId = d.uuid();
  const slot = fitSchedule(1, clockIn(group.scheduledAt, s.timezone), s, d.now());
  const when = localTime(d.now(), slot.day, slot.time, s.timezone).toISOString();
  const shared = { title: answer.title, text: answer.caption, tags: answer.tags };
  const next: PostIdea = { format: idea.format, hook: answer.hook, why: answer.why, experiment: `Second try: ${answer.change}`, tags: answer.tags, visual: answer.visual, spoken: answer.spoken, improves: group.title };
  await store.createPosts(row, accounts.map((a) => ({
    accountId: a.id, groupId, campaignId: group.campaignId, title: answer.title, body: answer.caption, options: optionsFor(a.provider, shared, s), scheduledAt: when, idea: next,
  })));
  await store.createJob(row, { groupId, kind: idea.format, prompt: idea.format === "video" ? videoPrompt(answer.visual, answer.spoken) : answer.visual, withVoice: idea.format === "video" && answer.spoken !== "" });
  await store.markRetried(row.workspaceId, group.groupId);
  await store.addNote(row, { kind: "plan", title: `A second try for “${group.title}”`.slice(0, 200), body: `${answer.why} This time: ${answer.change}.`, costMicroUsd: meter.cost(), data: { improves: contentId } });
  return "ok";
}

/** Once a day: is one of the autopilot's posts doing clearly worse than the usual post of its page? Then it gets a second try. */
async function reviewPosts(store: PilotStore, d: EngineDeps, row: PilotRow, did: string[]): Promise<void> {
  // Written down first: whatever happens below, this is not done again at the next run.
  await store.stamp(row.workspaceId, "reviewed_at", new Date(d.now()));
  if (!row.settings.retryWeak) return;
  const now = d.now();
  const feed = await store.feed(row.workspaceId, REVIEW_READS);
  const weak = feed.find((p) => {
    if (!p.contentId || !p.idea || p.idea.retried || p.idea.improves || !p.postedAt) return false;
    const age = now - new Date(p.postedAt).getTime();
    return age >= SECOND_TRY_AFTER_MS && age <= SECOND_TRY_UNTIL_MS && verdictOf(p, feed.filter((o) => o.accountId === p.accountId), now) === "weaker";
  });
  if (weak?.contentId && (await improvePost(store, d, row, weak.contentId)) === "ok") did.push("made a better version of a weak post");
}

// ── Reading the pages ────────────────────────────────────────────────────

async function read(store: PilotStore, d: EngineDeps, row: PilotRow, did: string[]): Promise<void> {
  const accounts = chosenAccounts(row.settings, await store.accounts(row.workspaceId)).filter((a) => a.serviceId);
  let readAny = false;
  for (const account of accounts) {
    try {
      const items = await readFeed(d, account.serviceId as string);
      await store.saveFeed(row, account.id, account.provider, items, new Date(d.now()));
      readAny = true;
    } catch (e) {
      if (!(e instanceof FeedError)) throw e;
      if (e.kind === "permission") {
        await problem(store, row, `Connect ${account.name} again`, `The autopilot cannot read the posts and numbers of ${account.name} yet. Open the Accounts tab and connect it again: the log-in now also asks for that.`, d.now());
      }
    }
  }
  await store.stamp(row.workspaceId, "collected_at", new Date(d.now()));
  if (readAny) did.push("read your pages");
}

// ── Thinking ─────────────────────────────────────────────────────────────

/** Reads the business's own website and keeps what it says, for every plan after it. */
async function learnSite(store: PilotStore, d: EngineDeps, row: PilotRow, did: string[]): Promise<void> {
  // Written down first: a site that cannot be read is not tried again at every run.
  await store.stamp(row.workspaceId, "site_at", new Date(d.now()));
  const site = siteOf(row.settings.website);
  if (!site) return;
  const meter = metered(d.claude);
  const notes = await readSite(meter.ai, { workspaceId: row.workspaceId, feature: "web" }, site);
  if (!notes) {
    await problem(store, row, "Your website could not be read", `The autopilot could not read ${site.domain}. Check the address in the autopilot's settings. Until then it works from what you wrote about your business.`, d.now());
    return;
  }
  await store.saveSiteNotes(row.workspaceId, notes);
  row.siteNotes = notes;
  await store.addNote(row, { kind: "study", title: "Read your website", body: notes, costMicroUsd: meter.cost(), data: { website: site.domain } });
  did.push("read your website");
}

async function lookUpTrends(store: PilotStore, d: EngineDeps, row: PilotRow, did: string[]): Promise<void> {
  const meter = metered(d.claude);
  const platforms = [...new Set(chosenAccounts(row.settings, await store.accounts(row.workspaceId)).map((a) => a.provider))];
  const text = await askTrends(meter.ai, { workspaceId: row.workspaceId, feature: "web" }, { settings: row.settings, platforms, today: todayWords(d.now(), row.settings.timezone) });
  if (!text) {
    await store.stamp(row.workspaceId, "trends_at", dueAgainIn(RETRY_MS, d.now()));
    return;
  }
  await store.addNote(row, { kind: "trends", title: "What is working right now", body: text, costMicroUsd: meter.cost() });
  await store.stamp(row.workspaceId, "trends_at", new Date(d.now()));
  did.push("looked up the latest trends");
}

async function studyPages(store: PilotStore, d: EngineDeps, row: PilotRow, did: string[]): Promise<void> {
  const posts = await store.feed(row.workspaceId, STUDY_READS);
  if (posts.filter((p) => score(p) > 0).length < STUDY_NEEDS) {
    const title = "Not enough posts to learn from yet";
    const last = await store.latestNote(row.workspaceId, "study");
    if (!last || last.title !== title) {
      await store.addNote(row, { kind: "study", title, body: "Your pages have too few posts with numbers to compare. The autopilot starts from the latest trends, tries a different thing in each post, and studies again as soon as the numbers come in." });
    }
    await store.stamp(row.workspaceId, "studied_at", dueAgainIn(STUDY_AGAIN_MS, d.now()));
    return;
  }
  const meter = metered(d.claude);
  const result = await askStudy(meter.ai, { workspaceId: row.workspaceId, feature: "step" }, { settings: row.settings, playbook: row.playbook, posts });
  await store.addNote(row, { kind: "study", title: "Study of your pages", body: result.summary.trim(), data: { ...findingsOf(result), posts: posts.length }, costMicroUsd: meter.cost() });
  if (result.playbook) {
    await store.savePlaybook(row.workspaceId, result.playbook);
    row.playbook = result.playbook;
  }
  await store.stamp(row.workspaceId, "studied_at", new Date(d.now()));
  did.push("studied your pages");
}

async function planWeek(store: PilotStore, d: EngineDeps, row: PilotRow, did: string[]): Promise<void> {
  const s = row.settings;
  const accounts = chosenAccounts(s, await store.accounts(row.workspaceId))
    // TikTok asks who may see each video. Until the owner has chosen, nothing is planned for it.
    .filter((a) => a.provider !== "tiktok" || s.tiktokPrivacy !== "");
  // Somewhere to post the kinds that are allowed: a workspace with only YouTube and pictures only has nowhere.
  const platforms = [...new Set(accounts.map((a) => a.provider))].filter((p) => s.formats.some((f) => takes(p, f)));
  if (platforms.length === 0) {
    await problem(store, row, "No account to post to", "Connect at least one social account on the Accounts tab. For TikTok, also choose in the autopilot's settings who can see the videos.", d.now());
    await store.stamp(row.workspaceId, "planned_at", dueAgainIn(RETRY_MS, d.now()));
    return;
  }
  const meter = metered(d.claude);
  const trendsNote = await store.latestNote(row.workspaceId, "trends");
  const recent = await store.recentTitles(row.workspaceId, new Date(d.now() - 30 * DAY_MS).toISOString());
  const answer = await askPlan(meter.ai, { workspaceId: row.workspaceId, feature: "step" }, {
    settings: s, playbook: row.playbook, trends: trendsNote?.body ?? "", site: row.siteNotes, platforms, recent: recent.slice(0, 40), today: todayWords(d.now(), s.timezone),
  });
  const posts = answer.posts.map((p) => usable(p, s, platforms)).filter((p): p is NonNullable<typeof p> => p !== null).slice(0, s.postsPerWeek);
  if (posts.length === 0) {
    await problem(store, row, "The week could not be planned", "The autopilot could not make a plan this time. It tries again in a few hours.", d.now());
    await store.stamp(row.workspaceId, "planned_at", dueAgainIn(RETRY_MS, d.now()));
    return;
  }

  const campaignId = await store.createCampaign(row, answer.campaignName.trim().slice(0, 120) || `Week of ${todayWords(d.now(), s.timezone)}`, answer.campaignGoal.trim().slice(0, 500));
  for (const post of posts) {
    const groupId = d.uuid();
    const slot = fitSchedule(post.day, post.time, s, d.now());
    const when = localTime(d.now(), slot.day, slot.time, s.timezone).toISOString();
    const shared = { title: post.title, text: post.caption, tags: post.tags };
    const rows: NewPost[] = accounts.filter((a) => post.platforms.includes(a.provider)).map((a) => ({
      accountId: a.id, groupId, campaignId, title: post.title, body: post.caption, options: optionsFor(a.provider, shared, s), scheduledAt: when, idea: post.idea,
    }));
    if (rows.length === 0) continue;
    await store.createPosts(row, rows);
    const withVoice = post.format === "video" && post.spoken !== "";
    await store.createJob(row, { groupId, kind: post.format, prompt: post.format === "video" ? videoPrompt(post.visual, post.spoken) : post.visual, withVoice });
  }
  await store.addNote(row, {
    kind: "plan", title: answer.campaignName.trim().slice(0, 120) || "The week's plan", body: answer.summary.trim(), costMicroUsd: meter.cost(),
    data: { campaignId, posts: posts.map((p) => ({ title: p.title, day: p.day, time: p.time, format: p.format, platforms: p.platforms, experiment: p.idea.experiment })) },
  });
  await store.stamp(row.workspaceId, "planned_at", new Date(d.now()));
  did.push(`planned ${posts.length} ${posts.length === 1 ? "post" : "posts"}`);
}

/** Which piece of thinking is due, in the order a new workspace needs them. */
export function nextThinking(row: PilotRow, now: number): Stamp | null {
  // The website first: everything after it is written from what it says.
  if (row.settings.website.trim() && due(row.siteAt, SITE_EVERY_MS, now)) return "site_at";
  if (due(row.trendsAt, WEEK_MS, now)) return "trends_at";
  if (due(row.studiedAt, WEEK_MS, now)) return "studied_at";
  if (due(row.plannedAt, WEEK_MS, now)) return "planned_at";
  if (due(row.reviewedAt, DAY_MS, now)) return "reviewed_at";
  return null;
}

export const STEP_WORDS: Record<Stamp, string> = {
  collected_at: "read your pages",
  trends_at: "look up the latest trends",
  studied_at: "study your pages",
  planned_at: "plan the week",
  reviewed_at: "look for a post that needs a second try",
  site_at: "read your website",
};

/** One run for one workspace. Returns what it did, in words. */
export async function runWorkspace(store: PilotStore, d: EngineDeps, row: PilotRow): Promise<string[]> {
  const did: string[] = [];
  const now = d.now();
  const spent = { cents: await store.spentCents(row.workspaceId, monthStart(new Date(now))) };

  await media(store, d, row, spent, did);
  if (due(row.collectedAt, READ_EVERY_MS, now)) await read(store, d, row, did);

  const step = nextThinking(row, now);
  if (!step || !d.claude) return did;
  if (spent.cents >= row.settings.budgetCents) {
    await problem(store, row, "This month's budget is used up", "The autopilot has stopped until next month. Raise the monthly budget in the autopilot's settings to carry on now.", now);
    return did;
  }
  try {
    if (step === "site_at") await learnSite(store, d, row, did);
    else if (step === "trends_at") await lookUpTrends(store, d, row, did);
    else if (step === "studied_at") await studyPages(store, d, row, did);
    else if (step === "planned_at") await planWeek(store, d, row, did);
    else await reviewPosts(store, d, row, did);
  } catch (e) {
    if (!(e instanceof AiError)) throw e;
    // Not at the next run again: a call that fails every five minutes costs money and teaches nothing.
    // (The daily look at the posts has written its time down already.)
    if (step !== "reviewed_at" && step !== "site_at") await store.stamp(row.workspaceId, step, dueAgainIn(RETRY_MS, now));
    if (step === "planned_at") await problem(store, row, "The week could not be planned", "The autopilot could not make a plan this time. It tries again in a few hours.", now);
  }
  return did;
}

/** How many workspaces one timed run takes, and how long it may go on. */
export const TICK_WORKSPACES = 3;
export const TICK_BUDGET_MS = 200_000;

/**
 * A timed run: the workspaces whose autopilot is on, the one that waited
 * longest first. With `workspaceId`, only that one (the "Run now" button).
 */
export async function tick(store: PilotStore, d: EngineDeps, workspaceId?: string): Promise<{ workspaces: number; did: string[] }> {
  const started = d.now();
  const rows = await store.claim(workspaceId ? 1 : TICK_WORKSPACES, new Date(started), workspaceId);
  const did: string[] = [];
  let worked = 0;
  for (const row of rows) {
    // A workspace that cannot start in time is let go untouched: the next run takes it first.
    const inTime = d.now() - started < TICK_BUDGET_MS;
    try {
      if (inTime) {
        did.push(...(await runWorkspace(store, d, row)));
        worked += 1;
      }
    } catch (e) {
      console.error("[autopilot] a run failed", e instanceof Error ? e.name : "unknown");
    } finally {
      await store.release(row.workspaceId, inTime ? new Date(d.now()) : null).catch(() => undefined);
    }
  }
  return { workspaces: worked, did };
}
