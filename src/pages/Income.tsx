// Income: the money that came in, and the money still to come.
//
// What came in is one list from three places: payments on invoices, payments
// written on a client's services, and other income typed in here (or read from
// a receipt). What is still to come is every issued invoice that is not paid
// in full. For the owner and admins.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Trash2, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import type { Invoice } from '../../api/_signroom/shared/types';
import { AppHeader } from '@/components/layout/AppHeader';
import { PageHeader } from '@/components/common/PageHeader';
import { SetupHint } from '@/components/common/SetupHint';
import { StatStrip } from '@/components/common/StatStrip';
import { StatusPill, type StatusTone } from '@/components/common/StatusPill';
import { IncomeEntryDialog } from '@/components/income/IncomeEntryDialog';
import { EmptyState, HEAD_ROW, PickWorkspace, ROW, TD, TD_DATE, TD_MONEY, TH, TH_RIGHT } from '@/components/signroom/billing/shared';
import { customerName, useBillingClients, useInvoices } from '@/components/signroom/billing/useBilling';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useOrganization } from '@/context/OrganizationContext';
import { useCrmContacts } from '@/hooks/useCrmHub';
import { useOrgCurrency } from '@/hooks/useOrgCurrency';
import { useSignroom } from '@/hooks/useSignroom';
import { formatCurrency } from '@/lib/crmCurrency';
import { leadName } from '@/lib/crmFlow';
import {
  SOURCE_LABEL, incomeTotals, monthSeries, receivedRows, upcomingRows, type IncomeEntry, type IncomeSource, type ReceivedRow,
} from '@/lib/income';
import { publicMessage } from '@/lib/publicError';
import { billingToday, shortDate } from '@/lib/signroom/billing';
import { listAccountPayments, listClientAccounts } from '@/services/supabase/crmHub/accounts';
import { deleteIncomeEntry, listIncomeEntries } from '@/services/supabase/income';
import type { CrmAccountPayment, CrmClientAccount } from '@/types/crmHub';

const SOURCE_TONE: Record<IncomeSource, StatusTone> = { invoice: 'info', service: 'neutral', other: 'success' };
const SELECT = 'h-11 md:h-8 rounded-md border border-input bg-background px-2 text-sm';
const money = (amount: number, currency: string): string => formatCurrency(amount, currency, { maximumFractionDigits: 2 });

export const Income: React.FC<{
  /** Inside the HR page: without the page's own top bar. */
  embedded?: boolean;
}> = ({ embedded = false }) => {
  const { organization, isAdmin } = useOrganization();
  const { workspaceId } = useSignroom();
  const companyCurrency = useOrgCurrency();
  const organizationId = organization?.organizationId ?? '';

  const shell = (children: React.ReactNode) => (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {!embedded && <AppHeader left={<span className="text-sm font-semibold">Income</span>} />}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">{children}</div>
      </div>
    </main>
  );
  const header = (actions?: React.ReactNode) => (
    <PageHeader
      title="Income"
      description="Money that came in, and money still to come from invoices that are not paid yet."
      actions={actions}
    />
  );

  if (!isAdmin) return shell(<>{header()}<EmptyState>Only the owner and admins can see income.</EmptyState></>);
  if (!workspaceId) return shell(<>{header()}<PickWorkspace what="its income" /></>);
  return shell(<IncomeBody key={workspaceId} organizationId={organizationId} workspaceId={workspaceId} companyCurrency={companyCurrency} header={header} />);
};

const IncomeBody: React.FC<{
  organizationId: string;
  workspaceId: string;
  companyCurrency: string;
  header: (actions?: React.ReactNode) => React.ReactNode;
}> = ({ organizationId, workspaceId, companyCurrency, header }) => {
  const { invoices, loading: loadingInvoices, error: invoicesError } = useInvoices();
  const { byId: clientsById } = useBillingClients();
  const { items: contacts } = useCrmContacts();

  const [accounts, setAccounts] = useState<CrmClientAccount[]>([]);
  const [payments, setPayments] = useState<CrmAccountPayment[]>([]);
  const [entries, setEntries] = useState<IncomeEntry[]>([]);
  /** False when other income cannot be kept yet (the table is not in the database). */
  const [entriesReady, setEntriesReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('received');
  const [year, setYear] = useState(() => Number(billingToday().slice(0, 4)));
  const [source, setSource] = useState<'all' | IncomeSource>('all');
  const [search, setSearch] = useState('');
  /** The window for other income: open for a new entry (null inside) or the one being changed. */
  const [editing, setEditing] = useState<{ entry: IncomeEntry | null } | null>(null);
  const [removing, setRemoving] = useState<IncomeEntry | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    // Each part on its own: one that cannot be read does not hide the others.
    const [own, other] = await Promise.all([
      (async () => {
        const all = await listClientAccounts(workspaceId);
        return { all, paid: all.length ? await listAccountPayments(workspaceId) : [] };
      })().catch(() => null),
      listIncomeEntries(workspaceId).catch(() => null),
    ]);
    if (own) { setAccounts(own.all); setPayments(own.paid); }
    if (other) { setEntries(other.entries); setEntriesReady(other.ready); }
    if (!own || !other) toast.error('Some of the income could not be loaded. Please try again.');
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const today = billingToday();
  const nameOf = useCallback((invoice: Invoice) => customerName(invoice, clientsById), [clientsById]);
  const contactById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);

  const received = useMemo(() => receivedRows({
    invoices, nameOf, accounts, payments, entries, companyCurrency,
    clientOf: (account) => { const lead = contactById.get(account.contactId); return lead ? leadName(lead) : ''; },
  }), [invoices, nameOf, accounts, payments, entries, companyCurrency, contactById]);
  const upcoming = useMemo(() => upcomingRows(invoices, today, nameOf), [invoices, today, nameOf]);
  const totals = useMemo(() => incomeTotals(received, upcoming, today, companyCurrency), [received, upcoming, today, companyCurrency]);
  const months = useMemo(() => monthSeries(received, year, companyCurrency), [received, year, companyCurrency]);
  const yearTotal = useMemo(
    () => incomeTotals(received.filter((row) => row.date.startsWith(String(year))), [], `${year}-12-31`, companyCurrency).thisYear,
    [received, year, companyCurrency],
  );

  const shown = useMemo(() => {
    const words = search.trim().toLowerCase();
    return received.filter((row) => {
      if (!row.date.startsWith(String(year))) return false;
      if (source !== 'all' && row.source !== source) return false;
      return !words || `${row.title} ${row.who} ${row.reference} ${row.method}`.toLowerCase().includes(words);
    });
  }, [received, year, source, search]);

  const entryById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  const thisYear = Number(today.slice(0, 4));

  const remove = async () => {
    if (!removing) return;
    try {
      await deleteIncomeEntry(removing.id);
      toast.success('Income deleted');
      setRemoving(null);
      await load(true);
    } catch (error) {
      toast.error(publicMessage(error, 'The income could not be deleted. Please try again.'));
    }
  };

  const busy = loading || loadingInvoices;

  return (
    <>
      {header(
        <Button onClick={() => setEditing({ entry: null })} disabled={!entriesReady}><Plus aria-hidden />Add income</Button>,
      )}

      {!entriesReady && (
        <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-muted-foreground">
          <SetupHint other="Adding other income is not switched on yet. Invoices and client services are counted.">
            Other income cannot be saved until the database has the income table: run supabase/crm_setup.sql in the Supabase SQL editor, then reload.
          </SetupHint>
        </p>
      )}
      {invoicesError && <p role="alert" className="text-sm text-destructive">The invoices could not be loaded, so their payments are missing here.</p>}

      <StatStrip
        items={[
          { label: 'Received this month', value: totals.thisMonth, tone: 'success' },
          { label: `Received in ${thisYear}`, value: totals.thisYear },
          {
            label: 'Upcoming', value: totals.upcoming,
            note: totals.upcomingCount ? `${totals.upcomingCount} ${totals.upcomingCount === 1 ? 'invoice' : 'invoices'} issued, not paid yet` : 'No invoice is waiting to be paid',
          },
          {
            label: 'Overdue', value: totals.overdue, tone: totals.overdueCount ? 'danger' : 'default',
            note: totals.overdueCount ? `${totals.overdueCount} past the due date` : 'Nothing is late',
          },
        ]}
      />

      <section aria-label={`Income in ${year}, month by month`} className="rounded-lg border border-border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <p className="text-sm font-medium text-foreground">
            {year} <span className="font-normal text-muted-foreground">· {yearTotal} received</span>
          </p>
          <div className="inline-flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label="The year before" onClick={() => setYear((y) => y - 1)}><ChevronLeft aria-hidden /></Button>
            <Button variant="outline" size="icon" aria-label="The year after" disabled={year >= thisYear} onClick={() => setYear((y) => y + 1)}><ChevronRight aria-hidden /></Button>
          </div>
        </div>
        <ol className="grid grid-cols-3 gap-2 px-4 py-3 sm:grid-cols-6 xl:grid-cols-12">
          {months.map((month) => (
            <li key={month.month} className="min-w-0 rounded-md bg-secondary px-1 py-2 text-center">
              <span className="block text-[0.6875rem] text-muted-foreground">{month.label}</span>
              <span className="block truncate text-xs font-medium tabular-nums" title={month.text}>{month.text}</span>
            </li>
          ))}
        </ol>
      </section>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="received">Received <span className="ml-1.5 tabular-nums text-muted-foreground">{shown.length}</span></TabsTrigger>
          <TabsTrigger value="upcoming">Upcoming <span className="ml-1.5 tabular-nums text-muted-foreground">{upcoming.length}</span></TabsTrigger>
        </TabsList>

        <TabsContent value="received" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 pt-3">
            <Input aria-label="Search" placeholder="Search what for, who paid or a reference" className="h-11 w-full sm:w-80 md:h-8" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select aria-label="Where it came from" className={SELECT} value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
              <option value="all">Everything</option>
              <option value="invoice">Invoices</option>
              <option value="service">Client services</option>
              <option value="other">Other income</option>
            </select>
          </div>
          {busy ? (
            <div className="py-16 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading income" /></div>
          ) : shown.length === 0 ? (
            <EmptyState icon={<TrendingUp className="h-5 w-5 text-muted-foreground" aria-hidden />}>
              {received.length === 0
                ? 'Nothing has come in yet. A payment on an invoice or on a client’s service shows here by itself.'
                : `Nothing matches in ${year}.`}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[56rem] text-sm" aria-label={`Money received in ${year}`}>
                <thead>
                  <tr className={HEAD_ROW}>
                    <th scope="col" className={TH}>Date</th>
                    <th scope="col" className={TH}>What for</th>
                    <th scope="col" className={TH}>From</th>
                    <th scope="col" className={TH}>Came from</th>
                    <th scope="col" className={TH}>Method</th>
                    <th scope="col" className={TH}>Reference</th>
                    <th scope="col" className={TH_RIGHT}>Amount</th>
                    <th scope="col" className={TH_RIGHT}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => <ReceivedLine key={row.id} row={row} entry={row.entryId ? entryById.get(row.entryId) : undefined} onEdit={(entry) => setEditing({ entry })} onRemove={setRemoving} />)}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="upcoming" className="space-y-3">
          <p className="pt-3 text-sm text-muted-foreground">Every invoice that was issued and is not paid in full, with what is left on it. It moves to Received when its payment is recorded.</p>
          {busy ? (
            <div className="py-16 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading income" /></div>
          ) : upcoming.length === 0 ? (
            <EmptyState icon={<TrendingUp className="h-5 w-5 text-muted-foreground" aria-hidden />} action={<Button asChild variant="outline"><Link to="/crm/invoices">Open invoices</Link></Button>}>
              No invoice is waiting to be paid. When you issue an invoice, what it is for shows here until it is paid.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[44rem] text-sm" aria-label="Money still to come">
                <thead>
                  <tr className={HEAD_ROW}>
                    <th scope="col" className={TH}>Invoice</th>
                    <th scope="col" className={TH}>Company</th>
                    <th scope="col" className={TH}>Due date</th>
                    <th scope="col" className={TH}>Status</th>
                    <th scope="col" className={TH_RIGHT}>Left to pay</th>
                  </tr>
                </thead>
                <tbody>
                  {upcoming.map((row) => (
                    <tr key={row.id} className={ROW} aria-label={`${row.number}, ${row.who}`}>
                      <td className={TD}><Link to={row.href} className="font-medium tabular-nums text-foreground hover:underline">{row.number}</Link></td>
                      <td className={TD}>{row.who || <span className="text-muted-foreground">—</span>}</td>
                      <td className={TD_DATE}>{shortDate(row.dueDate)}</td>
                      <td className={TD}>{row.overdue ? <StatusPill tone="danger">Overdue</StatusPill> : <StatusPill tone="info">Due</StatusPill>}</td>
                      <td className={`${TD_MONEY} font-medium`}>{money(row.amount, row.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <IncomeEntryDialog
        open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}
        organizationId={organizationId} workspaceId={workspaceId} entry={editing?.entry ?? null} onSaved={() => load(true)}
      />

      <AlertDialog open={removing !== null} onOpenChange={(open) => { if (!open) setRemoving(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this income?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing && `${money(removing.amount, removing.currency)} for “${removing.title}” on ${shortDate(removing.receivedOn)} is removed from your income. This cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={(event) => { event.preventDefault(); void remove(); }}>
              Delete income
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

const ReceivedLine: React.FC<{
  row: ReceivedRow;
  entry: IncomeEntry | undefined;
  onEdit: (entry: IncomeEntry) => void;
  onRemove: (entry: IncomeEntry) => void;
}> = ({ row, entry, onEdit, onRemove }) => (
  <tr className={ROW} aria-label={`${row.title}, ${shortDate(row.date)}`}>
    <td className={TD_DATE}>{shortDate(row.date)}</td>
    <td className={`${TD} max-w-[18rem]`}>
      {row.href
        ? <Link to={row.href} className="block truncate font-medium text-foreground hover:underline" title={row.title}>{row.title}</Link>
        : <span className="block truncate font-medium text-foreground" title={row.title}>{row.title}</span>}
    </td>
    <td className={`${TD} max-w-[14rem]`}><span className="block truncate" title={row.who}>{row.who || <span className="text-muted-foreground">—</span>}</span></td>
    <td className={TD}><StatusPill tone={SOURCE_TONE[row.source]} dot={false}>{SOURCE_LABEL[row.source]}</StatusPill></td>
    <td className={TD}>{row.method || <span className="text-muted-foreground">—</span>}</td>
    <td className={`${TD} max-w-[12rem]`}><span className="block truncate tabular-nums" title={row.reference}>{row.reference || <span className="text-muted-foreground">—</span>}</span></td>
    <td className={`${TD_MONEY} font-medium`}>{money(row.amount, row.currency)}</td>
    <td className="whitespace-nowrap px-3 py-1.5 text-right">
      {entry && (
        <>
          <Button size="icon" variant="ghost" aria-label={`Edit ${entry.title}`} title="Edit" onClick={() => onEdit(entry)}><Pencil aria-hidden /></Button>
          <Button size="icon" variant="ghost" aria-label={`Delete ${entry.title}`} title="Delete" onClick={() => onRemove(entry)}><Trash2 aria-hidden /></Button>
        </>
      )}
    </td>
  </tr>
);

export default Income;
