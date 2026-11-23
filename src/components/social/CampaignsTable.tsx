// The campaigns of the workspace in one table: what each one is for, how many
// of its posts went out, what they brought, and what can be done with it.
import React, { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { StatusPill, type StatusTone } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { campaignRows } from '@/lib/socialInsights';
import type { SocialCampaign, SocialContent, SocialMetric } from '@/types/social';

interface Props {
  campaigns: SocialCampaign[];
  content: SocialContent[];
  metrics: SocialMetric[];
  projects: Array<{ projectId: string; name: string }>;
  onNew: () => void;
  onSetStatus: (campaign: SocialCampaign, status: SocialCampaign['status']) => void | Promise<void>;
  /** Opens the posts table on this campaign's posts. */
  onSeePosts: (campaignId: string) => void;
}

const STATE: Record<SocialCampaign['status'], { label: string; tone: StatusTone }> = {
  draft: { label: 'Not started', tone: 'neutral' },
  active: { label: 'Running', tone: 'success' },
  paused: { label: 'Paused', tone: 'warning' },
  finished: { label: 'Finished', tone: 'muted' },
};

const BOX = 'h-11 md:h-8 rounded-md border border-input bg-background px-2 text-base md:text-sm focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25';
const HEAD = 'h-10 border-b border-border bg-surface-2 text-xs text-muted-foreground';
const ROW = 'border-b border-border/60 align-top transition-colors last:border-0 hover:bg-surface-2';
const NUM = 'px-3 py-3 text-right tabular-nums';

const day = (d: Date | null): string => (d ? d.toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—');

export const CampaignsTable: React.FC<Props> = ({ campaigns, content, metrics, projects, onNew, onSetStatus, onSeePosts }) => {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const rows = useMemo(() => campaignRows(campaigns, content, metrics, projects), [campaigns, content, metrics, projects]);
  const word = search.trim().toLowerCase();
  const shown = rows.filter((r) =>
    (!status || r.campaign.status === status)
    && (!word || `${r.campaign.name}\n${r.campaign.objective ?? ''}\n${r.projectName}`.toLowerCase().includes(word)));

  return (
    <section className="flex flex-col gap-3 pt-3" aria-label="Campaigns">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Campaigns</h2>
        <Button size="sm" onClick={onNew}><Plus aria-hidden />New campaign</Button>
      </div>

      {campaigns.length === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          No campaigns yet. A campaign groups the posts of one goal, so you can see what they brought together.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[12rem] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input aria-label="Search campaigns" placeholder="Search campaigns" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select aria-label="State" className={BOX} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Every state</option>
              {(Object.keys(STATE) as Array<SocialCampaign['status']>).map((s) => <option key={s} value={s}>{STATE[s].label}</option>)}
            </select>
          </div>

          {shown.length === 0 ? (
            <p className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">No campaign matches.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead>
                    <tr className={HEAD}>
                      <th scope="col" className="px-3 font-medium">Campaign</th>
                      <th scope="col" className="px-3 font-medium">State</th>
                      <th scope="col" className="px-3 font-medium">Project</th>
                      <th scope="col" className="px-3 text-right font-medium">Posts</th>
                      <th scope="col" className="px-3 text-right font-medium">Posted</th>
                      <th scope="col" className="px-3 text-right font-medium">Not posted</th>
                      <th scope="col" className="px-3 text-right font-medium">Waiting</th>
                      <th scope="col" className="px-3 text-right font-medium">Views</th>
                      <th scope="col" className="px-3 text-right font-medium">Clicks</th>
                      <th scope="col" className="px-3 text-right font-medium">Reactions</th>
                      <th scope="col" className="px-3 font-medium">Last posted</th>
                      <th scope="col" className="px-3 text-right font-medium"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => {
                      const c = r.campaign;
                      return (
                        <tr key={c.id} className={ROW} aria-label={c.name}>
                          <td className="max-w-[18rem] px-3 py-3">
                            <p className="truncate font-medium text-foreground" title={c.name}>{c.name}</p>
                            {c.objective && <p className="line-clamp-1 text-muted-foreground" title={c.objective}>{c.objective}</p>}
                          </td>
                          <td className="px-3 py-3"><StatusPill tone={STATE[c.status].tone}>{STATE[c.status].label}</StatusPill></td>
                          <td className="max-w-[10rem] px-3 py-3">{r.projectName ? <span className="block truncate" title={r.projectName}>{r.projectName}</span> : <span className="text-muted-foreground">—</span>}</td>
                          <td className={NUM}>{r.posts}</td>
                          <td className={NUM}>{r.posted}</td>
                          <td className={r.failed > 0 ? `${NUM} text-destructive` : NUM}>{r.failed}</td>
                          <td className={NUM}>{r.waiting}</td>
                          <td className={NUM}>{r.impressions.toLocaleString()}</td>
                          <td className={NUM}>{r.clicks.toLocaleString()}</td>
                          <td className={NUM}>{r.reactions.toLocaleString()}</td>
                          <td className="whitespace-nowrap px-3 py-3">{day(r.lastPosted)}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-right">
                            <div className="inline-flex items-center gap-1">
                              <Button size="sm" variant="outline" disabled={r.posts === 0} onClick={() => onSeePosts(c.id)}>See posts</Button>
                              {c.status !== 'finished' && (
                                <Button size="sm" variant="outline" onClick={() => void onSetStatus(c, c.status === 'active' ? 'paused' : 'active')}>
                                  {c.status === 'active' ? 'Pause' : c.status === 'paused' ? 'Go on' : 'Start'}
                                </Button>
                              )}
                              {c.status !== 'finished' && c.status !== 'draft' && (
                                <Button size="sm" variant="ghost" onClick={() => void onSetStatus(c, 'finished')}>Finish</Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
};

export default CampaignsTable;
