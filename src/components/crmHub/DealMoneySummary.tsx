import React, { useMemo } from 'react';
import { StatStrip } from '@/components/common/StatStrip';
import { useInvoices } from '@/components/signroom/billing/useBilling';
import { formatMinor } from '@/lib/signroom/billing';
import { dealMoney, moneySentence } from '@/lib/crmDealInvoiced';
import type { DealInvoice } from '@/lib/crmDealInvoiced';

/**
 * What the deal was sold for, beside what has been invoiced, paid and is still
 * owed. The deal value lives on the deal and the rest on its invoices; before
 * this nobody could read the two together.
 */
export const DealMoneySummary: React.FC<{
  deal: { id: string; companyId: string | null; value: number };
  /** The deal value as the page writes it, in the deal's own currency ("$12,000"). */
  valueText: string;
  /** The currency the deal value is in. */
  currency: string;
}> = ({ deal, valueText, currency: code }) => {
  const { invoices, loading, error, workspaceId } = useInvoices({ companyId: deal.companyId ?? undefined, dealId: deal.id });
  const lines = useMemo(() => dealMoney(invoices as DealInvoice[]), [invoices]);

  // "…" while the invoices are on their way, "—" when they cannot be read: never a zero that is not known to be zero.
  const unknown = !workspaceId || error ? '—' : loading && invoices.length === 0 ? '…' : null;
  const sum = (pick: (line: (typeof lines)[number]) => number): string =>
    unknown ?? (lines.length === 0 ? formatMinor(0, code) : lines.map((line) => formatMinor(pick(line), line.currency)).join(' + '));
  const sentence = unknown ? '' : moneySentence(deal.value, code, lines, formatMinor);
  const owed = lines.reduce((total, line) => total + line.owedMinor, 0);

  return (
    <section aria-label="Money" className="flex flex-col gap-2">
      <StatStrip
        items={[
          { label: 'Deal value', value: valueText },
          { label: 'Invoiced', value: sum((line) => line.invoicedMinor) },
          { label: 'Paid', value: sum((line) => line.paidMinor), tone: unknown || owed > 0 ? 'default' : lines.length > 0 ? 'success' : 'default' },
          { label: 'Still owed', value: sum((line) => line.owedMinor) },
        ]}
      />
      {sentence && <p className="text-xs text-muted-foreground">{sentence}</p>}
    </section>
  );
};
