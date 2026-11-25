// What the autopilot has learned, one thing at a time: the study of the
// workspace's own pages, the latest trends, what the business's website says,
// and the rules it keeps to in the next posts.
import React, { useState } from 'react';
import { ArrowRight, Clock, Loader2, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RichNote } from '@/components/social/RichNote';
import { cn } from '@/lib/utils';
import { noTrendsIn, type AutopilotNote } from '../../../api/_social/shared/autopilot';

type Tab = 'pages' | 'trends' | 'website' | 'rules';
const TAB_NAME: Record<Tab, string> = { pages: 'Your pages', trends: 'Latest trends', website: 'Your website', rules: 'Its rules' };

interface Props {
  study?: AutopilotNote;
  trends?: AutopilotNote;
  siteNotes: string;
  playbook: string;
  /** The owner and admins of a workspace whose autopilot is on may ask for the trends now. */
  canRefresh: boolean;
  refreshing: boolean;
  onRefreshTrends: () => void;
  when: (value: string | null) => string;
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : []);

const FINDINGS = [
  { key: 'working', title: 'Working', icon: TrendingUp, tone: 'text-success' },
  { key: 'notWorking', title: 'Not working', icon: TrendingDown, tone: 'text-destructive' },
  { key: 'changes', title: 'What it changes', icon: ArrowRight, tone: 'text-info' },
  { key: 'bestTimes', title: 'Best times', icon: Clock, tone: 'text-muted-foreground' },
] as const;

export const AutopilotLearned: React.FC<Props> = ({ study, trends, siteNotes, playbook, canRefresh, refreshing, onRefreshTrends, when }) => {
  const goodTrends = trends && !noTrendsIn(trends.body) ? trends : undefined;
  const has: Record<Tab, boolean> = { pages: Boolean(study), trends: Boolean(goodTrends) || canRefresh || Boolean(trends), website: siteNotes.trim() !== '', rules: playbook.trim() !== '' };
  const tabs = (Object.keys(TAB_NAME) as Tab[]).filter((t) => has[t]);
  const [picked, setPicked] = useState<Tab | null>(null);
  const tab = picked && tabs.includes(picked) ? picked : tabs[0];
  const nothing = !study && !trends && !siteNotes.trim() && !playbook.trim();

  return (
    <section aria-label="What it has learned" className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-2.5">
        <h3 className="py-0.5 text-sm font-semibold">What it has learned</h3>
        {!nothing && tabs.length > 1 && (
          <div role="tablist" aria-label="What it has learned" className="inline-flex flex-wrap rounded-md border border-border bg-surface-2 p-0.5">
            {tabs.map((t) => (
              <button
                key={t} type="button" role="tab" id={`learned-tab-${t}`} aria-selected={tab === t} aria-controls={`learned-panel-${t}`}
                onClick={() => setPicked(t)}
                className={cn(
                  'h-9 rounded px-3 text-sm transition-colors md:h-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  tab === t ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {TAB_NAME[t]}
              </button>
            ))}
          </div>
        )}
      </div>

      {nothing ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">Nothing yet. After it is switched on, the first study of your pages and of the latest trends appears here within about fifteen minutes.</p>
      ) : (
        <div role="tabpanel" id={`learned-panel-${tab}`} aria-labelledby={tabs.length > 1 ? `learned-tab-${tab}` : undefined} className="p-4">
          {tab === 'pages' && study && (
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-xs text-muted-foreground">
                  {study.title} · {when(study.createdAt)}
                  {typeof study.data.posts === 'number' && study.data.posts > 0 ? ` · ${study.data.posts} ${study.data.posts === 1 ? 'post' : 'posts'} read` : ''}
                </p>
                <p className="mt-1.5 max-w-3xl text-sm leading-6 text-foreground">{study.body}</p>
              </div>
              {FINDINGS.some((f) => strings(study.data[f.key]).length > 0) && (
                <div className="grid gap-3 lg:grid-cols-2">
                  {FINDINGS.map(({ key, title, icon: Icon, tone }) => {
                    const items = strings(study.data[key]);
                    return items.length === 0 ? null : (
                      <div key={key} className="rounded-md border border-border p-3.5">
                        <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Icon className={cn('h-4 w-4', tone)} aria-hidden />{title}</h4>
                        <ul className="mt-2 flex flex-col gap-2 text-sm leading-6 text-muted-foreground">
                          {items.map((item) => (
                            <li key={item} className="flex gap-2.5">
                              <span aria-hidden className="mt-[0.6rem] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
                              <span className="min-w-0">{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === 'trends' && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {goodTrends ? `What is working on your platforms right now · looked up ${when(goodTrends.createdAt)}` : 'What is working on your platforms right now, looked up on the web.'}
                </p>
                {canRefresh && (
                  <Button size="sm" variant="outline" disabled={refreshing} onClick={onRefreshTrends}>
                    {refreshing ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
                    {refreshing ? 'Searching the web…' : goodTrends ? 'Look up again' : 'Look up now'}
                  </Button>
                )}
              </div>
              {refreshing && <p role="status" className="text-sm text-muted-foreground">This takes a minute or two. You can stay on this page.</p>}
              {goodTrends ? (
                <RichNote text={goodTrends.body} />
              ) : !refreshing && (
                <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                  {trends
                    ? 'The last search on the web found nothing, so there are no trends to show. The autopilot tries again by itself in a few hours. Until then it plans from your own numbers.'
                    : 'No trends have been looked up yet.'}
                </p>
              )}
            </div>
          )}

          {tab === 'website' && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">What your website says about your business. The autopilot takes products, prices and offers only from here and from what you wrote.</p>
              <RichNote text={siteNotes} />
            </div>
          )}

          {tab === 'rules' && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">The rules it keeps to in the next posts. It writes them again after every study of your pages.</p>
              <RichNote text={playbook} mode="rules" foldAt={1600} />
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default AutopilotLearned;
