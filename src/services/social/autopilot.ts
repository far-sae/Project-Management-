/**
 * The browser's side of the social media autopilot.
 *
 * What the autopilot found and made is read straight from the database (the
 * people of a workspace may read it). The switch and the brief are saved the
 * same way: the database lets only the owner and admins do that. Two things go
 * through the server: asking which parts are switched on, and "Run now".
 */
import { supabase } from '@/services/supabase/config';
import {
  CREDIT_CENTS, DEFAULT_SETTINGS, SETTING_LIMITS,
  type AutopilotMode, type AutopilotNote, type AutopilotReady, type AutopilotSettings, type FeedPost, type JobStatus,
  type MediaFormat, type NoteKind, type RunReport, type VoiceChoice,
} from '../../../api/_social/shared/autopilot';
import type { TikTokPrivacy } from '../../../api/_social/shared/platforms';

type Row = Record<string, unknown>;

export const AUTOPILOT_FAILED_MESSAGE = 'The autopilot could not do that just now. Please try again.';
export const AUTOPILOT_NOT_SET_UP_MESSAGE = 'The autopilot is not set up yet. Run supabase/crm_setup.sql in the Supabase SQL editor, then reload.';
const SIGNED_OUT_MESSAGE = 'Please sign in again.';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

const PRIVACY: TikTokPrivacy[] = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'];

/** A row of the settings table as the screen works with it. */
export function settingsOfRow(r: Row | null): AutopilotSettings {
  if (!r) return { ...DEFAULT_SETTINGS, timezone: browserZone() };
  return {
    mode: (['off', 'ask', 'auto'] as AutopilotMode[]).includes(r.mode as AutopilotMode) ? (r.mode as AutopilotMode) : 'off',
    brief: text(r.brief), audience: text(r.audience), tone: text(r.tone), language: text(r.language) || DEFAULT_SETTINGS.language,
    postsPerWeek: Math.min(SETTING_LIMITS.postsMax, Math.max(SETTING_LIMITS.postsMin, Math.round(num(r.posts_per_week)) || DEFAULT_SETTINGS.postsPerWeek)),
    formats: strings(r.formats).filter((f): f is MediaFormat => f === 'image' || f === 'video'),
    voice: (['with', 'without', 'mixed'] as VoiceChoice[]).includes(r.voice as VoiceChoice) ? (r.voice as VoiceChoice) : 'mixed',
    accountIds: strings(r.account_ids),
    tiktokPrivacy: PRIVACY.includes(r.tiktok_privacy as TikTokPrivacy) ? (r.tiktok_privacy as TikTokPrivacy) : '',
    budgetCents: Math.round(num(r.budget_cents)),
    timezone: text(r.timezone) || browserZone(),
  };
}

/** The time zone of the person's own computer, for a workspace that has not chosen one. */
export function browserZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_SETTINGS.timezone; } catch { return DEFAULT_SETTINGS.timezone; }
}

export type AutopilotJobs = Record<JobStatus, number>;

export type AutopilotData = {
  /** False until the owner has saved the settings once. */
  saved: boolean;
  settings: AutopilotSettings;
  playbook: string;
  notes: AutopilotNote[];
  feed: FeedPost[];
  jobs: AutopilotJobs;
  /** Spent this calendar month on writing, pictures and videos, in US cents. */
  spentCents: number;
};

/** The table is not there: the SQL has not been run yet. */
const missing = (error: { code?: string; message?: string } | null): boolean =>
  Boolean(error && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message ?? '')));

const monthStart = (now: Date): string => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

export async function loadAutopilot(workspaceId: string, now: Date = new Date()): Promise<AutopilotData> {
  const since = monthStart(now);
  const [settings, notes, feed, jobs, costs] = await Promise.all([
    supabase.from('social_autopilot').select('*').eq('workspace_id', workspaceId).maybeSingle(),
    supabase.from('social_autopilot_notes').select('id, kind, title, body, data, created_at').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(40),
    supabase.from('social_feed_posts').select('*').eq('workspace_id', workspaceId).order('posted_at', { ascending: false, nullsFirst: false }).limit(200),
    supabase.from('social_media_jobs').select('status, credits, updated_at').eq('workspace_id', workspaceId).order('updated_at', { ascending: false }).limit(500),
    supabase.from('social_autopilot_notes').select('cost_micro_usd').eq('workspace_id', workspaceId).gte('created_at', since),
  ]);
  const error = settings.error ?? notes.error ?? feed.error ?? jobs.error ?? costs.error;
  if (error) throw new Error(missing(error) ? AUTOPILOT_NOT_SET_UP_MESSAGE : AUTOPILOT_FAILED_MESSAGE);

  const count: AutopilotJobs = { waiting: 0, running: 0, done: 0, failed: 0 };
  let credits = 0;
  for (const j of (jobs.data ?? []) as Row[]) {
    const status = text(j.status) as JobStatus;
    if (status in count) count[status] += 1;
    if ((status === 'running' || status === 'done') && text(j.updated_at) >= since) credits += num(j.credits);
  }
  const micro = ((costs.data ?? []) as Row[]).reduce((sum, n) => sum + num(n.cost_micro_usd), 0);
  const row = (settings.data as Row | null) ?? null;
  return {
    saved: row !== null,
    settings: settingsOfRow(row),
    playbook: text(row?.playbook),
    notes: ((notes.data ?? []) as Row[]).map((n): AutopilotNote => ({
      id: text(n.id), kind: text(n.kind) as NoteKind, title: text(n.title), body: text(n.body),
      data: n.data && typeof n.data === 'object' && !Array.isArray(n.data) ? (n.data as Record<string, unknown>) : {}, createdAt: text(n.created_at),
    })),
    feed: ((feed.data ?? []) as Row[]).map((p): FeedPost => ({
      id: text(p.id), accountId: text(p.account_id), platform: text(p.platform), url: text(p.url), caption: text(p.caption), kind: text(p.kind),
      postedAt: text(p.posted_at) || null, contentId: text(p.content_id) || null,
      views: num(p.views), likes: num(p.likes), comments: num(p.comments), shares: num(p.shares), saves: num(p.saves), reach: num(p.reach),
    })),
    jobs: count,
    spentCents: credits * CREDIT_CENTS + Math.round(micro / 10_000),
  };
}

/** Saves the switch and the brief. Only the owner and admins are let through by the database. */
export async function saveAutopilot(organizationId: string, workspaceId: string, s: AutopilotSettings, userId?: string): Promise<void> {
  const { error } = await supabase.from('social_autopilot').upsert({
    workspace_id: workspaceId, organization_id: organizationId, mode: s.mode,
    brief: s.brief.trim().slice(0, SETTING_LIMITS.brief), audience: s.audience.trim().slice(0, SETTING_LIMITS.audience),
    tone: s.tone.trim().slice(0, SETTING_LIMITS.tone), language: s.language.trim().slice(0, SETTING_LIMITS.language) || DEFAULT_SETTINGS.language,
    posts_per_week: Math.min(SETTING_LIMITS.postsMax, Math.max(SETTING_LIMITS.postsMin, Math.round(s.postsPerWeek) || DEFAULT_SETTINGS.postsPerWeek)),
    formats: s.formats, voice: s.voice, account_ids: s.accountIds, tiktok_privacy: s.tiktokPrivacy,
    budget_cents: Math.min(SETTING_LIMITS.budgetMax, Math.max(0, Math.round(s.budgetCents))), timezone: s.timezone || browserZone(),
    updated_by: userId ?? null, updated_at: new Date().toISOString(),
  }, { onConflict: 'workspace_id' });
  if (error) {
    if (missing(error)) throw new Error(AUTOPILOT_NOT_SET_UP_MESSAGE);
    throw new Error(error.code === '42501' ? 'Only the owner or an admin can change the autopilot.' : 'The settings could not be saved. Please try again.');
  }
}

async function call<T>(route: 'ready' | 'run', body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error(SIGNED_OUT_MESSAGE);
  const response = await fetch(`/api/social/autopilot/${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const answer = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(typeof answer.error === 'string' && answer.error ? answer.error : AUTOPILOT_FAILED_MESSAGE);
  return answer;
}

/** Which parts the site has switched on: writing, pictures and videos, posting. */
export const autopilotReady = (): Promise<AutopilotReady> => call<AutopilotReady>('ready');

/** One run for this workspace, now. It can take a few minutes when it plans a week. */
export const runAutopilot = (workspaceId: string): Promise<RunReport> => call<RunReport>('run', { workspaceId });

/**
 * Says yes to posts the autopilot made. Each goes out at its planned time, or
 * now when that time has passed.
 */
export async function approveAutopilotPosts(posts: Array<{ id: string; scheduledAt: Date | null }>, userId?: string, now: Date = new Date()): Promise<void> {
  for (const post of posts) {
    const when = post.scheduledAt && post.scheduledAt.getTime() > now.getTime() ? post.scheduledAt : now;
    const { error } = await supabase.from('social_content')
      .update({ status: 'scheduled', scheduled_at: when.toISOString(), approved_by: userId ?? null, approved_at: now.toISOString(), last_error: null })
      .eq('id', post.id).eq('status', 'in_review');
    if (error) throw new Error('The post could not be approved. Please try again.');
  }
}
