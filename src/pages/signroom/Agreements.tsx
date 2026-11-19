import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Copy, FileText, Loader2, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useSignroom } from '@/hooks/useSignroom';
import { useCrmDeals } from '@/hooks/useCrmHub';
import {
  STATUS_FILTERS, activityNote, filterAgreements, sentLabel, shortDate, signedCount, sortAgreements, statusCounts,
  type AgreementScope, type AgreementSort,
} from '@/lib/signroom/agreementFormat';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/common/PageHeader';
import { StatStrip } from '@/components/common/StatStrip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { AgreementStatusPill, PutAwayNote } from '@/components/signroom/agreements/AgreementStatus';
import { AgreementRowActions, agreementPath } from '@/components/signroom/agreements/AgreementRowActions';
import { AgreementPreviewDialog } from '@/components/signroom/agreements/AgreementPreviewDialog';
import { NewAgreementDialog } from '@/components/signroom/agreements/NewAgreementDialog';
import { messageOf } from '@/components/signroom/agreements/files';
import { TYPES, type Agreement, type AgreementSummary, type Client } from '../../../api/_signroom/shared/types';

const ALL = 'all';
const SCOPES: { value: AgreementScope; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'trash', label: 'Trash' },
  { value: 'all', label: 'All documents' },
];
const isScope = (value: string | null): value is AgreementScope => SCOPES.some((s) => s.value === value);
const isStatus = (value: string | null): value is (typeof STATUS_FILTERS)[number] =>
  (STATUS_FILTERS as readonly string[]).includes(value ?? '');

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** Every agreement in the selected workspace: where each one stands and what to do next. */
export const AgreementsPage: React.FC = () => {
  const { client, workspaceId } = useSignroom();
  const { items: deals } = useCrmDeals();
  const [params, setParams] = useSearchParams();

  const [agreements, setAgreements] = useState<AgreementSummary[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [sort, setSort] = useState<AgreementSort>('newest');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [preview, setPreview] = useState<Agreement | null>(null);

  // The status and the view are part of the address, so a filtered list can be bookmarked and shared.
  const status = isStatus(params.get('status')) ? params.get('status')! : ALL;
  const scope: AgreementScope = isScope(params.get('show')) ? (params.get('show') as AgreementScope) : 'active';
  const setParam = (key: 'status' | 'show', value: string, fallback: string) => {
    const next = new URLSearchParams(params);
    if (value === fallback) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const load = useCallback(async () => {
    if (!workspaceId) { setAgreements([]); setClients([]); return; }
    setLoading(true);
    setError('');
    try {
      const [list, people] = await Promise.all([
        client.call<AgreementSummary[]>('agreements'),
        client.call<Client[]>('clients'),
      ]);
      setAgreements(list);
      setClients(people);
    } catch (e) {
      setError(messageOf(e, 'Could not load agreements.'));
    } finally {
      setLoading(false);
    }
  }, [client, workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const clientNames = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c.name])), [clients]);
  const dealById = useMemo(() => new Map(deals.map((d) => [d.id, d])), [deals]);

  /** Everything except the status, so the status chips can show their counts. */
  const scoped = useMemo(
    () => filterAgreements(agreements, {
      scope, search, clientNames, from, to, type: typeFilter === ALL ? undefined : typeFilter,
    }),
    [agreements, scope, search, clientNames, from, to, typeFilter],
  );
  const visible = useMemo(
    () => sortAgreements(status === ALL ? scoped : scoped.filter((a) => a.status === status), sort),
    [scoped, status, sort],
  );
  const counts = useMemo(() => statusCounts(agreements), [agreements]);

  const filtering = Boolean(search.trim()) || status !== ALL || typeFilter !== ALL || scope !== 'active' || Boolean(from) || Boolean(to);
  const clearFilters = () => {
    setSearch(''); setTypeFilter(ALL); setFrom(''); setTo('');
    setParams(new URLSearchParams(), { replace: true });
  };

  /** The server's reply replaces the row whole: a restored agreement simply has no trash date any more. */
  const changed = (next: Agreement) => {
    setAgreements((list) => list.map((a) => (a.id === next.id ? next : a)));
  };

  /** The list carries summaries, so the text and the PDF state come from the full agreement. */
  const view = async (a: AgreementSummary) => {
    try {
      setPreview(await client.call<Agreement>(`agreements/${a.id}`));
    } catch (e) {
      toast.error(messageOf(e));
    }
  };

  const chip = (active: boolean) =>
    cn(
      'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      active
        ? 'border-foreground bg-foreground text-background'
        : 'border-border text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground',
    );

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-background">
      <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">
        <PageHeader
          title="Agreements"
          description="Documents you send to companies for signature, with the next step to keep each one moving."
          actions={workspaceId && (
            <>
              <Button asChild variant="outline">
                <Link to="/crm/templates"><Copy aria-hidden /> Templates</Link>
              </Button>
              <Button onClick={() => setShowNew(true)}>
                <Plus aria-hidden /> New agreement
              </Button>
            </>
          )}
        />

        {!workspaceId ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-16 text-center">
            <FileText className="h-5 w-5 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              Pick a workspace in the sidebar to see its agreements. Each agreement belongs to one workspace.
            </p>
          </div>
        ) : (
          <>
            {agreements.length > 0 && (
              <StatStrip
                items={[
                  { label: 'Total agreements', value: counts.total },
                  { label: 'Awaiting signatures', value: counts.awaiting },
                  { label: 'Completed', value: counts.completed, tone: counts.completed > 0 ? 'success' : 'default' },
                  { label: 'Drafts in progress', value: counts.drafts },
                ]}
              />
            )}

            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by status">
                <button type="button" className={chip(status === ALL)} aria-pressed={status === ALL} onClick={() => setParam('status', ALL, ALL)}>
                  All agreements <span className="tabular-nums opacity-70">{scoped.length}</span>
                </button>
                {STATUS_FILTERS.map((s) => (
                  <button key={s} type="button" className={chip(status === s)} aria-pressed={status === s} onClick={() => setParam('status', s, ALL)}>
                    {s === 'Draft' ? 'Drafts' : s}{' '}
                    <span className="tabular-nums opacity-70">{scoped.filter((a) => a.status === s).length}</span>
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <div className="relative min-w-52 max-w-md flex-1 basis-60">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search title, company or recipient"
                    aria-label="Search agreements"
                    className="pl-8"
                  />
                </div>
                <Select value={scope} onValueChange={(v) => setParam('show', v, 'active')}>
                  <SelectTrigger className="w-40" aria-label="Show"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SCOPES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="w-44" aria-label="Agreement type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All types</SelectItem>
                    {TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={sort} onValueChange={(v) => setSort(v as AgreementSort)}>
                  <SelectTrigger className="w-44" aria-label="Sort by"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Latest activity</SelectItem>
                    <SelectItem value="oldest">Oldest activity</SelectItem>
                    <SelectItem value="title">Title A to Z</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="agreements-from" className="text-xs text-muted-foreground">Created from</Label>
                  <Input id="agreements-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40 tabular-nums" />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="agreements-to" className="text-xs text-muted-foreground">Created to</Label>
                  <Input id="agreements-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40 tabular-nums" />
                </div>
              </div>
            </div>

            {loading && agreements.length === 0 ? (
              <div className="py-16 text-center">
                <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading agreements" />
              </div>
            ) : error ? (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-16 text-center">
                <p role="alert" className="text-sm text-destructive">{error}</p>
                <Button variant="outline" onClick={() => void load()}>Try again</Button>
              </div>
            ) : visible.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-16 text-center">
                <FileText className="h-5 w-5 text-muted-foreground" aria-hidden />
                <p className="text-sm text-muted-foreground">
                  {agreements.length > 0
                    ? 'No agreements match this view. Try another status, type or search.'
                    : 'No agreements yet. Start the first one for a company, and add more as the relationship grows.'}
                </p>
                {agreements.length > 0 && filtering
                  ? <Button variant="outline" onClick={clearFilters}>Clear filters</Button>
                  : <Button onClick={() => setShowNew(true)}><Plus aria-hidden /> New agreement</Button>}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div
                  className="overflow-x-auto rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  role="region"
                  aria-label="Agreements table, scroll for more columns"
                  tabIndex={0}
                >
                  <table className="w-full min-w-[72rem] text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th scope="col" className="px-3 py-2 text-left font-medium">Document</th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">Company</th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">Status</th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">Recipients</th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">Created</th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">Sent</th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">Completed</th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">Deadline</th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">Last activity</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((a) => {
                        const forClient = clientById.get(a.clientId);
                        const deal = a.dealId ? dealById.get(a.dealId) : undefined;
                        const { signed, signers } = signedCount(a);
                        return (
                          <tr key={a.id} className="border-b border-border align-top last:border-b-0 hover:bg-muted/40">
                            <td className="px-3 py-2">
                              <div className="flex min-w-0 items-start gap-2.5">
                                <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground">
                                  <FileText className="h-4 w-4" />
                                </span>
                                <div className="min-w-0">
                                  <Link to={agreementPath(a)} className="block max-w-[18rem] truncate font-medium text-foreground hover:underline">
                                    {a.title}
                                  </Link>
                                  <span className="block text-xs tabular-nums text-muted-foreground">
                                    {a.type} · {a.pages.length ? plural(a.pages.length, 'page', 'pages') : 'No pages'}
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              {forClient?.crmCompanyId ? (
                                <Link to={`/crm/companies/${forClient.crmCompanyId}`} className="block max-w-[14rem] truncate text-foreground hover:underline">
                                  {forClient.name}
                                </Link>
                              ) : (
                                <span className="block max-w-[14rem] truncate text-muted-foreground">{forClient?.name ?? '—'}</span>
                              )}
                              {a.dealId && (
                                <Link to={`/crm/deals/${a.dealId}`} className="block max-w-[14rem] truncate text-xs text-muted-foreground hover:text-foreground hover:underline">
                                  {deal ? `Deal: ${deal.name}` : 'View deal'}
                                </Link>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-col items-start gap-1">
                                <AgreementStatusPill status={a.status} />
                                <PutAwayNote agreement={a} />
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              {a.participants.length === 0 ? <span className="text-muted-foreground">—</span> : (
                                <ul className="flex flex-col gap-0.5">
                                  {a.participants.map((p) => (
                                    <li key={p.id} className="max-w-[16rem] truncate">
                                      {p.name || p.email}
                                      <span className="ml-1.5 text-xs text-muted-foreground">
                                        {p.name ? p.email : ''}{p.role === 'copy' ? ' · Copy' : ''}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {signers > 0 && (
                                <span className="text-xs tabular-nums text-muted-foreground">{signed}/{signers} signed</span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">{shortDate(a.created)}</td>
                            <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">{sentLabel(a)}</td>
                            <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">
                              {a.completedAt ? shortDate(a.completedAt) : '—'}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">
                              {a.deadline ? shortDate(a.deadline) : 'No deadline'}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2">
                              <span className="block tabular-nums">{shortDate(a.updated)}</span>
                              <span className="block text-xs text-muted-foreground">{activityNote(a)}</span>
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              <AgreementRowActions agreement={a} onView={() => void view(a)} onChange={changed} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs tabular-nums text-muted-foreground">
                  {plural(visible.length, 'agreement', 'agreements')} · All companies
                </p>
              </div>
            )}
          </>
        )}
      </div>

      <NewAgreementDialog open={showNew} onOpenChange={setShowNew} />
      <AgreementPreviewDialog agreement={preview} onClose={() => setPreview(null)} />
    </main>
  );
};

export default AgreementsPage;
