// Every post of the workspace in one table: a row for each platform a post
// went to, tabs by state, a search, filters (platform, account, campaign, and a
// span of date and time), sorting, pages, an export, and what can be done with
// a post right in its row.
import React, { useEffect, useId, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Download, ExternalLink, Film, ImageIcon, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { StatusPill, type StatusTone } from '@/components/common/StatusPill';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { publicText } from '@/lib/publicError';
import { saveTextFile } from '@/lib/signroom/billingCsv';
import {
  FIRST_SORT, NO_FILTERS, POST_TABS, QUICK_RANGES, STATE_LABEL, activeFilters, filterRows, pageOf, postRows, quickRange, quickRangeOf,
  rowsCsv, sortRows, tabCounts, toLocalInput,
  type PostFilters, type PostRow, type PostSort, type QuickRange,
} from '@/lib/socialPosts';
import { cn } from '@/lib/utils';
import type { SocialAccount, SocialCampaign, SocialContent, SocialContentStatus } from '@/types/social';
import { PLATFORMS, PLATFORM_NAME } from '../../../api/_social/shared/platforms';

interface Props {
  content: SocialContent[];
  accounts: SocialAccount[];
  campaigns: SocialCampaign[];
  onNewPost: () => void;
  /** Send failed posts again now. */
  onRetry: (items: SocialContent[]) => void | Promise<void>;
  /** Move a post on: ask for approval, approve it, or send an approved one. */
  onStatus: (item: SocialContent, status: SocialContentStatus) => void | Promise<void>;
  /** Remove posts from the list for good. */
  onDelete: (items: SocialContent[]) => Promise<void>;
  /** Opens the table on these filters (a campaign's posts, the drafts). `at` changes each time it is asked. */
  jump?: { filters: Partial<PostFilters>; at: number } | null;
  /** The time "now", for the ready-made date spans. */
  now?: () => Date;
}

const TONE: Record<SocialContentStatus, StatusTone> = {
  draft: 'neutral', in_review: 'warning', approved: 'info', scheduled: 'info', publishing: 'info', published: 'success', failed: 'danger',
};

const BOX = 'h-11 md:h-8 rounded-md border border-input bg-background px-2 text-base md:text-sm focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25';
const HEAD = 'h-10 border-b border-border bg-surface-2 text-xs text-muted-foreground';
const ROW = 'border-b border-border/60 align-top transition-colors last:border-0 hover:bg-surface-2';

const whenText = (d: Date): string => d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export const PostsTable: React.FC<Props> = ({ content, accounts, campaigns, onNewPost, onRetry, onStatus, onDelete, jump = null, now = () => new Date() }) => {
  const id = useId();
  const [filters, setFilters] = useState<PostFilters>(() => ({ ...NO_FILTERS, ...(jump?.filters ?? {}) }));
  const [sort, setSort] = useState<PostSort>(FIRST_SORT);
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [toDelete, setToDelete] = useState<SocialContent[] | null>(null);
  const [deleting, setDeleting] = useState(false);

  const rows = useMemo(() => postRows(content, accounts, campaigns), [content, accounts, campaigns]);
  const counts = useMemo(() => tabCounts(rows, filters), [rows, filters]);
  const shown = useMemo(() => sortRows(filterRows(rows, filters), sort), [rows, filters, sort]);
  const view = pageOf(shown, page);

  const change = (patch: Partial<PostFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  // Asked from another tab ("See posts" of a campaign): start from exactly those filters.
  const jumpAt = jump?.at;
  useEffect(() => {
    if (!jump) return;
    setFilters({ ...NO_FILTERS, ...jump.filters });
    setPage(1);
    // Only when it is asked again (`at` changes), not when the filters object is made anew.
  }, [jumpAt]);

  // A post that is gone (deleted, or filtered out by another person's change) is no longer picked.
  useEffect(() => {
    setPicked((old) => {
      const alive = new Set(content.map((p) => p.id));
      const next = new Set([...old].filter((postId) => alive.has(postId)));
      return next.size === old.size ? old : next;
    });
  }, [content]);

  const platforms = useMemo(() => PLATFORMS.filter((p) => accounts.some((a) => a.provider === p)), [accounts]);
  const accountChoices = filters.platform ? accounts.filter((a) => a.provider === filters.platform) : accounts;
  const span = quickRangeOf(filters.from, filters.to, now());
  const on = activeFilters(filters);

  const pickedPosts = content.filter((p) => picked.has(p.id));
  const pickedFailed = pickedPosts.filter((p) => p.status === 'failed');
  const pageIds = view.rows.map((r) => r.post.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((postId) => picked.has(postId));

  const togglePage = () => setPicked((old) => {
    const next = new Set(old);
    for (const postId of pageIds) { if (allOnPage) next.delete(postId); else next.add(postId); }
    return next;
  });
  const toggle = (postId: string) => setPicked((old) => {
    const next = new Set(old);
    if (next.has(postId)) next.delete(postId); else next.add(postId);
    return next;
  });

  const sortBy = (by: PostSort['by']) => setSort((s) => (s.by === by ? { by, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { by, dir: by === 'when' ? 'desc' : 'asc' }));

  const remove = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await onDelete(toDelete);
      setToDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  const exportRows = () => saveTextFile(`social-posts-${toLocalInput(now()).slice(0, 10)}.csv`, rowsCsv(shown));

  const head = (by: PostSort['by'], label: string, className = '') => (
    <th scope="col" aria-sort={sort.by === by ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={cn('px-3 font-medium', className)}>
      <button type="button" onClick={() => sortBy(by)} className="inline-flex items-center gap-1 hover:text-foreground" aria-label={`Sort by ${label.toLowerCase()}`}>
        {label}
        {sort.by === by && (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)}
      </button>
    </th>
  );

  const action = (row: PostRow) => {
    const post = row.post;
    if (post.status === 'failed') return <Button size="sm" variant="outline" onClick={() => void onRetry([post])}><RotateCcw aria-hidden />Try again</Button>;
    if (post.status === 'in_review') return <Button size="sm" variant="outline" onClick={() => void onStatus(post, post.scheduledAt ? 'scheduled' : 'approved')}><Check aria-hidden />Approve</Button>;
    if (post.status === 'draft') return <Button size="sm" variant="outline" onClick={() => void onStatus(post, 'in_review')}>Ask for approval</Button>;
    if (post.status === 'approved') return <Button size="sm" variant="outline" onClick={() => void onStatus(post, 'scheduled')}>Post now</Button>;
    if (row.link) return <Button asChild size="sm" variant="outline"><a href={row.link} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden />View post</a></Button>;
    return null;
  };

  return (
    <section className="flex flex-col gap-3" aria-label="Posts">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Posts</h2>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={shown.length === 0} onClick={exportRows}><Download aria-hidden />Export</Button>
          <Button size="sm" onClick={onNewPost}><Plus aria-hidden />New post</Button>
        </div>
      </div>

      <div role="tablist" aria-label="Posts by state" className="flex flex-wrap gap-1 border-b border-border">
        {POST_TABS.map((tab) => (
          <button
            key={tab.id} type="button" role="tab" aria-selected={filters.tab === tab.id}
            onClick={() => change({ tab: tab.id })}
            className={cn(
              '-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              filters.tab === tab.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
            <span className="rounded-full bg-secondary px-1.5 text-xs tabular-nums text-muted-foreground">{counts[tab.id]}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input aria-label="Search posts" placeholder="Search posts" className="pl-8" value={filters.search} onChange={(e) => change({ search: e.target.value })} />
        </div>
        <select aria-label="Platform" className={BOX} value={filters.platform} onChange={(e) => change({ platform: e.target.value, accountId: '' })}>
          <option value="">All platforms</option>
          {platforms.map((p) => <option key={p} value={p}>{PLATFORM_NAME[p]}</option>)}
        </select>
        <select aria-label="Account" className={cn(BOX, 'max-w-[14rem]')} value={filters.accountId} onChange={(e) => change({ accountId: e.target.value })}>
          <option value="">All accounts</option>
          {accountChoices.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}
        </select>
        {campaigns.length > 0 && (
          <select aria-label="Campaign" className={cn(BOX, 'max-w-[14rem]')} value={filters.campaignId} onChange={(e) => change({ campaignId: e.target.value })}>
            <option value="">All campaigns</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <select
          aria-label="When" className={BOX} value={span}
          onChange={(e) => { if (e.target.value !== 'custom') change(quickRange(e.target.value as QuickRange, now())); }}
        >
          {QUICK_RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          {span === 'custom' && <option value="custom">Chosen dates</option>}
        </select>
        <label htmlFor={`${id}-from`} className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          From
          <input id={`${id}-from`} type="datetime-local" className={BOX} value={filters.from} max={filters.to || undefined} onChange={(e) => change({ from: e.target.value })} />
        </label>
        <label htmlFor={`${id}-to`} className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          To
          <input id={`${id}-to`} type="datetime-local" className={BOX} value={filters.to} min={filters.from || undefined} onChange={(e) => change({ to: e.target.value })} />
        </label>
        {on > 0 && (
          <Button size="sm" variant="ghost" onClick={() => change({ ...NO_FILTERS, tab: filters.tab })}><X aria-hidden />Clear filters</Button>
        )}
      </div>

      {picked.size > 0 && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm">
          <span className="font-medium">{picked.size} selected</span>
          {pickedFailed.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => void onRetry(pickedFailed)}><RotateCcw aria-hidden />Try {pickedFailed.length === 1 ? 'it' : `${pickedFailed.length}`} again</Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setToDelete(pickedPosts)}><Trash2 aria-hidden />Delete</Button>
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">No posts yet. Press New post to upload once and post everywhere.</p>
      ) : shown.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          <p>No post matches.</p>
          {(on > 0 || filters.tab !== 'all') && (
            <Button className="mt-3" size="sm" variant="outline" onClick={() => change(NO_FILTERS)}>Show all posts</Button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead>
                <tr className={HEAD}>
                  <th scope="col" className="w-10 px-3">
                    <input type="checkbox" className="h-4 w-4 accent-primary" aria-label="Select every post on this page" checked={allOnPage} onChange={togglePage} />
                  </th>
                  {head('title', 'Post')}
                  {head('platform', 'Platform')}
                  {head('status', 'State')}
                  {head('when', 'Date and time')}
                  <th scope="col" className="px-3 font-medium">Campaign</th>
                  <th scope="col" className="px-3 text-right font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((row) => {
                  const post = row.post;
                  return (
                    <tr key={post.id} className={ROW} aria-label={`${post.title}, ${row.platformName}`}>
                      <td className="px-3 py-3">
                        <input type="checkbox" className="h-4 w-4 accent-primary" aria-label={`Select ${post.title} (${row.platformName})`} checked={picked.has(post.id)} onChange={() => toggle(post.id)} />
                      </td>
                      <td className="max-w-[22rem] px-3 py-3">
                        <p className="flex items-center gap-1.5 font-medium text-foreground">
                          {post.media && (post.media.kind === 'video' ? <Film className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /> : <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />)}
                          <span className="truncate" title={post.title}>{post.title}</span>
                        </p>
                        {post.body && <p className="mt-0.5 line-clamp-1 text-muted-foreground" title={post.body}>{post.body}</p>}
                        {post.status === 'failed' && post.lastError && (
                          <p className="mt-1 text-xs text-destructive">{publicText(post.lastError, 'The post was not accepted. Try again.')}</p>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <p className="whitespace-nowrap font-medium text-foreground">{row.platformName}</p>
                        {row.accountName && <p className="max-w-[12rem] truncate text-muted-foreground" title={row.accountName}>{row.accountName}</p>}
                      </td>
                      <td className="px-3 py-3"><StatusPill tone={TONE[post.status]}>{STATE_LABEL[post.status]}</StatusPill></td>
                      <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                        <time dateTime={row.when.toISOString()}>{whenText(row.when)}</time>
                        <p className="text-xs text-muted-foreground">{row.whenLabel}</p>
                      </td>
                      <td className="max-w-[12rem] px-3 py-3">
                        {row.campaignName ? <span className="block truncate" title={row.campaignName}>{row.campaignName}</span> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          {action(row)}
                          <Button
                            size="icon" variant="ghost" className="text-muted-foreground" aria-label={`Delete ${post.title} (${row.platformName})`}
                            disabled={post.status === 'publishing'} title={post.status === 'publishing' ? 'This post is going out right now.' : 'Delete'}
                            onClick={() => setToDelete([post])}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-sm text-muted-foreground">
            <span aria-live="polite">{view.from}–{view.to} of {view.total}</span>
            <div className="flex items-center gap-2">
              <span>Page {view.page} of {view.pages}</span>
              <Button size="sm" variant="outline" disabled={view.page <= 1} onClick={() => setPage(view.page - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={view.page >= view.pages} onClick={() => setPage(view.page + 1)}>Next</Button>
            </div>
          </div>
        </div>
      )}

      <AlertDialog open={toDelete !== null} onOpenChange={(open) => { if (!open && !deleting) setToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{toDelete?.length === 1 ? 'Delete this post?' : `Delete ${toDelete?.length ?? 0} posts?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete?.length === 1 ? 'It is' : 'They are'} removed from this list for good. A post that is already on a platform stays there:
              delete it on the platform too if you want it gone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={deleting} onClick={(event) => { event.preventDefault(); void remove(); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};

export default PostsTable;
