import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import type { Invoice } from '@/services/supabase/invoices';

const money = (n: number, c: string) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: c }).format(n); }
  catch { return `${c} ${n.toFixed(2)}`; }
};
const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—');

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 10, color: '#111', fontFamily: 'Helvetica' },
  brandRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 },
  brand: { fontSize: 18, fontWeight: 700, color: '#c2410c' },
  h1: { fontSize: 22, fontWeight: 700 },
  meta: { textAlign: 'right', color: '#555' },
  section: { marginBottom: 14 },
  label: { fontSize: 8, color: '#888', textTransform: 'uppercase', marginBottom: 2 },
  row: { flexDirection: 'row', borderBottom: '1px solid #eee', paddingVertical: 4 },
  thRow: { flexDirection: 'row', borderBottom: '1px solid #ccc', paddingVertical: 4, fontWeight: 700 },
  cDesc: { flex: 1 }, cQty: { width: 50, textAlign: 'right' },
  cUnit: { width: 80, textAlign: 'right' }, cTot: { width: 80, textAlign: 'right' },
  totals: { marginTop: 10, marginLeft: 'auto', width: 200 },
  tRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  grand: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 4, marginTop: 4, borderTop: '1px solid #ccc', fontWeight: 700, fontSize: 12 },
  terms: { marginTop: 22, color: '#555' },
});

export const InvoiceDocument: React.FC<{ invoice: Invoice; orgName: string; clientName: string }> = ({ invoice, orgName, clientName }) => {
  const c = invoice.currency;
  return (
    <Document title={invoice.invoiceNumber}>
      <Page size="A4" style={s.page}>
        <View style={s.brandRow}>
          <Text style={s.brand}>{orgName}</Text>
          <View style={s.meta}>
            <Text style={s.h1}>INVOICE</Text>
            <Text>{invoice.invoiceNumber}</Text>
          </View>
        </View>

        <View style={[s.section, { flexDirection: 'row', justifyContent: 'space-between' }]}>
          <View>
            <Text style={s.label}>Bill to</Text>
            <Text>{clientName}</Text>
          </View>
          <View style={{ textAlign: 'right' }}>
            <Text style={s.label}>Issued</Text>
            <Text>{ymd(invoice.issuedAt)}</Text>
            <Text style={[s.label, { marginTop: 4 }]}>Due</Text>
            <Text>{ymd(invoice.dueAt)}</Text>
          </View>
        </View>

        <View style={s.thRow}>
          <Text style={s.cDesc}>Description</Text>
          <Text style={s.cQty}>Qty</Text>
          <Text style={s.cUnit}>Unit</Text>
          <Text style={s.cTot}>Amount</Text>
        </View>
        {invoice.lineItems.map((li, i) => (
          <View style={s.row} key={i}>
            <Text style={s.cDesc}>{li.description}</Text>
            <Text style={s.cQty}>{li.qty}</Text>
            <Text style={s.cUnit}>{money(li.unitPrice, c)}</Text>
            <Text style={s.cTot}>{money(li.lineTotal, c)}</Text>
          </View>
        ))}

        <View style={s.totals}>
          <View style={s.tRow}><Text>Subtotal</Text><Text>{money(invoice.subtotal, c)}</Text></View>
          {invoice.discount > 0 && <View style={s.tRow}><Text>Discount</Text><Text>-{money(invoice.discount, c)}</Text></View>}
          {invoice.taxAmount > 0 && <View style={s.tRow}><Text>Tax</Text><Text>{money(invoice.taxAmount, c)}</Text></View>}
          <View style={s.grand}><Text>Total</Text><Text>{money(invoice.total, c)}</Text></View>
          {invoice.amountPaid > 0 && <View style={s.tRow}><Text>Paid</Text><Text>{money(invoice.amountPaid, c)}</Text></View>}
          {invoice.amountPaid > 0 && invoice.amountPaid < invoice.total && (
            <View style={s.tRow}><Text>Balance</Text><Text>{money(invoice.total - invoice.amountPaid, c)}</Text></View>
          )}
        </View>

        {invoice.terms ? <Text style={s.terms}>{invoice.terms}</Text> : null}
        {invoice.notes ? <Text style={[s.terms, { marginTop: 6 }]}>{invoice.notes}</Text> : null}
      </Page>
    </Document>
  );
};
