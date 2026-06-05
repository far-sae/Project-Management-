import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, FileDown } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { getPublicInvoice, payInvoice, type PublicInvoiceView, type Invoice } from '@/services/supabase/invoices';
import { downloadInvoicePdf } from '@/components/billing/invoicePdf';

const money = (n: number, c: string) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: c }).format(n); }
  catch { return `${c} ${n.toFixed(2)}`; }
};

export const PublicInvoice: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [inv, setInv] = useState<PublicInvoiceView | null>(null);
  const [loading, setLoading] = useState(true);
  const paidFlag = new URLSearchParams(window.location.search).get('paid') === '1';
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const v = token ? await getPublicInvoice(token) : null;
      if (alive) { setInv(v); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [token]);

  if (loading) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }
  if (!inv) {
    return <div className="min-h-screen grid place-items-center p-6 text-center text-muted-foreground">This invoice is not available.</div>;
  }

  const downloadPdf = () => {
    // Adapt the public view to the shape downloadInvoicePdf reads.
    const asInvoice = {
      invoiceNumber: inv.invoiceNumber, currency: inv.currency, subtotal: inv.subtotal,
      taxAmount: inv.taxAmount, discount: inv.discount, total: inv.total, amountPaid: inv.amountPaid,
      lineItems: inv.lineItems, notes: null, terms: inv.terms, issuedAt: inv.issuedAt, dueAt: inv.dueAt,
    } as unknown as Invoice;
    void downloadInvoicePdf(asInvoice, { name: inv.orgName }, inv.clientName);
  };

  const payNow = async () => {
    if (!inv) return;
    setPaying(true);
    try {
      const url = await payInvoice(token!);
      if (!url) { alert('Online payment is not available for this invoice.'); return; }
      window.location.href = url;
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Payment could not be started.');
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/30 py-10 px-4">
      <div className="max-w-2xl mx-auto bg-card rounded-xl border shadow-sm p-8">
        <div className="flex items-start justify-between mb-8">
          <div className="text-xl font-bold text-primary">{inv.orgName}</div>
          <div className="text-right">
            <div className="text-2xl font-bold">INVOICE</div>
            <div className="text-muted-foreground">{inv.invoiceNumber}</div>
          </div>
        </div>

        <div className="flex justify-between mb-6 text-sm">
          <div>
            <div className="text-xs uppercase text-muted-foreground">Bill to</div>
            <div>{inv.clientName}</div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase text-muted-foreground">Issued</div>
            <div>{format(inv.issuedAt, 'PP')}</div>
            {inv.dueAt && <><div className="text-xs uppercase text-muted-foreground mt-1">Due</div><div>{format(inv.dueAt, 'PP')}</div></>}
          </div>
        </div>

        <table className="w-full text-sm mb-4">
          <thead className="border-b text-xs uppercase text-muted-foreground">
            <tr><th className="text-left py-1.5">Description</th><th className="text-right">Qty</th><th className="text-right">Unit</th><th className="text-right">Amount</th></tr>
          </thead>
          <tbody className="divide-y">
            {inv.lineItems.map((li, i) => (
              <tr key={i}><td className="py-1.5">{li.description}</td><td className="text-right">{li.qty}</td><td className="text-right">{money(li.unitPrice, inv.currency)}</td><td className="text-right">{money(li.lineTotal, inv.currency)}</td></tr>
            ))}
          </tbody>
        </table>

        <div className="ml-auto w-56 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{money(inv.subtotal, inv.currency)}</span></div>
          {inv.discount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span>-{money(inv.discount, inv.currency)}</span></div>}
          {inv.taxAmount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>{money(inv.taxAmount, inv.currency)}</span></div>}
          <div className="flex justify-between font-bold border-t pt-1 text-base"><span>Total</span><span>{money(inv.total, inv.currency)}</span></div>
          {inv.amountPaid > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Paid</span><span>{money(inv.amountPaid, inv.currency)}</span></div>}
        </div>

        {inv.terms && <p className="text-xs text-muted-foreground mt-8">{inv.terms}</p>}

        {paidFlag && (
          <div className="mt-6 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-4 py-3 text-sm">
            Payment received — thank you! It may take a moment to reflect here.
          </div>
        )}
        <div className="mt-8 flex justify-end gap-2">
          <Button variant="outline" onClick={downloadPdf}><FileDown className="w-4 h-4 mr-1.5" /> Download PDF</Button>
          {inv.status !== 'paid' && inv.status !== 'void' && (inv.total - inv.amountPaid) > 0 && (
            <Button onClick={payNow} disabled={paying}>
              {paying ? 'Starting…' : `Pay ${money(inv.total - inv.amountPaid, inv.currency)}`}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PublicInvoice;
