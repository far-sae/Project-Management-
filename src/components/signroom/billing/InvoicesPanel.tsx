// A compact card for the CRM company and deal pages: that company's or deal's invoices.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { balance } from '../../../../api/_signroom/shared/invoiceMath';
import { billingToday, formatMinor, shortDate } from '@/lib/signroom/billing';
import { Button } from '@/components/ui/button';
import { NewInvoiceDialog } from './NewInvoiceDialog';
import { Card, InvoiceStatus, PickWorkspace } from './shared';
import { useInvoices } from './useBilling';

export interface InvoicesPanelProps {
  /** CRM company id: lists the invoices raised for this company. */
  companyId?: string;
  /** CRM deal id: lists the invoices raised from this deal. */
  dealId?: string;
}

/** How many invoices the card shows before "Show all". */
const SHORT_LIST = 5;

export const InvoicesPanel: React.FC<InvoicesPanelProps> = ({ companyId, dealId }) => {
  const { invoices, loading, error, workspaceId } = useInvoices({ companyId, dealId });
  const [showAll, setShowAll] = useState(false);
  const [creating, setCreating] = useState(false);
  const today = billingToday();
  const sorted = [...invoices].sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number));
  const shown = showAll ? sorted : sorted.slice(0, SHORT_LIST);

  return (
    <Card
      title="Invoices"
      count={workspaceId && !loading && !error ? invoices.length : undefined}
      action={
        <Button size="sm" variant="outline" onClick={() => setCreating(true)} disabled={!workspaceId}>
          <Plus aria-hidden /> New invoice
        </Button>
      }
    >
      {!workspaceId ? (
        <PickWorkspace compact />
      ) : error ? (
        <p role="alert" className="px-4 py-6 text-center text-sm text-destructive">{error}</p>
      ) : loading && invoices.length === 0 ? (
        <p role="status" className="px-4 py-6 text-center text-sm text-muted-foreground">Loading invoices</p>
      ) : invoices.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          {dealId ? 'No invoices for this deal yet.' : 'No invoices for this company yet.'}
        </p>
      ) : (
        <>
          <ul>
            {shown.map((i) => {
              const owed = balance(i);
              return (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border/60 px-4 py-2.5 last:border-0">
                  <div className="flex min-w-0 flex-col gap-1">
                    <Link to={`/crm/invoices/${i.id}`} className="truncate text-sm font-medium tabular-nums text-foreground hover:underline">
                      {i.number}
                    </Link>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {i.status === 'Draft' ? `Dated ${shortDate(i.issueDate)}` : `Due ${shortDate(i.dueDate)}`}
                    </span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-sm font-medium tabular-nums text-foreground">{formatMinor(i.totalMinor, i.currency)}</span>
                    <span className="flex flex-wrap items-center justify-end gap-1.5">
                      {owed > 0 && owed !== i.totalMinor && i.status !== 'Voided' && (
                        <span className="text-xs tabular-nums text-muted-foreground">{formatMinor(owed, i.currency)} outstanding</span>
                      )}
                      <InvoiceStatus invoice={i} today={today} />
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          {sorted.length > SHORT_LIST && (
            <div className="border-t border-border px-2 py-1">
              <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Show fewer' : `Show all ${sorted.length}`}
              </Button>
            </div>
          )}
        </>
      )}

      <NewInvoiceDialog open={creating} onOpenChange={setCreating} companyId={companyId} dealId={dealId} />
    </Card>
  );
};

export default InvoicesPanel;
