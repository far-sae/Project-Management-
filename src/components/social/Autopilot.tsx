// The social media autopilot of one workspace: its switch, what it has
// learned, the posts that wait for a yes, how its posts did, and its settings.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ExternalLink, Loader2, Pencil, Play, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { SetupHint } from '@/components/common/SetupHint';
import { StatStrip } from '@/components/common/StatStrip';
import { StatusPill, type StatusTone } from '@/components/common/StatusPill';
import { MediaThumb } from '@/components/social/PostPreview';
import { AutopilotEdit } from '@/components/social/AutopilotEdit';
import { AutopilotLearned } from '@/components/social/AutopilotLearned';
import { AutopilotSettingsForm } from '@/components/social/AutopilotSettingsForm';
import { publicMessage, publicText } from '@/lib/publicError';
import {
  MODE_HINT, MODE_NAME, NOTE_NAME, VERDICT_NAME, VIDEO_CREDITS_PER_SECOND, VIDEO_SECONDS,
  interactions, settingProblems, verdictOf,
  type AutopilotMode, type AutopilotNote, type AutopilotReady, type AutopilotSettings, type Verdict,
} from '../../../api/_social/shared/autopilot';
import { PLATFORM_NAME, isPlatform } from '../../../api/_social/shared/platforms';
import {
  approveAutopilotPosts, autopilotReady, improveAutopilotPost, learnFromWebsite, loadAutopilot, refreshAutopilotTrends, runAutopilot, saveAutopilot, type AutopilotData,
} from '@/services/social/autopilot';
import type { SocialAccount, SocialContent } from '@/types/social';

interface Props {
  organizationId: string;
  workspaceId: string;
  accounts: SocialAccount[];
  content: SocialContent[];
  /** The owner and admins change the switch and the brief, and may run it. */
  canEdit: boolean;
  userId?: string;
  /** Posts were approved or deleted: the page reads its lists again. */
  onChanged: () => void;
  onDelete: (items: SocialContent[]) => Promise<void> | void;
}

/** The most steps one press of "Run now" asks for: enough for a new workspace to reach its first plan, with room to spare. */
const RUN_STEPS_AT_MOST = 8;
const CARD = 'rounded-lg border border-border bg-card';
const HEAD = 'border-b border-border px-4 py-3';

const MODE_TONE: Record<AutopilotMode, StatusTone> = { off: 'muted', ask: 'info', auto: 'success' };
const VERDICT_TONE: Record<Verdict, StatusTone> = { better: 'success', usual: 'neutral', weaker: 'warning', early: 'muted' };
const NOTE_TONE: Record<AutopilotNote['kind'], StatusTone> = { study: 'info', trends: 'info', plan: 'success', problem: 'warning' };

const money = (cents: number): string => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
const when = (value: Date | string | null): string => {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

/** The posts of one idea (one for each account), as one thing to say yes or no to. */
type Idea = { id: string; posts: SocialContent[]; first: SocialContent };

function ideasOf(posts: SocialContent[]): Idea[] {
  const groups = new Map<string, SocialContent[]>();
  for (const post of posts) {
    const key = post.postGroupId ?? post.id;
    groups.set(key, [...(groups.get(key) ?? []), post]);
  }
  return [...groups.entries()].map(([id, group]) => ({ id, posts: group, first: group[0] }))
    .sort((a, b) => (a.first.scheduledAt?.getTime() ?? 0) - (b.first.scheduledAt?.getTime() ?? 0));
}

/** The most a month of pictures and videos can cost with these settings, in cents (the budget is the real limit). */
export function monthlyMediaCeiling(s: AutopilotSettings): number {
  const video = VIDEO_SECONDS * (s.voice === 'without' ? VIDEO_CREDITS_PER_SECOND.silent : VIDEO_CREDITS_PER_SECOND.voice);
  const each = s.formats.includes('video') ? video : 1;
  return Math.ceil(s.postsPerWeek * each * 4.5);
}

export const Autopilot: React.FC<Props> = ({ organizationId, workspaceId, accounts, content, canEdit, userId, onChanged, onDelete }) => {
  const [data, setData] = useState<AutopilotData | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [ready, setReady] = useState<AutopilotReady | null>(null);
  const [form, setForm] = useState<AutopilotSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  /** What "Run now" has done so far, while it is still working; null when it is not running. */
  const [progress, setProgress] = useState<string[] | null>(null);
  const [confirmAuto, setConfirmAuto] = useState(false);
  const [busyIdea, setBusyIdea] = useState<string | null>(null);
  /** The idea open in the "Change this post" window. */
  const [editing, setEditing] = useState<string | null>(null);
  /** The post a second try is being made for. */
  const [improving, setImproving] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  /** What the website said when it was read for the form: saved with the form, so it is not read twice. */
  const [siteNotes, setSiteNotes] = useState<string | null>(null);
  /** Goes up when the form is filled again from what is saved, so half-typed boxes start clean. */
  const [formVersion, setFormVersion] = useState(0);
  /** The trends are being looked up because the owner asked. */
  const [refreshing, setRefreshing] = useState(false);
  /** The last save could not keep the newer options. */
  const [customLost, setCustomLost] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await loadAutopilot(workspaceId);
      setData(next);
      setProblem(null);
      // What the person is typing is not thrown away by a read in the background.
      setForm((old) => old ?? next.settings);
    } catch (error) {
      setProblem(publicMessage(error, 'The autopilot could not be opened. Please try again.'));
    }
  }, [workspaceId]);

  useEffect(() => { setData(null); setForm(null); setSiteNotes(null); setCustomLost(false); setFormVersion((v) => v + 1); void load(); }, [load]);
  useEffect(() => { autopilotReady().then(setReady).catch(() => setReady(null)); }, []);

  const postable = useMemo(() => accounts.filter((a) => isPlatform(a.provider) && a.status === 'connected'), [accounts]);
  const accountName = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const own = useMemo(() => content.filter((c) => c.origin === 'autopilot'), [content]);
  const waiting = useMemo(() => ideasOf(own.filter((c) => c.status === 'in_review')), [own]);
  const making = useMemo(() => ideasOf(own.filter((c) => c.status === 'draft' && !c.media && !c.lastError)), [own]);
  const stuck = useMemo(() => ideasOf(own.filter((c) => c.status === 'draft' && Boolean(c.lastError))), [own]);
  const upcoming = useMemo(() => ideasOf(own.filter((c) => c.status === 'scheduled')), [own]);

  const results = useMemo(() => {
    if (!data) return [];
    const byContent = new Map(own.map((c) => [c.id, c]));
    const now = Date.now();
    return data.feed.filter((p) => p.contentId && byContent.has(p.contentId)).slice(0, 12).map((p) => ({
      post: p, made: byContent.get(p.contentId as string) as SocialContent,
      verdict: verdictOf(p, data.feed.filter((o) => o.accountId === p.accountId), now),
    }));
  }, [data, own]);

  const doSave = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const saved = await saveAutopilot(organizationId, workspaceId, form, userId, siteNotes !== null ? { siteNotes } : undefined);
      setCustomLost(!saved.customKept);
      if (saved.customKept) toast.success(form.mode === 'off' ? 'Saved. The autopilot is off.' : 'Saved. The autopilot starts within five minutes.');
      else toast.warning('Saved, but the newer options could not be kept yet. See the note in the settings.');
      setForm(null);
      setSiteNotes(null);
      setFormVersion((v) => v + 1);
      await load();
    } catch (error) {
      toast.error(publicMessage(error, 'The settings could not be saved. Please try again.'));
    } finally {
      setSaving(false);
      setConfirmAuto(false);
    }
  };

  /** Fully automatic posts with nobody checking: that is asked once more before it is saved. */
  const save = () => {
    if (form?.mode === 'auto' && data?.settings.mode !== 'auto') setConfirmAuto(true);
    else void doSave();
  };

  /**
   * One press of "Run now". The server does one step for each request (a step
   * can take minutes, and a request may not), and says whether another step is
   * due. So the page asks again by itself: a new workspace goes from reading
   * its pages to a planned week in one press, and the page says how far it is.
   */
  const run = async () => {
    setRunning(true);
    setProgress([]);
    const done: string[] = [];
    let why = '';
    try {
      for (let step = 0; step < RUN_STEPS_AT_MOST; step += 1) {
        const report = await runAutopilot(workspaceId);
        done.push(...report.did);
        why = report.next;
        setProgress([...done]);
        if (!report.more) break;
      }
      const planned = done.some((line) => line.startsWith('planned '));
      const said = done.length ? `Done: ${done.join(', ')}.` : '';
      const then = why || (planned ? 'The pictures and videos are being made now. The posts appear here when they are ready, in a few minutes.' : '');
      toast.success([said, then].filter(Boolean).join(' ') || 'Nothing was due just now.');
      await load();
      onChanged();
    } catch (error) {
      // What was done before the fault is still done: the page shows it after the reload.
      toast.error(publicMessage(error, 'The autopilot could not run just now. Please try again.'));
      if (done.length) await load().catch(() => undefined);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  /** Reads the business's website and fills in the form from it. Nothing is saved until Save is pressed. */
  const readWebsite = async () => {
    if (!form) return;
    setReading(true);
    try {
      const found = await learnFromWebsite(workspaceId, form.website);
      setForm((old) => (old ? {
        ...old,
        brief: found.brief || old.brief, audience: found.audience || old.audience, tone: found.tone || old.tone, language: found.language || old.language,
      } : old));
      setSiteNotes(found.notes);
      toast.success('Filled in from your website. Check it, then press Save.');
    } catch (error) {
      toast.error(publicMessage(error, 'The website could not be read just now. Please try again.'));
    } finally {
      setReading(false);
    }
  };

  const refreshTrends = async () => {
    setRefreshing(true);
    try {
      await refreshAutopilotTrends(workspaceId);
      toast.success('The latest trends are in.');
    } catch (error) {
      toast.error(publicMessage(error, 'The trends could not be looked up just now. Please try again.'));
    } finally {
      await load();
      setRefreshing(false);
    }
  };

  const secondTry = async (contentId: string) => {
    setImproving(contentId);
    try {
      await improveAutopilotPost(workspaceId, contentId);
      toast.success('A better version is being made. It appears above when it is ready.');
      await load();
      onChanged();
    } catch (error) {
      toast.error(publicMessage(error, 'A second try could not be made just now. Please try again.'));
    } finally {
      setImproving(null);
    }
  };

  const approve = async (idea: Idea) => {
    setBusyIdea(idea.id);
    try {
      await approveAutopilotPosts(idea.posts, userId);
      toast.success('Approved. It goes out at its time.');
      onChanged();
    } catch (error) {
      toast.error(publicMessage(error, 'The post could not be approved. Please try again.'));
    } finally {
      setBusyIdea(null);
    }
  };

  const remove = async (idea: Idea) => {
    setBusyIdea(idea.id);
    try { await onDelete(idea.posts); } finally { setBusyIdea(null); }
  };

  if (problem) return <div role="alert" className={`${CARD} mt-3 p-6 text-sm text-muted-foreground`}>{problem}</div>;
  if (!data || !form) return <div className="py-16 text-center text-muted-foreground"><Loader2 className="mx-auto h-7 w-7 animate-spin" aria-hidden /><p className="mt-2 text-sm">Opening the autopilot…</p></div>;

  const mode = data.settings.mode;
  /** The pictures and videos the maker is working on, or that wait for their turn. */
  const beingMade = data.jobs.running + data.jobs.waiting;
  const problems = settingProblems(form);
  const study = data.notes.find((n) => n.kind === 'study');
  const trends = data.notes.find((n) => n.kind === 'trends');
  const alerts = data.notes.filter((n) => n.kind === 'problem').slice(0, 3);
  const changed = JSON.stringify(form) !== JSON.stringify(data.settings) || !data.saved || siteNotes !== null;

  const editButton = (idea: Idea) => (
    <Button size="sm" variant="outline" disabled={busyIdea !== null} onClick={() => setEditing(idea.id)} aria-label={`Change ${idea.first.title}`}>
      <Pencil aria-hidden />Change
    </Button>
  );
  const allIdeas = [...waiting, ...upcoming, ...stuck];
  const editingPosts = allIdeas.find((idea) => idea.id === editing)?.posts ?? null;

  const ideaRow = (idea: Idea, actions: React.ReactNode) => {
    const post = idea.first;
    const platforms = idea.posts.map((p) => { const a = accountName.get(p.accountId ?? ''); return a && isPlatform(a.provider) ? PLATFORM_NAME[a.provider] : 'Account'; });
    return (
      <li key={idea.id} className="flex flex-wrap gap-3 px-4 py-3" aria-label={post.title}>
        <MediaThumb media={post.media} title={post.title} onOpen={() => { if (post.media) window.open(post.media.url, '_blank', 'noopener'); }} className="h-20 w-16 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{post.title}</p>
          <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">{post.body}</p>
          <p className="mt-1 text-xs text-muted-foreground">{[...new Set(platforms)].join(', ')}{post.scheduledAt ? ` · ${when(post.scheduledAt)}` : ''}</p>
          {post.idea?.experiment && <p className="mt-1 text-xs text-muted-foreground"><span className="font-medium text-foreground">It tries:</span> {post.idea.experiment}</p>}
          {post.idea?.improves && <p className="mt-1 text-xs text-muted-foreground">A better version of “{post.idea.improves}”, which did weakly.</p>}
          {post.lastError && <p className="mt-1 text-xs text-destructive">{publicText(post.lastError, 'This post has no picture or video.')}</p>}
        </div>
        <div className="flex shrink-0 items-start gap-2">{actions}</div>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-4 pt-3">
      <section aria-label="Autopilot" className={`${CARD} flex flex-wrap items-start justify-between gap-3 p-4`}>
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden />Autopilot
            <StatusPill tone={MODE_TONE[mode]}>{MODE_NAME[mode]}</StatusPill>
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            It reads your pages, learns what works, follows the latest trends, plans each week, makes the pictures and videos, and posts. Then it watches the numbers and changes what it does.
          </p>
          <p className="mt-1 text-sm text-foreground">{MODE_HINT[mode]}</p>
        </div>
        {canEdit && mode !== 'off' && (
          <Button variant="outline" onClick={() => void run()} disabled={running}>
            {running ? <Loader2 className="animate-spin" aria-hidden /> : <Play aria-hidden />}{running ? 'Working…' : 'Run now'}
          </Button>
        )}
        {progress !== null && (
          <p role="status" className="basis-full text-sm text-muted-foreground">
            {progress.length === 0
              ? 'Working. A step can take a few minutes; you can leave this page open.'
              : `Done so far: ${progress.join(', ')}. Still working…`}
          </p>
        )}
      </section>

      {mode !== 'off' && (
        <StatStrip
          items={[
            { label: 'Waiting for your yes', value: waiting.length, tone: waiting.length > 0 ? 'default' : 'muted' },
            { label: 'Planned to go out', value: upcoming.length, tone: upcoming.length > 0 ? 'default' : 'muted' },
            { label: 'Being made', value: beingMade, note: beingMade === 1 ? 'picture or video' : 'pictures and videos', tone: beingMade > 0 ? 'default' : 'muted' },
            { label: 'Spent this month', value: money(data.spentCents), note: `of ${money(data.settings.budgetCents)}`, tone: data.spentCents >= data.settings.budgetCents && data.settings.budgetCents > 0 ? 'danger' : 'default' },
          ]}
        />
      )}

      {ready && (!ready.writing || !ready.media || !ready.posting) && (
        <div role="status" className="rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning-soft-foreground">
          <p className="font-medium">Some parts are not switched on yet.</p>
          <ul className="mt-1 list-disc pl-5">
            {!ready.writing && <li>Writing and planning. <SetupHint other="">Add ANTHROPIC_API_KEY in the server settings (Vercel), then redeploy.</SetupHint></li>}
            {!ready.media && <li>Making pictures and videos. Posts are planned and wait for their picture. <SetupHint other="">Add RUNWAYML_API_SECRET in the server settings (Vercel), then redeploy.</SetupHint></li>}
            {!ready.posting && <li>Connecting accounts and reading their numbers. <SetupHint other="">Add POST_FOR_ME_API_KEY in the server settings (Vercel), then redeploy.</SetupHint></li>}
          </ul>
        </div>
      )}

      {alerts.length > 0 && (
        <section aria-label="Needs your attention" className={CARD}>
          <h3 className={`${HEAD} text-sm font-semibold`}>Needs your attention</h3>
          <ul className="divide-y divide-border">
            {alerts.map((n) => (
              <li key={n.id} className="px-4 py-3 text-sm">
                <p className="font-medium text-foreground">{n.title}</p>
                <p className="text-muted-foreground">{n.body}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{when(n.createdAt)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Waiting for your yes" className={CARD}>
        <h3 className={`${HEAD} text-sm font-semibold`}>Waiting for your yes{waiting.length > 0 ? ` (${waiting.length})` : ''}</h3>
        {waiting.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            {mode === 'off' ? 'Nothing here. Switch the autopilot on below.'
              : mode === 'auto' ? 'Nothing waits: posts go out at their time by themselves.'
                : making.length > 0 ? 'Nothing yet. The posts below are getting their picture or video first.'
                  : 'Nothing waits right now. New posts appear here after the next plan.'}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {waiting.map((idea) => ideaRow(idea, (
              <>
                {canEdit && editButton(idea)}
                <Button size="sm" disabled={busyIdea !== null} onClick={() => void approve(idea)} aria-label={`Approve ${idea.first.title}`}>
                  {busyIdea === idea.id ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}Approve
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={busyIdea !== null} onClick={() => void remove(idea)} aria-label={`Delete ${idea.first.title}`}>
                  <Trash2 aria-hidden />Delete
                </Button>
              </>
            )))}
          </ul>
        )}
      </section>

      {(making.length > 0 || stuck.length > 0 || upcoming.length > 0) && (
        <section aria-label="Planned posts" className={CARD}>
          <h3 className={`${HEAD} text-sm font-semibold`}>Planned posts</h3>
          <ul className="divide-y divide-border">
            {upcoming.map((idea) => ideaRow(idea, <><StatusPill tone="info">Goes out {when(idea.first.scheduledAt)}</StatusPill>{canEdit && editButton(idea)}</>))}
            {making.map((idea) => ideaRow(idea, <StatusPill tone="muted" pulse>{idea.first.idea?.format === 'video' ? 'Video being made' : 'Picture being made'}</StatusPill>))}
            {stuck.map((idea) => ideaRow(idea, (
              <>{canEdit && editButton(idea)}<Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={busyIdea !== null} onClick={() => void remove(idea)} aria-label={`Delete ${idea.first.title}`}>
                <Trash2 aria-hidden />Delete
              </Button></>
            )))}
          </ul>
        </section>
      )}

      <AutopilotLearned
        study={study} trends={trends} siteNotes={data.siteNotes} playbook={data.playbook}
        canRefresh={canEdit && mode !== 'off' && Boolean(ready?.writing)} refreshing={refreshing} onRefreshTrends={() => void refreshTrends()} when={when}
      />

      <section aria-label="How its posts did" className={CARD}>
        <h3 className={`${HEAD} text-sm font-semibold`}>How its posts did</h3>
        {results.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            {data.feed.length === 0
              ? 'No numbers yet. They are read from your pages every six hours, for every post, also the ones not made here.'
              : `The numbers of ${data.feed.length} ${data.feed.length === 1 ? 'post' : 'posts'} on your pages are on record. The autopilot's own posts appear here a day after they go out.`}
            {' '}A post cannot be changed once it is out. When one does weakly, the autopilot posts a better version instead.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="h-10 border-b border-border bg-surface-2 text-left text-xs text-muted-foreground">
                  <th className="px-4 font-medium">Post</th><th className="px-3 font-medium">It tried</th>
                  <th className="px-3 text-right font-medium">Views</th><th className="px-3 text-right font-medium">Reactions</th><th className="px-3 font-medium">Result</th><th className="px-4 font-medium"><span className="sr-only">Second try</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {results.map(({ post, made, verdict }) => (
                  <tr key={post.id}>
                    <td className="px-4 py-2">
                      <p className="font-medium text-foreground">{made.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {isPlatform(post.platform) ? PLATFORM_NAME[post.platform] : post.platform} · {when(post.postedAt)}
                        {post.url && <a href={post.url} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-0.5 underline">Open<ExternalLink className="h-3 w-3" aria-hidden /></a>}
                      </p>
                    </td>
                    <td className="max-w-xs px-3 py-2 text-muted-foreground">{made.idea?.experiment ?? ''}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{(post.views || post.reach).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{interactions(post).toLocaleString()}</td>
                    <td className="px-3 py-2"><StatusPill tone={VERDICT_TONE[verdict]}>{VERDICT_NAME[verdict]}</StatusPill></td>
                    <td className="px-4 py-2 text-right">
                      {made.idea?.retried ? <span className="text-xs text-muted-foreground">Second try made</span>
                        : made.idea?.improves ? <span className="text-xs text-muted-foreground">This is a second try</span>
                          : canEdit && mode !== 'off' && (
                            <Button size="sm" variant="outline" disabled={improving !== null} onClick={() => void secondTry(made.id)} aria-label={`Second try for ${made.title}`}>
                              {improving === made.id ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />}Second try
                            </Button>
                          )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-label="Autopilot settings" className={CARD}>
        <h3 className={`${HEAD} text-sm font-semibold`}>Settings</h3>
        {!canEdit ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Only the owner or an admin can change the autopilot.</p>
        ) : (
          <AutopilotSettingsForm
            key={formVersion}
            form={form} onChange={setForm} postable={postable} problems={problems} changed={changed} saving={saving} onSave={save}
            reading={reading} onReadWebsite={() => void readWebsite()} onWebsiteTyped={() => setSiteNotes(null)}
            costNote={`With these settings, pictures and videos cost at most about ${money(monthlyMediaCeiling(form))} a month, plus a few dollars for the writing. It stops when the limit is reached.`}
            customReady={data.customReady !== false && !customLost}
          />
        )}
      </section>

      {data.notes.length > 0 && (
        <section aria-label="What it did" className={CARD}>
          <h3 className={`${HEAD} text-sm font-semibold`}>What it did</h3>
          <ul className="divide-y divide-border">
            {data.notes.slice(0, 12).map((n) => (
              <li key={n.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2 text-sm">
                <StatusPill tone={NOTE_TONE[n.kind]}>{NOTE_NAME[n.kind]}</StatusPill>
                <span className="min-w-0 flex-1 text-foreground">{n.title}</span>
                <span className="text-xs text-muted-foreground">{when(n.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <AutopilotEdit
        posts={editingPosts} workspaceId={workspaceId} accounts={accounts} canRemake={Boolean(ready?.media) && mode !== 'off'}
        onOpenChange={(open) => { if (!open) setEditing(null); }} onChanged={() => { void load(); onChanged(); }}
      />

      <AlertDialog open={confirmAuto} onOpenChange={(open) => { if (!open && !saving) setConfirmAuto(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to fully automatic?</AlertDialogTitle>
            <AlertDialogDescription>
              The autopilot will post to your real pages by itself, with nobody checking the text, the picture or the video first.
              You can switch back to “Ask me first” at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={saving} onClick={(e) => { e.preventDefault(); void doSave(); }}>
              {saving && <Loader2 className="animate-spin" aria-hidden />}Yes, post by itself
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Autopilot;
