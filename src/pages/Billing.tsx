import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Invoice, listOrgInvoices } from '@/services/supabase/invoices';
import { getOrganizationClients, type Client } from '@/services/supabase/clients';
import { listOrgSchedules, type InvoiceSchedule } from '@/services/supabase/invoiceSchedules';
import { listOrgBills, type Bill } from '@/services/supabase/bills';
import { InvoiceEditor } from '@/components/billing/InvoiceEditor';
import { RecurringScheduleDialog } from '@/components/billing/RecurringScheduleDialog';
import { BillEditor } from '@/components/billing/BillEditor';
import { InvoicesTab } from '@/components/billing/tabs/InvoicesTab';
import { RecurringTab } from '@/components/billing/tabs/RecurringTab';
import { BillsTab } from '@/components/billing/tabs/BillsTab';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { useProjects } from '@/hooks/useProjects';
import { cn } from '@/lib/utils';

type Tab = 'invoices' | 'recurring' | 'bills';

export const Billing: React.FC = () => {
  const { user } = useAuth();
  const { organization, canEditPage } = useOrganization();
  const fmt = useFormatMoney();
  const orgId = organization?.organizationId ?? '';
  // View-only billing access hides the create action.
  const canEditBilling = canEditPage('billing');
  const { workspaces } = useWorkspaces();
  const { projects } = useProjects();

  const [tab, setTab] = useState<Tab>('invoices');
  const [wsFilter, setWsFilter] = useState<string>('all');
  const [projFilter, setProjFilter] = useState<string>('all');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [schedules, setSchedules] = useState<InvoiceSchedule[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);

  const [openEditor, setOpenEditor] = useState(false);
  const [editing, setEditing] = useState<Invoice | null>(null);
  const [openSchedule, setOpenSchedule] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<InvoiceSchedule | null>(null);
  const [openBill, setOpenBill] = useState(false);
  const [editingBill, setEditingBill] = useState<Bill | null>(null);

  const clientName = useMemo(() => {
    const m = new Map<string, string>();
    clients.forEach((c) => m.set(c.clientId, c.name));
    return (id: string) => m.get(id) ?? '—';
  }, [clients]);

  const load = async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [inv, cls] = await Promise.all([listOrgInvoices(orgId), getOrganizationClients(orgId)]);
      setInvoices(inv);
      setClients(cls);
      setSchedules(await listOrgSchedules(orgId));
      setBills(await listOrgBills(orgId));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [orgId]);

  const newAction: Record<Tab, { label: string; onClick: () => void }> = {
    invoices: { label: 'New invoice', onClick: () => { setEditing(null); setOpenEditor(true); } },
    recurring: { label: 'New recurring invoice', onClick: () => { setEditingSchedule(null); setOpenSchedule(true); } },
    bills: { label: 'New bill', onClick: () => { setEditingBill(null); setOpenBill(true); } },
  };

  // Normalize Project[] (workspaceId is optional on the type) to the shape
  // the editors expect: { projectId, name, workspaceId: string }.
  const editorProjects = useMemo(
    () => projects
      .filter((p): p is typeof p & { workspaceId: string } => !!p.workspaceId)
      .map((p) => ({ projectId: p.projectId, name: p.name, workspaceId: p.workspaceId })),
    [projects],
  );

  const projectOptions = useMemo(
    () => (wsFilter === 'all' ? editorProjects : editorProjects.filter((p) => p.workspaceId === wsFilter)),
    [editorProjects, wsFilter],
  );

  const matchScope = (row: { workspaceId: string | null; projectId: string | null }) =>
    (wsFilter === 'all' || row.workspaceId === wsFilter) &&
    (projFilter === 'all' || row.projectId === projFilter);

  const filteredInvoices = useMemo(() => invoices.filter(matchScope), [invoices, wsFilter, projFilter]);
  const filteredSchedules = useMemo(() => schedules.filter(matchScope), [schedules, wsFilter, projFilter]);
  const filteredBills = useMemo(() => bills.filter(matchScope), [bills, wsFilter, projFilter]);

  const defaultWorkspaceId = wsFilter === 'all' ? null : wsFilter;
  const defaultProjectId = projFilter === 'all' ? null : projFilter;

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Receipt className="w-5 h-5 text-primary" /> Billing
          </h1>
          <p className="text-sm text-muted-foreground">Invoices, recurring billing, and bills you owe.</p>
        </div>
        {canEditBilling && (
          <Button onClick={newAction[tab].onClick}>
            <Plus className="w-4 h-4 mr-1.5" /> {newAction[tab].label}
          </Button>
        )}
      </div>

      <div className="flex gap-1 border-b">
        {(['invoices', 'recurring', 'bills'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn('px-3 py-2 text-sm font-medium border-b-2 -mb-px capitalize',
              tab === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {t === 'invoices' ? 'Invoices' : t === 'recurring' ? 'Recurring' : 'Bills'}
          </button>
        ))}
      </div>

      {(workspaces.length > 0 || editorProjects.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {workspaces.length > 0 && (
            <>
              <span className="text-sm text-muted-foreground">Workspace:</span>
              <Select value={wsFilter} onValueChange={(v) => { setWsFilter(v); setProjFilter('all'); }}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All workspaces</SelectItem>
                  {workspaces.map((w) => (
                    <SelectItem key={w.workspaceId} value={w.workspaceId}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
          {editorProjects.length > 0 && (
            <>
              <span className="text-sm text-muted-foreground">Project:</span>
              <Select value={projFilter} onValueChange={setProjFilter}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All projects</SelectItem>
                  {projectOptions.map((p) => (
                    <SelectItem key={p.projectId} value={p.projectId}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
        </div>
      )}

      {tab === 'invoices' && (
        <InvoicesTab
          invoices={filteredInvoices} loading={loading} orgId={orgId}
          orgName={organization?.name ?? 'Company'} clientName={clientName} fmt={fmt}
          onEdit={(inv) => { setEditing(inv); setOpenEditor(true); }} onChanged={load}
        />
      )}
      {tab === 'recurring' && (
        <RecurringTab
          schedules={filteredSchedules} loading={loading} orgId={orgId} clientName={clientName} fmt={fmt}
          onEdit={(s) => { setEditingSchedule(s); setOpenSchedule(true); }}
          onNew={newAction.recurring.onClick} onChanged={load}
        />
      )}
      {tab === 'bills' && (
        <BillsTab
          bills={filteredBills} loading={loading} orgId={orgId} fmt={fmt}
          onEdit={(b) => { setEditingBill(b); setOpenBill(true); }} onChanged={load}
        />
      )}

      <InvoiceEditor
        open={openEditor}
        onOpenChange={(o) => { setOpenEditor(o); if (!o) setEditing(null); }}
        organizationId={orgId} clients={clients} existing={editing}
        userId={user?.userId ?? null} userName={user?.displayName ?? null} onSaved={load}
        projects={editorProjects} defaultProjectId={defaultProjectId}
      />
      <RecurringScheduleDialog
        open={openSchedule}
        onOpenChange={(o) => { setOpenSchedule(o); if (!o) setEditingSchedule(null); }}
        organizationId={orgId} clients={clients} existing={editingSchedule}
        userId={user?.userId ?? null} userName={user?.displayName ?? null} onSaved={load}
        projects={editorProjects} defaultProjectId={defaultProjectId}
      />
      <BillEditor
        open={openBill}
        onOpenChange={(o) => { setOpenBill(o); if (!o) setEditingBill(null); }}
        organizationId={orgId} existing={editingBill}
        userId={user?.userId ?? null} userName={user?.displayName ?? null} onSaved={load}
        workspaces={workspaces} defaultWorkspaceId={defaultWorkspaceId}
        projects={editorProjects} defaultProjectId={defaultProjectId}
      />
    </div>
  );
};

export default Billing;
