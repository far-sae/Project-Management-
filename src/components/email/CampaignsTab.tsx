import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Loader2, RefreshCw, Mail, ChevronDown, ChevronRight, Send, Clock, CheckCircle2,
  AlertCircle, PauseCircle, FileEdit, Reply, MailWarning,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ChartCard } from '@/components/dashboards/ChartCard';
import { StackedBar, type StackedDatum } from '@/components/dashboards/StackedBar';
import { listCampaigns, listMessages } from '@/services/supabase/email';
import type { EmailCampaign, EmailMessage, CampaignStatus, MessageStatus } from '@/lib/email/types';

interface CampaignsTabProps {
  orgId: string;
  workspaceId: string | null;
}

const POLL_MS = 15_000;

/** How many campaigns the chart covers. Beyond this the bars are too narrow
 *  to compare, which is the only thing a reader does with them. */
const CHART_CAMPAIGNS = 10;

/**
 * The chart's colours, matched to the coloured counts on each row below it
 * rather than taken from the dashboard palette's slate shades. Four
 * overlapping series in five shades of grey is a chart nobody can read, and
 * green/violet/blue/amber is already what "sent", "opened", "replied" and
 * "bounced" look like everywhere else on this page.
 */
const SERIES = [
  { key: 'sent', name: 'Sent', color: '#10b981' },
  { key: 'opened', name: 'Opened', color: '#8b5cf6' },
  { key: 'replied', name: 'Replied', color: '#3b82f6' },
  { key: 'bounced', name: 'Bounced', color: '#f59e0b' },
];

/** Enough of the name to tell two campaigns apart on an axis tick. */
const axisLabel = (name: string): string =>
  name.length > 16 ? `${name.slice(0, 15)}…` : name;

const campaignStatusBadge = (status: CampaignStatus) => {
  switch (status) {
    case 'sending':
      return <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30"><Send className="w-3 h-3 mr-1" />Sending</Badge>;
    case 'scheduled':
      return <Badge className="bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30"><Clock className="w-3 h-3 mr-1" />Scheduled</Badge>;
    case 'sent':
      return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"><CheckCircle2 className="w-3 h-3 mr-1" />Sent</Badge>;
    case 'failed':
      return <Badge className="bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30"><AlertCircle className="w-3 h-3 mr-1" />Failed</Badge>;
    case 'paused':
      return <Badge className="bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30"><PauseCircle className="w-3 h-3 mr-1" />Paused</Badge>;
    default:
      return <Badge variant="secondary"><FileEdit className="w-3 h-3 mr-1" />Draft</Badge>;
  }
};

const messageStatusBadge = (status: MessageStatus) => {
  switch (status) {
    case 'sent':
      return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">Sent</Badge>;
    case 'failed':
      return <Badge className="bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30">Failed</Badge>;
    case 'suppressed':
      return <Badge variant="secondary">Suppressed</Badge>;
    case 'sending':
      return <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30">Sending</Badge>;
    default:
      return <Badge variant="outline">Queued</Badge>;
  }
};

/**
 * Reply/bounce is a fact about a message ALONGSIDE its send status (a `sent`
 * row can also have been replied to or bounced later), not a replacement for
 * it — so this renders next to `messageStatusBadge`, never instead of it.
 * Bounced wins over replied when somehow both are set, since it is the one
 * with a consequence the recipient row still needs to explain.
 */
const inboxBadge = (message: EmailMessage) => {
  if (message.bouncedAt) {
    return (
      <Badge className="bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30">
        <MailWarning className="w-3 h-3 mr-1" />Bounced
      </Badge>
    );
  }
  if (message.repliedAt) {
    return (
      <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30">
        <Reply className="w-3 h-3 mr-1" />Replied
      </Badge>
    );
  }
  return null;
};

export const CampaignsTab: React.FC<CampaignsTabProps> = ({ orgId, workspaceId }) => {
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [messagesByCampaign, setMessagesByCampaign] = useState<Record<string, EmailMessage[]>>({});
  const [messagesLoading, setMessagesLoading] = useState<Record<string, boolean>>({});

  const load = useCallback(async (silent = false) => {
    if (!orgId) { setCampaigns([]); setLoading(false); return; }
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      // Excludes kind 'sequence' at the query — the hidden campaign behind a
      // sequence step is not a campaign anybody composed, and one row per step
      // per sequence would be this list's usefulness gone. See listCampaigns.
      const list = await listCampaigns(orgId, workspaceId);
      setCampaigns(list);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load campaigns');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [orgId, workspaceId]);

  useEffect(() => { void load(); }, [load]);

  /**
   * The last ten campaigns, oldest first so the axis reads left to right —
   * `listCampaigns` returns newest first, which is right for the list and
   * backwards for a chart.
   *
   * `openedPrefetchCount` is deliberately absent. It is not added to
   * `openedCount` (that would report a campaign to sixty iPhone users as
   * sixty reads), and it is not a fifth series either: it is a caveat on one
   * of the four, which the row below states per campaign and the subtitle
   * states here. A bar for it would invite exactly the comparison it exists
   * to prevent.
   */
  const chartData = useMemo<StackedDatum[]>(
    () => campaigns.slice(0, CHART_CAMPAIGNS).reverse().map((c) => ({
      label: axisLabel(c.name),
      sent: c.sentCount,
      opened: c.openedCount,
      replied: c.repliedCount,
      bounced: c.bouncedCount,
    })),
    [campaigns],
  );

  // Poll while any campaign is actively sending so counts and per-recipient
  // status keep moving without the user manually refreshing.
  useEffect(() => {
    const hasSending = campaigns.some((c) => c.status === 'sending');
    if (!hasSending) return;
    const interval = setInterval(() => { void load(true); }, POLL_MS);
    return () => clearInterval(interval);
  }, [campaigns, load]);

  const toggleExpand = async (campaign: EmailCampaign) => {
    if (expandedId === campaign.id) { setExpandedId(null); return; }
    setExpandedId(campaign.id);
    if (messagesByCampaign[campaign.id]) return;
    setMessagesLoading((m) => ({ ...m, [campaign.id]: true }));
    try {
      const messages = await listMessages(campaign.id);
      setMessagesByCampaign((m) => ({ ...m, [campaign.id]: messages }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load recipients');
    } finally {
      setMessagesLoading((m) => ({ ...m, [campaign.id]: false }));
    }
  };

  return (
    <div className="space-y-6">
      {/* One campaign is not a comparison, and a chart of a single bar says
          less than the row underneath it already does — so below two, there
          is nothing here at all. */}
      {!loading && chartData.length > 1 && (
        <ChartCard
          title="Recent campaigns"
          subtitle={`Last ${chartData.length} campaigns. Opens are an estimate and exclude the ones that looked automatic.`}
          bodyHeight="h-64"
        >
          {/* Side by side, not stacked: a message that was opened was also
              sent, so a stack would give the bar a height that counts it
              twice. */}
          <StackedBar data={chartData} series={SERIES} stacked={false} />
        </ChartCard>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Campaigns</CardTitle>
          <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing}>
            {refreshing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-16 text-muted-foreground">
              <Loader2 className="w-10 h-10 mx-auto mb-4 animate-spin text-muted-foreground/60" />
              <p>Loading campaigns...</p>
            </div>
          ) : campaigns.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Mail className="w-14 h-14 mx-auto mb-4 text-muted-foreground/60" />
              <p className="text-lg font-medium text-foreground">No campaigns yet</p>
              <p className="text-sm">Compose one from the Compose tab to see it here.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {campaigns.map((campaign) => {
                const expanded = expandedId === campaign.id;
                const messages = messagesByCampaign[campaign.id] ?? [];
                return (
                  <div key={campaign.id} className="border border-border rounded-lg overflow-hidden">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleExpand(campaign)}
                      onKeyDown={(e) => { if (e.key === 'Enter') toggleExpand(campaign); }}
                      className="flex items-center justify-between gap-4 p-4 bg-secondary/40 hover:bg-secondary/70 cursor-pointer"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {expanded ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium text-foreground truncate">{campaign.name}</p>
                            <Badge variant="outline" className="capitalize">{campaign.kind}</Badge>
                            {campaignStatusBadge(campaign.status)}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Created {format(campaign.createdAt, 'MMM d, yyyy')}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-sm shrink-0">
                        <span title="Queued">Q {campaign.queuedCount}</span>
                        <span className="text-emerald-600 dark:text-emerald-400" title="Sent">S {campaign.sentCount}</span>
                        <span className="text-red-600 dark:text-red-400" title="Failed">F {campaign.failedCount}</span>
                        <span className="text-muted-foreground" title="Suppressed">X {campaign.suppressedCount}</span>
                        {/* Stored columns (migration 157d increments them
                            directly), rendered unconditionally exactly like
                            the four counts to their left — never derived from
                            the expanded recipient list, which loads lazily and
                            would otherwise make this row show nothing, not
                            even a zero, until an admin happened to expand it. */}
                        {/* Two numbers, never one. `openedCount` excludes the
                            opens that looked automatic and `openedPrefetchCount`
                            is how many those were, so the second is what says
                            how much to trust the first. Merged into a single
                            figure this would report a campaign to sixty iPhone
                            users as sixty opens with nobody having opened
                            anything; dropped entirely it would hide that the
                            first number is a floor.

                            It sits to the LEFT of replies rather than being the
                            headline, deliberately. A reply is a fact; an open is
                            a signal. */}
                        <span
                          className="text-violet-600 dark:text-violet-400"
                          title={
                            campaign.openedPrefetchCount > 0
                              ? `Opened by a person (estimate). A further ${campaign.openedPrefetchCount} ` +
                                'were opened automatically — Apple Mail and most security scanners ' +
                                'load images without anybody reading the message — and are not counted here.'
                              : 'Opened (estimate — clients that block images record nothing, ' +
                                'so this is a floor)'
                          }
                        >
                          O {campaign.openedCount}
                          {campaign.openedPrefetchCount > 0 && (
                            <span className="text-muted-foreground">
                              {' '}
                              +{campaign.openedPrefetchCount} auto
                            </span>
                          )}
                        </span>
                        <span className="text-blue-600 dark:text-blue-400" title="Replied">R {campaign.repliedCount}</span>
                        <span className="text-amber-600 dark:text-amber-400" title="Bounced">B {campaign.bouncedCount}</span>
                      </div>
                    </div>
                    {expanded && (
                      <div className="border-t border-border">
                        {messagesLoading[campaign.id] ? (
                          <div className="py-8 text-center text-muted-foreground">
                            <Loader2 className="w-6 h-6 mx-auto animate-spin" />
                          </div>
                        ) : messages.length === 0 ? (
                          <p className="px-4 py-6 text-sm text-center text-muted-foreground">No recipients queued.</p>
                        ) : (
                          <div className="max-h-72 overflow-y-auto divide-y divide-border">
                            {messages.map((message) => (
                              <div key={message.id} className="flex items-center justify-between gap-3 px-4 py-2">
                                <div className="min-w-0">
                                  <p className="text-sm truncate">{message.toEmail}</p>
                                  {message.status === 'failed' && message.lastError && (
                                    <p className="text-xs text-red-600 dark:text-red-400 truncate">{message.lastError}</p>
                                  )}
                                  {/* The consequence an admin will ask about: a
                                      bounce also suppresses the address
                                      (migration 157d), which is why it won't
                                      receive future campaigns either. */}
                                  {message.bouncedAt && (
                                    <p className="text-xs text-muted-foreground truncate">
                                      Added to the suppression list — won&apos;t be mailed again.
                                    </p>
                                  )}
                                  {/* Said in words rather than shown as a
                                      timestamp and a count, because the count is
                                      the part people misread: fifty fetches is
                                      one person's client re-rendering the same
                                      message, not fifty readers. And an open
                                      that looked automatic says so here, on the
                                      row, rather than only being netted out of
                                      the total above. */}
                                  {message.openedAt && (
                                    <p className="text-xs text-muted-foreground truncate">
                                      {message.openWasPrefetch
                                        ? 'Opened automatically by a mail client or scanner — not counted as a read.'
                                        : `Opened ${format(message.openedAt, 'MMM d, HH:mm')}`}
                                      {message.openCount > 1 &&
                                        ` · loaded ${message.openCount} times`}
                                    </p>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {inboxBadge(message)}
                                  {messageStatusBadge(message.status)}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default CampaignsTab;
