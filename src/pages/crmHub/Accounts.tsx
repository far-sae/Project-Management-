// Accounts: every client's services in one place. For a chosen month it shows
// what each service is charged, what was paid for that month, what is still
// owed from before and what to collect, like a collections sheet. A second
// view shows a whole year, one column for each month.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, CreditCard, Download, FileText, Loader2, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/PageHeader';
import { StatStrip, type StatItem } from '@/components/common/StatStrip';
import { StatusPill, type StatusTone } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/context/AuthContext';
import { useCrmCurrency } from '@/context/CrmCurrencyContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useCrmCompanies, useCrmContacts } from '@/hooks/useCrmHub';
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
import {
  COLLECTION_STATUS_LABEL, collectionRow, collectionsTotals, monthKey, monthLabel, nextMonth, previousMonth, yearRow,
  sheetCsv, type CollectionRow, type CollectionStatus,
} from '@/lib/crmCollections';
import { leadName } from '@/lib/crmFlow';
import { accountCurrency, formatByCurrency, formatCurrency } from '@/lib/crmCurrency';
import { publicMessage } from '@/lib/publicError';
import { addAccountPayment, listAccountPayments, listClientAccounts } from '@/services/supabase/crmHub/accounts';
import { PAYMENT_METHODS } from '@/components/crmHub/ClientAccountsTab';
import { ServiceDialog, type ServiceClient } from '@/components/crmHub/ServiceDialog';
import { NewInvoiceDialog, type InvoiceService } from '@/components/signroom/billing/NewInvoiceDialog';
import type { CrmAccountPayment, CrmClientAccount } from '@/types/crmHub';

const SELECT = 'h-11 md:h-8 rounded-md border border-input bg-background px-2 text-sm';
const HEAD = 'h-10 border-b border-border bg-surface-2 text-xs text-muted-foreground';
const STATUS_TONE: Record<CollectionStatus, StatusTone> = { paid: 'success', part: 'warning', due: 'info', overdue: 'danger', none: 'muted', setup: 'warning' };
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type View = 'month' | 'year';
type StatusFilter = 'all' | 'collect' | CollectionStatus;

const today = (): string => new Date().toISOString().slice(0, 10);
const dayWords = (iso: string): string => `${Number(iso.slice(8, 10))} ${SHORT[Number(iso.slice(5, 7)) - 1]}`;

/** A value for a CSV cell: quoted when it holds a comma, a quote or a line break. */
const cell = (value: string | number): string => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const CrmAccountsPage: React.FC = () => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const { selected } = useSelectedWorkspace();
  // The company's currency. A service may be in another one: its row is then
  // written in that, and a total never adds two currencies together.
  const { code: companyCurrency } = useCrmCurrency();
  const moneyOf = useCallback(
    (account: CrmClientAccount) => (amount: number) => formatCurrency(amount, accountCurrency(account, companyCurrency)),
    [companyCurrency],
  );
  const sumOf = useCallback(
    (list: CollectionRow[], pick: (row: CollectionRow) => number) =>
      formatByCurrency(list.map((row) => ({ amount: pick(row), currency: accountCurrency(row.account, companyCurrency) })), companyCurrency),
    [companyCurrency],
  );
  const { items: contacts } = useCrmContacts();
  const { items: companies } = useCrmCompanies();
  const workspaceId = selected?.workspaceId ?? '';
  const organizationId = organization?.organizationId ?? '';

  const [accounts, setAccounts] = useState<CrmClientAccount[]>([]);
  const [payments, setPayments] = useState<CrmAccountPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [view, setView] = useState<View>('month');
  const [search, setSearch] = useState('');
  const [type, setType] = useState<'all' | 'monthly' | 'one_time'>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [paying, setPaying] = useState<CollectionRow | null>(null);
  /** The month a payment is being recorded for, when a month of the sheet was pressed. Null: the month on screen. */
  const [payingMonth, setPayingMonth] = useState<string | null>(null);
  /** The service window: open for a new service (null inside) or for the one being changed. */
  const [service, setService] = useState<{ account: CrmClientAccount | null } | null>(null);
  /** The service an invoice is being made for, and the company it is made out to. */
  const [invoicing, setInvoicing] = useState<{ service: InvoiceService; companyId: string } | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!workspaceId) { setAccounts([]); setPayments([]); setLoading(false); return; }
    if (!quiet) setLoading(true);
    try {
      const all = await listClientAccounts(workspaceId);
      setAccounts(all);
      setPayments(all.length ? await listAccountPayments(workspaceId) : []);
    } catch (error) {
      toast.error(publicMessage(error, 'The accounts could not be loaded. Please try again.'));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const contactById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  const clientOf = useCallback((account: CrmClientAccount): { name: string; company: string } => {
    const contact = contactById.get(account.contactId);
    return {
      name: contact ? leadName(contact) : 'A lead that was removed',
      company: contact?.companyId ? companyById.get(contact.companyId)?.name ?? '' : '',
    };
  }, [contactById, companyById]);

  /** Opens the New invoice window for one row: a monthly fee for the month on screen, a one-time fee for what is owed. */
  const startInvoice = (row: CollectionRow) => {
    const companyId = contactById.get(row.account.contactId)?.companyId;
    if (!companyId) {
      toast.error('Give this lead a company first (open the lead and press Edit). An invoice is made out to a company.');
      return;
    }
    const { account } = row;
    setInvoicing({
      companyId,
      service: account.billingType === 'monthly'
        ? { accountId: account.id, name: account.serviceName, amount: account.agreedAmount, billingMonth: month, monthly: true, currency: accountCurrency(account, companyCurrency) }
        : { accountId: account.id, name: account.serviceName, amount: row.collect > 0 ? row.collect : account.agreedAmount, billingMonth: null, monthly: false, currency: accountCurrency(account, companyCurrency) },
    });
  };

  const rows = useMemo(() => accounts.map((account) => collectionRow(account, payments, month)), [accounts, payments, month]);
  const totals = useMemo(() => collectionsTotals(rows), [rows]);

  const shown = useMemo(() => {
    const words = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (type !== 'all' && row.account.billingType !== type) return false;
      if (status === 'collect' ? row.collect <= 0 : status !== 'all' && row.status !== status) return false;
      if (!words) return true;
      const client = clientOf(row.account);
      return `${client.name} ${client.company} ${row.account.serviceName}`.toLowerCase().includes(words);
    }).sort((a, b) => b.collect - a.collect || clientOf(a.account).name.localeCompare(clientOf(b.account).name));
  }, [rows, search, type, status, clientOf]);

  /** The leads a new service can be for, by name. */
  const clientChoices = useMemo<ServiceClient[]>(
    () => contacts
      .map((contact) => ({ id: contact.id, name: leadName(contact), company: (contact.companyId && companyById.get(contact.companyId)?.name) || '' }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [contacts, companyById],
  );

  const year = Number(month.slice(0, 4));
  const yearRows = useMemo(() => shown.map((row) => yearRow(row.account, payments, year, month)), [shown, payments, year, month]);

  const stats: StatItem[] = [
    { label: 'Monthly fees', value: sumOf(rows, (row) => (row.account.billingType === 'monthly' ? row.charges : 0)), note: 'Running this month' },
    { label: `Charges in ${monthLabel(month, true)}`, value: sumOf(rows, (row) => row.charges) },
    { label: 'Paid for this month', value: sumOf(rows, (row) => row.paid), tone: totals.paid > 0 ? 'success' : 'default' },
    { label: 'Unpaid this month', value: sumOf(rows, (row) => row.monthUnpaid), tone: totals.monthUnpaid > 0 ? 'danger' : 'default' },
    { label: 'Unpaid from before', value: sumOf(rows, (row) => row.earlierUnpaid), tone: totals.earlierUnpaid > 0 ? 'danger' : 'default' },
    { label: 'To collect', value: sumOf(rows, (row) => row.collect), tone: totals.collect > 0 ? 'danger' : 'success' },
  ];

  const saveFile = (text: string, name: string) => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    link.download = name;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const exportCsv = () => {
    if (view === 'year') {
      saveFile(sheetCsv(yearRows, year, clientOf, (account) => accountCurrency(account, companyCurrency)), `accounts-${year}.csv`);
      return;
    }
    const header = ['Client', 'Company', 'Service', 'Type', 'Currency', 'Due', 'Charges', 'Paid for the month', 'Month unpaid', 'Earlier unpaid', 'To collect', 'Credit', 'Status'];
    const lines = shown.map((row) => {
      const client = clientOf(row.account);
      return [client.name, client.company, row.account.serviceName, row.account.billingType === 'monthly' ? 'Monthly' : 'One-time', accountCurrency(row.account, companyCurrency), row.dueOn ?? '',
        row.charges, row.paid, row.monthUnpaid, row.earlierUnpaid, row.collect, row.credit, row.setup ?? COLLECTION_STATUS_LABEL[row.status]].map(cell).join(',');
    });
    saveFile([header.map(cell).join(','), ...lines].join('\n'), `collections-${month}.csv`);
  };

  const filtered = search.trim() !== '' || type !== 'all' || status !== 'all';

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-background">
      <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">
        <PageHeader
          title="Accounts"
          description="What each client is charged, what they paid, and what is still to collect. “The year” is the payments sheet: one row for each service, one column for each month."
          actions={
            <>
              <Button variant="outline" onClick={exportCsv} disabled={shown.length === 0}><Download aria-hidden />Export</Button>
              <Button onClick={() => setService({ account: null })} disabled={!workspaceId}><Plus aria-hidden />Add service</Button>
            </>
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Review month" className="inline-flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label="The month before" onClick={() => setMonth(previousMonth(month))}><ChevronLeft aria-hidden /></Button>
            <Input type="month" aria-label="Month" className="h-11 w-44 md:h-8" value={month} onChange={(e) => { if (e.target.value) setMonth(e.target.value); }} />
            <Button variant="outline" size="icon" aria-label="The month after" onClick={() => setMonth(nextMonth(month))}><ChevronRight aria-hidden /></Button>
          </div>
          <div role="group" aria-label="What is shown" className="inline-flex rounded-md border border-border p-0.5">
            <Button size="sm" variant={view === 'month' ? 'secondary' : 'ghost'} aria-pressed={view === 'month'} onClick={() => setView('month')}>This month</Button>
            <Button size="sm" variant={view === 'year' ? 'secondary' : 'ghost'} aria-pressed={view === 'year'} onClick={() => setView('year')}>The year {year}</Button>
          </div>
        </div>

        <StatStrip items={stats} />

        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label="Search" placeholder="Search a client, company or service" className="h-11 w-full sm:w-72 md:h-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select aria-label="Type" className={SELECT} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            <option value="all">Monthly and one-time</option>
            <option value="monthly">Monthly</option>
            <option value="one_time">One-time</option>
          </select>
          <select aria-label="Status" className={SELECT} value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            <option value="all">Every status</option>
            <option value="collect">Something to collect</option>
            {(Object.keys(COLLECTION_STATUS_LABEL) as CollectionStatus[]).map((s) => <option key={s} value={s}>{COLLECTION_STATUS_LABEL[s]}</option>)}
          </select>
          {filtered && <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setType('all'); setStatus('all'); }}>Clear filters</Button>}
          <span className="ml-auto text-sm text-muted-foreground">{shown.length} of {rows.length} {rows.length === 1 ? 'service' : 'services'}</span>
        </div>

        {loading ? (
          <div className="py-16 text-center text-muted-foreground"><Loader2 className="mx-auto h-7 w-7 animate-spin" aria-hidden /></div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            <p>No client has a service yet. A service is what a client pays for: a monthly fee or a one-time fee.</p>
            <Button className="mt-3" onClick={() => setService({ account: null })}><Plus aria-hidden />Add service</Button>
          </div>
        ) : shown.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">Nothing matches these filters.</div>
        ) : view === 'month' ? (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm" aria-label={`Collections for ${monthLabel(month)}`}>
              <thead>
                <tr className={HEAD}>
                  <th className="px-4 text-left font-medium">Client</th>
                  <th className="px-3 text-left font-medium">Service</th>
                  <th className="px-3 text-left font-medium">Due</th>
                  <th className="px-3 text-right font-medium">Charges</th>
                  <th className="px-3 text-right font-medium">Paid</th>
                  <th className="px-3 text-right font-medium">Month unpaid</th>
                  <th className="px-3 text-right font-medium">From before</th>
                  <th className="px-3 text-right font-medium">To collect</th>
                  <th className="px-3 text-left font-medium">Status</th>
                  <th className="px-4 text-right font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((row) => {
                  const client = clientOf(row.account);
                  const money = moneyOf(row.account);
                  return (
                    <tr key={row.account.id} aria-label={`${client.name}, ${row.account.serviceName}`}>
                      <td className="px-4 py-2">
                        <Link to={`/crm/contacts/${row.account.contactId}`} className="font-medium text-foreground hover:underline">{client.name}</Link>
                        {client.company && <p className="text-xs text-muted-foreground">{client.company}</p>}
                      </td>
                      <td className="px-3 py-2">
                        <p className="text-foreground">{row.account.serviceName}</p>
                        <p className="text-xs text-muted-foreground">{row.account.billingType === 'monthly' ? `${money(row.account.agreedAmount)} a month` : `One-time, ${money(row.account.agreedAmount)}`}</p>
                      </td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{row.dueOn ? dayWords(row.dueOn) : ''}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(row.charges)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(row.paid)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(row.monthUnpaid)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${row.earlierUnpaid > 0 ? 'text-destructive' : ''}`}>{money(row.earlierUnpaid)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {money(row.collect)}
                        {row.credit > 0 && <p className="text-xs font-normal text-success">{money(row.credit)} in credit</p>}
                      </td>
                      <td className="px-3 py-2">
                        <StatusPill tone={STATUS_TONE[row.status]}>{COLLECTION_STATUS_LABEL[row.status]}</StatusPill>
                        {row.setup && <p className="mt-0.5 text-xs text-muted-foreground">{row.setup}</p>}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <span className="inline-flex gap-1.5">
                          <Button variant="outline" size="sm" onClick={() => setPaying(row)} aria-label={`Record a payment for ${client.name}, ${row.account.serviceName}`}>
                            <CreditCard aria-hidden />Payment
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => startInvoice(row)} aria-label={`Create an invoice for ${client.name}, ${row.account.serviceName}`}>
                            <FileText aria-hidden />Invoice
                          </Button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-surface-2 text-sm font-medium">
                  <td className="px-4 py-2" colSpan={3}>Total of what is shown</td>
                  <td className="px-3 py-2 text-right tabular-nums">{sumOf(shown, (row) => row.charges)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{sumOf(shown, (row) => row.paid)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{sumOf(shown, (row) => row.monthUnpaid)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{sumOf(shown, (row) => row.earlierUnpaid)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{sumOf(shown, (row) => row.collect)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            {/* The payments sheet: the same columns, in the same order, as the sheet it replaces. */}
            <table className="w-full min-w-[112rem] text-sm" aria-label={`Payments in ${year}`}>
              <thead>
                <tr className={HEAD}>
                  <th scope="col" className="px-4 text-left font-medium">Project</th>
                  <th scope="col" className="px-3 text-left font-medium">Client</th>
                  <th scope="col" className="px-3 text-left font-medium">Type</th>
                  <th scope="col" className="px-3 text-right font-medium">Fee</th>
                  <th scope="col" className="px-3 text-right font-medium">Total cost</th>
                  <th scope="col" className="px-3 text-right font-medium">Opening paid</th>
                  <th scope="col" className="px-3 text-left font-medium">Start</th>
                  <th scope="col" className="px-3 text-left font-medium">End</th>
                  {SHORT.map((name) => <th scope="col" key={name} className="px-1 text-right font-medium">{name}</th>)}
                  <th scope="col" className="px-3 text-right font-medium">Total paid</th>
                  <th scope="col" className="px-3 text-right font-medium">Amount due</th>
                  <th scope="col" className="px-3 text-left font-medium">Notes</th>
                  <th scope="col" className="px-4 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {yearRows.map((row, index) => {
                  const { account } = row;
                  const client = clientOf(account);
                  const money = moneyOf(account);
                  const monthRow = shown[index];
                  const label = `${client.name}, ${account.serviceName}`;
                  return (
                    <tr key={account.id} aria-label={label} className="hover:bg-surface-2">
                      <td className="max-w-[14rem] px-4 py-2 font-medium text-foreground"><span className="block truncate" title={account.serviceName}>{account.serviceName}</span></td>
                      <td className="px-3 py-2">
                        <Link to={`/crm/contacts/${account.contactId}`} className="text-foreground hover:underline">{client.name}</Link>
                        {client.company && <p className="text-xs text-muted-foreground">{client.company}</p>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">{account.billingType === 'monthly' ? 'Monthly' : 'One-time'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(account.agreedAmount)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{row.totalCost === null ? <span className="text-muted-foreground">Ongoing</span> : money(row.totalCost)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(account.openingPaid)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{account.serviceStart ? monthLabel(account.serviceStart.slice(0, 7), true) : '–'}</td>
                      <td className="whitespace-nowrap px-3 py-2">{account.serviceEnd ? monthLabel(account.serviceEnd.slice(0, 7), true) : '–'}</td>
                      {row.months.map((amount, at) => {
                        const key = `${year}-${String(at + 1).padStart(2, '0')}`;
                        return (
                          <td key={SHORT[at]} className="px-0.5 py-1 text-right tabular-nums">
                            {/* A month is pressed to write down what was paid for it. */}
                            <button
                              type="button"
                              aria-label={`Record a payment for ${label}, ${monthLabel(key)}`}
                              title={`Record a payment for ${monthLabel(key)}`}
                              onClick={() => { if (monthRow) { setPayingMonth(key); setPaying(collectionRow(account, payments, key)); } }}
                              className={`w-full rounded px-1.5 py-1 text-right hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${amount > 0 ? 'text-foreground' : 'text-muted-foreground/60'}`}
                            >
                              {amount > 0 ? money(amount) : '–'}
                            </button>
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{money(row.totalPaid)}</td>
                      <td className={`px-3 py-2 text-right font-medium tabular-nums ${row.amountDue > 0 ? 'text-destructive' : ''}`}>{money(row.amountDue)}</td>
                      <td className="max-w-[16rem] px-3 py-2 text-muted-foreground"><span className="block truncate" title={account.notes ?? undefined}>{account.notes?.trim() || '–'}</span></td>
                      <td className="whitespace-nowrap px-4 py-2 text-right">
                        <span className="inline-flex gap-1.5">
                          {monthRow && (
                            <Button variant="outline" size="sm" onClick={() => startInvoice(monthRow)} aria-label={`Create an invoice for ${label}`}>
                              <FileText aria-hidden />Invoice
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" onClick={() => setService({ account })} aria-label={`Edit ${account.serviceName} of ${client.name}`} title="Edit service">
                            <Pencil aria-hidden />
                          </Button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ServiceDialog
        open={service !== null} onOpenChange={(open) => { if (!open) setService(null); }}
        organizationId={organizationId} workspaceId={workspaceId} clients={clientChoices}
        account={service?.account ?? null} year={year} onSaved={() => load(true)}
      />

      {invoicing && (
        <NewInvoiceDialog open companyId={invoicing.companyId} service={invoicing.service} onOpenChange={(open) => { if (!open) setInvoicing(null); }} />
      )}

      <RecordPayment
        row={paying} month={payingMonth ?? month} clientName={paying ? clientOf(paying.account).name : ''} money={paying ? moneyOf(paying.account) : (amount: number) => formatCurrency(amount, companyCurrency)}
        onOpenChange={(open) => { if (!open) { setPaying(null); setPayingMonth(null); } }}
        onSave={async (input) => {
          if (!paying) return;
          await addAccountPayment({ accountId: paying.account.id, organizationId, workspaceId, createdBy: user?.userId, ...input });
          toast.success('Payment recorded');
          await load(true);
        }}
      />
    </main>
  );
};

interface PaymentInput { amount: number; paidOn: string; billingMonth: string | null; method: string | null; reference: string | null; notes: string | null }

const RecordPayment: React.FC<{
  row: CollectionRow | null;
  month: string;
  clientName: string;
  money: (value: number) => string;
  onOpenChange: (open: boolean) => void;
  onSave: (input: PaymentInput) => Promise<void>;
}> = ({ row, month, clientName, money, onOpenChange, onSave }) => {
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(today());
  const [billingMonth, setBillingMonth] = useState(month);
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const id = row?.account.id ?? null;
  // Starts from what is owed for the month on screen, each time another service is opened.
  useEffect(() => {
    if (!row) return;
    setAmount(row.monthUnpaid > 0 ? String(row.monthUnpaid) : row.collect > 0 ? String(row.collect) : '');
    setPaidOn(today());
    setBillingMonth(month);
    setMethod('');
    setReference('');
    setNotes('');
  }, [id, month]);

  if (!row) return null;
  const ready = Number(amount) > 0 && paidOn !== '';

  const save = async () => {
    setBusy(true);
    try {
      await onSave({
        amount: Number(amount), paidOn,
        // Named only when it differs from the month the payment arrived in.
        billingMonth: billingMonth && billingMonth !== paidOn.slice(0, 7) ? billingMonth : null,
        method: method || null, reference: reference.trim() || null, notes: notes.trim() || null,
      });
      onOpenChange(false);
    } catch (error) {
      toast.error(publicMessage(error, 'The payment could not be recorded. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!busy) onOpenChange(open); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record a payment</DialogTitle>
          <DialogDescription>
            {clientName}, {row.account.serviceName}. {row.collect > 0 ? `${money(row.collect)} is still to collect.` : 'Nothing is owed right now.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="rp-amount">Amount</Label>
            <Input id="rp-amount" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="rp-date">Payment date</Label>
            <Input id="rp-date" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="rp-month">Pays for the month</Label>
            <Input id="rp-month" type="month" value={billingMonth} onChange={(e) => setBillingMonth(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="rp-method">Method</Label>
            <select id="rp-method" className="h-11 w-full rounded-md border border-input bg-background px-2 text-sm md:h-9" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="">Not said</option>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="rp-reference">Reference</Label>
            <Input id="rp-reference" maxLength={80} placeholder="Receipt or bank reference" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="rp-notes">Notes</Label>
            <Input id="rp-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || !ready} onClick={() => void save()}>{busy && <Loader2 className="animate-spin" aria-hidden />}Save payment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CrmAccountsPage;
