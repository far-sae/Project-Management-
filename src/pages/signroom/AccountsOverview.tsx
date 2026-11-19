// Accounts overview at /crm/accounts-overview: every company's plan months and issued invoices for one year.
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CalendarRange, Download, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import type { AccountsOverviewData, OverviewRow } from '../../../api/_signroom/shared/types';
import { useSignroom } from '@/hooks/useSignroom';
import { anyAbove, billingToday, formatMinor, formatSums, shortDate } from '@/lib/signroom/billing';
import { csvText, saveTextFile } from '@/lib/signroom/billingCsv';
import {
  OVERVIEW_STATUSES, OVERVIEW_YEARS, STATUS_WORD, filterOverview, groupOverviewByMonth, monthLabel, overviewCsvRows,
  overviewTotals, type MonthOrder, type OverviewSource, type OverviewStatus,
} from '@/lib/signroom/billingPlans';
import { PageHeader } from '@/components/common/PageHeader';
import { StatStrip } from '@/components/common/StatStrip';
import { StatusPill } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PaymentPill, SumLines, YearSwitcher, chipClass } from '@/components/signroom/billing/planShared';
import {
  EmptyState, HEAD_ROW, PickWorkspace, ROW, TD, TD_DATE, TD_MONEY, TH, TH_RIGHT, Tick,
} from '@/components/signroom/billing/shared';
import { useBillingClients, useServerData } from '@/components/signroom/billing/useBilling';

const SOURCES: Array<{ source: OverviewSource; label: string; many: string }> = [
  { source: 'Project plan', label: 'Billing plans', many: 'billing plan months' },
  { source: 'Invoice', label: 'Invoices', many: 'invoices' },
];

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

const LINK = 'text-foreground underline-offset-4 hover:underline';

export const AccountsOverviewPage: React.FC = () => {
  const { workspaceId } = useSignroom();
  const { byId: clientsById } = useBillingClients();

  const [year, setYear] = useState(() => Number(billingToday().slice(0, 4)));
  const [source, setSource] = useState<OverviewSource>('Project plan');
  const [status, setStatus] = useState<OverviewStatus>('all');
  const [query, setQuery] = useState('');
  const [archived, setArchived] = useState(false);
  const [order, setOrder] = useState<MonthOrder>('earliest');

  const { data, error, notSetUp } = useServerData<AccountsOverviewData>(`accounts-overview?year=${year}`);
  const all = data?.rows ?? [];

  /** Everything except the status filter: what the totals and the counts on the chips are for. */
  const inView = useMemo(
    () => filterOverview(all, { source, status: 'all', query, archived }),
    [all, source, query, archived],
  );
  const months = useMemo(
    () => groupOverviewByMonth(inView.filter((r) => status === 'all' || r.status === status), order),
    [inView, status, order],
  );
  const shown = useMemo(() => months.flatMap((m) => m.rows), [months]);
  const totals = useMemo(() => overviewTotals(inView), [inView]);
  const countOf = (which: OverviewSource) => filterOverview(all, { source: which, status: 'all', query, archived }).length;

  const invoices = source === 'Invoice';
  const other = SOURCES.find((s) => s.source !== source)!;
  const filtering = status !== 'all' || Boolean(query.trim());
  const clearFilters = () => { setStatus('all'); setQuery(''); };
  const columns = invoices ? 6 : 5;

  const exportCsv = () => {
    if (!shown.length) { toast.error('Nothing to export'); return; }
    saveTextFile(`accounts-overview-${year}.csv`, csvText(overviewCsvRows(shown)));
    toast.success(`Exported ${plural(shown.length, 'entry', 'entries')}`);
  };

  const company = (row: OverviewRow) => {
    const companyId = clientsById.get(row.clientId)?.crmCompanyId;
    return (
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        {companyId
          ? <Link to={`/crm/companies/${companyId}`} className={`max-w-64 truncate font-medium ${LINK}`}>{row.clientName}</Link>
          : <span className="max-w-64 truncate font-medium text-foreground">{row.clientName}</span>}
        {row.archived && <StatusPill tone="muted" dot={false}>Archived</StatusPill>}
      </span>
    );
  };

  const content = () => {
    if (!workspaceId) return <PickWorkspace what="its accounts" />;
    if (notSetUp) {
      return (
        <EmptyState icon={<CalendarRange className="h-5 w-5 text-muted-foreground" aria-hidden />}>
          <span role="status">{error}</span>
        </EmptyState>
      );
    }
    if (error && !data) {
      return <p role="alert" className="rounded-md border border-border px-3 py-2 text-sm text-destructive">{error}</p>;
    }
    return (
      <>
        <StatStrip
          items={[
            {
              label: 'Paid',
              value: <SumLines sums={totals.paid} />,
              tone: anyAbove(totals.paid) ? 'success' : 'default',
              note: invoices ? 'Received on these invoices' : 'Receipts and amounts entered on plans',
            },
            {
              label: 'Still to come',
              value: <SumLines sums={totals.stillToCome} />,
              note: invoices ? 'Invoices not yet due' : 'This month and later',
            },
            {
              label: 'Overdue',
              value: <SumLines sums={totals.overdue} />,
              tone: anyAbove(totals.overdue) ? 'danger' : 'default',
              note: invoices ? 'Invoices past the due date' : 'Months that have ended',
            },
          ]}
        />

        {error && <p role="alert" className="rounded-md border border-border px-3 py-2 text-sm text-destructive">{error}</p>}

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Show">
              {SOURCES.map((s) => (
                <button key={s.source} type="button" className={chipClass(source === s.source)} aria-pressed={source === s.source} onClick={() => setSource(s.source)}>
                  {s.label} <span className="tabular-nums opacity-70">{countOf(s.source)}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by status">
              {OVERVIEW_STATUSES.map((s) => (
                <button key={s} type="button" className={chipClass(status === s)} aria-pressed={status === s} onClick={() => setStatus(s)}>
                  {s === 'all' ? 'All' : STATUS_WORD[s]}{' '}
                  <span className="tabular-nums opacity-70">{inView.filter((r) => s === 'all' || r.status === s).length}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="relative min-w-60 max-w-md flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8"
                placeholder="Search company, plan or invoice" aria-label="Search companies, plans and invoices"
              />
            </div>
            <Select value={order} onValueChange={(v) => setOrder(v as MonthOrder)}>
              <SelectTrigger aria-label="Order" className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="earliest">Earliest month first</SelectItem>
                <SelectItem value="latest">Latest month first</SelectItem>
              </SelectContent>
            </Select>
            <Tick checked={archived} onChange={setArchived}>Show archived</Tick>
            {filtering && <Button variant="ghost" onClick={clearFilters}>Clear filters</Button>}
          </div>
          <p className="max-w-3xl text-xs text-muted-foreground">
            {invoices
              ? `Invoices dated in ${year}, under the month they fall due. Billing plans are shown apart, so a payment is never counted twice.`
              : 'A plan month counts the receipts on its linked invoices and the amounts entered on the plan. Invoices are shown apart, so a payment is never counted twice.'}
          </p>
        </div>

        {!data ? (
          <div className="py-16 text-center">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading the accounts" />
          </div>
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<CalendarRange className="h-5 w-5 text-muted-foreground" aria-hidden />}
            action={filtering
              ? <Button variant="outline" onClick={clearFilters}>Clear filters</Button>
              : countOf(other.source) > 0
                ? <Button variant="outline" onClick={() => setSource(other.source)}>Show {plural(countOf(other.source), invoices ? 'billing plan month' : 'invoice', other.many)}</Button>
                : undefined}
          >
            {filtering
              ? 'Nothing matches these filters.'
              : invoices
                ? `No invoices dated in ${year}.`
                : `No billing plan months in ${year}. Add a billing plan on a company's page to see what it is expected to pay.`}
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-2">
            <p role="status" className="text-xs tabular-nums text-muted-foreground">
              {plural(shown.length, 'entry', 'entries')} · {plural(new Set(shown.map((r) => r.clientId)).size, 'company', 'companies')}
            </p>
            <div className="overflow-x-auto rounded-lg border border-border" role="region" aria-label={`Accounts for ${year}`} tabIndex={0}>
              <table className="w-full min-w-[44rem] text-sm">
                <thead>
                  <tr className={HEAD_ROW}>
                    <th scope="col" className={TH}>Company</th>
                    <th scope="col" className={TH}>{invoices ? 'Invoice' : 'Plan'}</th>
                    {invoices && <th scope="col" className={TH}>Due date</th>}
                    <th scope="col" className={TH_RIGHT}>Paid</th>
                    <th scope="col" className={TH_RIGHT}>Still to pay</th>
                    <th scope="col" className={TH}>Status</th>
                  </tr>
                </thead>
                {months.map((month, n) => (
                  <tbody key={month.month}>
                    <tr className={`border-b border-border bg-muted/50 ${n > 0 ? 'border-t' : ''}`}>
                      <th scope="colgroup" colSpan={columns} className="px-3 py-1.5 text-left font-normal">
                        <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                          <span className="text-[0.8125rem] font-semibold text-foreground">{monthLabel(month.month)}</span>{' '}
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {plural(month.rows.length, 'entry', 'entries')} · Paid {formatSums(month.paid)} · Still to pay {formatSums(month.remaining)}
                          </span>
                        </span>
                      </th>
                    </tr>
                    {month.rows.map((r) => (
                      <tr key={r.id} className={`${ROW} hover:bg-muted/40`}>
                        <td className={TD}>{company(r)}</td>
                        <td className={TD}>
                          {r.source === 'Invoice'
                            ? <Link to={`/crm/invoices/${r.id}`} className={`font-medium tabular-nums ${LINK}`}>{r.reference}</Link>
                            : <span className="block max-w-72 truncate text-foreground">{r.reference}</span>}
                        </td>
                        {invoices && <td className={TD_DATE}>{shortDate(r.period)}</td>}
                        <td className={`${TD_MONEY} text-muted-foreground`}>{formatMinor(r.paidMinor, r.currency)}</td>
                        <td className={`${TD_MONEY} font-medium`}>{formatMinor(r.remainingMinor, r.currency)}</td>
                        <td className={TD}><PaymentPill status={r.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          </div>
        )}
      </>
    );
  };

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-background">
      <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link to="/crm/invoices"><ArrowLeft aria-hidden /> Invoices</Link>
          </Button>
        </div>
        <PageHeader
          title="Accounts overview"
          description="What every company has paid, what is still to come and what is overdue, for one year."
          actions={
            <>
              <YearSwitcher year={year} onChange={setYear} min={OVERVIEW_YEARS.min} max={OVERVIEW_YEARS.max} disabled={!workspaceId} />
              <Button variant="outline" aria-label="Export CSV" onClick={exportCsv} disabled={!workspaceId || !data}>
                <Download aria-hidden /> Export
              </Button>
            </>
          }
        />
        {content()}
      </div>
    </main>
  );
};

export default AccountsOverviewPage;
