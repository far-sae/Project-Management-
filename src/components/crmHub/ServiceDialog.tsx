// The service window: one thing a client pays for (a monthly fee or a one-time
// fee). The same window adds a service and changes one, on a lead's Accounts
// tab and on the Accounts page. On the Accounts page it also asks which client
// the service is for.
import React, { useEffect, useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useCrmCurrency } from '@/context/CrmCurrencyContext';
import { accountCurrency } from '@/lib/crmCurrency';
import { publicMessage } from '@/lib/publicError';
import { createClientAccount, updateClientAccount } from '@/services/supabase/crmHub/accounts';
import type { ClientBillingType, CrmClientAccount } from '@/types/crmHub';
import { Button } from '@/components/ui/button';
import { CurrencySelect } from '@/components/ui/currency-select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

/** A client the service can be for, when the window has to ask. */
export interface ServiceClient {
  id: string;
  name: string;
  /** The client's company, shown next to the name when there is one. */
  company?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  workspaceId: string;
  /** The service being changed. Null: a new one. */
  account: CrmClientAccount | null;
  /** The lead a new service is for. Left out, the window asks (see `clients`). */
  contactId?: string;
  /** The leads to choose from when `contactId` is not given. */
  clients?: ServiceClient[];
  /** A new service starts on 1 January of this year. */
  year: number;
  /** Called after a save, so the page can read its numbers again. */
  onSaved: () => void | Promise<void>;
}

interface Form {
  contactId: string;
  serviceName: string;
  /** The currency the amounts are in ("GBP"). */
  currency: string;
  billingType: ClientBillingType;
  agreedAmount: string;
  openingPaid: string;
  serviceStart: string;
  serviceEnd: string;
  notes: string;
  /** The day of the month a monthly fee is due. */
  dueDay: string;
  /** The date a one-time fee is due. */
  dueDate: string;
}

/**
 * One of the newer fields for a save: left out while it is empty and was empty,
 * so a database that does not have the field yet still saves everything else.
 */
const changed = <K extends string, V>(key: K, now: V | null, before: V | null): Partial<Record<K, V | null>> =>
  (now === null && before === null ? {} : { [key]: now } as Record<K, V | null>);

export const ServiceDialog: React.FC<Props> = ({ open, onOpenChange, organizationId, workspaceId, account, contactId, clients, year, onSaved }) => {
  const { user } = useAuth();
  const { code: companyCurrency } = useCrmCurrency();
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);

  // Each time the window opens it starts from the service it was opened for, or from an empty one.
  useEffect(() => {
    if (!open) return;
    setForm(account
      ? {
          contactId: account.contactId, serviceName: account.serviceName, currency: accountCurrency(account, companyCurrency),
          billingType: account.billingType, agreedAmount: String(account.agreedAmount), openingPaid: String(account.openingPaid),
          serviceStart: account.serviceStart ?? '', serviceEnd: account.serviceEnd ?? '', notes: account.notes ?? '',
          dueDay: account.dueDay ? String(account.dueDay) : '', dueDate: account.dueDate ?? '',
        }
      : {
          contactId: contactId ?? '', serviceName: '', currency: companyCurrency, billingType: 'monthly', agreedAmount: '', openingPaid: '0',
          serviceStart: `${year}-01-01`, serviceEnd: '', notes: '', dueDay: '', dueDate: '',
        });
    // Only when it opens, or opens for another service: typing must not be thrown away by a re-render.
  }, [open, account?.id]);

  const asksClient = !account && !contactId;
  const ready = Boolean(
    form && form.serviceName.trim() && form.agreedAmount !== '' && Number(form.agreedAmount) >= 0 && (!asksClient || form.contactId),
  );

  const save = async () => {
    if (!form || !ready) return;
    // A service that has no currency of its own is in the company's. Choosing that same one changes nothing.
    const chosen = form.currency.trim().toUpperCase();
    const had = account?.currency ?? null;
    const currency = chosen && (had !== null || chosen !== companyCurrency) ? chosen : null;
    const fields = {
      // The window does not ask for a project. A service that was tied to one keeps it.
      projectId: account?.projectId ?? null, serviceName: form.serviceName.trim(), billingType: form.billingType,
      agreedAmount: Number(form.agreedAmount), openingPaid: Number(form.openingPaid || 0),
      serviceStart: form.serviceStart || null, serviceEnd: form.serviceEnd || null, notes: form.notes.trim() || null,
      ...changed('dueDay', form.billingType === 'monthly' && form.dueDay ? Math.min(31, Math.max(1, Math.round(Number(form.dueDay)))) : null, account?.dueDay ?? null),
      ...changed('dueDate', form.billingType === 'one_time' && form.dueDate ? form.dueDate : null, account?.dueDate ?? null),
      ...(currency === had ? {} : { currency }),
    };
    setBusy(true);
    try {
      if (account) await updateClientAccount(account.id, fields);
      else await createClientAccount({ organizationId, workspaceId, contactId: form.contactId, ...fields, createdBy: user?.userId });
      onOpenChange(false);
      toast.success(account ? 'Service saved' : 'Service added');
      await onSaved();
    } catch (error) {
      toast.error(publicMessage(error, account ? 'Could not save the service' : 'Could not add the service'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onOpenChange(false); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{account ? 'Edit service' : 'Add service'}</DialogTitle></DialogHeader>
        {form && (
          <div className="space-y-3">
            {asksClient && (
              <Field label="Client">
                {(id) => (clients && clients.length > 0 ? (
                  <Select value={form.contactId} onValueChange={(v) => setForm({ ...form, contactId: v })}>
                    <SelectTrigger id={id}><SelectValue placeholder="Choose a client" /></SelectTrigger>
                    <SelectContent>
                      {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.company ? `${c.name} · ${c.company}` : c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <p id={id} className="text-sm text-muted-foreground">There are no leads in this workspace yet. Add a lead first: a service belongs to a lead.</p>
                ))}
              </Field>
            )}
            <Field label="Service">
              {(id) => <Input id={id} value={form.serviceName} onChange={(e) => setForm({ ...form, serviceName: e.target.value })} />}
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Billing">
                {(id) => (
                  <Select value={form.billingType} onValueChange={(v) => setForm({ ...form, billingType: v as ClientBillingType })}>
                    <SelectTrigger id={id}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="one_time">One-time</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </Field>
              <Field label={form.billingType === 'monthly' ? 'Monthly amount' : 'Agreed amount'}>
                {(id) => (
                  <Input
                    id={id} type="number" min="0" step="0.01" value={form.agreedAmount}
                    onChange={(e) => setForm({ ...form, agreedAmount: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Currency">
                {(id) => <CurrencySelect id={id} value={form.currency} onValueChange={(currency) => setForm({ ...form, currency })} />}
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Opening paid">
                {(id) => (
                  <Input
                    id={id} type="number" min="0" step="0.01" value={form.openingPaid}
                    onChange={(e) => setForm({ ...form, openingPaid: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Starts">
                {(id) => <Input id={id} type="date" value={form.serviceStart} onChange={(e) => setForm({ ...form, serviceStart: e.target.value })} />}
              </Field>
              <Field label="Ends">
                {(id) => <Input id={id} type="date" value={form.serviceEnd} onChange={(e) => setForm({ ...form, serviceEnd: e.target.value })} />}
              </Field>
            </div>
            {form.billingType === 'monthly' ? (
              <Field label="Due on day of the month">
                {(id) => (
                  <Input
                    id={id} type="number" min="1" max="31" step="1" placeholder="For example 5" value={form.dueDay}
                    onChange={(e) => setForm({ ...form, dueDay: e.target.value })}
                  />
                )}
              </Field>
            ) : (
              <Field label="Due date">
                {(id) => <Input id={id} type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />}
              </Field>
            )}
            <Field label="Notes">
              {(id) => <Textarea id={id} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />}
            </Field>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button disabled={busy || !ready} onClick={() => void save()}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

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

export default ServiceDialog;
