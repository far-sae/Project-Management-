// Start an invoice: pick the CRM company it is for and, if you like, the deal it bills.
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Invoice } from '../../../../api/_signroom/shared/types';
import { useCrmCurrency } from '@/context/CrmCurrencyContext';
import { useCrmCompanies, useCrmDeals } from '@/hooks/useCrmHub';
import { useSignroom } from '@/hooks/useSignroom';
import { formatCurrency } from '@/lib/crmCurrency';
import { dealCurrency } from '@/lib/crmDealMoney';
import { INVOICE_CURRENCIES, dealFirstLine, defaultInvoiceCurrency, emptyLine, errorSentence } from '@/lib/signroom/billing';
import { clientForCompany } from '@/services/signroom/clients';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { FIELD, Tick } from './shared';

const NONE = '__none__';

export interface NewInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** CRM company to start with (the company page passes its own). */
  companyId?: string;
  /** CRM deal to start with (the deal page passes its own). */
  dealId?: string;
  /** Called with the new draft before the editor opens. */
  onCreated?: (invoice: Invoice) => void;
  /**
   * The client service this invoice bills (the lead's Accounts tab). The draft
   * starts with one line for it, and a payment recorded on the invoice is then
   * written on the service too.
   */
  service?: InvoiceService;
}

export interface InvoiceService {
  accountId: string;
  name: string;
  /** What to bill, in major units. */
  amount: number;
  /** The month it bills ("2026-09"), or null for a one-time fee. */
  billingMonth: string | null;
  monthly: boolean;
  /** The currency the amount is in. Left out: the company's own. */
  currency?: string | null;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The first line of an invoice made for a service: "Digital marketing, November 2026". */
export function serviceLine(service: InvoiceService): { description: string; rate: string; billingType: 'Monthly' | 'One-off' } {
  const month = service.billingMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(service.billingMonth)
    ? `${MONTHS[Number(service.billingMonth.slice(5, 7)) - 1]} ${service.billingMonth.slice(0, 4)}` : '';
  const amount = Number.isFinite(service.amount) && service.amount > 0 && service.amount < 1e9 ? Math.round(service.amount * 100) / 100 : 0;
  return {
    description: [service.name.trim(), month].filter(Boolean).join(', ').slice(0, 1500),
    rate: amount.toFixed(2),
    billingType: service.monthly ? 'Monthly' : 'One-off',
  };
}

/**
 * The currency a service is billed in, when it has one of its own that an
 * invoice cannot be in (invoices know fewer currencies than services). Its
 * amount is then left out: a number is never moved to another currency.
 */
export function unusableServiceCurrency(service: InvoiceService | undefined): string | null {
  const code = (service?.currency ?? '').trim().toUpperCase();
  return code && !INVOICE_CURRENCIES.includes(code) ? code : null;
}

/**
 * Who an invoice is for always comes from the CRM. Creating one makes a draft
 * on the documents server and opens it at /crm/invoices/:id.
 */
export const NewInvoiceDialog: React.FC<NewInvoiceDialogProps> = ({ open, onOpenChange, companyId, dealId, onCreated, service }) => {
  const id = useId();
  const navigate = useNavigate();
  const { client, workspaceId } = useSignroom();
  const { code: companyCurrency } = useCrmCurrency();
  const { items: companies, loading: loadingCompanies } = useCrmCompanies();
  const { items: deals } = useCrmDeals();

  const [company, setCompany] = useState('');
  const [deal, setDeal] = useState('');
  const [useDealLine, setUseDealLine] = useState(true);
  // Whether a receipt is made together with the invoice. Off unless it is chosen: the invoice goes first.
  const [withReceipt, setWithReceipt] = useState(false);
  const [busy, setBusy] = useState(false);

  // Each time it opens, start from what the page passed in.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setCompany(companyId ?? '');
      setDeal(dealId ?? '');
      setUseDealLine(true);
      setWithReceipt(false);
    }
    wasOpen.current = open;
  }, [open, companyId, dealId]);

  // A deal brings its company with it, once the deals have loaded.
  useEffect(() => {
    if (!open || company || !dealId) return;
    const startDeal = deals.find((d) => d.id === dealId);
    if (startDeal?.companyId) setCompany(startDeal.companyId);
  }, [open, company, dealId, deals]);

  const sortedCompanies = useMemo(() => [...companies].sort((a, b) => a.name.localeCompare(b.name)), [companies]);
  const companyDeals = useMemo(() => deals.filter((d) => company && d.companyId === company), [deals, company]);
  const chosenDeal = deals.find((d) => d.id === deal) ?? null;
  const dealStart = chosenDeal ? dealFirstLine(chosenDeal, companyCurrency) : null;
  const dealMoney = (d: { value: number; currency: string | null }) =>
    formatCurrency(d.value, dealCurrency(d, companyCurrency), { maximumFractionDigits: 2 });

  /** Set when the service's amount is in a currency an invoice cannot be in. */
  const noPriceIn = unusableServiceCurrency(service);

  const chooseCompany = (next: string) => {
    setCompany(next);
    if (chosenDeal && chosenDeal.companyId !== next) setDeal('');
  };

  const create = async () => {
    if (!workspaceId || !company) return;
    setBusy(true);
    try {
      const customer = await clientForCompany(client, company);
      let invoice = await client.call<Invoice>('billing', {
        clientId: customer.id, ...(deal ? { dealId: deal } : {}),
        ...(service ? { accountId: service.accountId, ...(service.billingMonth ? { billingMonth: service.billingMonth } : {}) } : {}),
      });
      if (service) {
        // The draft starts with the service as its first line, ready to check and issue.
        try {
          invoice = await client.call<Invoice>(`billing/${invoice.id}/save`, {
            revision: invoice.revision,
            lines: [{ ...emptyLine(), ...serviceLine(service), ...(noPriceIn ? { rate: '0.00' } : {}) }],
            // The amount is in the service's currency, so the invoice is too.
            currency: defaultInvoiceCurrency((noPriceIn ? null : service.currency) || customer.account?.currency, companyCurrency, invoice.currency),
            issueDate: invoice.issueDate,
            dueDate: invoice.dueDate,
            taxPercent: '0',
            receiptDraft: null,
            project: '',
            notes: '',
          });
        } catch (error) {
          toast.error(`The invoice was created, but its first line could not be added. ${errorSentence(error)}`);
        }
      } else if (dealStart && useDealLine) {
        try {
          invoice = await client.call<Invoice>(`billing/${invoice.id}/save`, {
            revision: invoice.revision,
            lines: [dealStart.line],
            currency: dealStart.currency ?? defaultInvoiceCurrency(customer.account?.currency, companyCurrency, invoice.currency),
            issueDate: invoice.issueDate,
            dueDate: invoice.dueDate,
            taxPercent: '0',
            receiptDraft: null,
            project: '',
            notes: '',
          });
        } catch (error) {
          toast.error(`The invoice was created, but its first line could not be added. ${errorSentence(error)}`);
        }
      }
      toast.success(`${invoice.number} created`);
      onOpenChange(false);
      onCreated?.(invoice);
      // The draft opens with its receipt switched on; the payment is filled in and confirmed there.
      navigate(`/crm/invoices/${invoice.id}${withReceipt ? '?receipt=with' : ''}`);
    } catch (error) {
      toast.error(errorSentence(error, 'Could not create the invoice'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New invoice</DialogTitle>
          <DialogDescription>
            Pick the company to bill. You add the line items next, and nothing is sent until you send it.
          </DialogDescription>
        </DialogHeader>

        {!workspaceId ? (
          <p className="text-sm text-muted-foreground">Pick a workspace in the sidebar first. An invoice always belongs to one workspace.</p>
        ) : !loadingCompanies && companies.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            There are no companies yet. <Link to="/crm/companies" className="font-medium text-foreground underline underline-offset-4">Add a company</Link> first, then invoice it.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className={FIELD}>
              <Label htmlFor={`${id}-company`}>Company</Label>
              <Select value={company} onValueChange={chooseCompany} disabled={busy}>
                <SelectTrigger id={`${id}-company`}><SelectValue placeholder="Choose a company" /></SelectTrigger>
                <SelectContent>
                  {sortedCompanies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className={FIELD}>
              <Label htmlFor={`${id}-deal`}>Deal (optional)</Label>
              <Select value={deal || NONE} onValueChange={(v) => setDeal(v === NONE ? '' : v)} disabled={busy || !company}>
                <SelectTrigger id={`${id}-deal`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No deal</SelectItem>
                  {companyDeals.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name} · {dealMoney(d)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {company && companyDeals.length === 0 && (
                <p className="text-xs text-muted-foreground">This company has no deals yet.</p>
              )}
            </div>

            {service && noPriceIn && (
              <p className="rounded-md border border-border p-3 text-xs text-muted-foreground">
                Adds “{service.name}” without a price, because invoices can&apos;t be in {noPriceIn}. You set the price and currency next.
              </p>
            )}

            {chosenDeal && dealStart && (
              <div className="flex flex-col gap-1.5 rounded-md border border-border p-3">
                <Tick checked={useDealLine} onChange={setUseDealLine} disabled={busy}>
                  Start the first line from this deal
                </Tick>
                <p className="pl-6 text-xs text-muted-foreground">
                  {dealStart.currency
                    ? <>Adds “{chosenDeal.name}” at <span className="tabular-nums">{dealMoney(chosenDeal)}</span>. The invoice will be in {dealStart.currency}, the deal&apos;s currency. You can change the line afterwards.</>
                    : <>Adds “{chosenDeal.name}” without a price, because invoices can&apos;t be in {dealCurrency(chosenDeal, companyCurrency)}. You set the price and currency next.</>}
                </p>
              </div>
            )}

            <fieldset className="flex flex-col gap-2.5 rounded-md border border-border p-3" disabled={busy}>
              <legend className="px-1 text-sm font-medium text-foreground">Receipt</legend>
              <label className="flex items-start gap-2 text-sm text-foreground">
                <input
                  type="radio" name={`${id}-receipt`} className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                  checked={!withReceipt} onChange={() => setWithReceipt(false)}
                />
                <span className="min-w-0">
                  No receipt yet
                  <span className="block text-xs text-muted-foreground">
                    Send the invoice first. Make the receipt when the money is in the bank.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-foreground">
                <input
                  type="radio" name={`${id}-receipt`} className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                  checked={withReceipt} onChange={() => setWithReceipt(true)}
                />
                <span className="min-w-0">
                  Make a receipt with this invoice
                  <span className="block text-xs text-muted-foreground">
                    Only when the money has arrived already. You enter the payment on the next screen.
                  </span>
                </span>
              </label>
            </fieldset>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void create()} disabled={busy || !workspaceId || !company}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            Create invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default NewInvoiceDialog;
