import { publicMessage } from '@/lib/publicError';
import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { CreditCard, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useCrmCurrency } from '@/context/CrmCurrencyContext';
import type { Project } from '@/types';
import type { ClientBillingType, CrmAccountPayment, CrmClientAccount } from '@/types/crmHub';
import { summarizeClientAccount } from '@/lib/crmAccounts';
import { addAccountPayment, createClientAccount, listAccountPayments, listClientAccounts } from '@/services/supabase/crmHub/accounts';
import { StatStrip } from '@/components/common/StatStrip';
import { StatusPill } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const BOX = 'overflow-hidden rounded-lg border border-border bg-card';

interface Props {
  organizationId: string;
  workspaceId: string;
  contactId: string;
  projects: Project[];
}

export const ClientAccountsTab: React.FC<Props> = ({ organizationId, workspaceId, contactId, projects }) => {
  const { user } = useAuth();
  const { format: money } = useCrmCurrency();
  const [year, setYear] = useState(new Date().getFullYear());
  const [accounts, setAccounts] = useState<CrmClientAccount[]>([]);
  const [workspaceAccounts, setWorkspaceAccounts] = useState<CrmClientAccount[]>([]);
  const [payments, setPayments] = useState<CrmAccountPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [paying, setPaying] = useState<CrmClientAccount | null>(null);
  const [serviceName, setServiceName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [billingType, setBillingType] = useState<ClientBillingType>('monthly');
  const [agreedAmount, setAgreedAmount] = useState('');
  const [openingPaid, setOpeningPaid] = useState('0');
  const [serviceStart, setServiceStart] = useState(`${year}-01-01`);
  const [serviceEnd, setServiceEnd] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentNotes, setPaymentNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [all, paymentRows] = await Promise.all([
        listClientAccounts(workspaceId),
        listAccountPayments(workspaceId),
      ]);
      const contactRows = all.filter((item) => item.contactId === contactId);
      setWorkspaceAccounts(all);
      setAccounts(contactRows);
      setPayments(paymentRows);
    } catch (error) {
      toast.error(publicMessage(error, 'Could not load accounts'));
    } finally {
      setLoading(false);
    }
  }, [contactId, workspaceId, year]);

  useEffect(() => { void load(); }, [load]);

  const summaries = useMemo(() => new Map(accounts.map((item) => [item.id, summarizeClientAccount(item, payments, year)])), [accounts, payments, year]);
  const workspaceTotals = useMemo(() => workspaceAccounts.reduce((total, item) => {
    const summary = summarizeClientAccount(item, payments, year);
    return { due: total.due + summary.due, paid: total.paid + summary.paid, outstanding: total.outstanding + summary.outstanding };
  }, { due: 0, paid: 0, outstanding: 0 }), [workspaceAccounts, payments, year]);

  const saveAccount = async () => {
    if (!serviceName.trim() || Number(agreedAmount) < 0) return;
    setBusy(true);
    try {
      await createClientAccount({
        organizationId, workspaceId, contactId, projectId: projectId || null,
        serviceName: serviceName.trim(), billingType, agreedAmount: Number(agreedAmount),
        openingPaid: Number(openingPaid || 0), serviceStart: serviceStart || null,
        serviceEnd: serviceEnd || null, notes: notes.trim() || null, createdBy: user?.userId,
      });
      setShowAccount(false);
      setServiceName(''); setProjectId(''); setAgreedAmount(''); setOpeningPaid('0'); setNotes('');
      toast.success('Account added');
      await load();
    } catch (error) {
      toast.error(publicMessage(error, 'Could not add account'));
    } finally { setBusy(false); }
  };

  const savePayment = async () => {
    if (!paying || Number(paymentAmount) <= 0) return;
    setBusy(true);
    try {
      await addAccountPayment({ accountId: paying.id, organizationId, workspaceId, paidOn: paymentDate,
        amount: Number(paymentAmount), notes: paymentNotes.trim() || null, createdBy: user?.userId });
      setPaying(null); setPaymentAmount(''); setPaymentNotes('');
      toast.success('Payment recorded');
      await load();
    } catch (error) {
      toast.error(publicMessage(error, 'Could not record payment'));
    } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-foreground">Accounts</h3>
          <p className="text-sm text-muted-foreground">Services, billing and payment history for this lead.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={String(year)} onValueChange={(value) => setYear(Number(value))}>
            <SelectTrigger className="w-28" aria-label="Account year"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[-2, -1, 0, 1].map((offset) => {
                const value = new Date().getFullYear() + offset;
                return <SelectItem key={value} value={String(value)}>{value}</SelectItem>;
              })}
            </SelectContent>
          </Select>
          <Button onClick={() => setShowAccount(true)}><Plus aria-hidden />Add service</Button>
        </div>
      </div>

      <StatStrip
        items={[
          { label: 'Workspace agreed', value: money(workspaceTotals.due) },
          { label: 'Workspace paid', value: money(workspaceTotals.paid) },
          {
            label: 'Workspace outstanding',
            value: money(workspaceTotals.outstanding),
            tone: workspaceTotals.outstanding > 0 ? 'danger' : 'default',
          },
        ]}
      />

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading accounts" />
        </div>
      ) : accounts.length === 0 ? (
        <div className={BOX}>
          <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
            <CreditCard className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">No services or billing records yet.</p>
            <Button variant="outline" className="mt-3" onClick={() => setShowAccount(true)}>Add service</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {accounts.map((account) => {
            const summary = summaries.get(account.id)!;
            const project = projects.find((item) => item.projectId === account.projectId);
            return (
              <div key={account.id} className={BOX}>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{account.serviceName}</p>
                    <p className="truncate text-xs text-muted-foreground">{project?.name ?? 'No linked project'}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone="neutral" dot={false} className="tabular-nums">
                      {account.billingType === 'monthly' ? `${money(account.agreedAmount)}/month` : 'One-time'}
                    </StatusPill>
                    <Button size="sm" variant="outline" onClick={() => setPaying(account)}>Add payment</Button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 px-4 py-3 sm:grid-cols-6 xl:grid-cols-12">
                  {MONTHS.map((month, index) => (
                    <div key={month} className="min-w-0 rounded-md bg-secondary px-1 py-2 text-center">
                      <p className="text-[0.6875rem] text-muted-foreground">{month}</p>
                      <p className="truncate text-xs font-medium tabular-nums" title={money(summary.monthlyPaid[index])}>
                        {money(summary.monthlyPaid[index])}
                      </p>
                    </div>
                  ))}
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border px-4 py-3 text-sm sm:grid-cols-4">
                  <Figure label="Opening" value={money(account.openingPaid)} />
                  <Figure label="Agreed" value={money(summary.due)} />
                  <Figure label="Paid" value={money(summary.paid)} />
                  <Figure
                    label="Outstanding"
                    value={money(summary.outstanding)}
                    className={summary.outstanding > 0 ? 'text-destructive' : 'text-success'}
                  />
                </dl>
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

      <Dialog open={showAccount} onOpenChange={setShowAccount}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Add linked service</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Field label="Service">
              {(id) => <Input id={id} value={serviceName} onChange={(e) => setServiceName(e.target.value)} />}
            </Field>
            <Field label="Linked project">
              {(id) => (
                <Select value={projectId || '__none__'} onValueChange={(v) => setProjectId(v === '__none__' ? '' : v)}>
                  <SelectTrigger id={id}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No project</SelectItem>
                    {projects.map((p) => <SelectItem key={p.projectId} value={p.projectId}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Billing">
                {(id) => (
                  <Select value={billingType} onValueChange={(v) => setBillingType(v as ClientBillingType)}>
                    <SelectTrigger id={id}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="one_time">One-time</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </Field>
              <Field label={billingType === 'monthly' ? 'Monthly amount' : 'Agreed amount'}>
                {(id) => <Input id={id} type="number" min="0" step="0.01" value={agreedAmount} onChange={(e) => setAgreedAmount(e.target.value)} />}
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Opening paid">
                {(id) => <Input id={id} type="number" min="0" step="0.01" value={openingPaid} onChange={(e) => setOpeningPaid(e.target.value)} />}
              </Field>
              <Field label="Starts">
                {(id) => <Input id={id} type="date" value={serviceStart} onChange={(e) => setServiceStart(e.target.value)} />}
              </Field>
              <Field label="Ends">
                {(id) => <Input id={id} type="date" value={serviceEnd} onChange={(e) => setServiceEnd(e.target.value)} />}
              </Field>
            </div>
            <Field label="Notes">
              {(id) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAccount(false)}>Cancel</Button>
            <Button disabled={busy || !serviceName.trim() || agreedAmount === ''} onClick={saveAccount}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(paying)} onOpenChange={(open) => { if (!open) setPaying(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Record payment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Field label="Amount">
              {(id) => <Input id={id} type="number" min="0.01" step="0.01" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} />}
            </Field>
            <Field label="Payment date">
              {(id) => <Input id={id} type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />}
            </Field>
            <Field label="Notes">
              {(id) => <Textarea id={id} value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} />}
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaying(null)}>Cancel</Button>
            <Button disabled={busy || Number(paymentAmount) <= 0} onClick={savePayment}>Save payment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

/** One labelled amount in an account's totals row. */
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
