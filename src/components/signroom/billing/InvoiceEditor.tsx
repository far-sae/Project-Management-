// A draft invoice: everything on it can still be changed. Issuing it locks it.
import React, { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, Loader2, Plus, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Invoice, ProjectList } from '../../../../api/_signroom/shared/types';
import { useSignroom } from '@/hooks/useSignroom';
import {
  BILLING_TYPES, INVOICE_CURRENCIES, billingToday, emptyLine, errorSentence, formatMinor, lineDrafts,
  linesForServer, liveTotals, taxModeOf, type BillingType, type LineDraft, type TaxMode,
} from '@/lib/signroom/billing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PdfFrame } from './PdfFrame';
import { Card, FIELD, HEAD_ROW, ROW, TH, TH_RIGHT, Tick } from './shared';
import { UnsavedGuard } from './UnsavedGuard';
import { useServerData, type DeliveryInfo } from './useBilling';

/** The plan picker's value for "not linked to a plan". */
const NO_PLAN = '__none__';

interface Props {
  invoice: Invoice;
  /** Where the invoice will be emailed. Empty when the company has no email address. */
  customerEmail: string;
  /** The CRM company page, where a missing email address can be added. */
  companyHref: string | null;
  /** The currency a draft with no lines yet starts in. */
  startCurrency: string;
  delivery: DeliveryInfo | null;
  /** The newest version of the invoice after every successful step. */
  onChange: (invoice: Invoice) => void;
  /** Fetch the invoice again, after the server says this copy is out of date. */
  onReload: () => void;
}

const isStale = (error: unknown): boolean => (error as { status?: number } | null)?.status === 409;

export const InvoiceEditor: React.FC<Props> = ({
  invoice, customerEmail, companyHref, startCurrency, delivery, onChange, onReload,
}) => {
  const id = useId();
  const { client } = useSignroom();
  const savedReceipt = invoice.receiptDraft?.enabled ? invoice.receiptDraft : null;

  const [lines, setLines] = useState<LineDraft[]>(() => lineDrafts(invoice));
  const [taxMode, setTaxMode] = useState<TaxMode>(() => taxModeOf(invoice));
  const [invoiceTax, setInvoiceTax] = useState(() => String(invoice.taxBps / 100));
  const [currency, setCurrency] = useState(() => (invoice.lines.length ? invoice.currency : startCurrency));
  const [issueDate, setIssueDate] = useState(invoice.issueDate);
  const [dueDate, setDueDate] = useState(invoice.dueDate);
  const [project, setProject] = useState(invoice.project ?? '');
  const [notes, setNotes] = useState(invoice.notes);
  const [withPayment, setWithPayment] = useState(Boolean(savedReceipt));
  const [amount, setAmount] = useState(savedReceipt?.amount ?? '');
  const [paidOn, setPaidOn] = useState(() => savedReceipt?.paidOn || billingToday());
  const [method, setMethod] = useState(savedReceipt?.method || 'Bank transfer');
  const [reference, setReference] = useState(savedReceipt?.reference ?? '');
  const [received, setReceived] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [confirm, setConfirm] = useState<null | 'issue' | 'send'>(null);

  // The company's billing plans. A draft can count towards one that is active and in the invoice's currency.
  // The server calls a plan a "client project", so the link travels as `projectId`.
  const plans = useServerData<ProjectList>(`client-projects/${invoice.clientId}`);
  const [planId, setPlanId] = useState(invoice.projectId ?? '');
  const [planNote, setPlanNote] = useState('');
  const allPlans = plans.data?.projects ?? [];
  const planChoices = allPlans.filter((p) => p.id === planId || (!p.archived && p.currency === currency));
  const otherCurrencies = Array.from(new Set(allPlans.filter((p) => !p.archived).map((p) => p.currency))).sort();

  const live = liveTotals(lines, taxMode, invoiceTax);
  const totalMinor = live.totals?.totalMinor || invoice.totalMinor;
  const money = (minor: number) => formatMinor(minor, currency);

  const touch = <T,>(set: (value: T) => void) => (value: T) => { set(value); setDirty(true); };
  const editLine = (index: number, patch: Partial<LineDraft>) => {
    setLines((old) => old.map((l, n) => (n === index ? { ...l, ...patch } : l)));
    setDirty(true);
  };
  const changeTaxMode = (next: TaxMode) => {
    if (next === taxMode) return;
    // Carry the rate across, so switching does not change the total by surprise.
    if (next === 'line') setLines((old) => old.map((l) => ({ ...l, taxPercent: invoiceTax || '0' })));
    else if (lines.every((l) => l.taxPercent === lines[0]?.taxPercent)) setInvoiceTax(lines[0]?.taxPercent || '0');
    setTaxMode(next);
    setDirty(true);
  };
  const changeCurrency = (next: string) => {
    setCurrency(next);
    setDirty(true);
    // A plan is in one currency, and only an invoice in that currency can count towards it.
    const linked = allPlans.find((p) => p.id === planId);
    if (linked && linked.currency !== next) {
      setPlanId('');
      setPlanNote(`${linked.name} is billed in ${linked.currency}, so it is no longer linked to this invoice.`);
    } else {
      setPlanNote('');
    }
  };
  const choosePlan = (value: string) => {
    const next = value === NO_PLAN ? '' : value;
    setPlanId(next);
    setPlanNote('');
    setDirty(true);
    // An empty reference takes the plan's name, so the invoice says what it is for.
    const chosen = allPlans.find((p) => p.id === next);
    if (chosen && !project.trim()) setProject(chosen.name.slice(0, 200));
  };

  const post = (action: string, body: unknown) => client.call<Invoice>(`billing/${invoice.id}/${action}`, body);
  const fail = (error: unknown, before = '') => {
    toast.error(before + errorSentence(error), isStale(error) ? { action: { label: 'Reload', onClick: onReload } } : undefined);
  };
  const saveBody = () => ({
    revision: invoice.revision,
    lines: linesForServer(lines, taxMode),
    currency,
    issueDate,
    dueDate,
    taxPercent: invoiceTax || '0',
    receiptDraft: withPayment ? { enabled: true, amount, paidOn, method, reference } : null,
    project,
    // The plan this draft counts towards, or "" for none. Left out while the plans could not be read,
    // so the server keeps whatever link the draft already has.
    projectId: plans.data ? planId : undefined,
    notes,
  });
  const issueBody = (revision: number) => ({
    revision,
    createReceipt: withPayment,
    payment: withPayment
      ? { amount: amount || (totalMinor / 100).toFixed(2), paidOn, method, reference, confirmed: received }
      : undefined,
  });
  const issuedMessage = (issued: Invoice) =>
    issued.payments.length ? 'Invoice issued and receipt created.' : 'Invoice issued.';

  const save = async () => {
    setBusy(true);
    try {
      onChange(await post('save', saveBody()));
      setDirty(false);
      toast.success('Draft saved');
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const issue = async () => {
    setBusy(true);
    try {
      const issued = await post('issue', issueBody(invoice.revision));
      toast.success(issuedMessage(issued));
      onChange(issued);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  /** Save, then issue, then email: three calls, stopping at the first that fails. */
  const saveIssueSend = async () => {
    setBusy(true);
    let current: Invoice | null = null;
    let issued = false;
    try {
      current = await post('save', saveBody());
      setDirty(false);
      current = await post('issue', issueBody(current.revision));
      issued = true;
      current = await post('send', {});
      toast.success(`Email sent to ${current.customer?.email || customerEmail}.`);
    } catch (error) {
      fail(error, issued ? 'The invoice was issued, but the email was not sent. Use Send invoice to try again. ' : '');
    } finally {
      setBusy(false);
      if (current) onChange(current);
    }
  };

  const paymentUnconfirmed = withPayment && !received;
  const canIssue = !busy && !dirty && invoice.totalMinor > 0 && !paymentUnconfirmed;
  const canSend = !busy && Boolean(customerEmail) && Boolean(delivery?.ready) && !paymentUnconfirmed;
  const canPreview = !busy && !dirty && invoice.lines.length > 0;

  return (
    <form
      className="flex min-w-0 flex-col gap-4"
      onSubmit={(event) => { event.preventDefault(); void save(); }}
    >
      <Card title="Details">
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className={FIELD}>
            <Label htmlFor={`${id}-currency`}>Currency</Label>
            <Select value={currency} onValueChange={changeCurrency} disabled={busy}>
              <SelectTrigger id={`${id}-currency`}><SelectValue /></SelectTrigger>
              <SelectContent>
                {INVOICE_CURRENCIES.map((code) => <SelectItem key={code} value={code}>{code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className={FIELD}>
            <Label htmlFor={`${id}-issue-date`}>Invoice date</Label>
            <Input
              id={`${id}-issue-date`} type="date" required className="tabular-nums" disabled={busy}
              value={issueDate} onChange={(e) => touch(setIssueDate)(e.target.value)}
            />
          </div>
          <div className={FIELD}>
            <Label htmlFor={`${id}-due-date`}>Due date</Label>
            <Input
              id={`${id}-due-date`} type="date" required min={issueDate} className="tabular-nums" disabled={busy}
              value={dueDate} onChange={(e) => touch(setDueDate)(e.target.value)}
            />
          </div>
          <div className={FIELD}>
            <Label htmlFor={`${id}-project`}>Reference (optional)</Label>
            <Input
              id={`${id}-project`} maxLength={200} disabled={busy} placeholder="Project or purchase order"
              value={project} onChange={(e) => touch(setProject)(e.target.value)}
            />
          </div>
          {plans.data && planChoices.length > 0 && (
            <div className={`${FIELD} sm:col-span-2`}>
              <Label htmlFor={`${id}-plan`}>Billing plan (optional)</Label>
              <Select value={planId || NO_PLAN} onValueChange={choosePlan} disabled={busy}>
                <SelectTrigger id={`${id}-plan`} aria-describedby={`${id}-plan-hint`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PLAN}>No plan</SelectItem>
                  {planChoices.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.archived ? `${p.name} (archived)` : p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p id={`${id}-plan-hint`} className="text-xs text-muted-foreground">
                Payments on this invoice count towards the plan. Only this company&apos;s plans in {currency} are listed.
              </p>
            </div>
          )}
          {(planNote || plans.error || (plans.data && planChoices.length === 0 && otherCurrencies.length > 0)) && (
            <p role="status" className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-4">
              {planNote
                || (plans.error && `Billing plans: ${plans.error}`)
                || `This company's billing plans are in ${otherCurrencies.join(' and ')}, so a ${currency} invoice cannot be linked to one.`}
            </p>
          )}
        </div>
      </Card>

      <Card title="Line items" count={lines.length}>
        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className={FIELD}>
              <Label htmlFor={`${id}-tax-mode`}>Tax</Label>
              <Select value={taxMode} onValueChange={(v) => changeTaxMode(v as TaxMode)} disabled={busy}>
                <SelectTrigger id={`${id}-tax-mode`} className="w-64"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="line">A tax rate on each line</SelectItem>
                  <SelectItem value="invoice">One tax rate for the whole invoice</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {taxMode === 'invoice' && (
              <div className={FIELD}>
                <Label htmlFor={`${id}-invoice-tax`}>Tax rate (%)</Label>
                <Input
                  id={`${id}-invoice-tax`} inputMode="decimal" required className="w-28 text-right tabular-nums" disabled={busy}
                  value={invoiceTax} onChange={(e) => touch(setInvoiceTax)(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="overflow-x-auto rounded-md border border-border" role="region" aria-label="Invoice line items" tabIndex={0}>
            <table className="w-full min-w-[52rem] text-sm">
              <thead>
                <tr className={HEAD_ROW}>
                  <th scope="col" className={TH}>Description</th>
                  <th scope="col" className={TH}>Billing type</th>
                  <th scope="col" className={TH_RIGHT}>Quantity</th>
                  <th scope="col" className={TH_RIGHT}>Unit price ({currency})</th>
                  {taxMode === 'line' && <th scope="col" className={TH_RIGHT}>Tax %</th>}
                  <th scope="col" className={TH_RIGHT}>{taxMode === 'line' ? 'Total with tax' : 'Amount'}</th>
                  <th scope="col" className={TH_RIGHT}><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, n) => {
                  const made = live.totals?.lines[n];
                  return (
                    <tr key={n} className={`${ROW} align-top`}>
                      <td className="min-w-64 p-2">
                        <Textarea
                          aria-label={`Description for item ${n + 1}`}
                          required rows={2} maxLength={1500} disabled={busy}
                          className="min-h-[3.5rem]"
                          placeholder="What you are charging for"
                          value={l.description}
                          onChange={(e) => editLine(n, { description: e.target.value })}
                        />
                      </td>
                      <td className="w-40 p-2">
                        <div className="flex flex-col gap-1.5">
                          <Select value={l.billingType} onValueChange={(v) => editLine(n, { billingType: v as BillingType })} disabled={busy}>
                            <SelectTrigger aria-label={`Billing type for item ${n + 1}`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {BILLING_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          {l.billingType === 'Custom' && (
                            <Input
                              aria-label={`Custom billing type for item ${n + 1}`}
                              required maxLength={80} disabled={busy} placeholder="For example, per milestone"
                              value={l.billingLabel}
                              onChange={(e) => editLine(n, { billingLabel: e.target.value })}
                            />
                          )}
                        </div>
                      </td>
                      <td className="w-24 p-2">
                        <Input
                          aria-label={`Quantity for item ${n + 1}`}
                          required inputMode="decimal" disabled={busy} className="text-right tabular-nums"
                          value={l.quantity}
                          onChange={(e) => editLine(n, { quantity: e.target.value })}
                        />
                      </td>
                      <td className="w-32 p-2">
                        <Input
                          aria-label={`Unit price for item ${n + 1}`}
                          required inputMode="decimal" disabled={busy} className="text-right tabular-nums"
                          value={l.rate}
                          onChange={(e) => editLine(n, { rate: e.target.value })}
                        />
                      </td>
                      {taxMode === 'line' && (
                        <td className="w-24 p-2">
                          <Input
                            aria-label={`Tax percent for item ${n + 1}`}
                            required inputMode="decimal" disabled={busy} className="text-right tabular-nums"
                            value={l.taxPercent}
                            onChange={(e) => editLine(n, { taxPercent: e.target.value })}
                          />
                        </td>
                      )}
                      <td className="whitespace-nowrap px-3 py-3.5 text-right font-medium tabular-nums md:py-2.5">
                        <output aria-label={`Total for item ${n + 1}`}>
                          {made ? money(made.totalMinor + (made.taxMinor ?? 0)) : '—'}
                        </output>
                      </td>
                      <td className="p-2 text-right">
                        <Button
                          type="button" size="icon" variant="ghost"
                          aria-label={`Remove item ${n + 1}`}
                          disabled={busy || lines.length === 1}
                          onClick={() => { setLines((old) => old.filter((_, j) => j !== n)); setDirty(true); }}
                        >
                          <Trash2 />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-2">
              <div>
                <Button
                  type="button" variant="outline" disabled={busy || lines.length >= 100}
                  onClick={() => { setLines((old) => [...old, emptyLine()]); setDirty(true); }}
                >
                  <Plus aria-hidden /> Add line
                </Button>
              </div>
              <p className="max-w-md text-xs text-muted-foreground">
                Monthly, quarterly and yearly are labels on the invoice only. Nothing is sent or charged again by itself.
              </p>
            </div>
            <dl className="ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm" aria-live="polite" aria-label="Invoice totals">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="text-right tabular-nums">{live.totals ? money(live.totals.subtotalMinor) : '—'}</dd>
              <dt className="text-muted-foreground">Tax</dt>
              <dd className="text-right tabular-nums">{live.totals ? money(live.totals.taxMinor) : '—'}</dd>
              <dt className="border-t border-border pt-1 font-semibold text-foreground">Total</dt>
              <dd className="border-t border-border pt-1 text-right font-semibold tabular-nums text-foreground">
                {live.totals ? money(live.totals.totalMinor) : '—'}
              </dd>
              {live.problem && <dd className="col-span-2 pt-1 text-xs text-muted-foreground">{live.problem}</dd>}
            </dl>
          </div>
        </div>
      </Card>

      <Card title="Notes">
        <div className={`${FIELD} p-4`}>
          <Label htmlFor={`${id}-notes`}>Notes shown on the invoice (optional)</Label>
          <Textarea
            id={`${id}-notes`} rows={3} maxLength={5000} disabled={busy}
            value={notes} onChange={(e) => touch(setNotes)(e.target.value)}
          />
        </div>
      </Card>

      <Card title="Payment already received">
        <div className="flex flex-col gap-3 p-4">
          <Tick checked={withPayment} onChange={(next) => { setWithPayment(next); setReceived(false); }} disabled={busy}>
            Record a payment and create its receipt when this invoice is issued
          </Tick>
          <p className="text-xs text-muted-foreground">
            Leave this off to issue the invoice on its own. Saving a draft never records a payment or makes a receipt.
          </p>
          {withPayment && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className={FIELD}>
                  <Label htmlFor={`${id}-amount`}>Amount received ({currency})</Label>
                  <Input
                    id={`${id}-amount`} inputMode="decimal" disabled={busy} className="text-right tabular-nums"
                    placeholder={live.totals ? (live.totals.totalMinor / 100).toFixed(2) : 'Full amount'}
                    value={amount} onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
                <div className={FIELD}>
                  <Label htmlFor={`${id}-paid-on`}>Payment date</Label>
                  <Input
                    id={`${id}-paid-on`} type="date" max={billingToday()} disabled={busy} className="tabular-nums"
                    value={paidOn} onChange={(e) => setPaidOn(e.target.value)}
                  />
                </div>
                <div className={FIELD}>
                  <Label htmlFor={`${id}-method`}>Payment method</Label>
                  <Input id={`${id}-method`} maxLength={100} disabled={busy} value={method} onChange={(e) => setMethod(e.target.value)} />
                </div>
                <div className={FIELD}>
                  <Label htmlFor={`${id}-reference`}>Payment reference</Label>
                  <Input id={`${id}-reference`} maxLength={200} disabled={busy} value={reference} onChange={(e) => setReference(e.target.value)} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Leave the amount empty to record the full invoice total. Enter less for a part payment.
              </p>
              <Tick checked={received} onChange={setReceived} disabled={busy}>
                I confirm this payment has actually been received.
              </Tick>
            </>
          )}
        </div>
      </Card>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">
          {customerEmail
            ? <>This invoice will be emailed to <span className="font-medium text-foreground">{customerEmail}</span>.</>
            : <>This company has no email address, so the invoice cannot be sent yet.{' '}
              {companyHref && <Link to={companyHref} className="font-medium text-foreground underline underline-offset-4">Add one on the company page</Link>}
              {companyHref && ', to the company or to one of its leads.'}</>}
          {' '}Issuing locks the amounts, the customer details and how the invoice looks. It cannot be edited afterwards.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="outline" disabled={busy}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            Save draft
          </Button>
          <Button type="button" variant="outline" disabled={!canPreview} onClick={() => setShowPreview((v) => !v)}>
            {showPreview ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
            {showPreview ? 'Hide PDF' : 'Preview PDF'}
          </Button>
          <Button type="button" variant="outline" disabled={!canIssue} onClick={() => setConfirm('issue')}>
            Issue invoice
          </Button>
          <Button type="button" disabled={!canSend} onClick={() => setConfirm('send')}>
            <Send aria-hidden /> Save, issue and send
          </Button>
          <span className="text-xs text-muted-foreground" role="status">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
        </div>
        {(dirty || paymentUnconfirmed || (!dirty && invoice.totalMinor <= 0)) && (
          <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            {dirty && <li>Save your changes before you preview or issue the invoice.</li>}
            {!dirty && invoice.totalMinor <= 0 && <li>Add at least one line with a price before you issue the invoice.</li>}
            {paymentUnconfirmed && <li>Tick the box to confirm the payment has been received.</li>}
          </ul>
        )}
        {delivery && !delivery.ready && (
          <p className="text-xs text-muted-foreground">
            Sending email is not set up for this app yet. You can still issue the invoice and download its PDF.
          </p>
        )}
      </div>

      {showPreview && canPreview && (
        <Card title="PDF preview">
          <div className="p-4">
            <PdfFrame
              load={() => client.pdf(`billing/${invoice.id}/preview?v=${invoice.revision}`)}
              sourceKey={`${invoice.id}-${invoice.revision}`}
              title={`Invoice ${invoice.number} preview`}
              filename={`${invoice.number}-draft.pdf`}
            />
          </div>
        </Card>
      )}

      <UnsavedGuard when={dirty} what="Your changes to this invoice" />

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === 'send' ? `Issue and send ${invoice.number}?` : `Issue ${invoice.number}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'send'
                ? `Your changes are saved, the invoice is locked, and it is emailed to ${customerEmail}.`
                : 'The invoice is locked: its amounts, customer details and look cannot be edited afterwards.'}
              {withPayment && ' The payment you entered is recorded and its receipt created.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void (confirm === 'send' ? saveIssueSend() : issue())}>
              {confirm === 'send' ? 'Issue and send' : 'Issue invoice'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
};

export default InvoiceEditor;
