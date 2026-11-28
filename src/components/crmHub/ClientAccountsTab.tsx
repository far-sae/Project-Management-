// The Accounts tab on a lead: what this lead agreed to pay, what they paid and
// what is still owed. Every number is this lead's own. A year, one month or one
// day can be looked at, and every service and payment can be changed or removed.
import { publicMessage } from '@/lib/publicError';
import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { CreditCard, FileText, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useCrmCurrency } from '@/context/CrmCurrencyContext';
import { accountCurrency, formatByCurrency, formatCurrency } from '@/lib/crmCurrency';
import type { CrmAccountPayment, CrmClientAccount } from '@/types/crmHub';
import {
  MONTH_NAMES, daysInMonth, paymentInPeriod, periodLabel, summarizeAccountPeriod, summarizeClientAccount,
  type AccountPeriod,
} from '@/lib/crmAccounts';
import {
  addAccountPayment, deleteAccountPayment, deleteClientAccount, listAccountPayments,
  listClientAccounts, updateAccountPayment,
} from '@/services/supabase/crmHub/accounts';
import { collectionRow, monthKey, monthLabel } from '@/lib/crmCollections';
import { NewInvoiceDialog, type InvoiceService } from '@/components/signroom/billing/NewInvoiceDialog';
import { ServiceDialog } from './ServiceDialog';
import { StatStrip, type StatItem } from '@/components/common/StatStrip';
import { StatusPill } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const BOX = 'overflow-hidden rounded-lg border border-border bg-card';
const ALL = '__all__';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * One of the newer fields for a save: left out while it is empty and was empty,
 * so a database that does not have the field yet still saves everything else.
 */
const changed = <K extends string, V>(key: K, now: V | null, before: V | null): Partial<Record<K, V | null>> =>
  (now === null && before === null ? {} : { [key]: now } as Record<K, V | null>);
/** "2026-03-10" → "10 Mar 2026". */
const dayLabel = (iso: string): string =>
  `${Number(iso.slice(8, 10))} ${MONTH_NAMES[Number(iso.slice(5, 7)) - 1]?.slice(0, 3) ?? ''} ${iso.slice(0, 4)}`;
/** "in 2026", "in March 2026", "on 10 March 2026". */
const inPeriodWords = (period: AccountPeriod): string => `${period.day === null ? 'in' : 'on'} ${periodLabel(period)}`;

/** The payment window: adding one to a service, or changing the one whose id it carries. */
interface PaymentForm {
  id: string | null;
  accountId: string;
  amount: string;
  paidOn: string;
  notes: string;
  /** The month the payment pays for ("2026-09"). Empty: the month of the payment date. */
  billingMonth: string;
  method: string;
  reference: string;
}

/** How a payment can have been made. */
export const PAYMENT_METHODS = ['Bank transfer', 'Card', 'Cash', 'Cheque', 'PayPal', 'Other'];

type Removing = { kind: 'service'; account: CrmClientAccount } | { kind: 'payment'; payment: CrmAccountPayment };

interface Props {
  organizationId: string;
  workspaceId: string;
  contactId: string;
  /** The lead's company. An invoice for a service is made out to it. */
  companyId?: string | null;
}

export const ClientAccountsTab: React.FC<Props> = ({ organizationId, workspaceId, contactId, companyId }) => {
  const { user } = useAuth();
  // The company's currency. A service may be in another one: its own amounts are
  // then written in that, and two currencies are never added together.
  const { code: companyCurrency } = useCrmCurrency();
  const currencyOf = useCallback((account: CrmClientAccount) => accountCurrency(account, companyCurrency), [companyCurrency]);
  const [period, setPeriod] = useState<AccountPeriod>(() => ({ year: new Date().getFullYear(), month: null, day: null }));
  const [accounts, setAccounts] = useState<CrmClientAccount[]>([]);
  const [payments, setPayments] = useState<CrmAccountPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  /** The service window: open for a new service (null inside) or for the one being changed. */
  const [service, setService] = useState<{ account: CrmClientAccount | null } | null>(null);
  const [paying, setPaying] = useState<PaymentForm | null>(null);
  const [removing, setRemoving] = useState<Removing | null>(null);
  /** The service an invoice is being made for. */
  const [invoicing, setInvoicing] = useState<InvoiceService | null>(null);

  /**
   * Opens the New invoice window for one service. A monthly fee is billed for
   * the month on screen (or this month); a one-time fee for what is still owed.
   * An invoice is made out to a company, so the lead needs one.
   */
  const startInvoice = (account: CrmClientAccount) => {
    if (!companyId) {
      toast.error('Give this lead a company first (press Edit at the top). An invoice is made out to a company.');
      return;
    }
    const month = period.month === null ? monthKey(new Date()) : `${period.year}-${String(period.month + 1).padStart(2, '0')}`;
    const owed = collectionRow(account, payments, month);
    setInvoicing(account.billingType === 'monthly'
      ? { accountId: account.id, name: account.serviceName, amount: account.agreedAmount, billingMonth: month, monthly: true, currency: currencyOf(account) }
      : { accountId: account.id, name: account.serviceName, amount: owed.collect > 0 ? owed.collect : account.agreedAmount, billingMonth: null, monthly: false, currency: currencyOf(account) });
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Only this lead's services, and only the payments made on them.
      const own = await listClientAccounts(workspaceId, contactId);
      const paid = own.length ? await listAccountPayments(workspaceId, undefined, own.map((item) => item.id)) : [];
      setAccounts(own);
      setPayments(paid);
    } catch (error) {
      toast.error(publicMessage(error, 'Could not load accounts'));
    } finally {
      setLoading(false);
    }
  }, [contactId, workspaceId]);

  useEffect(() => { void load(); }, [load]);

  /** This lead's services added together, for the time chosen. Each currency has its own sum. */
  const totals = useMemo(() => {
    const due: { amount: number; currency: string }[] = [];
    const paid: { amount: number; currency: string }[] = [];
    const outstanding: { amount: number; currency: string }[] = [];
    for (const account of accounts) {
      const one = summarizeAccountPeriod(account, payments, period);
      const currency = currencyOf(account);
      due.push({ amount: one.due ?? 0, currency });
      paid.push({ amount: one.paid, currency });
      outstanding.push({ amount: one.outstanding ?? 0, currency });
    }
    const count = payments.filter((payment) => paymentInPeriod(payment.paidOn, period)).length;
    const text = (parts: { amount: number; currency: string }[]) => formatByCurrency(parts, companyCurrency);
    return {
      due: text(due), paid: text(paid), outstanding: text(outstanding), count,
      owes: outstanding.some((part) => part.amount > 0),
    };
  }, [accounts, payments, period, currencyOf, companyCurrency]);

  const when = periodLabel(period);
  const stats: StatItem[] = period.day !== null
    ? [
        { label: 'Paid', value: totals.paid, note: `This lead · ${when}` },
        { label: 'Payments', value: totals.count, note: `Recorded on ${when}` },
      ]
    : [
        { label: period.month === null ? 'Agreed' : 'Due', value: totals.due, note: `This lead · ${when}` },
        { label: 'Paid', value: totals.paid, note: `This lead · ${when}` },
        {
          label: 'Outstanding',
          value: totals.outstanding,
          tone: totals.owes ? 'danger' : 'default',
          note: `This lead · ${when}`,
        },
      ];

  /** The currency of the service a payment was made on. */
  const paymentCurrency = (payment: CrmAccountPayment): string => {
    const account = accounts.find((item) => item.id === payment.accountId);
    return account ? currencyOf(account) : companyCurrency;
  };

  const pickMonth = (month: number | null) => setPeriod((old) => ({ year: old.year, month, day: null }));

  /** Run one change, say how it went, and read the numbers again. */
  const run = async (work: () => Promise<unknown>, done: string, failed: string, close: () => void) => {
    setBusy(true);
    try {
      await work();
      close();
      toast.success(done);
      await load();
    } catch (error) {
      toast.error(publicMessage(error, failed));
    } finally {
      setBusy(false);
    }
  };

  const paymentReady = Boolean(paying && Number(paying.amount) > 0 && paying.paidOn);
  const savePayment = () => {
    if (!paying || !paymentReady) return;
    const was = payments.find((payment) => payment.id === paying.id);
    const fields = {
      paidOn: paying.paidOn, amount: Number(paying.amount), notes: paying.notes.trim() || null,
      ...changed('billingMonth', paying.billingMonth || null, was?.billingMonth ?? null),
      ...changed('method', paying.method || null, was?.method ?? null),
      ...changed('reference', paying.reference.trim() || null, was?.reference ?? null),
    };
    void (paying.id
      ? run(() => updateAccountPayment(paying.id as string, fields), 'Payment saved', 'Could not save the payment', () => setPaying(null))
      : run(
          () => addAccountPayment({ accountId: paying.accountId, organizationId, workspaceId, ...fields, createdBy: user?.userId }),
          'Payment recorded', 'Could not record payment', () => setPaying(null),
        ));
  };

  const remove = () => {
    if (!removing) return;
    void (removing.kind === 'service'
      ? run(() => deleteClientAccount(removing.account.id), 'Service deleted', 'Could not delete the service', () => setRemoving(null))
      : run(() => deleteAccountPayment(removing.payment.id), 'Payment deleted', 'Could not delete the payment', () => setRemoving(null)));
  };

  const paymentsOf = (account: CrmClientAccount) => payments.filter((payment) => payment.accountId === account.id);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-foreground">Accounts</h3>
          <p className="text-sm text-muted-foreground">
            What this lead agreed to pay, what they paid and what is still owed. Only this lead is counted.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={String(period.year)}
            onValueChange={(value) => setPeriod((old) => ({ ...old, year: Number(value), day: null }))}
          >
            <SelectTrigger className="w-24" aria-label="Year"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[-2, -1, 0, 1].map((offset) => {
                const value = new Date().getFullYear() + offset;
                return <SelectItem key={value} value={String(value)}>{value}</SelectItem>;
              })}
            </SelectContent>
          </Select>
          <Select
            value={period.month === null ? ALL : String(period.month)}
            onValueChange={(value) => pickMonth(value === ALL ? null : Number(value))}
          >
            <SelectTrigger className="w-36" aria-label="Month"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Whole year</SelectItem>
              {MONTH_NAMES.map((name, index) => <SelectItem key={name} value={String(index)}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
          {period.month !== null && (
            <Select
              value={period.day === null ? ALL : String(period.day)}
              onValueChange={(value) => setPeriod((old) => ({ ...old, day: value === ALL ? null : Number(value) }))}
            >
              <SelectTrigger className="w-32" aria-label="Day"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Whole month</SelectItem>
                {Array.from({ length: daysInMonth(period.year, period.month) }, (_, index) => (
                  <SelectItem key={index} value={String(index + 1)}>{index + 1}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button onClick={() => setService({ account: null })}><Plus aria-hidden />Add service</Button>
        </div>
      </div>

      <div role="group" aria-label="Totals for this lead">
        <StatStrip items={stats} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading accounts" />
        </div>
      ) : accounts.length === 0 ? (
        <div className={BOX}>
          <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
            <CreditCard className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">No services or billing records yet.</p>
            <p className="text-xs text-muted-foreground">Add what this lead pays for. Then record each payment as it arrives.</p>
            <Button variant="outline" className="mt-3" onClick={() => setService({ account: null })}>Add service</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {accounts.map((account) => {
            const year = summarizeClientAccount(account, payments, period.year);
            const code = currencyOf(account);
            // Everything in this box is this one service's money, in its own currency.
            const money = (amount: number) => formatCurrency(amount, code);
            const shown = paymentsOf(account)
              .filter((payment) => paymentInPeriod(payment.paidOn, period))
              .sort((a, b) => b.paidOn.localeCompare(a.paidOn));
            return (
              <div key={account.id} className={BOX}>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{account.serviceName}</p>
                    {code !== companyCurrency && <p className="truncate text-xs text-muted-foreground">Amounts in {code}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusPill tone="neutral" dot={false} className="tabular-nums">
                      {account.billingType === 'monthly' ? `${money(account.agreedAmount)}/month` : 'One-time'}
                    </StatusPill>
                    <Button
                      size="sm" variant="outline"
                      onClick={() => setPaying({ id: null, accountId: account.id, amount: '', paidOn: today(), notes: '', billingMonth: '', method: '', reference: '' })}
                    >
                      Add payment
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => startInvoice(account)} aria-label={`Create an invoice for ${account.serviceName}`}>
                      <FileText aria-hidden />Invoice
                    </Button>
                    <Button
                      size="icon" variant="ghost" aria-label={`Edit ${account.serviceName}`} title="Edit service"
                      onClick={() => setService({ account })}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      size="icon" variant="ghost" aria-label={`Delete ${account.serviceName}`} title="Delete service"
                      onClick={() => setRemoving({ kind: 'service', account })}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>

                {/* The year, month by month. Press a month to see only that month. */}
                <div className="grid grid-cols-3 gap-2 px-4 py-3 sm:grid-cols-6 xl:grid-cols-12">
                  {MONTH_NAMES.map((name, index) => {
                    const chosen = period.month === index;
                    return (
                      <button
                        key={name}
                        type="button"
                        aria-pressed={chosen}
                        title={chosen ? 'Show the whole year' : `Show ${name} only`}
                        onClick={() => pickMonth(chosen ? null : index)}
                        className={cn(
                          'min-w-0 rounded-md border px-1 py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          chosen ? 'border-foreground bg-secondary' : 'border-transparent bg-secondary hover:border-border',
                        )}
                      >
                        <span className="block text-[0.6875rem] text-muted-foreground">{name.slice(0, 3)}</span>
                        <span className="block truncate text-xs font-medium tabular-nums">{money(year.monthlyPaid[index])}</span>
                      </button>
                    );
                  })}
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border px-4 py-3 text-sm sm:grid-cols-4">
                  <Figure label="Opening" value={money(account.openingPaid)} />
                  <Figure label={`Agreed, ${period.year}`} value={money(year.due)} />
                  <Figure label={`Paid, ${period.year}`} value={money(year.paid)} />
                  <Figure
                    label="Outstanding"
                    value={money(year.outstanding)}
                    className={year.outstanding > 0 ? 'text-destructive' : 'text-success'}
                  />
                </dl>

                <div className="border-t border-border">
                  <p className="px-4 pt-3 text-xs font-medium text-muted-foreground">
                    Payments {inPeriodWords(period)} <span className="tabular-nums">· {shown.length}</span>
                  </p>
                  {shown.length === 0 ? (
                    <p className="px-4 pb-3 pt-1 text-sm text-muted-foreground">No payments {inPeriodWords(period)}.</p>
                  ) : (
                    <ul aria-label={`Payments for ${account.serviceName} ${inPeriodWords(period)}`} className="divide-y divide-border">
                      {shown.map((payment) => (
                        <li key={payment.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm">
                          <span className="w-28 shrink-0 tabular-nums text-muted-foreground">{dayLabel(payment.paidOn)}</span>
                          <span className="w-28 shrink-0 font-medium tabular-nums">{money(payment.amount)}</span>
                          <span className="min-w-0 flex-1 truncate text-muted-foreground" title={payment.notes ?? undefined}>
                            {[
                              payment.billingMonth && payment.billingMonth !== payment.paidOn.slice(0, 7) ? `for ${monthLabel(payment.billingMonth)}` : '',
                              payment.method ?? '', payment.reference ?? '', payment.notes ?? '',
                            ].filter(Boolean).join(' · ')}
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            <Button
                              size="icon" variant="ghost" aria-label={`Edit the payment of ${dayLabel(payment.paidOn)}`} title="Edit payment"
                              onClick={() => setPaying({
                                id: payment.id, accountId: payment.accountId, amount: String(payment.amount),
                                paidOn: payment.paidOn, notes: payment.notes ?? '',
                                billingMonth: payment.billingMonth ?? '', method: payment.method ?? '', reference: payment.reference ?? '',
                              })}
                            >
                              <Pencil />
                            </Button>
                            <Button
                              size="icon" variant="ghost" aria-label={`Delete the payment of ${dayLabel(payment.paidOn)}`} title="Delete payment"
                              onClick={() => setRemoving({ kind: 'payment', payment })}
                            >
                              <Trash2 />
                            </Button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {account.notes && (
                  <p className="whitespace-pre-wrap break-words border-t border-border px-4 py-3 text-sm text-muted-foreground">
                    {account.notes}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ServiceDialog
        open={service !== null} onOpenChange={(open) => { if (!open) setService(null); }}
        organizationId={organizationId} workspaceId={workspaceId} contactId={contactId}
        account={service?.account ?? null} year={period.year} onSaved={load}
      />

      {invoicing && companyId && (
        <NewInvoiceDialog open companyId={companyId} service={invoicing} onOpenChange={(open) => { if (!open) setInvoicing(null); }} />
      )}

      <Dialog open={paying !== null} onOpenChange={(open) => { if (!open && !busy) setPaying(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{paying?.id ? 'Edit payment' : 'Record payment'}</DialogTitle></DialogHeader>
          {paying && (
            <div className="space-y-3">
              <Field label="Amount">
                {(id) => (
                  <Input
                    id={id} type="number" min="0.01" step="0.01" value={paying.amount}
                    onChange={(e) => setPaying({ ...paying, amount: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Payment date">
                {(id) => <Input id={id} type="date" value={paying.paidOn} onChange={(e) => setPaying({ ...paying, paidOn: e.target.value })} />}
              </Field>
              <Field label="Pays for the month">
                {(id) => <Input id={id} type="month" value={paying.billingMonth} onChange={(e) => setPaying({ ...paying, billingMonth: e.target.value })} />}
              </Field>
              <p className="-mt-2 text-xs text-muted-foreground">Leave empty when it pays for the month it arrived in.</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Method">
                  {(id) => (
                    <select
                      id={id} className="h-11 md:h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      value={paying.method} onChange={(e) => setPaying({ ...paying, method: e.target.value })}
                    >
                      <option value="">Not said</option>
                      {[...new Set([...PAYMENT_METHODS, ...(paying.method ? [paying.method] : [])])].map((method) => <option key={method} value={method}>{method}</option>)}
                    </select>
                  )}
                </Field>
                <Field label="Reference">
                  {(id) => <Input id={id} maxLength={80} placeholder="Receipt or bank reference" value={paying.reference} onChange={(e) => setPaying({ ...paying, reference: e.target.value })} />}
                </Field>
              </div>
              <Field label="Notes">
                {(id) => <Textarea id={id} value={paying.notes} onChange={(e) => setPaying({ ...paying, notes: e.target.value })} />}
              </Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaying(null)} disabled={busy}>Cancel</Button>
            <Button disabled={busy || !paymentReady} onClick={savePayment}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}Save payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removing !== null} onOpenChange={(open) => { if (!open && !busy) setRemoving(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {removing?.kind === 'service' ? `Delete ${removing.account.serviceName}?` : 'Delete this payment?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.kind === 'service' && (() => {
                const count = paymentsOf(removing.account).length;
                return count
                  ? `The service and its ${count} ${count === 1 ? 'payment' : 'payments'} are removed from this lead’s accounts. This cannot be undone.`
                  : 'The service is removed from this lead’s accounts. This cannot be undone.';
              })()}
              {removing?.kind === 'payment'
                && `${formatCurrency(removing.payment.amount, paymentCurrency(removing.payment))} paid on ${dayLabel(removing.payment.paidOn)} is removed from this lead’s accounts. This cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => { event.preventDefault(); remove(); }}
            >
              {removing?.kind === 'service' ? 'Delete service' : 'Delete payment'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

/** One labelled amount in a service's totals row. */
const Figure: React.FC<{ label: string; value: string; className?: string }> = ({ label, value, className }) => (
  <div className="min-w-0">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className={cn('truncate font-medium tabular-nums', className)}>{value}</dd>
  </div>
);

/** A form field; hands its control the id the label points at. */
const Field: React.FC<{ label: string; children: (id: string) => React.ReactNode }> = ({ label, children }) => {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
    </div>
  );
};
