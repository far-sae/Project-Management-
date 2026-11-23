// Invoices: every invoice in the workspace, what is owed, and the receipts for what was paid.
import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarRange, Download, FileText, Loader2, MoreHorizontal, Plus, Receipt, Search } from 'lucide-react';
import { toast } from 'sonner';
import { balance } from '../../../api/_signroom/shared/invoiceMath';
import type { Invoice } from '../../../api/_signroom/shared/types';
import { useSignroom } from '@/hooks/useSignroom';
import {
  STATUS_FILTERS, anyAbove, billingToday, errorSentence, filterInvoices, filterReceipts, formatMinor, formatSums,
  listTotals, matchesStatus, paidMinor, receiptRows, shortDate, type StatusFilter,
} from '@/lib/signroom/billing';
import { invoicesCsv, receiptsCsv, saveTextFile } from '@/lib/signroom/billingCsv';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/common/PageHeader';
import { StatStrip } from '@/components/common/StatStrip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { NewInvoiceDialog } from '@/components/signroom/billing/NewInvoiceDialog';
import { NewReceiptDialog } from '@/components/signroom/billing/NewReceiptDialog';
import { PdfDialog } from '@/components/signroom/billing/PdfFrame';
import {
  EmptyState, HEAD_ROW, InvoiceStatus, PickWorkspace, ROW, TD, TD_DATE, TD_MONEY, TH, TH_RIGHT, savePdf,
} from '@/components/signroom/billing/shared';
import { customerName, useBillingClients, useInvoices } from '@/components/signroom/billing/useBilling';

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

interface Preview { heading: string; path: string; filename: string }

export const InvoicesPage: React.FC = () => {
  const navigate = useNavigate();
  const { client, workspaceId } = useSignroom();
  const { invoices, loading, error, reload } = useInvoices();
  const { byId: clientsById } = useBillingClients();

  const [tab, setTab] = useState('invoices');
  const [status, setStatus] = useState<StatusFilter>('All');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [creating, setCreating] = useState(false);
  const [receipting, setReceipting] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [sending, setSending] = useState<string | null>(null);

  const today = billingToday();
  const nameOf = (invoice: Invoice) => customerName(invoice, clientsById);
  const companyHref = (invoice: Invoice): string | null => {
    const companyId = clientsById.get(invoice.clientId)?.crmCompanyId;
    return companyId ? `/crm/companies/${companyId}` : null;
  };

  const totals = useMemo(() => listTotals(invoices, today), [invoices, today]);
  /** Everything except the status filter, so each status chip can show its count. */
  const scoped = useMemo(
    () => filterInvoices(invoices, { status: 'All', query, from, to, today, nameOf }),
    [invoices, query, from, to, today, clientsById],
  );
  const visible = useMemo(
    () => scoped
      .filter((i) => matchesStatus(i, status, today))
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number)),
    [scoped, status, today],
  );
  const receipts = useMemo(
    () => filterReceipts(receiptRows(invoices), { query, from, to, nameOf }),
    [invoices, query, from, to, clientsById],
  );

  const filtering = Boolean(query.trim() || from || to) || status !== 'All';
  const clearFilters = () => { setQuery(''); setFrom(''); setTo(''); setStatus('All'); };

  const send = async (invoice: Invoice, paymentId?: string) => {
    setSending(paymentId ?? invoice.id);
    try {
      await client.call<Invoice>(`billing/${invoice.id}/${paymentId ? 'send-receipt' : 'send'}`, paymentId ? { paymentId } : {});
      toast.success(`Email sent to ${invoice.customer?.email || clientsById.get(invoice.clientId)?.email || 'the customer'}.`);
      await reload();
    } catch (err) {
      toast.error(errorSentence(err, 'The email could not be sent'));
    } finally {
      setSending(null);
    }
  };

  const download = async (path: string, filename: string) => {
    try {
      savePdf(await client.pdf(path), filename);
    } catch (err) {
      toast.error(errorSentence(err, 'The PDF could not be downloaded.'));
    }
  };

  const exportCsv = () => {
    if (tab === 'receipts') {
      if (!receipts.length) { toast.error('Nothing to export'); return; }
      saveTextFile('receipts.csv', receiptsCsv(receipts, nameOf));
      toast.success(`Exported ${plural(receipts.length, 'receipt', 'receipts')}`);
      return;
    }
    if (!visible.length) { toast.error('Nothing to export'); return; }
    saveTextFile('invoices.csv', invoicesCsv(visible, nameOf));
    toast.success(`Exported ${plural(visible.length, 'invoice', 'invoices')}`);
  };

  const invoicePdf = (i: Invoice): Preview => ({
    heading: `Invoice ${i.number}`,
    path: `billing/${i.id}/${i.status === 'Draft' ? `preview?v=${i.revision}` : 'artifact'}`,
    filename: `${i.number}${i.status === 'Draft' ? '-draft' : ''}.pdf`,
  });

  const chip = (active: boolean) =>
    cn(
      'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      active
        ? 'border-foreground bg-foreground text-background'
        : 'border-border text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground',
    );

  const company = (invoice: Invoice) => {
    const name = nameOf(invoice);
    const href = companyHref(invoice);
    if (!name) return <span className="text-muted-foreground">—</span>;
    return href
      ? <Link to={href} className="block max-w-56 truncate text-foreground hover:underline">{name}</Link>
      : <span className="block max-w-56 truncate">{name}</span>;
  };

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-background">
      <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">
        <PageHeader
          title="Invoices"
          description="Bill a company first. When its money arrives, create the receipt. Recording a payment does not move money."
          actions={
            <>
              <Button asChild variant="outline">
                <Link to="/crm/accounts-overview"><CalendarRange aria-hidden /> Accounts overview</Link>
              </Button>
              <Button variant="outline" onClick={exportCsv} disabled={!workspaceId}>
                <Download aria-hidden /> Export
              </Button>
              <Button variant="outline" onClick={() => setReceipting(true)} disabled={!workspaceId}>
                <Receipt aria-hidden /> New receipt
              </Button>
              <Button onClick={() => setCreating(true)} disabled={!workspaceId}>
                <Plus aria-hidden /> New invoice
              </Button>
            </>
          }
        />

        {!workspaceId ? (
          <PickWorkspace />
        ) : (
          <>
            <StatStrip
              items={[
                {
                  label: 'Outstanding',
                  value: formatSums(totals.outstanding),
                  note: totals.unpaidCount ? `${plural(totals.unpaidCount, 'invoice', 'invoices')} waiting to be paid` : 'Nothing waiting to be paid',
                },
                {
                  label: 'Overdue',
                  value: formatSums(totals.overdue),
                  tone: anyAbove(totals.overdue) ? 'danger' : 'default',
                  note: totals.overdueCount ? `${plural(totals.overdueCount, 'invoice', 'invoices')} past the due date` : 'Nothing past its due date',
                },
                {
                  label: 'Paid this month',
                  value: formatSums(totals.paidThisMonth),
                  tone: anyAbove(totals.paidThisMonth) ? 'success' : 'default',
                  note: 'Payments dated this month',
                },
              ]}
            />

            {error && <p role="alert" className="rounded-md border border-border px-3 py-2 text-sm text-destructive">{error}</p>}

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="invoices">Invoices <span className="tabular-nums opacity-70">{invoices.length}</span></TabsTrigger>
                <TabsTrigger value="receipts">Receipts <span className="tabular-nums opacity-70">{receiptRows(invoices).length}</span></TabsTrigger>
              </TabsList>

              <div className="mt-4 flex flex-col gap-3">
                {tab === 'invoices' && (
                  <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by status">
                    {STATUS_FILTERS.map((s) => (
                      <button key={s} type="button" className={chip(status === s)} aria-pressed={status === s} onClick={() => setStatus(s)}>
                        {s} <span className="tabular-nums opacity-70">{scoped.filter((i) => matchesStatus(i, s, today)).length}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap items-end gap-2">
                  <div className="relative min-w-60 max-w-md flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={tab === 'receipts' ? 'Search receipt, invoice, company, reference' : 'Search number, company, line item, notes'}
                      aria-label={tab === 'receipts' ? 'Search receipts' : 'Search invoices'}
                      className="pl-8"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="invoices-from" className="text-xs text-muted-foreground">From</Label>
                    <Input id="invoices-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40 tabular-nums" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="invoices-to" className="text-xs text-muted-foreground">To</Label>
                    <Input id="invoices-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40 tabular-nums" />
                  </div>
                  {filtering && <Button variant="ghost" onClick={clearFilters}>Clear filters</Button>}
                </div>
              </div>

              <TabsContent value="invoices">
                {loading && invoices.length === 0 ? (
                  <div className="py-16 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading invoices" />
                  </div>
                ) : visible.length === 0 ? (
                  <EmptyState
                    icon={<FileText className="h-5 w-5 text-muted-foreground" aria-hidden />}
                    action={filtering
                      ? <Button variant="outline" onClick={clearFilters}>Clear filters</Button>
                      : <Button onClick={() => setCreating(true)}><Plus aria-hidden /> New invoice</Button>}
                  >
                    {filtering ? 'No invoices match these filters.' : 'No invoices yet. Create the first one for a company in your CRM.'}
                  </EmptyState>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full min-w-[64rem] text-sm">
                      <thead>
                        <tr className={HEAD_ROW}>
                          <th className={TH}>Invoice</th>
                          <th className={TH}>Company</th>
                          <th className={TH}>Status</th>
                          <th className={TH}>Invoice date</th>
                          <th className={TH}>Due date</th>
                          <th className={TH_RIGHT}>Total</th>
                          <th className={TH_RIGHT}>Paid</th>
                          <th className={TH_RIGHT}>Outstanding</th>
                          <th className={TH}>Last sent</th>
                          <th className={TH_RIGHT}><span className="sr-only">Actions</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((i) => {
                          const issued = i.status !== 'Draft' && i.status !== 'Voided';
                          return (
                            <tr key={i.id} className={`${ROW} hover:bg-muted/40`}>
                              <td className={TD}>
                                <Link to={`/crm/invoices/${i.id}`} className="font-medium tabular-nums text-foreground hover:underline">{i.number}</Link>
                              </td>
                              <td className={TD}>{company(i)}</td>
                              <td className={TD}><InvoiceStatus invoice={i} today={today} /></td>
                              <td className={TD_DATE}>{shortDate(i.issueDate)}</td>
                              <td className={TD_DATE}>{shortDate(i.dueDate)}</td>
                              <td className={`${TD_MONEY} font-medium`}>{formatMinor(i.totalMinor, i.currency)}</td>
                              <td className={`${TD_MONEY} text-muted-foreground`}>{formatMinor(paidMinor(i), i.currency)}</td>
                              <td className={TD_MONEY}>
                                {i.status === 'Voided'
                                  ? <span className="text-muted-foreground">Voided</span>
                                  : formatMinor(balance(i), i.currency)}
                              </td>
                              <td className={TD_DATE}>{i.sentAt ? shortDate(i.sentAt) : 'Not sent'}</td>
                              <td className="px-3 py-1.5 text-right">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button size="icon" variant="ghost" aria-label={`More actions for ${i.number}`}>
                                      {sending === i.id ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem asChild>
                                      <Link to={`/crm/invoices/${i.id}`}>{i.status === 'Draft' ? 'Edit draft' : 'Open invoice'}</Link>
                                    </DropdownMenuItem>
                                    {(i.status !== 'Draft' || i.lines.length > 0) && (
                                      <DropdownMenuItem onClick={() => setPreview(invoicePdf(i))}>Preview PDF</DropdownMenuItem>
                                    )}
                                    {i.status !== 'Draft' && (
                                      <DropdownMenuItem onClick={() => void download(`billing/${i.id}/artifact`, `${i.number}.pdf`)}>
                                        Download PDF
                                      </DropdownMenuItem>
                                    )}
                                    {issued && (
                                      <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem disabled={sending !== null} onClick={() => void send(i)}>
                                          {i.sentAt ? 'Send invoice again' : 'Send invoice'}
                                        </DropdownMenuItem>
                                        {balance(i) > 0 && (
                                          <DropdownMenuItem onClick={() => navigate(`/crm/invoices/${i.id}?payment=new`)}>
                                            Create a receipt
                                          </DropdownMenuItem>
                                        )}
                                      </>
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="receipts">
                {receipts.length === 0 ? (
                  <EmptyState
                    icon={<FileText className="h-5 w-5 text-muted-foreground" aria-hidden />}
                    action={query.trim() || from || to
                      ? <Button variant="outline" onClick={clearFilters}>Clear filters</Button>
                      : <Button variant="outline" onClick={() => setReceipting(true)}><Receipt aria-hidden /> New receipt</Button>}
                  >
                    {query.trim() || from || to
                      ? 'No receipts match these filters.'
                      : 'No receipts yet. A receipt is made when the money for an invoice has arrived.'}
                  </EmptyState>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full min-w-[56rem] text-sm">
                      <thead>
                        <tr className={HEAD_ROW}>
                          <th className={TH}>Receipt</th>
                          <th className={TH}>Invoice</th>
                          <th className={TH}>Company</th>
                          <th className={TH}>Payment date</th>
                          <th className={TH}>Method</th>
                          <th className={TH}>Reference</th>
                          <th className={TH_RIGHT}>Amount</th>
                          <th className={TH_RIGHT}><span className="sr-only">Actions</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {receipts.map(({ invoice: i, payment: p }) => {
                          const path = `billing/${i.id}/artifact?payment=${p.id}`;
                          return (
                            <tr key={p.id} className={`${ROW} hover:bg-muted/40`}>
                              <td className={`${TD} font-medium tabular-nums`}>{p.receiptNumber}</td>
                              <td className={TD}>
                                <Link to={`/crm/invoices/${i.id}`} className="tabular-nums text-foreground hover:underline">{i.number}</Link>
                              </td>
                              <td className={TD}>{company(i)}</td>
                              <td className={TD_DATE}>{shortDate(p.paidOn)}</td>
                              <td className={`${TD} text-muted-foreground`}>{p.method}</td>
                              <td className={`${TD} text-muted-foreground`}>{p.reference || '—'}</td>
                              <td className={`${TD_MONEY} font-medium`}>{formatMinor(p.amountMinor, i.currency)}</td>
                              <td className="px-3 py-1.5 text-right">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button size="icon" variant="ghost" aria-label={`More actions for ${p.receiptNumber}`}>
                                      {sending === p.id ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => setPreview({ heading: `Receipt ${p.receiptNumber}`, path, filename: `${p.receiptNumber}.pdf` })}>
                                      Preview PDF
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => void download(path, `${p.receiptNumber}.pdf`)}>Download PDF</DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem disabled={sending !== null} onClick={() => void send(i, p.id)}>Send receipt</DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>

      <NewInvoiceDialog open={creating} onOpenChange={setCreating} />
      <NewReceiptDialog
        open={receipting}
        onOpenChange={setReceipting}
        invoices={invoices}
        nameOf={nameOf}
        onNewInvoice={() => setCreating(true)}
      />

      <PdfDialog
        open={preview !== null}
        onOpenChange={(open) => !open && setPreview(null)}
        heading={preview?.heading ?? 'PDF'}
        load={() => client.pdf(preview?.path ?? '')}
        sourceKey={preview?.path ?? ''}
        title={preview?.heading ?? 'PDF'}
        filename={preview?.filename ?? 'document.pdf'}
      />
    </main>
  );
};

export default InvoicesPage;
