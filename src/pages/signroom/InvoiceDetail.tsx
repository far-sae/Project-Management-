// One invoice at /crm/invoices/:id. A draft opens in the editor; once issued it is a read-only record.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, FileX, Loader2 } from 'lucide-react';
import type { Client, Invoice } from '../../../api/_signroom/shared/types';
import { useCrmCurrency } from '@/context/CrmCurrencyContext';
import { useCrmDeals } from '@/hooks/useCrmHub';
import { useSignroom } from '@/hooks/useSignroom';
import { billingToday, defaultInvoiceCurrency, errorSentence } from '@/lib/signroom/billing';
import { clientForCompany } from '@/services/signroom/clients';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { InvoiceEditor } from '@/components/signroom/billing/InvoiceEditor';
import { InvoiceRecord } from '@/components/signroom/billing/InvoiceRecord';
import { EmptyState, InvoiceStatus, PickWorkspace } from '@/components/signroom/billing/shared';
import { useBillingClients, useDelivery } from '@/components/signroom/billing/useBilling';

const LINK = 'font-medium text-foreground underline-offset-4 hover:underline';

export const InvoiceDetailPage: React.FC = () => {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { client, workspaceId } = useSignroom();
  const { code: companyCurrency } = useCrmCurrency();
  const { items: deals } = useCrmDeals();
  const { byId: clientsById, loading: loadingClients, error: clientsError } = useBillingClients();
  const { delivery, error: deliveryError } = useDelivery();

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState('');
  /** Counts fetches, so the editor starts again from what the server has after a reload. */
  const [fetched, setFetched] = useState(0);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const mine = ++latest.current;
    if (!workspaceId || !id) return;
    try {
      const found = await client.call<Invoice>(`billing/${encodeURIComponent(id)}`);
      if (mine !== latest.current) return;
      setInvoice(found);
      setError('');
      setFetched((n) => n + 1);
    } catch (err) {
      if (mine === latest.current) setError(errorSentence(err));
    }
  }, [client, workspaceId, id]);

  useEffect(() => {
    setInvoice(null);
    setError('');
    void load();
    return () => { latest.current += 1; };
  }, [load]);

  // A draft is issued with the customer's details as they are then. While nothing has been issued to the
  // company the server brings them up to date from the CRM, so an email address added there since is used.
  const [refreshed, setRefreshed] = useState<Client | null>(null);
  const draftCompanyId = invoice?.status === 'Draft' ? clientsById.get(invoice.clientId)?.crmCompanyId ?? null : null;
  useEffect(() => {
    if (!draftCompanyId) return;
    let alive = true;
    clientForCompany(client, draftCompanyId)
      .then((current) => { if (alive) setRefreshed(current); })
      .catch(() => { /* The details from the list still stand. */ });
    return () => { alive = false; };
  }, [client, draftCompanyId]);

  // "Record a payment" from the list arrives as ?payment=new: open the dialog once, then tidy the address.
  const startWithPayment = useRef(params.get('payment') === 'new').current;
  useEffect(() => {
    if (!params.has('payment')) return;
    const next = new URLSearchParams(params);
    next.delete('payment');
    setParams(next, { replace: true });
  }, []);

  const back = (
    <div>
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/crm/invoices"><ArrowLeft aria-hidden /> Invoices</Link>
      </Button>
    </div>
  );

  const shell = (children: React.ReactNode) => (
    <main className="min-w-0 flex-1 overflow-y-auto bg-background">
      <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">{children}</div>
    </main>
  );

  if (!workspaceId) {
    return shell(<>{back}<PageHeader title="Invoice" /><PickWorkspace what="this invoice" /></>);
  }
  if (error && !invoice) {
    return shell(
      <>
        {back}
        <EmptyState
          icon={<FileX className="h-5 w-5 text-muted-foreground" aria-hidden />}
          action={<Button asChild variant="outline"><Link to="/crm/invoices">Back to invoices</Link></Button>}
        >
          <span role="alert">{error}</span>
        </EmptyState>
      </>,
    );
  }
  const listed = invoice ? clientsById.get(invoice.clientId) ?? null : null;
  const customer = invoice && refreshed?.id === invoice.clientId ? refreshed : listed;
  const waitingForCustomer = invoice?.status === 'Draft' && loadingClients && !customer;
  if (!invoice || waitingForCustomer) {
    return shell(
      <>
        {back}
        <div className="py-16 text-center">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading the invoice" />
        </div>
      </>,
    );
  }

  const today = billingToday();
  const draft = invoice.status === 'Draft';
  const companyName = invoice.customer?.name || customer?.name || '';
  const companyHref = customer?.crmCompanyId ? `/crm/companies/${customer.crmCompanyId}` : null;
  const deal = invoice.dealId ? deals.find((d) => d.id === invoice.dealId) : undefined;

  return shell(
    <>
      {back}
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="tabular-nums">{invoice.number}</span>
            <InvoiceStatus invoice={invoice} today={today} />
          </span>
        }
        description={
          <>
            {companyName && (
              <>For {companyHref ? <Link to={companyHref} className={LINK}>{companyName}</Link> : <span className="font-medium text-foreground">{companyName}</span>}. </>
            )}
            {invoice.dealId && (
              <>Deal: <Link to={`/crm/deals/${invoice.dealId}`} className={LINK}>{deal?.name ?? 'open the deal'}</Link>. </>
            )}
            {draft
              ? 'This is a draft. Nothing is sent until you issue it.'
              : 'This invoice has been issued, so its details can no longer be changed.'}
          </>
        }
      />

      {[clientsError, deliveryError].filter(Boolean).map((sentence, n) => (
        <p key={n} role="alert" className="rounded-md border border-border px-3 py-2 text-sm text-destructive">{sentence}</p>
      ))}

      {draft ? (
        <InvoiceEditor
          key={`${invoice.id}-${fetched}`}
          invoice={invoice}
          customerEmail={customer?.email ?? ''}
          companyHref={companyHref}
          startCurrency={defaultInvoiceCurrency(customer?.account?.currency, companyCurrency, invoice.currency)}
          delivery={delivery}
          onChange={setInvoice}
          onReload={() => void load()}
        />
      ) : (
        <InvoiceRecord
          invoice={invoice}
          delivery={delivery}
          startWithPayment={startWithPayment}
          onChange={setInvoice}
          onReload={() => void load()}
        />
      )}
    </>,
  );
};

export default InvoiceDetailPage;
