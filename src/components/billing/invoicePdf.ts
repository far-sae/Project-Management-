import type { Invoice } from '@/services/supabase/invoices';

/** Build + download an invoice PDF in the browser. `@react-pdf/renderer` is
 *  dynamically imported so it stays out of the main bundle until used. */
export const downloadInvoicePdf = async (
  invoice: Invoice,
  org: { name: string },
  clientName: string,
): Promise<void> => {
  const [{ pdf }, { InvoiceDocument }, React] = await Promise.all([
    import('@react-pdf/renderer'),
    import('./InvoiceDocument'),
    import('react'),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blob = await pdf(
    React.createElement(InvoiceDocument, { invoice, orgName: org.name, clientName }) as any,
  ).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${invoice.invoiceNumber}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};
