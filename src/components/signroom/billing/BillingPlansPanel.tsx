// A company's billing plans for one year: what each month expects, what has been paid, and what is late.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, ArchiveRestore, Download, MoreHorizontal, Pencil, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { balance } from '../../../../api/_signroom/shared/invoiceMath';
import type { Client, ClientProject, Invoice, ProjectList, ProjectYear } from '../../../../api/_signroom/shared/types';
import { useCrmCurrency } from '@/context/CrmCurrencyContext';
import { useSignroom } from '@/hooks/useSignroom';
import {
  anyAbove, billingToday, defaultInvoiceCurrency, errorSentence, errorStatus, formatMinor, formatSums, shortDate,
} from '@/lib/signroom/billing';
import { csvText, saveTextFile } from '@/lib/signroom/billingCsv';
import {
  MONTH_NAMES, PAYMENT_FILTERS, PLAN_YEARS, STATUS_WORD, filterPlans, monthBody, monthKey, monthResetBody, monthStatus,
  monthTotals, planHasPayment, planTotals, planTypeLabel, plansCsvRows, shortMonth,
  type MonthInput, type PaymentFilter, type PlanBody,
} from '@/lib/signroom/billingPlans';
import { clientForCompany } from '@/services/signroom/clients';
import { cn } from '@/lib/utils';
import { StatStrip } from '@/components/common/StatStrip';
import { StatusPill } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PlanDialog } from './PlanDialog';
import { PlanMonthDialog } from './PlanMonthDialog';
import { PaymentPill, SumLines, YearSwitcher, chipClass } from './planShared';
import { Card, HEAD_ROW, InvoiceStatus, PickWorkspace, ROW, TD, TD_DATE, TD_MONEY, TH, TH_RIGHT } from './shared';
import { useBillingClients, useServerData } from './useBilling';

export interface BillingPlansPanelProps {
  /** CRM company id. */
  companyId: string;
  /** The company's name, for headings and the export. */
  companyName: string;
}

/** The dialog that is open: a plan being added (`id` null) or changed, or one month of a plan. */
type Open = { kind: 'plan'; id: string | null } | { kind: 'month'; id: string; month: number } | null;

const CHANGED_ELSEWHERE = 'This plan was changed somewhere else. The latest version is shown now, so make your change again.';

const FILTER_WORDS: Record<PaymentFilter, string> = {
  all: '',
  paid: ' with a paid month',
  upcoming: ' with a month still to come',
  overdue: ' with an overdue month',
};

// The grid keeps its first column in place while the months scroll, so borders sit on the cells.
const CELL = 'border-b border-border px-2 py-1.5 align-top';
const HEAD = 'whitespace-nowrap border-b border-border px-2 py-2 text-xs font-medium text-muted-foreground';
const STICKY = 'sticky left-0 z-10 w-56 min-w-56 max-w-56 border-r border-border bg-card pl-4 text-left';
const NUMBER = 'whitespace-nowrap text-right tabular-nums';
const NOTE = 'px-4 py-6 text-center text-sm';

export const BillingPlansPanel: React.FC<BillingPlansPanelProps> = ({ companyId, companyName }) => {
  const { client, workspaceId } = useSignroom();
  const { code: companyCurrency } = useCrmCurrency();
  const { clients, loading: loadingClients, error: clientsError } = useBillingClients();
  // The company's customer record is only made when its first plan is added, never by looking.
  const [made, setMade] = useState<Client | null>(null);
  const customer = clients.find((c) => c.crmCompanyId === companyId) ?? (made?.crmCompanyId === companyId ? made : null);

  const today = billingToday();
  const currentMonth = today.slice(0, 7);
  const [year, setYear] = useState(() => Number(today.slice(0, 4)));
  const list = useServerData<ProjectList>(customer ? `client-projects/${customer.id}?year=${year}` : null);
  const plans = list.data?.projects ?? [];

  // Linked invoices are only worth asking for once the company has a plan.
  const [hasPlans, setHasPlans] = useState(false);
  useEffect(() => { if (plans.length > 0) setHasPlans(true); }, [plans.length]);
  const invoices = useServerData<Invoice[]>(customer && hasPlans ? `billing?${new URLSearchParams({ companyId }).toString()}` : null);

  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState('');
  const [payment, setPayment] = useState<PaymentFilter>('all');
  const [open, setOpen] = useState<Open>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  const archivedCount = plans.filter((p) => p.archived).length;
  useEffect(() => {
    if (showArchived && list.data && archivedCount === 0) setShowArchived(false);
  }, [showArchived, list.data, archivedCount]);

  const scoped = filterPlans(plans, { archived: showArchived, query });
  const shown = scoped.filter((p) => planHasPayment(p, payment, year, currentMonth));
  const totals = planTotals(shown, year, currentMonth);
  const feet = shown.length > 1 ? monthTotals(shown) : [];
  const shownIds = new Set(shown.map((p) => p.id));
  const linked = (invoices.data ?? [])
    .filter((i) => i.projectId && shownIds.has(i.projectId))
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number));
  const planName = (id: string | undefined) => plans.find((p) => p.id === id)?.name ?? '';

  const filtering = payment !== 'all' || Boolean(query.trim());
  const locked = busy || Boolean(customer?.archived);
  const ready = Boolean(workspaceId) && !clientsError && !loadingClients && !list.notSetUp && !(list.error && !list.data);
  const openPlan = open?.id ? plans.find((p) => p.id === open.id) ?? null : null;

  const show = (next: Open) => { setProblem(''); setOpen(next); };

  /**
   * One change to a plan. When the server says the plan changed somewhere else
   * (409) the list is read again, so the form starts over from the latest version.
   */
  const change = async (planId: string | null, body: object, done: string, inDialog: boolean) => {
    setBusy(true);
    setProblem('');
    const before = plans.find((p) => p.id === planId)?.revision;
    try {
      let target = customer;
      if (!target) {
        target = await clientForCompany(client, companyId);
        setMade(target);
      }
      const base = `client-projects/${target.id}`;
      await client.call<ClientProject>(planId ? `${base}/${planId}` : base, body, planId ? 'PATCH' : 'POST');
      toast.success(done);
      setOpen(null);
      if (customer) await list.reload();
    } catch (error) {
      let sentence = errorSentence(error);
      let stillThere = true;
      if (errorStatus(error) === 409 && customer) {
        const fresh = await list.reload();
        const now = fresh?.projects.find((p) => p.id === planId);
        if (fresh && planId && !now) stillThere = false;
        else if (now && now.revision !== before) sentence = CHANGED_ELSEWHERE;
      }
      if (inDialog && stillThere) {
        setProblem(sentence);
      } else {
        setOpen(null);
        toast.error(sentence);
      }
    } finally {
      setBusy(false);
    }
  };

  const savePlan = (body: PlanBody) => {
    if (openPlan) void change(openPlan.id, { ...body, revision: openPlan.revision }, 'Billing plan saved.', true);
    else void change(null, body, 'Billing plan added.', true);
  };
  const saveMonth = (input: MonthInput) => {
    if (open?.kind !== 'month' || !openPlan) return;
    void change(openPlan.id, monthBody(monthKey(year, open.month), input, openPlan.revision), 'Month saved.', true);
  };
  const resetMonth = () => {
    if (open?.kind !== 'month' || !openPlan) return;
    void change(openPlan.id, monthResetBody(monthKey(year, open.month), openPlan.revision), 'Month put back to what the plan expects.', true);
  };
  const archive = (p: ProjectYear) => void change(
    p.id,
    { action: p.archived ? 'restore' : 'archive', revision: p.revision },
    p.archived ? 'Plan restored.' : 'Plan archived. Its invoices and receipts are kept.',
    false,
  );

  const exportCsv = () => saveTextFile(`billing-plans-${year}.csv`, csvText(plansCsvRows(shown, companyName, year)));

  const addButton = (
    <Button size="sm" onClick={() => show({ kind: 'plan', id: null })} disabled={!ready || locked}>
      <Plus aria-hidden /> Add billing plan
    </Button>
  );

  const body = () => {
    if (!workspaceId) return <PickWorkspace compact what="this company's billing plans" />;
    if (clientsError) return <p role="alert" className={`${NOTE} text-destructive`}>{clientsError}</p>;
    if (list.notSetUp) return <p role="status" className={`${NOTE} text-muted-foreground`}>{list.error}</p>;
    if (list.error && !list.data) return <p role="alert" className={`${NOTE} text-destructive`}>{list.error}</p>;
    if ((!customer && loadingClients) || (customer && !list.data)) {
      return <p role="status" className={`${NOTE} text-muted-foreground`}>Loading billing plans</p>;
    }
    if (plans.length === 0) {
      return (
        <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
          <p className="max-w-md text-sm text-muted-foreground">
            No billing plans for this company yet. A plan sets what you expect to be paid each month, so you can see what
            has come in and what is late.
          </p>
          {addButton}
        </div>
      );
    }
    return (
      <>
        {list.error && <p role="alert" className="border-b border-border px-4 py-2 text-sm text-destructive">{list.error}</p>}
        {customer?.archived && (
          <p className="border-b border-border px-4 py-2 text-sm text-muted-foreground">
            This company&apos;s billing record is archived, so its plans cannot be changed.
          </p>
        )}
        <div className="flex flex-col gap-3 p-4">
          <StatStrip
            items={[
              {
                label: `Target for ${year}`,
                value: <SumLines sums={totals.target} />,
                note: anyAbove(totals.leftOfTarget)
                  ? `${formatSums(totals.leftOfTarget)} left to reach it`
                  : anyAbove(totals.target) ? 'Target reached' : undefined,
              },
              { label: 'Paid', value: <SumLines sums={totals.paid} />, tone: anyAbove(totals.paid) ? 'success' : 'default', note: 'Receipts and amounts entered' },
              { label: 'Still to come', value: <SumLines sums={totals.stillToCome} />, note: 'This month and later' },
              { label: 'Overdue', value: <SumLines sums={totals.overdue} />, tone: anyAbove(totals.overdue) ? 'danger' : 'default', note: 'Months that have ended' },
              { label: 'Unpaid invoices', value: <SumLines sums={totals.unpaidInvoices} />, note: 'On invoices linked to a plan' },
            ]}
          />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by payment">
              {PAYMENT_FILTERS.map((f) => (
                <button key={f} type="button" className={chipClass(payment === f)} aria-pressed={payment === f} onClick={() => setPayment(f)}>
                  {f === 'all' ? 'All' : STATUS_WORD[f]}{' '}
                  <span className="tabular-nums opacity-70">{scoped.filter((p) => planHasPayment(p, f, year, currentMonth)).length}</span>
                </button>
              ))}
            </div>
            {(archivedCount > 0 || showArchived) && (
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Active or archived">
                {[false, true].map((archived) => (
                  <button
                    key={String(archived)} type="button" className={chipClass(showArchived === archived)}
                    aria-pressed={showArchived === archived} onClick={() => setShowArchived(archived)}
                  >
                    {archived ? 'Archived' : 'Active'}{' '}
                    <span className="tabular-nums opacity-70">{archived ? archivedCount : plans.length - archivedCount}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="relative min-w-48 max-w-xs flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8"
                placeholder="Search name or notes" aria-label="Search billing plans"
              />
            </div>
          </div>
          {filtering && (
            <p role="status" className="text-xs text-muted-foreground">
              Showing {shown.length} of {scoped.length} {scoped.length === 1 ? 'plan' : 'plans'}{FILTER_WORDS[payment]} in {year}.
              {' '}The totals and the export follow these filters.
            </p>
          )}
        </div>

        {shown.length === 0 ? (
          <div className="flex flex-col items-center gap-3 border-t border-border px-4 py-8 text-center">
            <p className="max-w-md text-sm text-muted-foreground">
              {filtering
                ? 'No plans match these filters.'
                : showArchived ? 'No archived plans.' : 'No active plans. Archived plans are kept under Archived.'}
            </p>
            {filtering && <Button variant="outline" size="sm" onClick={() => { setPayment('all'); setQuery(''); }}>Clear filters</Button>}
          </div>
        ) : (
          <div
            className="overflow-x-auto border-t border-border" role="region" tabIndex={0}
            aria-label={`Billing plans for ${year}`} aria-busy={list.loading}
          >
            <table className="w-full border-separate border-spacing-0 text-[0.8125rem]">
              <thead>
                <tr>
                  <th scope="col" className={cn(HEAD, STICKY)}>Plan</th>
                  {MONTH_NAMES.map((name, m) => (
                    <th
                      key={name} scope="col"
                      aria-current={monthKey(year, m) === currentMonth ? 'date' : undefined}
                      className={cn(HEAD, 'min-w-[5.5rem] text-right', monthKey(year, m) === currentMonth && 'bg-muted/60 text-foreground')}
                    >
                      {name}
                    </th>
                  ))}
                  <th scope="col" className={cn(HEAD, 'border-l text-right')}>Target</th>
                  <th scope="col" className={cn(HEAD, 'text-right')}>Paid</th>
                  <th scope="col" className={cn(HEAD, 'text-right')}>Left of target</th>
                  <th scope="col" className={cn(HEAD, 'text-right')}>Unpaid invoices</th>
                  <th scope="col" className={HEAD}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const money = (minor: number) => formatMinor(minor, p.currency);
                  const amount = p.billingType === 'Monthly'
                    ? `${money(p.monthlyFeeMinor)} a month`
                    : p.contractValueMinor > 0 ? money(p.contractValueMinor) : '';
                  return (
                    <tr key={p.id}>
                      <th scope="row" className={cn(CELL, STICKY, 'font-normal')}>
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <button
                            type="button" disabled={locked} onClick={() => show({ kind: 'plan', id: p.id })}
                            className="truncate rounded-md text-left text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {p.name}
                          </button>
                          <span className="truncate text-xs text-muted-foreground">{planTypeLabel(p)}{amount && ' · '}{amount}</span>
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {p.endMonth ? `${shortMonth(p.startMonth)} to ${shortMonth(p.endMonth)}` : `From ${shortMonth(p.startMonth)}`}
                          </span>
                          {(p.status !== 'Active' || p.archived) && (
                            <span className="flex flex-wrap gap-1 pt-0.5">
                              {p.status !== 'Active' && <StatusPill tone={p.status === 'On hold' ? 'warning' : 'muted'}>{p.status}</StatusPill>}
                              {p.archived && <StatusPill tone="muted">Archived</StatusPill>}
                            </span>
                          )}
                          {p.notes && <span className="truncate text-xs text-muted-foreground" title={p.notes}>{p.notes}</span>}
                        </div>
                      </th>
                      {p.months.map((paid, m) => {
                        const status = monthStatus(p, m, year, currentMonth);
                        return (
                          <td key={m} className={cn('border-b border-border p-0.5 align-top', monthKey(year, m) === currentMonth && 'bg-muted/40')}>
                            <button
                              type="button" disabled={locked || p.archived} onClick={() => show({ kind: 'month', id: p.id, month: m })}
                              className="flex min-h-16 w-full flex-col items-end gap-0.5 rounded-md px-1.5 py-1 text-right transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
                            >
                              <span className="sr-only">Edit {MONTH_NAMES[m]} {year} for {p.name}</span>
                              {status === 'neutral' ? (
                                <span aria-hidden className="text-muted-foreground">—</span>
                              ) : (
                                <>
                                  <span className="font-medium tabular-nums text-foreground">{money(paid)}</span>
                                  <span className="whitespace-nowrap text-[0.6875rem] tabular-nums text-muted-foreground">of {money(p.expectedMonths[m] ?? 0)}</span>
                                  <PaymentPill status={status} dot={false} />
                                </>
                              )}
                            </button>
                          </td>
                        );
                      })}
                      <td className={cn(CELL, NUMBER, 'border-l')}>{money(p.targetMinor)}</td>
                      <td className={cn(CELL, NUMBER, 'font-medium')}>{money(p.receivedMinor)}</td>
                      <td className={cn(CELL, NUMBER)}>{money(p.remainingTargetMinor)}</td>
                      <td className={cn(CELL, NUMBER)}>{money(p.outstandingMinor)}</td>
                      <td className="border-b border-border px-1 py-1 text-right align-top">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost" aria-label={`More actions for ${p.name}`} disabled={locked}><MoreHorizontal /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => show({ kind: 'plan', id: p.id })}><Pencil aria-hidden /> Edit plan</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => archive(p)}>
                              {p.archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
                              {p.archived ? 'Restore plan' : 'Archive plan'}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {feet.length > 0 && (
                <tfoot>
                  {feet.map((foot) => {
                    const money = (minor: number) => formatMinor(minor, foot.currency);
                    return (
                      <tr key={foot.currency} className="text-xs">
                        <th scope="row" className={cn(CELL, STICKY, 'font-medium text-foreground')}>Total {foot.currency}</th>
                        {foot.paid.map((paid, m) => (
                          <td key={m} className={cn(CELL, NUMBER, monthKey(year, m) === currentMonth && 'bg-muted/40')}>
                            {paid === 0 && foot.expected[m] === 0 ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <>
                                <span className="block font-medium text-foreground">{money(paid)}</span>
                                <span className="block text-[0.6875rem] text-muted-foreground">of {money(foot.expected[m] ?? 0)}</span>
                              </>
                            )}
                          </td>
                        ))}
                        <td className={cn(CELL, NUMBER, 'border-l')}>{money(totals.target[foot.currency] ?? 0)}</td>
                        <td className={cn(CELL, NUMBER, 'font-medium')}>{money(totals.paid[foot.currency] ?? 0)}</td>
                        <td className={cn(CELL, NUMBER)}>{money(totals.leftOfTarget[foot.currency] ?? 0)}</td>
                        <td className={cn(CELL, NUMBER)}>{money(totals.unpaidInvoices[foot.currency] ?? 0)}</td>
                        <td className={CELL} />
                      </tr>
                    );
                  })}
                </tfoot>
              )}
            </table>
          </div>
        )}

        <div className="flex flex-col gap-4 p-4">
          <p className="max-w-3xl text-xs text-muted-foreground">
            Select a month to change what it expects, or to enter a payment that has no invoice. Paid adds up the receipts
            on linked invoices and the amounts entered here. A month is overdue once it has ended with something still to pay.
          </p>

          {invoices.data && shown.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-foreground">Linked invoices</h3>
              {linked.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No invoices are linked to {shown.length === 1 ? 'this plan' : 'these plans'} yet. Open a draft invoice to link it to a plan.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-md border border-border" role="region" aria-label="Invoices linked to these plans" tabIndex={0}>
                  <table className="w-full min-w-[40rem] text-sm">
                    <thead>
                      <tr className={HEAD_ROW}>
                        <th scope="col" className={TH}>Invoice</th>
                        <th scope="col" className={TH}>Plan</th>
                        <th scope="col" className={TH}>Status</th>
                        <th scope="col" className={TH}>Invoice date</th>
                        <th scope="col" className={TH_RIGHT}>Total</th>
                        <th scope="col" className={TH_RIGHT}>Outstanding</th>
                      </tr>
                    </thead>
                    <tbody>
                      {linked.map((i) => (
                        <tr key={i.id} className={ROW}>
                          <td className={TD}>
                            <Link to={`/crm/invoices/${i.id}`} className="font-medium tabular-nums text-foreground hover:underline">{i.number}</Link>
                          </td>
                          <td className={`${TD} text-muted-foreground`}>{planName(i.projectId)}</td>
                          <td className={TD}><InvoiceStatus invoice={i} today={today} /></td>
                          <td className={TD_DATE}>{shortDate(i.issueDate)}</td>
                          <td className={`${TD_MONEY} font-medium`}>{formatMinor(i.totalMinor, i.currency)}</td>
                          <td className={TD_MONEY}>
                            {i.status === 'Voided'
                              ? <span className="text-muted-foreground">Voided</span>
                              : formatMinor(balance(i), i.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </>
    );
  };

  return (
    <>
      <Card
        title="Billing plans"
        count={list.data && plans.length > 0 ? scoped.length : undefined}
        className="min-w-0"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <YearSwitcher compact year={year} onChange={setYear} min={PLAN_YEARS.min} max={PLAN_YEARS.max} disabled={!workspaceId} />
            <Button size="sm" variant="outline" aria-label="Export CSV" onClick={exportCsv} disabled={shown.length === 0}>
              <Download aria-hidden /> Export
            </Button>
            {addButton}
          </div>
        }
      >
        {body()}
      </Card>

      <PlanDialog
        open={open?.kind === 'plan' && (open.id === null || openPlan !== null)}
        plan={openPlan}
        companyName={companyName}
        start={{ currency: defaultInvoiceCurrency(customer?.account?.currency, companyCurrency, 'GBP'), startMonth: currentMonth }}
        busy={busy}
        error={problem}
        onClose={() => setOpen(null)}
        onSave={savePlan}
      />
      <PlanMonthDialog
        open={open?.kind === 'month'}
        plan={open?.kind === 'month' ? openPlan : null}
        year={year}
        monthIndex={open?.kind === 'month' ? open.month : 0}
        busy={busy}
        error={problem}
        onClose={() => setOpen(null)}
        onSave={saveMonth}
        onReset={resetMonth}
      />
    </>
  );
};

export default BillingPlansPanel;
