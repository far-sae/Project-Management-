import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2, Plus, Search, Upload, Download, Loader2,
  Filter, Trash2, MoreVertical, TrendingUp,
  ArrowRight, Pencil,
} from 'lucide-react';
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
import { DealDetailDrawer } from '@/components/clients/DealDetailDrawer';
import { useDeals } from '@/hooks/useDeals';
import { ClientTasksList } from '@/components/clients/ClientTasksList';
import { ForecastTab } from '@/components/clients/ForecastTab';
import { PipelineAnalyticsCard } from '@/components/clients/PipelineAnalyticsCard';
import { PipelineSelector } from '@/components/clients/PipelineSelector';
import { useClients } from '@/hooks/useClients';
import { usePipelines } from '@/hooks/usePipelines';
import {
  Client, ClientStatus, ClientType,
  CreateClientInput, exportClientsToCsv,
} from '@/services/supabase/clients';
import { ClientFormDialog } from '@/components/clients/ClientFormDialog';
import { BulkEditClientsDialog } from '@/components/clients/BulkEditClientsDialog';
import { SavedListViews } from '@/components/clients/SavedListViews';
import { ClientsTable } from '@/components/clients/ClientsTable';
import { ImportClientsDialog } from '@/components/clients/ImportClientsDialog';
import { ClientDetailDrawer } from '@/components/clients/ClientDetailDrawer';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';
import { COMMON_CURRENCIES } from '@/lib/countries';
import { useOrgCurrency } from '@/hooks/useOrgCurrency';
import { useFxRates } from '@/lib/fxRates';
import { Coins } from 'lucide-react';

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

export const Clients: React.FC = () => {
  const { user } = useAuth();
  const {
    organizationId, workspaceId: activeWorkspaceId,
    clients, allClients, loading, create, update, remove,
    canCreate, canManage,
    selectedWorkspace, isAllWorkspaces,
  } = useClients();
  const { pipelines, defaultPipeline, stagesByPipeline } = usePipelines();
  const { deals: allDeals, remove: removeDeal, update: updateDeal } = useDeals();
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('');
  useEffect(() => {
    if (!selectedPipelineId && defaultPipeline) {
      setSelectedPipelineId(defaultPipeline.pipelineId);
    }
  }, [defaultPipeline, selectedPipelineId]);

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<ClientType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<ClientStatus | 'all'>('all');
  const [bandFilter, setBandFilter] = useState<"all" | "hot" | "warm" | "cold">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [groupByCategory, setGroupByCategory] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'accounts' | 'pipeline' | 'tasks' | 'forecast'>('accounts');

  // Pipeline display currency. Persists per-browser so reps don't have to
  // re-pick on every visit. Defaults to whatever the org is set to.
  const orgCurrency = useOrgCurrency();
  const [pipelineCurrency, setPipelineCurrency] = useState<string>(() => {
    try {
      return localStorage.getItem('pm_pipeline_display_currency') || '';
    } catch {
      return '';
    }
  });
  const effectivePipelineCurrency = pipelineCurrency || orgCurrency;
  // Make sure the org's currency is always selectable, even if it isn't in
  // COMMON_CURRENCIES (e.g. THB, CZK from the country picker).
  const currencyOptions = useMemo(() => {
    const codes = new Set<string>([effectivePipelineCurrency, ...COMMON_CURRENCIES]);
    return Array.from(codes);
  }, [effectivePipelineCurrency]);
  const { usingFallback: fxUsingFallback, fetchedAt: fxFetchedAt } =
    useFxRates();
  const handlePipelineCurrencyChange = (next: string) => {
    setPipelineCurrency(next);
    try {
      localStorage.setItem('pm_pipeline_display_currency', next);
    } catch {
      /* ignore */
    }
  };

  const [openCreate, setOpenCreate] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [openImport, setOpenImport] = useState(false);
  const [selected, setSelected] = useState<Client | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Client | null>(null);
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(() => new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [openBulkEdit, setOpenBulkEdit] = useState(false);
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
      if (bandFilter !== "all" && c.scoreBand !== bandFilter) return false;
      if (categoryFilter !== 'all' && (c.category ?? '') !== categoryFilter) return false;
      if (!q) return true;
      const haystack = [
        c.name, c.legalName, c.industry, c.category, c.email, c.phone,
        c.city, c.country, c.accountOwnerName, ...(c.tags ?? []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [clients, search, typeFilter, statusFilter, bandFilter, categoryFilter]);

  // Build a unique sorted list of categories used in the current org so the
  // filter dropdown only offers real values.
  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    for (const c of clients) if (c.category) set.add(c.category);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [clients]);

  const selectedClients = useMemo(
    () => clients.filter((c) => selectedClientIds.has(c.clientId)),
    [clients, selectedClientIds],
  );

  useEffect(() => {
    const handler = (event: Event) => {
      const clientId = (event as CustomEvent<string>).detail;
      const match = clients.find((c) => c.clientId === clientId);
      if (match) setSelected(match);
    };
    window.addEventListener('open-client', handler);
    return () => window.removeEventListener('open-client', handler);
  }, [clients]);

  const toggleClientSelection = (clientId: string) => {
    setSelectedClientIds((prev) => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedClientIds(new Set(filtered.map((c) => c.clientId)));
  };

  const clearSelection = () => setSelectedClientIds(new Set());

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

  const handleUpdateExistingFromCreate = async (
    clientId: string,
    input: CreateClientInput,
  ) => {
    const updated = await update(clientId, input);
    toast.success(`Updated existing client "${updated.name}"`);
    setSelected(updated);
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await remove(confirmDelete.clientId);
      toast.success(`Deleted "${confirmDelete.name}"`);
      if (selected?.clientId === confirmDelete.clientId) setSelected(null);
      setSelectedClientIds((prev) => {
        const next = new Set(prev);
        next.delete(confirmDelete.clientId);
        return next;
      });
      setConfirmDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setDeleting(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedClients.length === 0) return;
    setDeleting(true);
    try {
      for (const client of selectedClients) {
        await remove(client.clientId);
      }
      toast.success(`Deleted ${selectedClients.length} client(s)`);
      if (selected && selectedClientIds.has(selected.clientId)) setSelected(null);
      clearSelection();
      setConfirmBulkDelete(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete selected clients');
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
    <>
      <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-4 md:p-8">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
                <Building2 className="w-6 h-6 text-primary" /> Clients
                <Badge variant="outline" className="ml-2 text-xs font-medium">
                  {isAllWorkspaces
                    ? 'All workspaces'
                    : selectedWorkspace?.name ?? 'Workspace'}
                </Badge>
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {isAllWorkspaces
                  ? 'Accounts across every workspace in this organization.'
                  : `Accounts that live in the "${selectedWorkspace?.name ?? 'current'}" workspace. Switch workspace in the sidebar to see a different list.`}
                {canCreate && ' Add clients, import leads, and track follow-ups from one place.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" asChild>
                <Link to="/clients/activity">Recent activity</Link>
              </Button>
              <Button variant="outline" onClick={exportAll}>
                <Download className="w-4 h-4 mr-2" /> Export CSV
              </Button>
              {canCreate && (
                <Button variant="outline" onClick={() => setOpenImport(true)}>
                  <Upload className="w-4 h-4 mr-2" /> Import
                </Button>
              )}
              {canCreate && (
                <Button onClick={() => setOpenCreate(true)}>
                  <Plus className="w-4 h-4 mr-2" /> New client
                </Button>
              )}
            </div>
          </div>

          <Card>
            <CardContent className="pt-5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Start here
                  </p>
                  <h2 className="text-lg font-semibold mt-1">Choose what you want to do next</h2>
                  <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                    Clients are companies or people you work with. Add them one by one,
                    import a spreadsheet, then track follow-ups, deals, and activity from here.
                  </p>
                </div>
                <Badge variant="outline">{clients.length} saved client{clients.length === 1 ? '' : 's'}</Badge>
              </div>
              <div className="grid gap-3 md:grid-cols-4 mt-4">
                {canCreate && (
                  <>
                    <button
                      type="button"
                      onClick={() => setOpenCreate(true)}
                      className="rounded-lg border bg-background p-3 text-left hover:border-primary/50 hover:bg-muted/40 transition-colors"
                    >
                      <Plus className="w-4 h-4 text-primary mb-2" />
                      <p className="font-medium text-sm">Add one client</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Best for a single new company or contact.
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpenImport(true)}
                      className="rounded-lg border bg-background p-3 text-left hover:border-primary/50 hover:bg-muted/40 transition-colors"
                    >
                      <Upload className="w-4 h-4 text-primary mb-2" />
                      <p className="font-medium text-sm">Import leads</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Upload CSV files, including Apollo-style exports.
                      </p>
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setActiveTab('pipeline')}
                  className="rounded-lg border bg-background p-3 text-left hover:border-primary/50 hover:bg-muted/40 transition-colors"
                >
                  <GitBranch className="w-4 h-4 text-primary mb-2" />
                  <p className="font-medium text-sm">Track sales</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Move deals through stages and see totals.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('tasks')}
                  className="rounded-lg border bg-background p-3 text-left hover:border-primary/50 hover:bg-muted/40 transition-colors"
                >
                  <ListTodo className="w-4 h-4 text-primary mb-2" />
                  <p className="font-medium text-sm">Follow up</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    See the next task for every client.
                  </p>
                </button>
              </div>
            </CardContent>
          </Card>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
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
              <TabsTrigger value="forecast">
                <TrendingUp className="w-4 h-4 mr-1.5" /> Forecast
              </TabsTrigger>
            </TabsList>

            <TabsContent value="accounts" className="mt-4 space-y-6">
              <div>
                <h2 className="text-lg font-semibold">Accounts</h2>
                <p className="text-sm text-muted-foreground">
                  Your main client list. Search, filter, open a record, or add/import more clients.
                </p>
              </div>
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
              <Select value={bandFilter} onValueChange={(v) => setBandFilter(v as any)}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All scores</SelectItem>
                  <SelectItem value="hot">Hot</SelectItem>
                  <SelectItem value="warm">Warm</SelectItem>
                  <SelectItem value="cold">Cold</SelectItem>
                </SelectContent>
              </Select>
              {/* Category filter + group toggle — always visible so the
                  feature is discoverable even before any client has a
                  category. */}
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[170px]"><SelectValue placeholder="Category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {availableCategories.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      No categories yet. Set one when adding or editing a client.
                    </div>
                  )}
                  {availableCategories.map((cat) => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <SavedListViews
                organizationId={organizationId}
                currentFilters={{
                  search, typeFilter, statusFilter, bandFilter,
                  categoryFilter, groupByCategory,
                }}
                onApply={(f) => {
                  setSearch(f.search);
                  setTypeFilter(f.typeFilter);
                  setStatusFilter(f.statusFilter);
                  setBandFilter(f.bandFilter);
                  setCategoryFilter(f.categoryFilter);
                  setGroupByCategory(f.groupByCategory);
                }}
              />
              <Button
                type="button"
                size="sm"
                variant={groupByCategory ? 'default' : 'outline'}
                onClick={() => setGroupByCategory((v) => !v)}
                title={groupByCategory ? 'Show as flat grid' : 'Group cards by category'}
              >
                {groupByCategory ? 'Grouped' : 'Group by category'}
              </Button>
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1 ml-auto">
                <Filter className="w-3 h-3" />
                {filtered.length} of {clients.length}
              </span>
            </CardContent>
          </Card>

          {canManage && filtered.length > 0 && (
            <Card>
              <CardContent className="py-3 flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {selectedClients.length > 0
                    ? `${selectedClients.length} selected`
                    : 'Select clients to bulk delete'}
                </span>
                <Button type="button" variant="outline" size="sm" onClick={selectAllFiltered}>
                  Select all shown
                </Button>
                {selectedClients.length > 0 && (
                  <>
                    <Button type="button" variant="ghost" size="sm" onClick={clearSelection}>
                      Clear
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setOpenBulkEdit(true)}
                    >
                      <Pencil className="w-4 h-4 mr-2" /> Mass edit
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => setConfirmBulkDelete(true)}
                    >
                      <Trash2 className="w-4 h-4 mr-2" /> Delete selected
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Excel-style table */}
          {loading ? (
            <Card>
              <CardContent className="py-10 flex items-center justify-center text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading clients…
              </CardContent>
            </Card>
          ) : clients.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center space-y-2">
                <Building2 className="w-10 h-10 mx-auto text-muted-foreground/60" />
                <p className="text-sm text-muted-foreground">
                  No clients yet. Add one client if you only have a name, or import a spreadsheet if you already have a list.
                </p>
                {canCreate && (
                  <div className="flex flex-wrap justify-center gap-2 pt-2">
                    <Button onClick={() => setOpenCreate(true)}>
                      <Plus className="w-4 h-4 mr-2" /> New client
                    </Button>
                    <Button variant="outline" onClick={() => setOpenImport(true)}>
                      <Upload className="w-4 h-4 mr-2" /> Import
                    </Button>
                    <Button variant="ghost" onClick={() => setActiveTab('pipeline')}>
                      Learn pipeline <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <ClientsTable
              rows={filtered}
              selectedIds={selectedClientIds}
              groupByCategory={groupByCategory}
              canManage={canManage}
              onOpen={(c) => setSelected(c)}
              onToggleRow={toggleClientSelection}
              onToggleAll={(allSelected) => {
                if (allSelected) clearSelection();
                else selectAllFiltered();
              }}
            />
          )}
            </TabsContent>

            <TabsContent value="pipeline" className="mt-4 space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Pipeline</h2>
                <p className="text-sm text-muted-foreground">
                  Track possible sales as deals. Each deal moves through stages until it is won or lost.
                </p>
              </div>
              <Card>
                <CardContent className="pt-4 flex flex-wrap items-center gap-3">
                  <PipelineSelector
                    pipelines={pipelines}
                    value={selectedPipelineId}
                    onChange={setSelectedPipelineId}
                  />
                  <div className="flex items-center gap-2">
                    <Coins className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Display currency</span>
                  </div>
                  <Select
                    value={effectivePipelineCurrency}
                    onValueChange={handlePipelineCurrencyChange}
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {currencyOptions.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">
                    All deal values, column totals and KPIs convert from each
                    deal's saved currency into this one.
                  </span>
                  <span className="text-[11px] text-muted-foreground ml-auto">
                    {fxUsingFallback || !fxFetchedAt
                      ? 'Rates: built-in fallback'
                      : `Rates: live · updated ${new Date(fxFetchedAt).toLocaleDateString()}`}
                  </span>
                </CardContent>
              </Card>
              <PipelineAnalyticsCard
                currency={effectivePipelineCurrency}
                pipelineId={selectedPipelineId || undefined}
              />
              <DealsKanban
                clients={clients}
                displayCurrency={effectivePipelineCurrency}
                pipelineId={selectedPipelineId || undefined}
                restrictToClientIds={
                  isAllWorkspaces
                    ? null
                    : new Set(clients.map((c) => c.clientId))
                }
                stages={
                  selectedPipelineId
                    ? stagesByPipeline[selectedPipelineId] ?? []
                    : []
                }
                onSelectDeal={(d) => setSelectedDealId(d.dealId)}
              />
            </TabsContent>

            <TabsContent value="tasks" className="mt-4 space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Tasks</h2>
                <p className="text-sm text-muted-foreground">
                  A simple follow-up list for calls, emails, meetings, and client reminders.
                </p>
              </div>
              <ClientTasksList clients={clients} />
            </TabsContent>

            <TabsContent value="forecast" className="mt-4 space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Forecast</h2>
                <p className="text-sm text-muted-foreground">
                  Estimate likely revenue from open deals, grouped into easy sales projections.
                </p>
              </div>
              <ForecastTab displayCurrency={effectivePipelineCurrency} />
            </TabsContent>
          </Tabs>
        </div>
      </main>

      {/* New */}
      <ClientFormDialog
        open={openCreate}
        onOpenChange={setOpenCreate}
        onSubmit={handleCreate}
        onUpdateExisting={canManage ? handleUpdateExistingFromCreate : undefined}
        organizationId={organizationId}
      />
      {/* Edit */}
      <ClientFormDialog
        open={!!editing}
        onOpenChange={(o) => { if (!o) setEditing(null); }}
        client={editing}
        onSubmit={handleUpdate}
        organizationId={organizationId}
      />
      {/* Import */}
      <ImportClientsDialog
        open={openImport}
        onOpenChange={setOpenImport}
        organizationId={organizationId}
        workspaceId={activeWorkspaceId}
        workspaceName={selectedWorkspace?.name ?? null}
        userId={user?.userId}
        userName={user?.displayName}
        onComplete={(imported) => {
          // If any imported client has a category, switch to grouped view so
          // the user immediately sees their data organised by category — and
          // clear any active category filter so all groups are visible.
          if (imported && imported.some((c) => c.category && c.category.trim().length > 0)) {
            setGroupByCategory(true);
            setCategoryFilter('all');
            toast.success('Switched to "Group by category" view');
          }
        }}
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

      {/* Deal detail drawer — HubSpot-style 3-column view */}
      {(() => {
        const selectedDeal = allDeals.find((d) => d.dealId === selectedDealId) ?? null;
        // Look up the linked client against the org-wide list so the drawer
        // still works if the user happens to flip workspaces while the deal
        // is open from a different workspace.
        const linkedClient = selectedDeal?.clientId
          ? allClients.find((c) => c.clientId === selectedDeal.clientId) ?? null
          : null;
        if (!selectedDeal) return null;
        const stagesForDeal = stagesByPipeline[selectedDeal.pipelineId] ?? [];
        return (
          <DealDetailDrawer
            deal={selectedDeal}
            client={linkedClient}
            organizationId={organizationId}
            canManage={canManage}
            pipelineStages={stagesForDeal}
            onStageChange={async (d, stage) => {
              try {
                await updateDeal(d.dealId, { stageId: stage.stageId });
                toast.success(`Moved to ${stage.label}`);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Stage move failed');
              }
            }}
            onClose={() => setSelectedDealId(null)}
            onEdit={() => {
              setSelectedDealId(null);
              toast.info('Use the ⋮ menu on the deal card to edit.');
            }}
            onDelete={async (d) => {
              if (!confirm(`Delete deal "${d.title}"? This cannot be undone.`)) return;
              try {
                await removeDeal(d.dealId);
                setSelectedDealId(null);
                toast.success('Deal deleted');
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Delete failed');
              }
            }}
            onOpenClient={(c) => {
              setSelectedDealId(null);
              setSelected(c);
            }}
          />
        );
      })()}

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

      <AlertDialog
        open={confirmBulkDelete}
        onOpenChange={(o) => { if (!o) setConfirmBulkDelete(false); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete selected clients?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {selectedClients.length} selected client
              {selectedClients.length === 1 ? '' : 's'}. Only the clients you
              selected will be deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              disabled={deleting || selectedClients.length === 0}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <Trash2 className="w-4 h-4 mr-1" /> Delete selected
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BulkEditClientsDialog
        open={openBulkEdit}
        onOpenChange={setOpenBulkEdit}
        clients={selectedClients}
        onApply={async (clientId, patch) => {
          await update(clientId, patch);
        }}
        onClear={clearSelection}
      />
    </>
  );
};

export default Clients;
// Avoid unused-imports warnings for icons reserved for future row actions.
void MoreVertical;
