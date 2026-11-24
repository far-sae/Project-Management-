import { publicMessage, publicText } from '@/lib/publicError';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, CalendarDays, Check, Clock, Film, ImageIcon, LayoutList, Library, Loader2, Plus, RotateCcw, Rows3, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
import { createSocialAccount, createSocialCampaign, deleteSocialContent, listSocialData, runSocialPublish, saveSocialAccountToken, setSocialContentCampaign, updateSocialCampaignStatus, updateSocialContentStatus } from '@/services/supabase/social';
import { SocialComposer } from '@/components/social/SocialComposer';
import { ConnectAccounts } from '@/components/social/ConnectAccounts';
import { PostsTable } from '@/components/social/PostsTable';
import { SocialCalendar } from '@/components/social/SocialCalendar';
import { CampaignsTable } from '@/components/social/CampaignsTable';
import { SocialAnalytics } from '@/components/social/SocialAnalytics';
import type { PostFilters } from '@/lib/socialPosts';
import { CONNECT_FAILED, SERVICE_CONNECTED, SERVICE_NOT_CONNECTED, connectReturnMessage, readConnectReturn, readServiceReturn } from '@/lib/socialConnect';
import { syncSocialAccounts } from '@/services/social/connect';
import { StatusPill, type StatusTone } from '@/components/common/StatusPill';
import { groupPosts, groupSummary, isOnItsWay, type PostGroup } from '@/lib/socialCompose';
import { PLATFORM_NAME, isPlatform } from '../../api/_social/shared/platforms';
import type { SocialAccount, SocialCampaign, SocialContent, SocialMetric, SocialProvider } from '@/types/social';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

type CreateKind = 'account' | 'campaign' | null;

type PostsView = 'table' | 'cards';
const POSTS_VIEW_KEY = 'social.postsView';
const readPostsView = (): PostsView => {
  try { return window.localStorage.getItem(POSTS_VIEW_KEY) === 'cards' ? 'cards' : 'table'; } catch { return 'table'; }
};
const PROVIDERS: SocialProvider[] = ['linkedin', 'facebook', 'instagram', 'x', 'youtube', 'tiktok', 'other'];

export const SocialMedia: React.FC = () => {
  const { user } = useAuth();
  const { organization, isAdmin } = useOrganization();
  const { selected, isAll, isUnassigned, select, workspaces, loading: workspaceLoading, preferredWorkspaceId } = useSelectedWorkspace();
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [campaigns, setCampaigns] = useState<SocialCampaign[]>([]);
  const [content, setContent] = useState<SocialContent[]>([]);
  const [metrics, setMetrics] = useState<SocialMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [createKind, setCreateKind] = useState<CreateKind>(null);
  const [name, setName] = useState(''); const [description, setDescription] = useState('');
  const [provider, setProvider] = useState<SocialProvider>('linkedin'); const [externalId, setExternalId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [composing, setComposing] = useState(false);
  const [tab, setTab] = useState('library');
  // The posts as a table (every platform a row), or as cards (one for each press). The choice is remembered.
  const [postsView, setPostsView] = useState<PostsView>(readPostsView);
  /** Opens the posts table on some filters, from another tab. */
  const [jump, setJump] = useState<{ filters: Partial<PostFilters>; at: number } | null>(null);
  const openPosts = (filters: Partial<PostFilters>) => {
    setJump({ filters, at: Date.now() });
    setPostsView('table');
    setTab('library');
  };
  const choosePostsView = (next: PostsView) => {
    setPostsView(next);
    try { window.localStorage.setItem(POSTS_VIEW_KEY, next); } catch { /* not remembered, that is all */ }
  };

  useEffect(() => {
    if (workspaceLoading || (!isAll && !isUnassigned)) return;
    // The workspace used last, never simply the oldest one (see WorkspaceContext).
    const wanted = preferredWorkspaceId ?? null;
    if (wanted) select(wanted);
  }, [isAll, isUnassigned, select, workspaceLoading, preferredWorkspaceId]);

  // Back from logging in at a platform ("Connect"): say how it ended, show the
  // accounts, and take the note out of the address so a reload does not repeat it.
  useEffect(() => {
    const back = readConnectReturn(window.location.search);
    if (!back) return;
    const said = connectReturnMessage(back);
    if (said.ok) toast.success(said.text); else toast.error(said.text);
    setTab('accounts');
    window.history.replaceState(window.history.state, '', window.location.pathname);
  }, []);

  const workspaceId = selected?.workspaceId ?? '';
  const orgId = organization?.organizationId ?? '';
  const load = useCallback(async (quiet = false) => {
    if (!workspaceId || !orgId) { setLoading(false); return; }
    if (!quiet) setLoading(true);
    try { const data = await listSocialData(workspaceId); setAccounts(data.accounts); setCampaigns(data.campaigns); setContent(data.content); setMetrics(data.metrics); }
    catch (error) { toast.error(publicMessage(error, 'Could not load social marketing')); }
    finally { setLoading(false); }
  }, [orgId, workspaceId]);
  useEffect(() => { void load(); }, [load]);

  // Back from a log-in through the posting service: bring the account into the
  // list, say how it went, and take the note out of the address.
  const [serviceBack] = useState(() => readServiceReturn(window.location.search));
  const serviceHandled = useRef(false);
  useEffect(() => {
    if (!serviceBack || serviceHandled.current || !orgId || !workspaceId) return;
    serviceHandled.current = true;
    setTab('accounts');
    window.history.replaceState(window.history.state, '', window.location.pathname);
    void (async () => {
      try {
        const connected = await syncSocialAccounts(orgId, workspaceId, serviceBack.accountIds);
        if (serviceBack.ok && connected > 0) toast.success(SERVICE_CONNECTED); else toast.error(SERVICE_NOT_CONNECTED);
        await load(true);
      } catch (error) { toast.error(publicMessage(error, CONNECT_FAILED)); }
    })();
  }, [serviceBack, orgId, workspaceId, load]);

  // While a post is on its way out, look again every few seconds, so each
  // platform's result shows up by itself.
  const waiting = useMemo(() => content.some((item) => isOnItsWay(item, Date.now())), [content]);
  // Every fourth look also asks the server to check the posts that are with a
  // platform, so an answer shows within seconds and not at the next five-minute run.
  const looks = useRef(0);
  useEffect(() => {
    if (!waiting) { looks.current = 0; return; }
    const timer = window.setTimeout(() => {
      looks.current += 1;
      if (looks.current % 4 === 0) void runSocialPublish().catch(() => undefined).then(() => load(true));
      else void load(true);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [waiting, content, load]);
  const groups = useMemo(() => groupPosts(content), [content]);
  const accountsById = useMemo(() => new Map(accounts.map((item) => [item.id, item])), [accounts]);

  const reset = () => { setCreateKind(null); setName(''); setDescription(''); setExternalId(''); setAccessToken(''); setRefreshToken(''); };
  const save = async () => {
    if (!name.trim() || !orgId || !workspaceId) return;
    setBusy(true);
    try {
      if (createKind === 'account') {
        const id = await createSocialAccount({ organizationId: orgId, workspaceId, provider, displayName: name.trim(), externalAccountId: externalId.trim(), userId: user?.userId });
        if (accessToken.trim()) await saveSocialAccountToken(id, accessToken.trim(), refreshToken.trim() || undefined);
      }
      if (createKind === 'campaign') await createSocialCampaign({ organizationId: orgId, workspaceId, name: name.trim(), objective: description.trim(), userId: user?.userId });
      toast.success('Saved'); reset(); await load(true);
    } catch (error) { toast.error(publicMessage(error, 'Could not save')); }
    finally { setBusy(false); }
  };

  const setStatus = async (item: SocialContent, status: SocialContent['status']) => {
    try { await updateSocialContentStatus(item.id, status, user?.userId, status === 'scheduled' ? item.scheduledAt : undefined); toast.success(status === 'approved' ? 'Content approved' : 'Status updated'); await load(); }
    catch (error) { toast.error(publicMessage(error, 'Could not update content')); }
  };
  /** Try posts again now: back in the queue, and the server is asked to send them straight away. */
  const retryAll = async (items: SocialContent[]) => {
    try {
      for (const item of items) await updateSocialContentStatus(item.id, 'scheduled', user?.userId, new Date());
      toast.success('Trying again now');
      await load(true);
      void runSocialPublish().then(() => load(true));
    } catch (error) { toast.error(publicMessage(error, 'Could not try the post again')); }
  };
  const retry = (item: SocialContent) => retryAll([item]);
  const setPostsCampaign = async (items: SocialContent[], campaignId: string | null) => {
    try {
      await setSocialContentCampaign(items.map((item) => item.id), campaignId);
      toast.success(campaignId ? (items.length === 1 ? 'Added to the campaign' : `${items.length} posts added to the campaign`) : 'Taken out of the campaign');
      await load(true);
    } catch (error) { toast.error(publicMessage(error, 'Could not change the campaign. Please try again.')); }
  };
  const removePosts = async (items: SocialContent[]) => {
    try {
      await deleteSocialContent(items.map((item) => item.id));
      toast.success(items.length === 1 ? 'Post deleted' : `${items.length} posts deleted`);
      await load(true);
    } catch (error) { toast.error(publicMessage(error, 'Could not delete. Please try again.')); }
  };

  if (workspaceLoading || !selected) return <main className="flex-1 grid place-items-center"><div className="text-center text-muted-foreground"><Loader2 className="mx-auto mb-2 h-7 w-7 animate-spin" /><p>{workspaces.length ? 'Opening workspace social marketing…' : 'Create a workspace to use social marketing.'}</p></div></main>;

  return <main className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6 md:p-8">
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-3xl font-bold">Social Media Marketing</h1><p className="text-muted-foreground">Plan, approve and measure content for <b>{selected.name}</b>.</p></div><Button onClick={() => setComposing(true)}><Plus className="mr-1 h-4 w-4" />New post</Button></div>
    {loading ? <div className="py-20 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin" /></div> : <Tabs value={tab} onValueChange={setTab}><TabsList className="flex flex-wrap h-auto"><TabsTrigger value="library"><Library className="mr-1 h-4 w-4" />Posts</TabsTrigger><TabsTrigger value="calendar"><CalendarDays className="mr-1 h-4 w-4" />Calendar</TabsTrigger><TabsTrigger value="campaigns">Campaigns</TabsTrigger><TabsTrigger value="accounts"><Share2 className="mr-1 h-4 w-4" />Accounts</TabsTrigger><TabsTrigger value="analytics"><BarChart3 className="mr-1 h-4 w-4" />Analytics</TabsTrigger></TabsList>
      <TabsContent value="library" className="space-y-3">
        <div className="flex justify-end pt-3">
          <div role="group" aria-label="How the posts are shown" className="inline-flex rounded-md border border-border p-0.5">
            <Button size="sm" variant={postsView === 'table' ? 'secondary' : 'ghost'} aria-pressed={postsView === 'table'} onClick={() => choosePostsView('table')}><Rows3 aria-hidden />Table</Button>
            <Button size="sm" variant={postsView === 'cards' ? 'secondary' : 'ghost'} aria-pressed={postsView === 'cards'} onClick={() => choosePostsView('cards')}><LayoutList aria-hidden />By post</Button>
          </div>
        </div>
        {postsView === 'table'
          ? <PostsTable content={content} accounts={accounts} campaigns={campaigns} onNewPost={() => setComposing(true)} onRetry={retryAll} onStatus={setStatus} onDelete={removePosts} onSetCampaign={setPostsCampaign} jump={jump} />
          : <><SectionHeader title="Posts" action="New post" onClick={() => setComposing(true)} />{groups.length === 0 ? <Empty text="No posts yet. Press New post to upload once and post everywhere." /> : groups.map((group) => (group.posts.length === 1 && !group.posts[0].postGroupId
            ? <ContentCard key={group.id} item={group.posts[0]} onStatus={setStatus} />
            : <GroupCard key={group.id} group={group} accountName={(id) => accountsById.get(id ?? '')} onRetry={retry} />))}</>}
      </TabsContent>
      <TabsContent value="calendar">
        <SocialCalendar content={content} accounts={accounts} campaigns={campaigns} onNewPost={() => setComposing(true)} onSeeDrafts={() => openPosts({ tab: 'drafts' })} />
      </TabsContent>
      <TabsContent value="campaigns">
        <CampaignsTable
          campaigns={campaigns} content={content} metrics={metrics} accounts={accounts}
          onNew={() => setCreateKind('campaign')}
          onSetStatus={async (campaign, status) => {
            try { await updateSocialCampaignStatus(campaign.id, status); await load(true); }
            catch (error) { toast.error(publicMessage(error, 'Could not change the campaign. Please try again.')); }
          }}
          onSeePosts={(campaignId) => openPosts({ campaignId })}
        />
      </TabsContent>
      <TabsContent value="accounts" className="space-y-3"><ConnectAccounts organizationId={orgId} workspaceId={workspaceId} canConnect={Boolean(isAdmin)} onChanged={() => void load(true)} /><SectionHeader title="Connected accounts" action="Add with a key" onClick={() => setCreateKind('account')} />{accounts.length === 0 ? <Empty text="No account connected yet. Press Connect above." /> : accounts.map((item) => <Card key={item.id}><CardContent className="flex items-center justify-between p-4"><div><p className="font-semibold">{item.displayName}</p><p className="text-sm capitalize text-muted-foreground">{item.provider}</p></div><div className="flex max-w-[60%] flex-col items-end gap-1"><Badge variant={item.status === 'connected' ? 'default' : 'outline'}>{item.status === 'error' ? 'connect again' : item.status}</Badge>{item.status === 'error' && item.lastError && <p className="text-right text-xs text-destructive">{publicText(item.lastError, 'This account needs to be connected again.')}</p>}</div></CardContent></Card>)}</TabsContent>
      <TabsContent value="analytics">
        <SocialAnalytics content={content} accounts={accounts} campaigns={campaigns} metrics={metrics} />
      </TabsContent>
    </Tabs>}

    <Dialog open={Boolean(createKind)} onOpenChange={(open) => { if (!open) reset(); }}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{createKind === 'account' ? 'Add social account' : 'New social media campaign'}</DialogTitle></DialogHeader><div className="space-y-3">
      <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={createKind === 'campaign' ? 'Winter offer' : undefined} /></Field>
      {createKind === 'account' ? <><Field label="Network"><Select value={provider} onValueChange={(v) => setProvider(v as SocialProvider)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PROVIDERS.map((item) => <SelectItem key={item} value={item} className="capitalize">{item}</SelectItem>)}</SelectContent></Select></Field><Field label="Provider account ID / author URN"><Input value={externalId} onChange={(e) => setExternalId(e.target.value)} /></Field><Field label="Provider access token"><Input type="password" autoComplete="off" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} /><p className="text-xs text-muted-foreground">Sent over TLS and encrypted server-side. It is never stored in the browser or readable through the app API.</p></Field>{(provider === 'youtube' || provider === 'tiktok' || provider === 'x') && <Field label="Refresh token"><Input type="password" autoComplete="off" value={refreshToken} onChange={(e) => setRefreshToken(e.target.value)} /><p className="text-xs text-muted-foreground">{PLATFORM_NAME[provider]} access tokens run out within hours. With the refresh token, a new one is fetched by itself each time.</p></Field>}</> : <>
        <Field label="What is it for?"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="More bookings in December" /><p className="text-xs text-muted-foreground">A campaign groups social media posts of one goal. Choose it in New post, or add posts to it from the posts table.</p></Field>
      </>}</div><DialogFooter><Button variant="outline" onClick={reset}>Cancel</Button><Button disabled={busy || !name.trim()} onClick={save}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Save</Button></DialogFooter></DialogContent></Dialog>
    <SocialComposer
      open={composing}
      onOpenChange={setComposing}
      organizationId={orgId}
      workspaceId={workspaceId}
      userId={user?.userId}
      accounts={accounts}
      campaigns={campaigns}
      onPosted={() => void load(true)}
      onAddAccount={() => { setTab('accounts'); setCreateKind('account'); }}
    />
  </main>;
};

const POST_STATE: Record<SocialContent['status'], { label: string; tone: StatusTone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  in_review: { label: 'Waiting for approval', tone: 'warning' },
  approved: { label: 'Approved', tone: 'info' },
  scheduled: { label: 'Waiting to go out', tone: 'info' },
  publishing: { label: 'Posting now', tone: 'info' },
  published: { label: 'Posted', tone: 'success' },
  failed: { label: 'Not posted', tone: 'danger' },
};

/** The posts of one press: one line for each account, with how it went and a way to try again. */
const GroupCard: React.FC<{ group: PostGroup; accountName: (id: string | null) => SocialAccount | undefined; onRetry: (item: SocialContent) => void }> = ({ group, accountName, onRetry }) => (
  <Card>
    <CardContent className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-semibold">
            {group.media && (group.media.kind === 'video' ? <Film className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /> : <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />)}
            <span className="truncate">{group.title}</span>
          </p>
          {group.body && <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground">{group.body}</p>}
          {group.scheduledAt && <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" aria-hidden />{group.scheduledAt.toLocaleString()}</p>}
        </div>
        <span className="shrink-0 text-sm font-medium text-foreground">{groupSummary(group)}</span>
      </div>
      <ul className="divide-y divide-border rounded-md border border-border">
        {group.posts.map((item) => {
          const account = accountName(item.accountId);
          const platform = account && isPlatform(account.provider) ? PLATFORM_NAME[account.provider] : 'Account';
          const state = POST_STATE[item.status];
          return (
            <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm" aria-label={`${platform}: ${state.label}`}>
              <span className="w-24 shrink-0 font-medium text-foreground">{platform}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{account?.displayName ?? 'Account removed'}</span>
              <StatusPill tone={state.tone}>{state.label}</StatusPill>
              {item.status === 'failed' && (
                <Button size="sm" variant="outline" onClick={() => onRetry(item)}><RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden />Try again</Button>
              )}
              {item.status === 'failed' && item.lastError && (
                <p className="basis-full text-xs text-destructive">{publicText(item.lastError, 'The post was not accepted. Try again.')}</p>
              )}
            </li>
          );
        })}
      </ul>
    </CardContent>
  </Card>
);

const ContentCard: React.FC<{ item: SocialContent; onStatus: (item: SocialContent, status: SocialContent['status']) => void }> = ({ item, onStatus }) => <Card><CardContent className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{item.title}</p><p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{item.body}</p>{item.scheduledAt && <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" />{item.scheduledAt.toLocaleString()}</p>}</div><div className="flex items-center gap-2"><Badge variant="outline">{item.status.replace('_', ' ')}</Badge>{item.status === 'in_review' && <Button size="sm" onClick={() => onStatus(item, item.scheduledAt ? 'scheduled' : 'approved')}><Check className="mr-1 h-4 w-4" />Approve</Button>}{item.status === 'draft' && <Button size="sm" variant="outline" onClick={() => onStatus(item, 'in_review')}>Request approval</Button>}{item.status === 'approved' && <Button size="sm" onClick={() => onStatus(item, 'scheduled')}>Publish now</Button>}{item.status === 'failed' && <Button size="sm" variant="outline" onClick={() => onStatus(item, 'scheduled')}>Retry</Button>}</div></div></CardContent></Card>;
const SectionHeader: React.FC<{ title: string; action?: string; onClick?: () => void }> = ({ title, action, onClick }) => <div className="flex items-center justify-between pt-3"><h2 className="text-lg font-semibold">{title}</h2>{action && <Button size="sm" variant="outline" onClick={onClick}><Plus className="mr-1 h-4 w-4" />{action}</Button>}</div>;
const Empty: React.FC<{ text: string }> = ({ text }) => <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">{text}</div>;
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => <div className="space-y-1"><Label>{label}</Label>{children}</div>;

export default SocialMedia;
