/**
 * The autopilot's database, on the service key. Every read and write names
 * its workspace: the service key sees all workspaces, so the workspace is
 * always part of the question.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { centsOf } from "../../_automation/cost.js";
import { CREDIT_CENTS, DEFAULT_SETTINGS, SETTING_LIMITS, cleanCustom, cleanDays, cleanTimes, type AutopilotMode, type AutopilotSettings, type MediaFormat, type PostIdea, type VoiceChoice } from "../shared/autopilot.js";
import { serviceIdOf } from "../service.js";
import type { StudyPost } from "./brain.js";
import { BUSY_FOR_MS, type JobRow, type PilotGroup, type PilotRow, type PilotStore } from "./engine.js";

type Row = Record<string, unknown>;

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : Number(value) > 0 ? Number(value) : 0);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
const timeOrNull = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

/** A row of social_autopilot as the settings the app works with. Anything odd falls back to the default. */
export function settingsOf(r: Row): AutopilotSettings {
  const formats = strings(r.formats).filter((f): f is MediaFormat => f === "image" || f === "video");
  return {
    mode: (["off", "ask", "auto"] as AutopilotMode[]).includes(r.mode as AutopilotMode) ? (r.mode as AutopilotMode) : "off",
    brief: text(r.brief),
    audience: text(r.audience),
    tone: text(r.tone),
    language: text(r.language) || DEFAULT_SETTINGS.language,
    postsPerWeek: Math.min(14, Math.max(1, Math.round(num(r.posts_per_week)) || DEFAULT_SETTINGS.postsPerWeek)),
    formats,
    voice: (["with", "without", "mixed"] as VoiceChoice[]).includes(r.voice as VoiceChoice) ? (r.voice as VoiceChoice) : "mixed",
    accountIds: strings(r.account_ids),
    tiktokPrivacy: (["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"].includes(text(r.tiktok_privacy)) ? text(r.tiktok_privacy) : "") as AutopilotSettings["tiktokPrivacy"],
    budgetCents: Math.max(0, Math.round(num(r.budget_cents))),
    timezone: text(r.timezone) || DEFAULT_SETTINGS.timezone,
    // On unless the owner switched it off (also before the column was added).
    retryWeak: r.retry_weak !== false,
    website: text(r.website),
    postDays: cleanDays(r.post_days),
    postTimes: cleanTimes(r.post_times),
    // All "the autopilot chooses" before the column was added.
    custom: cleanCustom(r.custom),
  };
}

const rowOf = (r: Row): PilotRow => ({
  workspaceId: text(r.workspace_id),
  organizationId: text(r.organization_id),
  settings: settingsOf(r),
  playbook: text(r.playbook),
  collectedAt: timeOrNull(r.collected_at),
  studiedAt: timeOrNull(r.studied_at),
  trendsAt: timeOrNull(r.trends_at),
  plannedAt: timeOrNull(r.planned_at),
  reviewedAt: timeOrNull(r.reviewed_at),
  siteNotes: text(r.site_notes),
  siteAt: timeOrNull(r.site_at),
});

const jobOf = (r: Row): JobRow => ({
  id: text(r.id), groupId: text(r.post_group_id), kind: r.kind === "video" ? "video" : "image", prompt: text(r.prompt),
  withVoice: r.with_voice === true, taskId: timeOrNull(r.task_id), attempts: num(r.attempts),
});

/** Whether one of our own posts is this post on the platform: what we kept after posting is its address or its id. */
export function sameFeedPost(kept: string, item: { url: string; platform_post_id: string }): boolean {
  if (!kept) return false;
  const id = item.platform_post_id;
  return kept === item.url || kept === id || (id.length >= 6 && kept.includes(id));
}

const fail = (what: string, error: { code?: string } | null): void => {
  if (error) {
    console.error(`[autopilot] ${what} failed`, error.code ?? "unknown");
    throw new Error(what);
  }
};

export function supabasePilotStore(db: SupabaseClient): PilotStore {
  const free = (now: Date): string => `busy_since.is.null,busy_since.lt."${new Date(now.getTime() - BUSY_FOR_MS).toISOString()}"`;
  return {
    async get(workspaceId) {
      const { data, error } = await db.from("social_autopilot").select("*").eq("workspace_id", workspaceId).maybeSingle();
      fail("row", error);
      return data ? rowOf(data as Row) : null;
    },
    async group(workspaceId, by) {
      let groupId = "groupId" in by ? by.groupId : "";
      if ("contentId" in by) {
        const { data } = await db.from("social_content").select("post_group_id").eq("workspace_id", workspaceId).eq("id", by.contentId).eq("origin", "autopilot").maybeSingle();
        groupId = text(data?.post_group_id);
      }
      if (!groupId) return null;
      const { data, error } = await db.from("social_content").select("id, account_id, status, title, body, idea, campaign_id, scheduled_at")
        .eq("workspace_id", workspaceId).eq("post_group_id", groupId).eq("origin", "autopilot").order("created_at", { ascending: true });
      fail("group", error);
      const rows = (data ?? []) as Row[];
      if (rows.length === 0) return null;
      const first = rows[0];
      const idea = first.idea && typeof first.idea === "object" && !Array.isArray(first.idea) ? (first.idea as PostIdea) : null;
      const group: PilotGroup = {
        groupId, campaignId: timeOrNull(first.campaign_id), title: text(first.title), body: text(first.body), idea, scheduledAt: timeOrNull(first.scheduled_at),
        posts: rows.map((r) => ({ id: text(r.id), accountId: timeOrNull(r.account_id), status: text(r.status) })),
      };
      return group;
    },
    async cancelJobs(groupId) {
      // What a job already cost stays on record: it was spent.
      const { error } = await db.from("social_media_jobs").update({ status: "failed", error: "replaced", updated_at: new Date().toISOString() }).eq("post_group_id", groupId).in("status", ["waiting", "running"]);
      fail("cancel", error);
    },
    async resetGroup(workspaceId, groupId, idea) {
      const { error } = await db.from("social_content").update({ status: "draft", media: [], media_urls: [], idea, last_error: null })
        .eq("workspace_id", workspaceId).eq("post_group_id", groupId).eq("origin", "autopilot").in("status", ["draft", "in_review", "scheduled"]);
      fail("reset", error);
    },
    async markRetried(workspaceId, groupId) {
      const { data } = await db.from("social_content").select("id, idea").eq("workspace_id", workspaceId).eq("post_group_id", groupId).eq("origin", "autopilot");
      for (const r of (data ?? []) as Row[]) {
        const idea = r.idea && typeof r.idea === "object" && !Array.isArray(r.idea) ? (r.idea as Record<string, unknown>) : {};
        const { error } = await db.from("social_content").update({ idea: { ...idea, retried: true } }).eq("id", r.id);
        fail("retried", error);
      }
    },
    async claim(limit, now, workspaceId) {
      let query = db.from("social_autopilot").select("*").neq("mode", "off").or(free(now)).order("worked_at", { ascending: true, nullsFirst: true }).limit(limit);
      if (workspaceId) query = query.eq("workspace_id", workspaceId);
      const { data, error } = await query;
      fail("claim", error);
      const out: PilotRow[] = [];
      for (const r of (data ?? []) as Row[]) {
        // Marked busy only when it is still free: of two runs at the same moment, one gets it.
        const { data: got } = await db.from("social_autopilot").update({ busy_since: now.toISOString() }).eq("workspace_id", r.workspace_id).or(free(now)).select("workspace_id");
        if (got?.length) out.push(rowOf(r));
      }
      return out;
    },
    async release(workspaceId, workedAt) {
      await db.from("social_autopilot").update({ busy_since: null, ...(workedAt ? { worked_at: workedAt.toISOString() } : {}) }).eq("workspace_id", workspaceId);
    },
    async stamp(workspaceId, what, at) {
      const { error } = await db.from("social_autopilot").update({ [what]: at.toISOString() }).eq("workspace_id", workspaceId);
      fail("stamp", error);
    },
    async savePlaybook(workspaceId, playbook) {
      const { error } = await db.from("social_autopilot").update({ playbook }).eq("workspace_id", workspaceId);
      fail("playbook", error);
    },
    async saveSiteNotes(workspaceId, notes) {
      const { error } = await db.from("social_autopilot").update({ site_notes: notes.slice(0, SETTING_LIMITS.siteNotes) }).eq("workspace_id", workspaceId);
      fail("site notes", error);
    },
    async accounts(workspaceId) {
      const { data, error } = await db.from("social_accounts").select("id, provider, display_name, status, credential_ref, external_account_id").eq("workspace_id", workspaceId);
      fail("accounts", error);
      return ((data ?? []) as Row[]).map((a) => ({
        id: text(a.id), provider: text(a.provider), name: text(a.display_name) || "the account", status: text(a.status),
        serviceId: serviceIdOf({ id: text(a.id), provider: text(a.provider), external_account_id: text(a.external_account_id), credential_ref: text(a.credential_ref) }),
      }));
    },
    async saveFeed(row, accountId, platform, items, now) {
      if (items.length === 0) return;
      const at = now.toISOString();
      const { data, error } = await db.from("social_feed_posts").upsert(items.map((i) => ({
        organization_id: row.organizationId, workspace_id: row.workspaceId, account_id: accountId, platform,
        platform_post_id: i.platformPostId, url: i.url, caption: i.caption, kind: i.kind, posted_at: i.postedAt,
        views: i.views, likes: i.likes, comments: i.comments, shares: i.shares, saves: i.saves, reach: i.reach, measured_at: at,
      })), { onConflict: "account_id,platform_post_id" }).select("id, platform_post_id, url, content_id, views, likes, comments, shares, saves, reach");
      fail("feed", error);
      const kept = (data ?? []) as Row[];
      if (kept.length === 0) return;

      // The record: one row for each post and day. A second read on the same day replaces the first.
      const snap = await db.from("social_feed_snapshots").upsert(kept.map((p) => ({
        feed_post_id: p.id, taken_on: at.slice(0, 10), workspace_id: row.workspaceId,
        views: num(p.views), likes: num(p.likes), comments: num(p.comments), shares: num(p.shares), saves: num(p.saves), reach: num(p.reach),
      })), { onConflict: "feed_post_id,taken_on" });
      fail("snapshots", snap.error);

      // Our own posts among them: tie each to its post here, so its numbers show next to it.
      const { data: ours } = await db.from("social_content").select("id, external_post_id").eq("workspace_id", row.workspaceId).eq("account_id", accountId).eq("status", "published").not("external_post_id", "is", null).order("published_at", { ascending: false }).limit(300);
      const own = ((ours ?? []) as Row[]).map((c) => ({ id: text(c.id), kept: text(c.external_post_id) }));
      for (const p of kept) {
        let contentId = timeOrNull(p.content_id);
        if (!contentId) {
          contentId = own.find((c) => sameFeedPost(c.kept, { url: text(p.url), platform_post_id: text(p.platform_post_id) }))?.id ?? null;
          if (contentId) await db.from("social_feed_posts").update({ content_id: contentId }).eq("id", p.id);
        }
        if (contentId) {
          await db.from("social_content_metrics").upsert({
            content_id: contentId, organization_id: row.organizationId, workspace_id: row.workspaceId,
            impressions: num(p.views), reach: num(p.reach), reactions: num(p.likes), comments: num(p.comments), shares: num(p.shares), synced_at: at,
          }, { onConflict: "content_id" });
        }
      }
    },
    async feed(workspaceId, limit) {
      const { data, error } = await db.from("social_feed_posts").select("*").eq("workspace_id", workspaceId).order("posted_at", { ascending: false, nullsFirst: false }).limit(limit);
      fail("feed read", error);
      const posts = (data ?? []) as Row[];
      const { data: accounts } = await db.from("social_accounts").select("id, display_name").eq("workspace_id", workspaceId);
      const names = new Map(((accounts ?? []) as Row[]).map((a) => [text(a.id), text(a.display_name)]));
      const contentIds = posts.map((p) => text(p.content_id)).filter(Boolean);
      const ideas = new Map<string, PostIdea>();
      if (contentIds.length) {
        const { data: content } = await db.from("social_content").select("id, origin, idea").eq("workspace_id", workspaceId).in("id", contentIds);
        for (const c of (content ?? []) as Row[]) {
          if (c.origin === "autopilot" && c.idea && typeof c.idea === "object") ideas.set(text(c.id), c.idea as PostIdea);
        }
      }
      return posts.map((p): StudyPost => ({
        id: text(p.id), accountId: text(p.account_id), platform: text(p.platform), url: text(p.url), caption: text(p.caption), kind: text(p.kind),
        postedAt: timeOrNull(p.posted_at), contentId: timeOrNull(p.content_id),
        views: num(p.views), likes: num(p.likes), comments: num(p.comments), shares: num(p.shares), saves: num(p.saves), reach: num(p.reach),
        accountName: names.get(text(p.account_id)) ?? "", idea: ideas.get(text(p.content_id)) ?? null,
      }));
    },
    async addNote(row, note) {
      const { error } = await db.from("social_autopilot_notes").insert({
        organization_id: row.organizationId, workspace_id: row.workspaceId, kind: note.kind, title: note.title.slice(0, 200), body: note.body.slice(0, 8000),
        data: note.data ?? {}, cost_micro_usd: Math.max(0, Math.round(note.costMicroUsd ?? 0)),
      });
      fail("note", error);
    },
    async latestNote(workspaceId, kind) {
      const { data } = await db.from("social_autopilot_notes").select("title, body, created_at").eq("workspace_id", workspaceId).eq("kind", kind).order("created_at", { ascending: false }).limit(1).maybeSingle();
      return data ? { title: text(data.title), body: text(data.body), createdAt: text(data.created_at) } : null;
    },
    async spentCents(workspaceId, since) {
      const [jobs, notes] = await Promise.all([
        // Every job that has a cost: one being made, one made, and one that was replaced while it was being made.
        db.from("social_media_jobs").select("credits").eq("workspace_id", workspaceId).gte("updated_at", since).gt("credits", 0),
        db.from("social_autopilot_notes").select("cost_micro_usd").eq("workspace_id", workspaceId).gte("created_at", since),
      ]);
      fail("spend", jobs.error ?? notes.error);
      const credits = ((jobs.data ?? []) as Row[]).reduce((sum, j) => sum + num(j.credits), 0);
      const micro = ((notes.data ?? []) as Row[]).reduce((sum, n) => sum + num(n.cost_micro_usd), 0);
      return credits * CREDIT_CENTS + centsOf(micro);
    },
    async recentTitles(workspaceId, since) {
      const { data } = await db.from("social_content").select("title").eq("workspace_id", workspaceId).gte("created_at", since).order("created_at", { ascending: false }).limit(120);
      return [...new Set(((data ?? []) as Row[]).map((r) => text(r.title).trim()).filter(Boolean))];
    },
    async createCampaign(row, name, goal) {
      const { data, error } = await db.from("social_campaigns").insert({
        organization_id: row.organizationId, workspace_id: row.workspaceId, name, objective: goal || null, status: "active", origin: "autopilot",
      }).select("id").single();
      fail("campaign", error);
      return text((data as Row).id);
    },
    async createPosts(row, posts) {
      const { error } = await db.from("social_content").insert(posts.map((p) => ({
        organization_id: row.organizationId, workspace_id: row.workspaceId, account_id: p.accountId, campaign_id: p.campaignId, post_group_id: p.groupId,
        title: p.title, body: p.body, media: [], media_urls: [], options: p.options, status: "draft", scheduled_at: p.scheduledAt, origin: "autopilot", idea: p.idea,
      })));
      fail("posts", error);
    },
    async createJob(row, job) {
      const { error } = await db.from("social_media_jobs").insert({
        organization_id: row.organizationId, workspace_id: row.workspaceId, post_group_id: job.groupId, kind: job.kind, prompt: job.prompt, with_voice: job.withVoice,
      });
      fail("job", error);
    },
    async jobs(workspaceId, status, limit) {
      const { data, error } = await db.from("social_media_jobs").select("*").eq("workspace_id", workspaceId).eq("status", status).order("created_at", { ascending: true }).limit(limit);
      fail("jobs", error);
      return ((data ?? []) as Row[]).map(jobOf);
    },
    async updateJob(id, patch) {
      const { error } = await db.from("social_media_jobs").update({
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.taskId !== undefined ? { task_id: patch.taskId } : {}),
        ...(patch.credits !== undefined ? { credits: patch.credits } : {}),
        ...(patch.url !== undefined ? { url: patch.url } : {}),
        ...(patch.error !== undefined ? { error: patch.error } : {}),
        ...(patch.attempts !== undefined ? { attempts: patch.attempts } : {}),
        updated_at: new Date().toISOString(),
      }).eq("id", id);
      fail("job update", error);
    },
    async attachMedia(groupId, media, release, now) {
      // Only posts the autopilot made that still wait for their file: one a person has since changed or sent is left alone.
      const { error } = await db.from("social_content").update({
        media: [media], media_urls: [media.url], status: release, last_error: null,
        ...(release === "scheduled" ? { approved_at: now.toISOString() } : {}),
      }).eq("post_group_id", groupId).eq("origin", "autopilot").eq("status", "draft");
      fail("attach", error);
    },
    async failGroup(groupId, message) {
      await db.from("social_content").update({ last_error: message }).eq("post_group_id", groupId).eq("origin", "autopilot").eq("status", "draft");
    },
    async saveFile(workspaceId, name, bytes, mime) {
      const path = `${workspaceId}/${name}`;
      const { error } = await db.storage.from("social-media").upload(path, bytes, { contentType: mime, upsert: true });
      if (error) {
        console.error("[autopilot] a file was not stored", error.name ?? "unknown");
        throw new Error("file not stored");
      }
      return db.storage.from("social-media").getPublicUrl(path).data.publicUrl;
    },
  };
}
