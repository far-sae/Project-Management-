import React, { useMemo, useState } from 'react';
import {
  Building2, Plus, Search, Upload, Download, Loader2,
  Filter, Star, Trash2, MoreVertical,
} from 'lucide-react';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GitBranch, ListTodo } from 'lucide-react';
import { DealsKanban } from '@/components/clients/DealsKanban';
import { ClientTasksList } from '@/components/clients/ClientTasksList';
import { PipelineAnalyticsCard } from '@/components/clients/PipelineAnalyticsCard';
import { useClients } from '@/hooks/useClients';
import {
  Client, ClientStatus, ClientType,
  CreateClientInput, exportClientsToCsv, formatRevenue,
} from '@/services/supabase/clients';
import { ClientFormDialog } from '@/components/clients/ClientFormDialog';
import { ImportClientsDialog } from '@/components/clients/ImportClientsDialog';
import { ClientDetailDrawer } from '@/components/clients/ClientDetailDrawer';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';

const TYPE_OPTIONS: { value: ClientType | 'all'; label: string }[] = [
  { value: 'all', label: 'All types' },
  { value: 'customer', label: 'Customer' },
  { value: 'prospect', label: 'Prospect' },
  { value: 'partner', label: 'Partner' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'other', label: 'Other' },
];

const STATUS_OPTIONS: { value: ClientStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'archived', label: 'Archived' },
];

const downloadFile = (filename: string, content: string, mime: string) => {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const StatusBadge: React.FC<{ status: ClientStatus }> = ({ status }) => (
  <Badge
    className={
      status === 'active'
        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
        : status === 'archived'
        ? 'bg-muted text-muted-foreground border-border'
        : 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30'
    }
  >
    {status}
  </Badge>
);

export const Clients: React.FC = () => {
  const { user } = useAuth();
  const {
    organizationId, clients, loading, create, update, remove, canManage,
  } = useClients();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<ClientType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<ClientStatus | 'all'>('all');

  const [openCreate, setOpenCreate] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [openImport, setOpenImport] = useState(false);
  const [selected, setSelected] = useState<Client | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Client | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Keep the selected client's data in sync when the list refreshes via realtime.
  const liveSelected = useMemo(() => {
    if (!selected) return null;
    return clients.find((c) => c.clientId === selected.clientId) ?? null;
  }, [clients, selected]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      if (typeFilter !== 'all' && c.type !== typeFilter) return false;
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (!q) return true;
      const haystack = [
        c.name, c.legalName, c.industry, c.email, c.phone,
        c.city, c.country, c.accountOwnerName, ...(c.tags ?? []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [clients, search, typeFilter, statusFilter]);

  const handleCreate = async (input: CreateClientInput) => {
    try {
      const created = await create(input);
      toast.success(`Created "${created.name}"`);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to create client');
    }
  };

  const handleUpdate = async (input: CreateClientInput) => {
    if (!editing) return;
    try {
      const updated = await update(editing.clientId, input);
      toast.success(`Updated "${updated.name}"`);
      setEditing(null);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to update client');
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await remove(confirmDelete.clientId);
      toast.success(`Deleted "${confirmDelete.name}"`);
      if (selected?.clientId === confirmDelete.clientId) setSelected(null);
      setConfirmDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setDeleting(false);
    }
  };

  const exportAll = () => {
    if (filtered.length === 0) {
      toast.error('Nothing to export with current filters');
      return;
    }
    const csv = exportClientsToCsv(filtered);
    downloadFile(`clients-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
    toast.success(`Exported ${filtered.length} client(s)`);
  };

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
                <Building2 className="w-6 h-6 text-primary" /> Clients
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Your CRM accounts — companies you sell to, work with, or have on the radar.
                {canManage && ' Track contacts, calls, meetings, and uploaded documents.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={exportAll}>
                <Download className="w-4 h-4 mr-2" /> Export CSV
              </Button>
              {canManage && (
                <Button variant="outline" onClick={() => setOpenImport(true)}>
                  <Upload className="w-4 h-4 mr-2" /> Import
                </Button>
              )}
              {canManage && (
                <Button onClick={() => setOpenCreate(true)}>
                  <Plus className="w-4 h-4 mr-2" /> New client
                </Button>
              )}
            </div>
          </div>

          <Tabs defaultValue="accounts">
            <TabsList>
              <TabsTrigger value="accounts">
                <Building2 className="w-4 h-4 mr-1.5" /> Accounts
              </TabsTrigger>
              <TabsTrigger value="pipeline">
                <GitBranch className="w-4 h-4 mr-1.5" /> Pipeline
              </TabsTrigger>
              <TabsTrigger value="tasks">
                <ListTodo className="w-4 h-4 mr-1.5" /> Tasks
              </TabsTrigger>
            </TabsList>

            <TabsContent value="accounts" className="mt-4 space-y-6">
          {/* Filters */}
          <Card>
            <CardContent className="pt-4 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 flex-1 min-w-[240px]">
                <Search className="w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search name, email, tags, owner…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  maxLength={200}
                />
              </div>
              <Select
                value={typeFilter}
                onValueChange={(v) => setTypeFilter(v as ClientType | 'all')}
              >
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as ClientStatus | 'all')}
              >
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1 ml-auto">
                <Filter className="w-3 h-3" />
                {filtered.length} of {clients.length}
              </span>
            </CardContent>
          </Card>

          {/* List */}
          {loading ? (
            <Card>
              <CardContent className="py-10 flex items-center justify-center text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading clients…
              </CardContent>
            </Card>
          ) : filtered.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center space-y-2">
                <Building2 className="w-10 h-10 mx-auto text-muted-foreground/60" />
                <p className="text-sm text-muted-foreground">
                  {clients.length === 0
                    ? 'No clients yet. Add your first one or import a CSV.'
                    : 'No clients match your filters.'}
                </p>
                {canManage && clients.length === 0 && (
                  <div className="flex justify-center gap-2 pt-2">
                    <Button onClick={() => setOpenCreate(true)}>
                      <Plus className="w-4 h-4 mr-2" /> New client
                    </Button>
                    <Button variant="outline" onClick={() => setOpenImport(true)}>
                      <Upload className="w-4 h-4 mr-2" /> Import
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((c) => (
                <button
                  key={c.clientId}
                  onClick={() => setSelected(c)}
                  className="text-left rounded-lg border bg-card p-4 hover:border-primary/40 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-md bg-primary-soft text-primary-soft-foreground flex items-center justify-center shrink-0">
                      <Building2 className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold truncate">{c.name}</h3>
                      <p className="text-xs text-muted-foreground truncate">
                        {c.industry || c.type}
                      </p>
                    </div>
                    {c.rating && (
                      <Badge variant="outline" className="shrink-0">
                        <Star className="w-3 h-3 mr-1" /> {c.rating}
                      </Badge>
                    )}
                  </div>

                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="capitalize">{c.type}</Badge>
                    <StatusBadge status={c.status} />
                    {c.country && (
                      <span className="text-xs text-muted-foreground">{c.country}</span>
                    )}
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide">Revenue</p>
                      <p className="text-foreground">
                        {c.annualRevenue == null ? '—' : formatRevenue(c.annualRevenue)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide">Owner</p>
                      <p className="text-foreground truncate">
                        {c.accountOwnerName || '—'}
                      </p>
                    </div>
                  </div>

                  {c.tags && c.tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {c.tags.slice(0, 4).map((t) => (
                        <Badge key={t} variant="secondary" className="text-[10px]">
                          {t}
                        </Badge>
                      ))}
                      {c.tags.length > 4 && (
                        <span className="text-[10px] text-muted-foreground">
                          +{c.tags.length - 4}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
            </TabsContent>

            <TabsContent value="pipeline" className="mt-4 space-y-4">
              <PipelineAnalyticsCard />
              <DealsKanban clients={clients} />
            </TabsContent>

            <TabsContent value="tasks" className="mt-4">
              <ClientTasksList clients={clients} />
            </TabsContent>
          </Tabs>
        </div>
      </main>

      {/* New */}
      <ClientFormDialog
        open={openCreate}
        onOpenChange={setOpenCreate}
        onSubmit={handleCreate}
      />
      {/* Edit */}
      <ClientFormDialog
        open={!!editing}
        onOpenChange={(o) => { if (!o) setEditing(null); }}
        client={editing}
        onSubmit={handleUpdate}
      />
      {/* Import */}
      <ImportClientsDialog
        open={openImport}
        onOpenChange={setOpenImport}
        organizationId={organizationId}
        userId={user?.userId}
        userName={user?.displayName}
        onComplete={() => undefined}
      />

      {/* Detail drawer */}
      {liveSelected && (
        <ClientDetailDrawer
          client={liveSelected}
          organizationId={organizationId}
          canManage={canManage}
          onClose={() => setSelected(null)}
          onEdit={(c) => setEditing(c)}
          onDelete={(c) => setConfirmDelete(c)}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this client?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{confirmDelete?.name}</strong>{' '}
              and every contact, note, and uploaded file attached to it. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <Trash2 className="w-4 h-4 mr-1" /> Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Clients;
// Avoid unused-imports warnings for icons reserved for future row actions.
void MoreVertical;
