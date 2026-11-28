// The posts on a calendar: a month or a week at a time, each post on its day
// with its time, platform and state. Pressing a day lists that day's posts.
import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { StatusPill, type StatusTone } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { WEEKDAYS, dayKey, monthGrid, monthTitle, rowsByDay, undated, weekDays, weekTitle } from '@/lib/socialInsights';
import { STATE_LABEL, postRows, type PostRow } from '@/lib/socialPosts';
import { cn } from '@/lib/utils';
import type { SocialAccount, SocialContent, SocialContentStatus } from '@/types/social';
import { PLATFORMS, PLATFORM_NAME } from '../../../api/_social/shared/platforms';

interface Props {
  content: SocialContent[];
  accounts: SocialAccount[];
  onNewPost: () => void;
  /** Opens the posts that are on no day yet. */
  onSeeDrafts?: () => void;
  now?: () => Date;
}

const TONE: Record<SocialContentStatus, StatusTone> = {
  draft: 'neutral', in_review: 'warning', approved: 'info', scheduled: 'info', publishing: 'info', published: 'success', failed: 'danger',
};
const DOT: Record<StatusTone, string> = {
  success: 'bg-success', warning: 'bg-warning', danger: 'bg-destructive', info: 'bg-info', neutral: 'bg-muted-foreground/60', muted: 'bg-muted-foreground/40',
};
const BOX = 'h-11 md:h-8 rounded-md border border-input bg-background px-2 text-base md:text-sm focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25';

const timeOf = (d: Date): string => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const longDay = (d: Date): string => d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const count = (n: number): string => (n === 0 ? 'no posts' : n === 1 ? '1 post' : `${n} posts`);

/** One post on a day: a dot for its state, its time, its platform and its title. */
const Chip: React.FC<{ row: PostRow }> = ({ row }) => (
  <span className="flex min-w-0 items-center gap-1 text-xs" title={`${timeOf(row.when)} · ${row.platformName} · ${row.post.title} · ${STATE_LABEL[row.post.status]}`}>
    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT[TONE[row.post.status]])} aria-hidden />
    <span className="shrink-0 tabular-nums text-muted-foreground">{timeOf(row.when)}</span>
    <span className="truncate text-foreground">{row.platformName}: {row.post.title}</span>
  </span>
);

export const SocialCalendar: React.FC<Props> = ({ content, accounts, onNewPost, onSeeDrafts, now = () => new Date() }) => {
  const today = now();
  const [view, setView] = useState<'month' | 'week'>('month');
  const [cursor, setCursor] = useState<Date>(new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12));
  const [platform, setPlatform] = useState('');
  const [chosen, setChosen] = useState<string>(dayKey(today));

  const rows = useMemo(() => postRows(content, accounts), [content, accounts]);
  const shownRows = useMemo(() => (platform ? rows.filter((r) => r.platform === platform) : rows), [rows, platform]);
  const days = useMemo(() => rowsByDay(shownRows), [shownRows]);
  const noDay = useMemo(() => undated(rows), [rows]);
  const platforms = useMemo(() => PLATFORMS.filter((p) => accounts.some((a) => a.provider === p)), [accounts]);

  const weeks = view === 'month' ? monthGrid(cursor.getFullYear(), cursor.getMonth()) : [weekDays(cursor)];
  const title = view === 'month' ? monthTitle(cursor.getFullYear(), cursor.getMonth()) : weekTitle(cursor);
  const todayKey = dayKey(today);

  const move = (by: number) => setCursor((c) => (view === 'month'
    ? new Date(c.getFullYear(), c.getMonth() + by, 1, 12)
    : new Date(c.getFullYear(), c.getMonth(), c.getDate() + by * 7, 12)));
  const goToday = () => {
    setCursor(new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12));
    setChosen(todayKey);
  };

  const chosenRows = days.get(chosen) ?? [];
  const chosenDate = new Date(`${chosen}T12:00:00`);
  /** How many posts a day's box shows before "+N more". A week has room for all of them. */
  const cap = view === 'month' ? 3 : 50;

  return (
    <section className="flex flex-col gap-3 pt-3" aria-label="Calendar">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" aria-label={view === 'month' ? 'Previous month' : 'Previous week'} onClick={() => move(-1)}><ChevronLeft aria-hidden /></Button>
          <Button size="icon" variant="outline" aria-label={view === 'month' ? 'Next month' : 'Next week'} onClick={() => move(1)}><ChevronRight aria-hidden /></Button>
          <Button size="sm" variant="outline" onClick={goToday}>Today</Button>
          <h2 className="ml-2 text-lg font-semibold" aria-live="polite">{title}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Platform" className={BOX} value={platform} onChange={(e) => setPlatform(e.target.value)}>
            <option value="">All platforms</option>
            {platforms.map((p) => <option key={p} value={p}>{PLATFORM_NAME[p]}</option>)}
          </select>
          <div role="group" aria-label="Month or week" className="inline-flex rounded-md border border-border p-0.5">
            <Button size="sm" variant={view === 'month' ? 'secondary' : 'ghost'} aria-pressed={view === 'month'} onClick={() => setView('month')}>Month</Button>
            <Button size="sm" variant={view === 'week' ? 'secondary' : 'ghost'} aria-pressed={view === 'week'} onClick={() => setView('week')}>Week</Button>
          </div>
          <Button size="sm" onClick={onNewPost}><Plus aria-hidden />New post</Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="overflow-x-auto">
          <div className="min-w-[840px]">
            <div className="grid grid-cols-7 border-b border-border bg-surface-2 text-xs text-muted-foreground">
              {WEEKDAYS.map((name) => <div key={name} className="px-2 py-2 font-medium">{name}</div>)}
            </div>
            {weeks.map((week) => (
              <div key={dayKey(week[0])} className="grid grid-cols-7 border-b border-border last:border-0">
                {week.map((day) => {
                  const key = dayKey(day);
                  const posts = days.get(key) ?? [];
                  const outside = view === 'month' && day.getMonth() !== cursor.getMonth();
                  return (
                    <button
                      key={key} type="button" onClick={() => setChosen(key)}
                      aria-label={`${longDay(day)}: ${count(posts.length)}`} aria-pressed={chosen === key}
                      className={cn(
                        'flex flex-col gap-1 border-r border-border/60 p-2 text-left align-top transition-colors last:border-r-0 hover:bg-surface-2',
                        view === 'month' ? 'min-h-[6.5rem]' : 'min-h-[16rem]',
                        outside && 'bg-muted/30',
                        chosen === key && 'bg-surface-2 ring-1 ring-inset ring-primary',
                      )}
                    >
                      <span className={cn(
                        'inline-flex h-6 min-w-6 items-center justify-center self-start rounded-full px-1 text-xs tabular-nums',
                        key === todayKey ? 'bg-primary font-semibold text-primary-foreground' : outside ? 'text-muted-foreground/60' : 'text-foreground',
                      )}>{day.getDate()}</span>
                      {posts.slice(0, cap).map((row) => <Chip key={row.post.id} row={row} />)}
                      {posts.length > cap && <span className="text-xs text-muted-foreground">+{posts.length - cap} more</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border">
        <h3 className="border-b border-border px-4 py-2.5 text-sm font-semibold">{longDay(chosenDate)} <span className="font-normal text-muted-foreground">· {count(chosenRows.length)}</span></h3>
        {chosenRows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Nothing on this day.</p>
        ) : (
          <ul className="divide-y divide-border">
            {chosenRows.map((row) => (
              <li key={row.post.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm" aria-label={`${timeOf(row.when)} ${row.platformName}: ${row.post.title}`}>
                <span className="w-14 shrink-0 tabular-nums text-muted-foreground">{timeOf(row.when)}</span>
                <span className="w-24 shrink-0 font-medium">{row.platformName}</span>
                <span className="min-w-0 flex-1 truncate" title={row.post.title}>{row.post.title}</span>
                {row.accountName && <span className="max-w-[12rem] truncate text-muted-foreground">{row.accountName}</span>}
                <StatusPill tone={TONE[row.post.status]}>{STATE_LABEL[row.post.status]}</StatusPill>
              </li>
            ))}
          </ul>
        )}
      </div>

      {noDay.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {noDay.length === 1 ? '1 post has' : `${noDay.length} posts have`} no date yet, so {noDay.length === 1 ? 'it is' : 'they are'} not on the calendar.
          {onSeeDrafts && <Button variant="link" size="sm" className="h-auto px-1.5 py-0" onClick={onSeeDrafts}>See {noDay.length === 1 ? 'it' : 'them'}</Button>}
        </p>
      )}
    </section>
  );
};

export default SocialCalendar;
