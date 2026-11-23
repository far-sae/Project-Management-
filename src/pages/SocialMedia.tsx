import { publicMessage, publicText } from '@/lib/publicError';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, CalendarDays, Check, Clock, Film, ImageIcon, Library, Loader2, Plus, RotateCcw, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
import { useProjects } from '@/hooks/useProjects';
import { useAllTasks } from '@/hooks/useAllTasks';
import { createSocialAccount, createSocialCampaign, createSocialContent, listSocialData, runSocialPublish, saveSocialAccountToken, updateSocialCampaignStatus, updateSocialContentStatus } from '@/services/supabase/social';
import { SocialComposer } from '@/components/social/SocialComposer';
import { ConnectAccounts } from '@/components/social/ConnectAccounts';
import { connectReturnMessage, readConnectReturn } from '@/lib/socialConnect';
import { StatusPill, type StatusTone } from '@/components/common/StatusPill';
import { groupPosts, groupSummary, isOnItsWay, type PostGroup } from '@/lib/socialCompose';
import { PLATFORM_NAME, isPlatform } from '../../api/_social/shared/platforms';
import type { SocialAccount, SocialCampaign, SocialContent, SocialMetric, SocialProvider } from '@/types/social';
import type { CrmCompany, CrmContact } from '@/types/crmHub';
import { listContacts } from '@/services/supabase/crmHub/contacts';
import { listCompanies } from '@/services/supabase/crmHub/companies';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

type CreateKind = 'account' | 'campaign' | 'content' | null;
const PROVIDERS: SocialProvider[] = ['linkedin', 'facebook', 'instagram', 'x', 'youtube', 'tiktok', 'other'];

export const SocialMedia: React.FC = () => {
  const { user } = useAuth();
  const { organization, isAdmin } = useOrganization();
  const { selected, isAll, isUnassigned, select, workspaces, loading: workspaceLoading } = useSelectedWorkspace();
  const { projects, loading: projectsLoading } = useProjects();
  const { tasks } = useAllTasks();
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [campaigns, setCampaigns] = useState<SocialCampaign[]>([]);
  const [content, setContent] = useState<SocialContent[]>([]);
  const [metrics, setMetrics] = useState<SocialMetric[]>([]);
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [companies, setCompanies] = useState<CrmCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [createKind, setCreateKind] = useState<CreateKind>(null);
  const [name, setName] = useState(''); const [description, setDescription] = useState('');
  const [provider, setProvider] = useState<SocialProvider>('linkedin'); const [externalId, setExternalId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [composing, setComposing] = useState(false);
  const [tab, setTab] = useState('library');
  const [projectId, setProjectId] = useState(''); const [campaignId, setCampaignId] = useState('');
  const [accountId, setAccountId] = useState(''); const [scheduledAt, setScheduledAt] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [crmContactId, setCrmContactId] = useState(''); const [crmCompanyId, setCrmCompanyId] = useState('');
  const [taskId, setTaskId] = useState('');

  useEffect(() => {
    if (workspaceLoading || (!isAll && !isUnassigned)) return;
    if (workspaces[0]) select(workspaces[0].workspaceId);
  }, [isAll, isUnassigned, select, workspaceLoading, workspaces]);

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
  const workspaceProjects = useMemo(() => projects.filter((item) => item.workspaceId === workspaceId), [projects, workspaceId]);
  const workspaceProjectIds = useMemo(() => new Set(workspaceProjects.map((item) => item.projectId)), [workspaceProjects]);
  const workspaceTasks = useMemo(() => tasks.filter((item) => workspaceProjectIds.has(item.projectId) && (!projectId || item.projectId === projectId)), [projectId, tasks, workspaceProjectIds]);
  const load = useCallback(async (quiet = false) => {
    if (!workspaceId || !orgId) { setLoading(false); return; }
    if (!quiet) setLoading(true);
    try { const [data, contactRows, companyRows] = await Promise.all([listSocialData(workspaceId), listContacts(orgId, { workspaceId }), listCompanies(orgId, { workspaceId })]); setAccounts(data.accounts); setCampaigns(data.campaigns); setContent(data.content); setMetrics(data.metrics); setContacts(contactRows); setCompanies(companyRows); }
    catch (error) { toast.error(publicMessage(error, 'Could not load social marketing')); }
    finally { setLoading(false); }
  }, [orgId, workspaceId]);
  useEffect(() => { void load(); }, [load]);

  // While a post is on its way out, look again every few seconds, so each
  // platform's result shows up by itself.
  const waiting = useMemo(() => content.some((item) => isOnItsWay(item, Date.now())), [content]);
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => void load(true), 5000);
    return () => window.clearTimeout(timer);
  }, [waiting, content, load]);
  const groups = useMemo(() => groupPosts(content), [content]);
  const accountsById = useMemo(() => new Map(accounts.map((item) => [item.id, item])), [accounts]);

  const reset = () => { setCreateKind(null); setName(''); setDescription(''); setExternalId(''); setAccessToken(''); setRefreshToken(''); setProjectId(''); setTaskId(''); setCampaignId(''); setAccountId(''); setScheduledAt(''); setMediaUrl(''); setCrmContactId(''); setCrmCompanyId(''); };
  const save = async () => {
    if (!name.trim() || !orgId || !workspaceId) return;
    setBusy(true);
    try {
      if (createKind === 'account') {
        const id = await createSocialAccount({ organizationId: orgId, workspaceId, provider, displayName: name.trim(), externalAccountId: externalId.trim(), userId: user?.userId });
        if (accessToken.trim()) await saveSocialAccountToken(id, accessToken.trim(), refreshToken.trim() || undefined);
      }
      if (createKind === 'campaign') await createSocialCampaign({ organizationId: orgId, workspaceId, name: name.trim(), objective: description.trim(), projectId, taskId, crmContactId, crmCompanyId, userId: user?.userId });
      if (createKind === 'content') await createSocialContent({ organizationId: orgId, workspaceId, title: name.trim(), body: description, mediaUrls: mediaUrl.trim() ? [mediaUrl.trim()] : [], campaignId, accountId, projectId, taskId, crmContactId, crmCompanyId, scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined, userId: user?.userId });
      toast.success(createKind === 'content' && scheduledAt ? 'Draft sent for approval' : 'Saved'); reset(); await load();
    } catch (error) { toast.error(publicMessage(error, 'Could not save')); }
    finally { setBusy(false); }
  };

  const setStatus = async (item: SocialContent, status: SocialContent['status']) => {
    try { await updateSocialContentStatus(item.id, status, user?.userId, status === 'scheduled' ? item.scheduledAt : undefined); toast.success(status === 'approved' ? 'Content approved' : 'Status updated'); await load(); }
    catch (error) { toast.error(publicMessage(error, 'Could not update content')); }
  };
  /** Try a post again now: back in the queue, and the server is asked to send it straight away. */
  const retry = async (item: SocialContent) => {
    try {
      await updateSocialContentStatus(item.id, 'scheduled', user?.userId, new Date());
      toast.success('Trying again now');
      await load(true);
      void runSocialPublish().then(() => load(true));
    } catch (error) { toast.error(publicMessage(error, 'Could not try the post again')); }
  };
  const totals = metrics.reduce((sum, row) => ({ impressions: sum.impressions + row.impressions, clicks: sum.clicks + row.clicks, reactions: sum.reactions + row.reactions }), { impressions: 0, clicks: 0, reactions: 0 });
  const metricsByContent = useMemo(() => new Map(metrics.map((item) => [item.contentId, item])), [metrics]);
  const campaignAnalytics = useMemo(() => campaigns.map((campaign) => {
    const rows = content.filter((item) => item.campaignId === campaign.id).map((item) => metricsByContent.get(item.id)).filter((item): item is SocialMetric => Boolean(item));
    return { campaign, posts: content.filter((item) => item.campaignId === campaign.id).length, impressions: rows.reduce((sum, item) => sum + item.impressions, 0), clicks: rows.reduce((sum, item) => sum + item.clicks, 0), reactions: rows.reduce((sum, item) => sum + item.reactions, 0) };
  }), [campaigns, content, metricsByContent]);

  if (workspaceLoading || projectsLoading || !selected) return <main className="flex-1 grid place-items-center"><div className="text-center text-muted-foreground"><Loader2 className="mx-auto mb-2 h-7 w-7 animate-spin" /><p>{workspaces.length ? 'Opening workspace social marketing…' : 'Create a workspace to use social marketing.'}</p></div></main>;
  if (workspaceProjects.length === 0) return <main className="flex-1 grid place-items-center p-6"><div className="max-w-md text-center"><Share2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground" /><h2 className="text-xl font-semibold">Create this workspace’s first project</h2><p className="mt-2 text-sm text-muted-foreground">Social campaigns unlock once there is a project to connect content and tasks to.</p></div></main>;

  return <main className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6 md:p-8">
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-3xl font-bold">Social Media Marketing</h1><p className="text-muted-foreground">Plan, approve and measure content for <b>{selected.name}</b>.</p></div><Button onClick={() => setComposing(true)}><Plus className="mr-1 h-4 w-4" />New post</Button></div>
    {loading ? <div className="py-20 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin" /></div> : <Tabs value={tab} onValueChange={setTab}><TabsList className="flex flex-wrap h-auto"><TabsTrigger value="library"><Library className="mr-1 h-4 w-4" />Library</TabsTrigger><TabsTrigger value="calendar"><CalendarDays className="mr-1 h-4 w-4" />Calendar</TabsTrigger><TabsTrigger value="campaigns">Campaigns</TabsTrigger><TabsTrigger value="accounts"><Share2 className="mr-1 h-4 w-4" />Accounts</TabsTrigger><TabsTrigger value="analytics"><BarChart3 className="mr-1 h-4 w-4" />Analytics</TabsTrigger></TabsList>
      <TabsContent value="library" className="space-y-3"><SectionHeader title="Posts" action="New post" onClick={() => setComposing(true)} />{groups.length === 0 ? <Empty text="No posts yet. Press New post to upload once and post everywhere." /> : groups.map((group) => (group.posts.length === 1 && !group.posts[0].postGroupId
        ? <ContentCard key={group.id} item={group.posts[0]} onStatus={setStatus} />
        : <GroupCard key={group.id} group={group} accountName={(id) => accountsById.get(id ?? '')} onRetry={retry} />))}</TabsContent>
      <TabsContent value="calendar"><SectionHeader title="Content calendar" /> <div className="mt-3 space-y-2">{content.filter((item) => item.scheduledAt).sort((a,b) => a.scheduledAt!.getTime() - b.scheduledAt!.getTime()).map((item) => <ContentCard key={item.id} item={item} onStatus={setStatus} />)}{content.every((item) => !item.scheduledAt) && <Empty text="Nothing scheduled." />}</div></TabsContent>
      <TabsContent value="campaigns" className="space-y-3"><SectionHeader title="Campaigns" action="New campaign" onClick={() => setCreateKind('campaign')} />{campaigns.length === 0 ? <Empty text="No campaigns yet." /> : campaigns.map((item) => <Card key={item.id}><CardContent className="flex items-center justify-between gap-3 p-4"><div><p className="font-semibold">{item.name}</p><p className="text-sm text-muted-foreground">{item.objective || 'No objective'} · {workspaceProjects.find((p) => p.projectId === item.projectId)?.name || 'No linked project'}</p></div><div className="flex items-center gap-2"><Badge>{item.status}</Badge>{item.status !== 'finished' && <Button size="sm" variant="outline" onClick={async () => { await updateSocialCampaignStatus(item.id, item.status === 'active' ? 'paused' : 'active'); await load(); }}>{item.status === 'active' ? 'Pause' : 'Activate'}</Button>}</div></CardContent></Card>)}</TabsContent>
      <TabsContent value="accounts" className="space-y-3"><ConnectAccounts organizationId={orgId} workspaceId={workspaceId} canConnect={Boolean(isAdmin)} /><SectionHeader title="Connected accounts" action="Add with a key" onClick={() => setCreateKind('account')} />{accounts.length === 0 ? <Empty text="No account connected yet. Press Connect above." /> : accounts.map((item) => <Card key={item.id}><CardContent className="flex items-center justify-between p-4"><div><p className="font-semibold">{item.displayName}</p><p className="text-sm capitalize text-muted-foreground">{item.provider}</p></div><div className="flex max-w-[60%] flex-col items-end gap-1"><Badge variant={item.status === 'connected' ? 'default' : 'outline'}>{item.status === 'error' ? 'connect again' : item.status}</Badge>{item.status === 'error' && item.lastError && <p className="text-right text-xs text-destructive">{publicText(item.lastError, 'This account needs to be connected again.')}</p>}</div></CardContent></Card>)}</TabsContent>
      <TabsContent value="analytics" className="space-y-4"><div className="grid gap-3 sm:grid-cols-3"><Metric label="Impressions" value={totals.impressions} /><Metric label="Clicks" value={totals.clicks} /><Metric label="Reactions" value={totals.reactions} /></div><Card><CardHeader><CardTitle>Campaign analytics</CardTitle></CardHeader><CardContent className="space-y-2">{campaignAnalytics.length === 0 ? <p className="text-sm text-muted-foreground">No campaigns to measure yet.</p> : campaignAnalytics.map(({ campaign, posts, impressions, clicks, reactions }) => <div key={campaign.id} className="grid grid-cols-[minmax(0,1fr)_repeat(4,auto)] gap-4 rounded-lg border p-3 text-sm"><b className="truncate">{campaign.name}</b><span>{posts} posts</span><span>{impressions.toLocaleString()} views</span><span>{clicks.toLocaleString()} clicks</span><span>{reactions.toLocaleString()} reactions</span></div>)}</CardContent></Card></TabsContent>
    </Tabs>}

    <Dialog open={Boolean(createKind)} onOpenChange={(open) => { if (!open) reset(); }}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{createKind === 'account' ? 'Add social account' : createKind === 'campaign' ? 'New campaign' : 'New content'}</DialogTitle></DialogHeader><div className="space-y-3">
      <Field label={createKind === 'content' ? 'Title' : 'Name'}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      {createKind === 'account' ? <><Field label="Network"><Select value={provider} onValueChange={(v) => setProvider(v as SocialProvider)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PROVIDERS.map((item) => <SelectItem key={item} value={item} className="capitalize">{item}</SelectItem>)}</SelectContent></Select></Field><Field label="Provider account ID / author URN"><Input value={externalId} onChange={(e) => setExternalId(e.target.value)} /></Field><Field label="Provider access token"><Input type="password" autoComplete="off" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} /><p className="text-xs text-muted-foreground">Sent over TLS and encrypted server-side. It is never stored in the browser or readable through the app API.</p></Field>{(provider === 'youtube' || provider === 'tiktok' || provider === 'x') && <Field label="Refresh token"><Input type="password" autoComplete="off" value={refreshToken} onChange={(e) => setRefreshToken(e.target.value)} /><p className="text-xs text-muted-foreground">{PLATFORM_NAME[provider]} access tokens run out within hours. With the refresh token, a new one is fetched by itself each time.</p></Field>}</> : <>
        <Field label={createKind === 'content' ? 'Post copy' : 'Objective'}><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} /></Field>
        <Field label="Linked project"><Select value={projectId || '__none__'} onValueChange={(v) => setProjectId(v === '__none__' ? '' : v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">No project</SelectItem>{workspaceProjects.map((item) => <SelectItem key={item.projectId} value={item.projectId}>{item.name}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Linked project task"><Select value={taskId || '__none__'} onValueChange={(v) => setTaskId(v === '__none__' ? '' : v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">No task</SelectItem>{workspaceTasks.map((item) => <SelectItem key={item.taskId} value={item.taskId}>{item.title}</SelectItem>)}</SelectContent></Select></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="CRM contact"><Select value={crmContactId || '__none__'} onValueChange={(v) => setCrmContactId(v === '__none__' ? '' : v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">No contact</SelectItem>{contacts.map((item) => <SelectItem key={item.id} value={item.id}>{item.firstName} {item.lastName}</SelectItem>)}</SelectContent></Select></Field><Field label="CRM company"><Select value={crmCompanyId || '__none__'} onValueChange={(v) => setCrmCompanyId(v === '__none__' ? '' : v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">No company</SelectItem>{companies.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></Field></div>
        {createKind === 'content' && <><Field label="Campaign"><Select value={campaignId || '__none__'} onValueChange={(v) => setCampaignId(v === '__none__' ? '' : v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">No campaign</SelectItem>{campaigns.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></Field><Field label="Publish via"><Select value={accountId || '__none__'} onValueChange={(v) => setAccountId(v === '__none__' ? '' : v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">Choose later</SelectItem>{accounts.map((item) => <SelectItem key={item.id} value={item.id}>{item.displayName}</SelectItem>)}</SelectContent></Select></Field><Field label="Public media URL (optional)"><Input type="url" value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} placeholder="https://…" /></Field><Field label="Schedule (optional)"><Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} /></Field></>}
      </>}</div><DialogFooter><Button variant="outline" onClick={reset}>Cancel</Button><Button disabled={busy || !name.trim()} onClick={save}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Save</Button></DialogFooter></DialogContent></Dialog>
    <SocialComposer
      open={composing}
      onOpenChange={setComposing}
      organizationId={orgId}
      workspaceId={workspaceId}
      userId={user?.userId}
      accounts={accounts}
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
const Metric: React.FC<{ label: string; value: number }> = ({ label, value }) => <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{label}</CardTitle></CardHeader><CardContent><p className="text-3xl font-bold">{value.toLocaleString()}</p></CardContent></Card>;
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => <div className="space-y-1"><Label>{label}</Label>{children}</div>;

export default SocialMedia;
