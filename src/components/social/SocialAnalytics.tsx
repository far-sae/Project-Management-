// How posting went over a span of days: what was posted and what was not, by
// platform, over time, on which days and at which hours, and what the posts
// brought where a platform reported it.
import React, { useMemo, useState } from 'react';
import { StatStrip } from '@/components/common/StatStrip';
import { insights, spanOf } from '@/lib/socialInsights';
import { QUICK_RANGES, postRows, quickRange, quickRangeOf, type QuickRange } from '@/lib/socialPosts';
import { cn } from '@/lib/utils';
import type { SocialAccount, SocialCampaign, SocialContent, SocialMetric } from '@/types/social';
import { PLATFORMS, PLATFORM_NAME } from '../../../api/_social/shared/platforms';

interface Props {
  content: SocialContent[];
  accounts: SocialAccount[];
  campaigns: SocialCampaign[];
  metrics: SocialMetric[];
  now?: () => Date;
}

const BOX = 'h-11 md:h-8 rounded-md border border-input bg-background px-2 text-base md:text-sm focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25';
const CARD = 'rounded-lg border border-border bg-card';
const CARD_HEAD = 'border-b border-border px-4 py-2.5 text-sm font-semibold';

const posts = (n: number): string => (n === 1 ? '1 post' : `${n} posts`);
const hourLabel = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;

/** Upright bars, one for each item. The tallest fills the height; a hover or a screen reader gets the exact count. */
const Columns: React.FC<{ label: string; items: Array<{ key: string; label: string; value: number; extra?: number; say: string }>; showEvery?: number }> = ({ label, items, showEvery = 1 }) => {
  const top = Math.max(1, ...items.map((i) => i.value + (i.extra ?? 0)));
  return (
    <ol aria-label={label} className="flex h-40 items-end gap-1 px-4 pb-2 pt-4">
      {items.map((item, i) => (
        <li key={item.key} aria-label={item.say} title={item.say} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
          <span className="flex w-full flex-1 flex-col justify-end">
            {(item.extra ?? 0) > 0 && <span className="w-full rounded-t-sm bg-destructive/70" style={{ height: `${((item.extra ?? 0) / top) * 100}%` }} />}
            <span className={cn('w-full bg-primary', (item.extra ?? 0) > 0 ? '' : 'rounded-t-sm', item.value === 0 && 'bg-transparent')} style={{ height: `${(item.value / top) * 100}%` }} />
          </span>
          <span className="h-4 truncate text-[10px] leading-4 text-muted-foreground" aria-hidden>{i % showEvery === 0 ? item.label : ''}</span>
        </li>
      ))}
    </ol>
  );
};

export const SocialAnalytics: React.FC<Props> = ({ content, accounts, campaigns, metrics, now = () => new Date() }) => {
  const [from, setFrom] = useState(() => quickRange('last30', now()).from);
  const [to, setTo] = useState(() => quickRange('last30', now()).to);
  const [platform, setPlatform] = useState('');

  const rows = useMemo(() => postRows(content, accounts, campaigns), [content, accounts, campaigns]);
  const shown = useMemo(() => (platform ? rows.filter((r) => r.platform === platform) : rows), [rows, platform]);
  const data = useMemo(() => insights(shown, metrics, spanOf(from, to, now())), [shown, metrics, from, to, now]);
  const platforms = useMemo(() => PLATFORMS.filter((p) => accounts.some((a) => a.provider === p)), [accounts]);
  const span = quickRangeOf(from, to, now());

  const tried = data.posted + data.failed;
  const busiest = Math.max(1, ...data.byPlatform.map((p) => p.posted + p.failed + p.waiting));
  const bestDay = [...data.byWeekday].sort((a, b) => b.posted - a.posted)[0];
  const bestHour = [...data.byHour].sort((a, b) => b.posted - a.posted)[0];
  const every = Math.ceil(data.byDay.length / 10);

  return (
    <section className="flex flex-col gap-4 pt-3" aria-label="Analytics">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold">Analytics</h2>
        <div className="flex flex-wrap items-end gap-2">
          <select aria-label="Platform" className={BOX} value={platform} onChange={(e) => setPlatform(e.target.value)}>
            <option value="">All platforms</option>
            {platforms.map((p) => <option key={p} value={p}>{PLATFORM_NAME[p]}</option>)}
          </select>
          <select
            aria-label="When" className={BOX} value={span === 'any' ? 'custom' : span}
            onChange={(e) => { if (e.target.value !== 'custom') { const next = quickRange(e.target.value as QuickRange, now()); setFrom(next.from); setTo(next.to); } }}
          >
            {QUICK_RANGES.filter((r) => r.id !== 'any' && r.id !== 'next7').map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            {(span === 'custom' || span === 'any') && <option value="custom">Chosen dates</option>}
          </select>
          <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            From
            <input type="datetime-local" className={BOX} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            To
            <input type="datetime-local" className={BOX} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      </div>

      <StatStrip items={[
        { label: 'Posted', value: data.posted, tone: 'success' },
        { label: 'Not posted', value: data.failed, tone: data.failed > 0 ? 'danger' : 'default' },
        { label: 'Posted, of those tried', value: data.successRate === null ? '—' : `${data.successRate}%`, note: tried > 0 ? `${data.posted} of ${tried}` : 'Nothing was tried' },
        { label: 'Waiting to go out', value: data.waiting },
      ]} />

      {tried + data.waiting === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">No posts in these days. Choose other dates, or make a post.</p>
      ) : (
        <>
          <div className={CARD}>
            <h3 className={CARD_HEAD}>Posts over time <span className="font-normal text-muted-foreground">· {data.grouped === 'week' ? 'by week' : 'by day'}</span></h3>
            <Columns
              label="Posts over time" showEvery={every}
              items={data.byDay.map((d) => ({
                key: d.key, label: d.label, value: d.posted, extra: d.failed,
                say: `${data.grouped === 'week' ? 'Week of ' : ''}${d.label}: ${d.posted} posted${d.failed ? `, ${d.failed} not posted` : ''}`,
              }))}
            />
            <p className="flex items-center gap-4 border-t border-border px-4 py-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-primary" aria-hidden />Posted</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-destructive/70" aria-hidden />Not posted</span>
            </p>
          </div>

          <div className={CARD}>
            <h3 className={CARD_HEAD}>By platform</h3>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="h-9 border-b border-border text-xs text-muted-foreground">
                  <th scope="col" className="px-4 font-medium">Platform</th>
                  <th scope="col" className="px-4 font-medium"><span className="sr-only">Share</span></th>
                  <th scope="col" className="px-4 text-right font-medium">Posted</th>
                  <th scope="col" className="px-4 text-right font-medium">Not posted</th>
                  <th scope="col" className="px-4 text-right font-medium">Waiting</th>
                </tr>
              </thead>
              <tbody>
                {data.byPlatform.map((p) => (
                  <tr key={p.platform || 'none'} className="border-b border-border/60 last:border-0" aria-label={p.name}>
                    <th scope="row" className="whitespace-nowrap px-4 py-2.5 font-medium">{p.name}</th>
                    <td className="w-1/2 px-4 py-2.5">
                      <span className="flex h-2 w-full overflow-hidden rounded-full bg-secondary" aria-hidden>
                        <span className="bg-primary" style={{ width: `${(p.posted / busiest) * 100}%` }} />
                        <span className="bg-destructive/70" style={{ width: `${(p.failed / busiest) * 100}%` }} />
                        <span className="bg-muted-foreground/40" style={{ width: `${(p.waiting / busiest) * 100}%` }} />
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{p.posted}</td>
                    <td className={cn('px-4 py-2.5 text-right tabular-nums', p.failed > 0 && 'text-destructive')}>{p.failed}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{p.waiting}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className={CARD}>
              <h3 className={CARD_HEAD}>Days you post on{bestDay.posted > 0 && <span className="font-normal text-muted-foreground"> · most on {bestDay.label}</span>}</h3>
              <Columns label="Days you post on" items={data.byWeekday.map((d) => ({ key: d.label, label: d.label, value: d.posted, say: `${d.label}: ${posts(d.posted)}` }))} />
            </div>
            <div className={CARD}>
              <h3 className={CARD_HEAD}>Time of day{bestHour.posted > 0 && <span className="font-normal text-muted-foreground"> · most at {hourLabel(bestHour.hour)}</span>}</h3>
              <Columns label="Time of day" showEvery={3} items={data.byHour.map((h) => ({ key: String(h.hour), label: String(h.hour), value: h.posted, say: `${hourLabel(h.hour)}: ${posts(h.posted)}` }))} />
            </div>
          </div>

          <div className={CARD}>
            <h3 className={CARD_HEAD}>What the posts brought</h3>
            {data.results.any ? (
              <>
                <StatStrip className="rounded-none border-0" items={[
                  { label: 'Views', value: data.results.impressions.toLocaleString() },
                  { label: 'People reached', value: data.results.reach.toLocaleString() },
                  { label: 'Clicks', value: data.results.clicks.toLocaleString() },
                  { label: 'Reactions', value: data.results.reactions.toLocaleString() },
                  { label: 'Comments', value: data.results.comments.toLocaleString() },
                  { label: 'Shares', value: data.results.shares.toLocaleString() },
                ]} />
                {data.top.length > 0 && (
                  <ol aria-label="Posts with the most views" className="divide-y divide-border border-t border-border">
                    {data.top.map((t) => (
                      <li key={t.row.post.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
                        <span className="w-24 shrink-0 font-medium">{t.row.platformName}</span>
                        <span className="min-w-0 flex-1 truncate" title={t.row.post.title}>{t.row.post.title}</span>
                        <span className="tabular-nums text-muted-foreground">{t.impressions.toLocaleString()} views · {t.clicks.toLocaleString()} clicks · {t.reactions.toLocaleString()} reactions</span>
                      </li>
                    ))}
                  </ol>
                )}
              </>
            ) : (
              <p className="px-4 py-6 text-sm text-muted-foreground">No views, clicks or reactions have been reported for these posts yet.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
};

export default SocialAnalytics;
