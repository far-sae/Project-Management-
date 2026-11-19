// An issued invoice: read-only, with its payments, receipts, emails and history.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, Download, Eye, EyeOff, Loader2, MoreHorizontal, Send, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { balance } from '../../../../api/_signroom/shared/invoiceMath';
import type { Invoice, Payment, ProjectList } from '../../../../api/_signroom/shared/types';
import { useSignroom } from '@/hooks/useSignroom';
import {
  billingToday, errorSentence, formatMinor, isOverdue, paidMinor, shortDate, shortDateTime,
} from '@/lib/signroom/billing';
import { StatStrip } from '@/components/common/StatStrip';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DeliveryLog } from '../DeliveryLog';
import { PdfDialog, PdfFrame } from './PdfFrame';
import { RecordPaymentDialog, type PaymentInput } from './RecordPaymentDialog';
import { Card, HEAD_ROW, ROW, TD, TD_DATE, TD_MONEY, TH, TH_RIGHT, savePdf } from './shared';
import { useServerData, type DeliveryInfo } from './useBilling';

interface Props {
  invoice: Invoice;
  delivery: DeliveryInfo | null;
  /** Open the payment dialog straight away (the list's "Record a payment"). */
  startWithPayment?: boolean;
  /** The CRM company page, where the invoice's billing plan lives. */
  companyHref?: string | null;
  onChange: (invoice: Invoice) => void;
  onReload: () => void;
}

const isStale = (error: unknown): boolean => (error as { status?: number } | null)?.status === 409;

export const InvoiceRecord: React.FC<Props> = ({ invoice, delivery, startWithPayment, companyHref, onChange, onReload }) => {
  const { client } = useSignroom();
  const [busy, setBusy] = useState(false);
  const [showPdf, setShowPdf] = useState(false);
  const [paying, setPaying] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [receipt, setReceipt] = useState<Payment | null>(null);

  const today = billingToday();
  const owed = balance(invoice);
  const voided = invoice.status === 'Voided';
  const canPay = invoice.status === 'Issued' || invoice.status === 'Part paid';
  const canVoid = invoice.status === 'Issued' && invoice.payments.length === 0;
  const email = invoice.customer?.email ?? '';
  const money = (minor: number) => formatMinor(minor, invoice.currency);
  const perLineTax = invoice.lines.some((l) => l.taxBps !== undefined);

  // The billing plan this invoice counts towards, when it has one (the server calls a plan a "client project").
  const plans = useServerData<ProjectList>(invoice.projectId ? `client-projects/${invoice.clientId}` : null);
  const planName = plans.data?.projects.find((p) => p.id === invoice.projectId)?.name;

  useEffect(() => {
    if (startWithPayment && canPay) setPaying(true);
  }, [startWithPayment]);

  const fail = (error: unknown) => {
    toast.error(errorSentence(error), isStale(error) ? { action: { label: 'Reload', onClick: onReload } } : undefined);
  };

  /** One change to the invoice. Resolves true when the server accepted it. */
  const act = async (action: string, body: unknown, done: string): Promise<boolean> => {
    setBusy(true);
    try {
      onChange(await client.call<Invoice>(`billing/${invoice.id}/${action}`, body));
      toast.success(done);
      return true;
    } catch (error) {
      fail(error);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const send = () => act('send', {}, `Email sent to ${email}.`);
  const sendReceipt = (payment: Payment) => act('send-receipt', { paymentId: payment.id }, `Email sent to ${email}.`);
  const recordPayment = async (payment: PaymentInput) => {
    const ok = await act('payment', { revision: invoice.revision, ...payment }, 'Payment recorded and receipt created.');
    if (ok) setPaying(false);
  };
  const voidInvoice = () => act('void', { revision: invoice.revision }, 'Invoice voided.');

  const download = async (path: string, filename: string) => {
    try {
      savePdf(await client.pdf(path), filename);
    } catch (error) {
      toast.error(errorSentence(error, 'The PDF could not be downloaded.'));
    }
  };
  const receiptPath = (payment: Payment) => `billing/${invoice.id}/artifact?payment=${payment.id}`;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <StatStrip
        items={[
          { label: 'Total', value: money(invoice.totalMinor) },
          { label: 'Paid', value: money(paidMinor(invoice)), tone: paidMinor(invoice) > 0 ? 'success' : 'muted' },
          voided
            ? { label: 'Outstanding', value: 'Voided', tone: 'muted' }
            : {
              label: 'Outstanding',
              value: money(owed),
              tone: isOverdue(invoice, today) ? 'danger' : owed === 0 ? 'muted' : 'default',
              note: isOverdue(invoice, today) ? 'Overdue' : undefined,
            },
          { label: 'Due', value: shortDate(invoice.dueDate), note: `Dated ${shortDate(invoice.issueDate)}` },
        ]}
      />

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          {!voided && (
            <Button onClick={() => void send()} disabled={busy || !email}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
              {invoice.sentAt ? 'Send invoice again' : 'Send invoice'}
            </Button>
          )}
          {canPay && (
            <Button variant="outline" onClick={() => setPaying(true)} disabled={busy}>
              <Wallet aria-hidden /> Record a payment
            </Button>
          )}
          <Button variant="outline" onClick={() => setShowPdf((v) => !v)}>
            {showPdf ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
            {showPdf ? 'Hide PDF' : 'Preview PDF'}
          </Button>
          <Button variant="outline" onClick={() => void download(`billing/${invoice.id}/artifact`, `${invoice.number}.pdf`)}>
            <Download aria-hidden /> Download PDF
          </Button>
          {canVoid && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" aria-label={`More actions for ${invoice.number}`}><MoreHorizontal /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setConfirmVoid(true)}>
                  <Ban aria-hidden /> Void this invoice
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {voided
            ? 'This invoice was voided. Its record is kept, and links already emailed no longer open it.'
            : !email
              ? 'This invoice has no customer email address, so it cannot be sent. Download the PDF instead.'
              : <>
                Goes to <span className="font-medium text-foreground">{email}</span>
                {delivery?.sender ? <>, sent from {delivery.sender}</> : null}.{' '}
                {invoice.sentAt
                  ? <>Last sent <span className="tabular-nums">{shortDateTime(invoice.sentAt)}</span>.</>
                  : 'Not sent yet.'}
              </>}
          {!voided && email && delivery && !delivery.ready && ' Sending email is not set up for this app yet.'}
        </p>
      </div>

      {showPdf && (
        <Card title="Invoice PDF">
          <div className="p-4">
            <PdfFrame
              load={() => client.pdf(`billing/${invoice.id}/artifact`)}
              sourceKey={invoice.id}
              title={`Invoice ${invoice.number}`}
              filename={`${invoice.number}.pdf`}
            />
          </div>
        </Card>
      )}

      <Card title="Line items" count={invoice.lines.length}>
        <div className="overflow-x-auto" role="region" aria-label="Invoice line items" tabIndex={0}>
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className={HEAD_ROW}>
                <th scope="col" className={TH}>Description</th>
                <th scope="col" className={TH}>Billing type</th>
                <th scope="col" className={TH_RIGHT}>Quantity</th>
                <th scope="col" className={TH_RIGHT}>Unit price</th>
                {perLineTax && <th scope="col" className={TH_RIGHT}>Tax %</th>}
                <th scope="col" className={TH_RIGHT}>{perLineTax ? 'Total with tax' : 'Amount'}</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((l, n) => (
                <tr key={n} className={`${ROW} align-top`}>
                  <td className={`${TD} whitespace-pre-wrap break-words`}>{l.description}</td>
                  <td className={`${TD} text-muted-foreground`}>
                    {l.billingType === 'Custom' ? l.billingLabel || 'Custom' : l.billingType ?? 'One-off'}
                  </td>
                  <td className={TD_MONEY}>{l.quantityMilli / 1000}</td>
                  <td className={TD_MONEY}>{money(l.rateMinor)}</td>
                  {perLineTax && <td className={TD_MONEY}>{(l.taxBps ?? invoice.taxBps) / 100}</td>}
                  <td className={`${TD_MONEY} font-medium`}>{money(l.totalMinor + (l.taxMinor ?? 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4 border-t border-border p-4">
          <div className="flex min-w-0 max-w-xl flex-col gap-2 text-sm">
            {invoice.project && (
              <p><span className="text-muted-foreground">Reference: </span>{invoice.project}</p>
            )}
            {invoice.projectId && (planName ? (
              <p>
                <span className="text-muted-foreground">Billing plan: </span>
                {companyHref
                  ? <Link to={companyHref} className="font-medium text-foreground underline-offset-4 hover:underline">{planName}</Link>
                  : <span className="font-medium text-foreground">{planName}</span>}
              </p>
            ) : !plans.loading && (
              <p className="text-muted-foreground">Linked to a billing plan.</p>
            ))}
            {invoice.notes && <p className="whitespace-pre-wrap break-words text-muted-foreground">{invoice.notes}</p>}
          </div>
          <dl className="ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm" aria-label="Invoice totals">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="text-right tabular-nums">{money(invoice.subtotalMinor)}</dd>
            <dt className="text-muted-foreground">Tax{perLineTax ? '' : ` (${invoice.taxBps / 100}%)`}</dt>
            <dd className="text-right tabular-nums">{money(invoice.taxMinor)}</dd>
            <dt className="border-t border-border pt-1 font-semibold text-foreground">Total</dt>
            <dd className="border-t border-border pt-1 text-right font-semibold tabular-nums text-foreground">{money(invoice.totalMinor)}</dd>
          </dl>
        </div>
      </Card>

      <Card title="Payments and receipts" count={invoice.payments.length}>
        {invoice.payments.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {voided ? 'No payments were recorded.' : 'No payments recorded yet. Each payment you record gets its own receipt.'}
          </p>
        ) : (
          <div className="overflow-x-auto" role="region" aria-label="Payments and receipts" tabIndex={0}>
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className={HEAD_ROW}>
                  <th scope="col" className={TH}>Receipt</th>
                  <th scope="col" className={TH}>Payment date</th>
                  <th scope="col" className={TH}>Method</th>
                  <th scope="col" className={TH}>Reference</th>
                  <th scope="col" className={TH_RIGHT}>Amount</th>
                  <th scope="col" className={TH_RIGHT}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {invoice.payments.map((p) => (
                  <tr key={p.id} className={ROW}>
                    <th scope="row" className={`${TD} text-left font-medium tabular-nums`}>{p.receiptNumber}</th>
                    <td className={TD_DATE}>{shortDate(p.paidOn)}</td>
                    <td className={`${TD} text-muted-foreground`}>{p.method}</td>
                    <td className={`${TD} text-muted-foreground`}>{p.reference || '—'}</td>
                    <td className={`${TD_MONEY} font-medium`}>{money(p.amountMinor)}</td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setReceipt(p)} aria-label={`Preview receipt ${p.receiptNumber}`}>
                          Preview
                        </Button>
                        <Button
                          size="sm" variant="ghost"
                          onClick={() => void download(receiptPath(p), `${p.receiptNumber}.pdf`)}
                          aria-label={`Download receipt ${p.receiptNumber}`}
                        >
                          Download
                        </Button>
                        <Button
                          size="sm" variant="outline" disabled={busy || !email}
                          onClick={() => void sendReceipt(p)}
                          aria-label={`Send receipt ${p.receiptNumber}`}
                        >
                          Send receipt
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Sending adds to the invoice's history, which is the cue to read the list of emails again. */}
      <DeliveryLog key={`${invoice.sentAt ?? ''}:${invoice.events.length}`} path={`billing/${invoice.id}/deliveries`} />

      <Card title="Activity" count={invoice.events.length}>
        {invoice.events.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing has happened yet.</p>
        ) : (
          <ol>
            {[...invoice.events].reverse().map((e, n) => (
              <li key={n} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-border/60 px-4 py-2.5 last:border-0">
                <span className="min-w-0 text-sm text-foreground">{e.type}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{shortDateTime(e.at)} · {e.actor}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <RecordPaymentDialog
        open={paying}
        onOpenChange={setPaying}
        invoice={invoice}
        busy={busy}
        onRecord={(payment) => void recordPayment(payment)}
      />

      <PdfDialog
        open={receipt !== null}
        onOpenChange={(open) => !open && setReceipt(null)}
        heading={receipt ? `Receipt ${receipt.receiptNumber}` : 'Receipt'}
        load={() => client.pdf(receipt ? receiptPath(receipt) : '')}
        sourceKey={receipt?.id ?? ''}
        title={receipt ? `Receipt ${receipt.receiptNumber}` : 'Receipt'}
        filename={`${receipt?.receiptNumber ?? 'receipt'}.pdf`}
      />

      <AlertDialog open={confirmVoid} onOpenChange={setConfirmVoid}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void {invoice.number}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its record stays, but it no longer counts as owed and links already emailed stop working. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void voidInvoice()}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Void invoice
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default InvoiceRecord;
