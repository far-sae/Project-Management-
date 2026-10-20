import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CreditCard, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useCrmCurrency } from '@/context/CrmCurrencyContext';
import type { Project } from '@/types';
import type { ClientBillingType, CrmAccountPayment, CrmClientAccount } from '@/types/crmHub';
import { summarizeClientAccount } from '@/lib/crmAccounts';
import { addAccountPayment, createClientAccount, listAccountPayments, listClientAccounts } from '@/services/supabase/crmHub/accounts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
      toast.error(error instanceof Error ? error.message : 'Could not load accounts');
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
      toast.success('Client account added');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add account');
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
      toast.error(error instanceof Error ? error.message : 'Could not record payment');
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Client accounts</h3>
          <p className="text-sm text-muted-foreground">Services, billing and payment history for this contact.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(year)} onValueChange={(value) => setYear(Number(value))}>
            <SelectTrigger className="w-28" aria-label="Account year"><SelectValue /></SelectTrigger>
            <SelectContent>{[-2, -1, 0, 1].map((offset) => { const value = new Date().getFullYear() + offset; return <SelectItem key={value} value={String(value)}>{value}</SelectItem>; })}</SelectContent>
          </Select>
          <Button size="sm" onClick={() => setShowAccount(true)}><Plus className="mr-1 h-4 w-4" />Add service</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Workspace agreed" value={money(workspaceTotals.due)} />
        <Metric label="Workspace paid" value={money(workspaceTotals.paid)} />
        <Metric label="Workspace outstanding" value={money(workspaceTotals.outstanding)} danger={workspaceTotals.outstanding > 0} />
      </div>

      {loading ? <div className="py-10 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div> : accounts.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          <CreditCard className="mx-auto mb-3 h-8 w-8" /><p>No services or billing records yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((account) => {
            const summary = summaries.get(account.id)!;
            const project = projects.find((item) => item.projectId === account.projectId);
            return <Card key={account.id}><CardContent className="p-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="font-semibold">{account.serviceName}</p><p className="text-xs text-muted-foreground">{project?.name ?? 'No linked project'}</p></div>
                <div className="flex items-center gap-2"><Badge variant="outline">{account.billingType === 'monthly' ? `${money(account.agreedAmount)}/month` : 'One-time'}</Badge><Button size="sm" variant="outline" onClick={() => setPaying(account)}>Add payment</Button></div>
              </div>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-12">
                {MONTHS.map((month, index) => <div key={month} className="rounded-md bg-muted/50 p-2 text-center"><p className="text-[10px] text-muted-foreground">{month}</p><p className="text-xs font-medium">{money(summary.monthlyPaid[index])}</p></div>)}
              </div>
              <div className="grid gap-2 text-sm sm:grid-cols-4">
                <span>Opening: <b>{money(account.openingPaid)}</b></span><span>Agreed: <b>{money(summary.due)}</b></span><span>Paid: <b>{money(summary.paid)}</b></span><span>Outstanding: <b className={summary.outstanding > 0 ? 'text-destructive' : 'text-emerald-600'}>{money(summary.outstanding)}</b></span>
              </div>
              {account.notes && <p className="text-sm text-muted-foreground">{account.notes}</p>}
            </CardContent></Card>;
          })}
        </div>
      )}

      <Dialog open={showAccount} onOpenChange={setShowAccount}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Add linked service</DialogTitle></DialogHeader>
        <div className="space-y-3"><Field label="Service"><Input value={serviceName} onChange={(e) => setServiceName(e.target.value)} /></Field>
          <Field label="Linked project"><Select value={projectId || '__none__'} onValueChange={(v) => setProjectId(v === '__none__' ? '' : v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">No project</SelectItem>{projects.map((p) => <SelectItem key={p.projectId} value={p.projectId}>{p.name}</SelectItem>)}</SelectContent></Select></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Billing"><Select value={billingType} onValueChange={(v) => setBillingType(v as ClientBillingType)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="one_time">One-time</SelectItem></SelectContent></Select></Field><Field label={billingType === 'monthly' ? 'Monthly amount' : 'Agreed amount'}><Input type="number" min="0" step="0.01" value={agreedAmount} onChange={(e) => setAgreedAmount(e.target.value)} /></Field></div>
          <div className="grid grid-cols-3 gap-3"><Field label="Opening paid"><Input type="number" min="0" step="0.01" value={openingPaid} onChange={(e) => setOpeningPaid(e.target.value)} /></Field><Field label="Starts"><Input type="date" value={serviceStart} onChange={(e) => setServiceStart(e.target.value)} /></Field><Field label="Ends"><Input type="date" value={serviceEnd} onChange={(e) => setServiceEnd(e.target.value)} /></Field></div>
          <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>
        <DialogFooter><Button variant="outline" onClick={() => setShowAccount(false)}>Cancel</Button><Button disabled={busy || !serviceName.trim() || agreedAmount === ''} onClick={saveAccount}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Save</Button></DialogFooter>
      </DialogContent></Dialog>

      <Dialog open={Boolean(paying)} onOpenChange={(open) => { if (!open) setPaying(null); }}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle>Record payment</DialogTitle></DialogHeader>
        <div className="space-y-3"><Field label="Amount"><Input type="number" min="0.01" step="0.01" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} /></Field><Field label="Payment date"><Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} /></Field><Field label="Notes"><Textarea value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} /></Field></div>
        <DialogFooter><Button variant="outline" onClick={() => setPaying(null)}>Cancel</Button><Button disabled={busy || Number(paymentAmount) <= 0} onClick={savePayment}>Save payment</Button></DialogFooter>
      </DialogContent></Dialog>
    </div>
  );
};

const Metric: React.FC<{ label: string; value: string; danger?: boolean }> = ({ label, value, danger }) => <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className={`text-xl font-bold ${danger ? 'text-destructive' : ''}`}>{value}</p></CardContent></Card>;
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => <div className="space-y-1"><Label>{label}</Label>{children}</div>;
