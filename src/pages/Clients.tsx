import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2, Plus, Search, Upload, Download, Loader2,
  Filter, Trash2, MoreVertical, TrendingUp,
  Pencil, ArrowLeft,
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
import {
  GitBranch, Home as HomeIcon, UserPlus,
  LayoutGrid, List, Activity as ActivityIcon,
} from 'lucide-react';
import { ActivitiesHubPanel } from '@/components/activities/ActivitiesHubPanel';
import { DealsKanban } from '@/components/clients/DealsKanban';
import { DealDetailDrawer } from '@/components/clients/DealDetailDrawer';
import { DealDetailView } from '@/components/deals/DealDetailView';
import { DealsEmptyState } from '@/components/deals/DealsEmptyState';
import { DealsListView } from '@/components/deals/DealsListView';
import { DealFormDialog } from '@/components/deals/DealFormDialog';
import { ImportDealsDialog } from '@/components/deals/ImportDealsDialog';
import { useDeals } from '@/hooks/useDeals';
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
import { CrmCategoryLanding } from '@/components/clients/CrmCategoryLanding';
import { CrmHomeDashboard } from '@/components/clients/CrmHomeDashboard';
import { AccountsLanding } from '@/components/clients/AccountsLanding';
import { AccountsHubCard } from '@/components/clients/AccountsHubCard';
import { ManageCategoriesDialog } from '@/components/clients/ManageCategoriesDialog';
import { useClientCategories } from '@/hooks/useClientCategories';
import { LeadsLanding } from '@/components/leads/LeadsLanding';
import { LeadsTable } from '@/components/leads/LeadsTable';
import { LeadFormDialog } from '@/components/leads/LeadFormDialog';
import { LeadDetailDrawer } from '@/components/leads/LeadDetailDrawer';
import { LeadConvertDialog } from '@/components/leads/LeadConvertDialog';
import { LeadsHubCard } from '@/components/leads/LeadsHubCard';
import { ImportLeadsDialog } from '@/components/leads/ImportLeadsDialog';
import { useContacts } from '@/hooks/useContacts';
import { useLeads } from '@/hooks/useLeads';
import type { Lead } from '@/services/supabase/leads';
import { leadDisplayName } from '@/services/supabase/leads';
import { recordAuditEvent } from '@/services/supabase/auditLog';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { toast } from 'sonner';
import { COMMON_CURRENCIES } from '@/lib/countries';
import { useOrgCurrency } from '@/hooks/useOrgCurrency';
import { useFxRates } from '@/lib/fxRates';
import { Coins } from 'lucide-react';
import { SendEmailDialog, type SendEmailRecipient } from '@/components/activities/SendEmailDialog';

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
  const { canViewModule, canEditModule } = useOrganization();
  const {
    organizationId, workspaceId: activeWorkspaceId,
    clients, allClients, loading, create, update, remove,
    canCreate, canManage,
    selectedWorkspace, isAllWorkspaces,
  } = useClients();
  const { pipelines, defaultPipeline, stagesByPipeline } = usePipelines();
  const { deals: allDeals, create: createDealHook, remove: removeDeal, update: updateDeal } = useDeals();
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  // Pipeline-tab-local state: which deal is open inline (Zoho detail view),
  // which view mode the rep prefers, and whether the Create Deal dialog is
  // open from the empty state or the kanban header.
  const [pipelineDealId, setPipelineDealId] = useState<string | null>(null);
  const [pipelineView, setPipelineView] = useState<'kanban' | 'list'>('kanban');
  const [openCreateDeal, setOpenCreateDeal] = useState(false);
  const [openImportDeals, setOpenImportDeals] = useState(false);
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
  // 'tasks' is retained in the union for backwards compat — if a
  // saved bookmark or onGoToTasks callback fires with 'tasks', the
  // useEffect below silently redirects it to 'activities' (where
  // tasks now live).
  const [activeTab, setActiveTab] = useState<'home' | 'leads' | 'accounts' | 'pipeline' | 'tasks' | 'activities' | 'forecast'>('home');
  useEffect(() => {
    if (activeTab === 'tasks') setActiveTab('activities');
  }, [activeTab]);

  // Guard: if the active tab requires a module the user can't view, fall back to home.
  useEffect(() => {
    if (activeTab === 'pipeline' && !canViewModule('deals')) setActiveTab('home');
    if (activeTab === 'leads' && !canViewModule('leads')) setActiveTab('home');
  }, [activeTab, canViewModule]);

  // ─── Contacts (still needed for AccountsHubCard count + DealFormDialog) ──
  const { contacts } = useContacts();
  // Send-email composer state (used by lead drawer Send Email button).
  const [emailRecipient, setEmailRecipient] = useState<SendEmailRecipient | null>(null);

  // ─── Leads state ────────────────────────────────────────────────────────
  const {
    leads, allLeads, loading: leadsLoading,
    workspaceId: activeLeadWorkspaceId,
    create: createLeadSvc, update: updateLeadSvc, remove: removeLeadSvc, convert: convertLeadSvc,
    canCreate: canCreateLead, canManage: canManageLead,
  } = useLeads();
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [openCreateLead, setOpenCreateLead] = useState(false);
  const [openImportLead, setOpenImportLead] = useState(false);
  const [confirmDeleteLead, setConfirmDeleteLead] = useState<Lead | null>(null);
  const [convertingLead, setConvertingLead] = useState<Lead | null>(null);
  const [deletingLead, setDeletingLead] = useState(false);

  // Keep the open drawer reactive to realtime updates. Look up against the
  // workspace-filtered list first so the user always sees the "current"
  // version; fall back to the org-wide list (allLeads) so a lead that lives
  // in another workspace still hydrates while the drawer is open; finally
  // return null so the drawer unmounts if the lead was deleted out from
  // under us (rather than rendering a ghost the user can act on).
  const liveSelectedLead = useMemo(() => {
    if (!selectedLead) return null;
    return leads.find((l) => l.leadId === selectedLead.leadId)
        ?? allLeads.find((l) => l.leadId === selectedLead.leadId)
        ?? null;
  }, [leads, allLeads, selectedLead]);

  // Drop a stale open drawer when the selected lead vanishes (deleted in
  // another tab / never made it after the realtime feed refreshed).
  useEffect(() => {
    if (selectedLead && liveSelectedLead === null) {
      setSelectedLead(null);
    }
  }, [selectedLead, liveSelectedLead]);

  const isLocalOrg = !!organizationId?.startsWith('local-');

  // ─── Account categories ────────────────────────────────────────────────
  const {
    categories: registeredCategories,
    workspaceId: categoriesWorkspaceId,
    create: createCategorySvc,
    update: updateCategorySvc,
    remove: removeCategorySvc,
    canManage: canManageCategories,
    canAdminCategories,
  } = useClientCategories();
  const [openManageCategories, setOpenManageCategories] = useState(false);

  // Category landing gate. Users see a tile picker first; clicking a tile
  // (or "All accounts") lands them in the full CRM view filtered to that
  // category. Persists per browser so reps don't see the gate every time.
  const LANDING_KEY = 'pm_crm_landing_done';
  const [showLanding, setShowLanding] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LANDING_KEY) !== '1';
    } catch {
      return true;
    }
  });
  const exitLanding = (category: string | null) => {
    if (category === '__uncategorized__') {
      setCategoryFilter('__uncategorized__');
    } else if (category) {
      setCategoryFilter(category);
    } else {
      setCategoryFilter('all');
    }
    setShowLanding(false);
    try { localStorage.setItem(LANDING_KEY, '1'); } catch { /* ignore */ }
  };
  const backToLanding = () => {
    setShowLanding(true);
    setCategoryFilter('all');
    try { localStorage.removeItem(LANDING_KEY); } catch { /* ignore */ }
  };

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
      if (categoryFilter === '__uncategorized__') {
        if (c.category && c.category.trim().length > 0) return false;
      } else if (
        categoryFilter !== 'all'
        && (c.category ?? '').trim().toLowerCase() !== categoryFilter.toLowerCase()
      ) {
        return false;
      }
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

  // Union of registered categories + free-text categories on accounts.
  // Keyed case-insensitively so "Enterprise" and "ENTERPRISE" collapse into
  // one option (matches how the landing buckets them). Registered names win
  // as the display label so dropdowns show the canonical casing.
  const availableCategories = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of registeredCategories) {
      map.set(r.name.toLowerCase(), r.name);
    }
    for (const c of clients) {
      const raw = c.category?.trim();
      if (!raw) continue;
      const k = raw.toLowerCase();
      if (!map.has(k)) map.set(k, raw);
    }
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
  }, [clients, registeredCategories]);

  const selectedClients = useMemo(
    () => clients.filter((c) => selectedClientIds.has(c.clientId)),
    [clients, selectedClientIds],
  );

  // Shared allow-list for every workspace-scoped view (kanban, analytics,
  // tasks, forecast). When the sidebar shows "All workspaces" we pass null
  // so the downstream components skip filtering entirely.
  const workspaceClientIds = useMemo(
    () => (isAllWorkspaces ? null : new Set(clients.map((c) => c.clientId))),
    [isAllWorkspaces, clients],
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
      toast.error(err instanceof Error ? err.message : 'Failed to create account');
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
      toast.error(err instanceof Error ? err.message : 'Failed to update account');
    }
  };

  const handleUpdateExistingFromCreate = async (
    clientId: string,
    input: CreateClientInput,
  ) => {
    const updated = await update(clientId, input);
    toast.success(`Updated existing account "${updated.name}"`);
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
    const targetSample = selectedClients.slice(0, 5).map((c) => c.name);
    try {
      for (const client of selectedClients) {
        await remove(client.clientId);
      }
      toast.success(`Deleted ${selectedClients.length} account(s)`);
      void recordAuditEvent(
        organizationId,
        { userId: user?.userId ?? null, displayName: user?.displayName ?? null },
        {
          action: 'bulk_delete',
          targetType: 'client',
          targetLabel: `${selectedClients.length} account(s)`,
          metadata: {
            count: selectedClients.length,
            sample: targetSample,
            workspaceId: activeWorkspaceId,
          },
        },
      );
      if (selected && selectedClientIds.has(selected.clientId)) setSelected(null);
      clearSelection();
      setConfirmBulkDelete(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete selected accounts');
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
    toast.success(`Exported ${filtered.length} account(s)`);
    void recordAuditEvent(
      organizationId,
      { userId: user?.userId ?? null, displayName: user?.displayName ?? null },
      {
        action: 'data_exported',
        targetType: 'client',
        targetLabel: `${filtered.length} account(s) → CSV`,
        metadata: { count: filtered.length, format: 'csv', workspaceId: activeWorkspaceId },
      },
    );
  };

  return (
    <>
      <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-4 md:p-8">
        {/* Every CRM tab gets full page width — matches the project-board
            layout and gives leads / contacts / accounts / pipeline lists
            enough room for all their columns without internal scroll. */}
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
                <Building2 className="w-6 h-6 text-primary" /> CRM
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
                {canCreate && ' Add accounts, import leads, and track follow-ups from one place.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {activeTab === 'accounts' && !showLanding && (
                <Button variant="outline" onClick={backToLanding}>
                  <ArrowLeft className="w-4 h-4 mr-2" /> Categories
                </Button>
              )}
              <Button variant="outline" asChild>
                <Link to="/clients/activity">Activities</Link>
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
                  <Plus className="w-4 h-4 mr-2" /> New account
                </Button>
              )}
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
            <TabsList>
              <TabsTrigger value="home">
                <HomeIcon className="w-4 h-4 mr-1.5" /> Home
              </TabsTrigger>
              {canViewModule('leads') && (
                <TabsTrigger value="leads">
                  <UserPlus className="w-4 h-4 mr-1.5" /> Leads
                  {leads.length > 0 && (
                    <Badge variant="outline" className="ml-1.5 text-[9px]">{leads.length}</Badge>
                  )}
                </TabsTrigger>
              )}
              <TabsTrigger value="accounts">
                <Building2 className="w-4 h-4 mr-1.5" /> Accounts
              </TabsTrigger>
              {canViewModule('deals') && (
                <TabsTrigger value="pipeline">
                  <GitBranch className="w-4 h-4 mr-1.5" /> Pipeline
                </TabsTrigger>
              )}
              {/* Tasks + Meetings + Calls all live in the Activities tab
                  now — same underlying tables, same filter views, plus
                  the drag-droppable status kanban. The old Tasks tab was
                  redundant (also read client_tasks) and confused reps. */}
              <TabsTrigger value="activities">
                <ActivityIcon className="w-4 h-4 mr-1.5" /> Activities
              </TabsTrigger>
              <TabsTrigger value="forecast">
                <TrendingUp className="w-4 h-4 mr-1.5" /> Forecast
              </TabsTrigger>
            </TabsList>

            <TabsContent value="home" className="mt-4">
              <CrmHomeDashboard
                clients={clients}
                deals={allDeals}
                workspaceClientIds={workspaceClientIds}
                workspaceName={selectedWorkspace?.name ?? null}
                displayCurrency={effectivePipelineCurrency}
                onOpenAccount={(c) => setSelected(c)}
                onOpenDeal={(d) => setSelectedDealId(d.dealId)}
                onGoToTab={(t) => setActiveTab(t)}
              />
            </TabsContent>

            <TabsContent value="leads" className="mt-4 space-y-4">
              {!canViewModule('leads') ? (
                <div className="p-6 text-sm text-muted-foreground">You don't have access to Leads. Ask an admin for access.</div>
              ) : leadsLoading ? (
                <Card>
                  <CardContent className="py-10 flex items-center justify-center text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading leads…
                  </CardContent>
                </Card>
              ) : leads.length === 0 ? (
                <LeadsLanding
                  canCreate={canCreateLead && canEditModule('leads')}
                  onCreate={() => setOpenCreateLead(true)}
                  onImport={() => setOpenImportLead(true)}
                />
              ) : (
                <>
                  <LeadsHubCard
                    leadsCount={leads.length}
                    accountsCount={clients.length}
                    canCreate={canCreateLead}
                    scopeLabel={isAllWorkspaces
                      ? 'All workspaces'
                      : selectedWorkspace?.name ?? 'Current workspace'}
                    onCreateLead={() => setOpenCreateLead(true)}
                    onImportLeads={() => setOpenImportLead(true)}
                    onGoToAccounts={() => setActiveTab('accounts')}
                    onGoToPipeline={() => setActiveTab('pipeline')}
                    onGoToTasks={() => setActiveTab('tasks')}
                    onConvertHelp={() => {
                      // Scroll the leads table into view so the rep can
                      // pick which lead to convert. The Convert action
                      // itself opens via the row drawer's Convert button.
                      document.getElementById('leads-table-anchor')
                        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      toast.info('Pick a lead from the table below and click Convert in its drawer.');
                    }}
                  />

                  <div
                    id="leads-table-anchor"
                    className="flex items-center justify-between flex-wrap gap-2 pt-2"
                  >
                    <div>
                      <h2 className="text-lg font-semibold">Leads</h2>
                      <p className="text-sm text-muted-foreground">
                        Prospects you haven't qualified yet. Convert a lead to promote it into a real Account + Contact.
                      </p>
                    </div>
                    {canCreateLead && canEditModule('leads') && (
                      <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={() => setOpenImportLead(true)}>
                          <Upload className="w-4 h-4 mr-2" /> Import Leads
                        </Button>
                        <Button onClick={() => setOpenCreateLead(true)}>
                          <Plus className="w-4 h-4 mr-2" /> Create Lead
                        </Button>
                      </div>
                    )}
                  </div>
                  <LeadsTable
                    rows={leads}
                    onOpen={(l) => setSelectedLead(l)}
                  />
                </>
              )}
            </TabsContent>

            <TabsContent value="accounts" className="mt-4 space-y-6">
              {loading ? (
                <Card>
                  <CardContent className="py-10 flex items-center justify-center text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading accounts…
                  </CardContent>
                </Card>
              ) : clients.length === 0 ? (
                <AccountsLanding
                  canCreate={canCreate}
                  onCreate={() => setOpenCreate(true)}
                  onImport={() => setOpenImport(true)}
                />
              ) : showLanding ? (
                <CrmCategoryLanding
                  clients={clients}
                  registered={registeredCategories}
                  onPick={exitLanding}
                  onCreateCategory={canManageCategories
                    ? () => setOpenManageCategories(true)
                    : undefined}
                  onManageCategories={canManageCategories
                    ? () => setOpenManageCategories(true)
                    : undefined}
                />
              ) : (
              <>
              <AccountsHubCard
                accountsCount={clients.length}
                contactsCount={contacts.length}
                leadsCount={leads.length}
                canCreate={canCreate}
                scopeLabel={isAllWorkspaces
                  ? 'All workspaces'
                  : selectedWorkspace?.name ?? 'Current workspace'}
                onCreateAccount={() => setOpenCreate(true)}
                onImportAccounts={() => setOpenImport(true)}
                onGoToContacts={() => {/* Contacts tab removed */}}
                onGoToLeads={() => setActiveTab('leads')}
                onGoToPipeline={() => setActiveTab('pipeline')}
                onGoToTasks={() => setActiveTab('tasks')}
              />
              <div className="pt-2">
                <h2 className="text-lg font-semibold">Accounts</h2>
                <p className="text-sm text-muted-foreground">
                  Your main accounts list. Search, filter, open a record, or add/import more accounts.
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
                      No categories yet. Set one when adding or editing an account.
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
                    : 'Select accounts to bulk delete'}
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

          {/* Excel-style table — the outer branches already handled
              `loading` and the zero-clients empty state above. By the time
              we reach here we have rows to show, so render the table
              directly. */}
          {(
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
              </>
              )}
            </TabsContent>

            <TabsContent value="pipeline" className="mt-4 space-y-4">
              {(() => {
                if (!canViewModule('deals')) {
                  return (
                    <div className="p-6 text-sm text-muted-foreground">You don't have access to Deals. Ask an admin for access.</div>
                  );
                }
                // Deals visible in the current Pipeline tab scope: workspace
                // clients only (or all when on All-workspaces) + optional
                // pipeline filter. Determines whether we render the empty
                // state, the inline detail, or the standard kanban / list.
                const scopedDeals = allDeals.filter((d) => {
                  if (selectedPipelineId && d.pipelineId !== selectedPipelineId) return false;
                  if (workspaceClientIds && d.clientId && !workspaceClientIds.has(d.clientId)) return false;
                  return true;
                });

                // Inline Zoho-style detail. Replaces kanban/list while open;
                // the back chevron clears the selection.
                if (pipelineDealId) {
                  return (
                    <DealDetailView
                      dealId={pipelineDealId}
                      onBack={() => setPipelineDealId(null)}
                    />
                  );
                }

                // Zoho empty state when there are zero deals in scope.
                // If allDeals has rows but they're all filtered out by the
                // current workspace / pipeline scope, show a different
                // message with an escape hatch — otherwise reps see "no
                // deals" and panic that their work vanished.
                if (scopedDeals.length === 0) {
                  if (allDeals.length > 0) {
                    return (
                      <div className="rounded-lg border p-8 text-center space-y-3 max-w-2xl mx-auto">
                        <p className="text-base font-semibold">
                          No deals in this scope
                        </p>
                        <p className="text-sm text-muted-foreground">
                          You have {allDeals.length} deal{allDeals.length === 1 ? '' : 's'} in this organization,
                          but none are in the current workspace
                          {selectedPipelineId ? ' or pipeline' : ''}. Switch workspace
                          (or change the pipeline selector below) to see them.
                        </p>
                        <div className="flex items-center justify-center gap-2 pt-2">
                          {selectedPipelineId && (
                            <Button variant="outline" size="sm" onClick={() => setSelectedPipelineId('')}>
                              Show all pipelines
                            </Button>
                          )}
                          {canManage && canEditModule('deals') && (
                            <Button size="sm" onClick={() => setOpenCreateDeal(true)}>
                              <Plus className="w-3.5 h-3.5 mr-1" /> Create Deal here
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <DealsEmptyState
                      canManage={canManage && canEditModule('deals')}
                      onCreate={() => setOpenCreateDeal(true)}
                      onImport={() => setOpenImportDeals(true)}
                    />
                  );
                }

                return (
                  <>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <h2 className="text-lg font-semibold">Pipeline</h2>
                        <p className="text-sm text-muted-foreground">
                          Track possible sales as deals. Each deal moves through stages until it is won or lost.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex rounded-md border overflow-hidden">
                          <Button
                            variant={pipelineView === 'list' ? 'default' : 'ghost'}
                            size="sm"
                            className="rounded-none"
                            onClick={() => setPipelineView('list')}
                            title="List view"
                          >
                            <List className="w-4 h-4" />
                          </Button>
                          <Button
                            variant={pipelineView === 'kanban' ? 'default' : 'ghost'}
                            size="sm"
                            className="rounded-none"
                            onClick={() => setPipelineView('kanban')}
                            title="Kanban view"
                          >
                            <LayoutGrid className="w-4 h-4" />
                          </Button>
                        </div>
                        {canManage && canEditModule('deals') && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => setOpenImportDeals(true)}>
                              <Upload className="w-3.5 h-3.5 mr-1" /> Import
                            </Button>
                            <Button size="sm" onClick={() => setOpenCreateDeal(true)}>
                              <Plus className="w-3.5 h-3.5 mr-1" /> Create Deal
                            </Button>
                          </>
                        )}
                      </div>
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
                      restrictToClientIds={workspaceClientIds}
                    />

                    {pipelineView === 'kanban' ? (
                      <DealsKanban
                        clients={clients}
                        displayCurrency={effectivePipelineCurrency}
                        pipelineId={selectedPipelineId || undefined}
                        restrictToClientIds={workspaceClientIds}
                        stages={
                          selectedPipelineId
                            ? stagesByPipeline[selectedPipelineId] ?? []
                            : []
                        }
                        onSelectDeal={(d) => setPipelineDealId(d.dealId)}
                      />
                    ) : (
                      <DealsListView
                        deals={scopedDeals}
                        onSelectDeal={(d) => setPipelineDealId(d.dealId)}
                      />
                    )}
                  </>
                );
              })()}
            </TabsContent>

            <TabsContent value="activities" className="mt-4">
              {/* Embeds the same hub the standalone /clients/activity page
                  renders — Tasks + Meetings + Calls in one filterable
                  view, with kanban + list toggle and quick-create dialogs. */}
              <ActivitiesHubPanel bounded={false} />
            </TabsContent>

            <TabsContent value="forecast" className="mt-4 space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Forecast</h2>
                <p className="text-sm text-muted-foreground">
                  Estimate likely revenue from open deals, grouped into easy sales projections.
                </p>
              </div>
              <ForecastTab
                displayCurrency={effectivePipelineCurrency}
                restrictToClientIds={workspaceClientIds}
              />
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
          if (imported && imported.length > 0) {
            void recordAuditEvent(
              organizationId,
              { userId: user?.userId ?? null, displayName: user?.displayName ?? null },
              {
                action: 'client_imported',
                targetType: 'client',
                targetLabel: `${imported.length} account(s) via CSV`,
                metadata: {
                  count: imported.length,
                  workspaceId: activeWorkspaceId,
                  workspaceName: selectedWorkspace?.name ?? null,
                },
              },
            );
          }
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
          allAccounts={allClients}
          onOpenAccount={(c) => setSelected(c)}
        />
      )}

      {/* Account categories — managed list lives in client_categories */}
      <ManageCategoriesDialog
        open={openManageCategories}
        onOpenChange={setOpenManageCategories}
        categories={registeredCategories}
        clients={clients}
        canManage={canManageCategories}
        canAdmin={canAdminCategories}
        workspaceId={isAllWorkspaces ? null : categoriesWorkspaceId}
        workspaceName={selectedWorkspace?.name ?? null}
        onCreate={createCategorySvc}
        onUpdate={updateCategorySvc}
        onDelete={removeCategorySvc}
      />

      {/* Zoho-style Create Deal dialog. Opens from the Pipeline tab's empty
          state or the kanban header. */}
      <DealFormDialog
        open={openCreateDeal}
        onOpenChange={setOpenCreateDeal}
        clients={clients}
        contacts={contacts}
      />

      {/* Deals CSV importer — same shape as Leads / Contacts / Accounts. */}
      <ImportDealsDialog
        open={openImportDeals}
        onOpenChange={setOpenImportDeals}
        organizationId={organizationId}
        accounts={clients}
        workspaceName={selectedWorkspace?.name ?? null}
        create={createDealHook}
        onComplete={(r) => {
          if (r.imported > 0) {
            toast.success(`Imported ${r.imported} deal${r.imported === 1 ? '' : 's'}.`);
          } else if (r.errors.length > 0) {
            toast.error(`Couldn't import — ${r.errors[0]?.message ?? 'see details'}.`);
          }
        }}
      />

      {/* In-app email composer — opened by the Send Email button on the Lead drawer. */}
      <SendEmailDialog
        open={!!emailRecipient}
        onOpenChange={(o) => { if (!o) setEmailRecipient(null); }}
        recipient={emailRecipient}
      />

      {/* Lead dialogs and drawer */}
      <ImportLeadsDialog
        open={openImportLead}
        onOpenChange={setOpenImportLead}
        organizationId={organizationId}
        // Skip the implicit-workspace fallback when the user is in 'All
        // workspaces' / 'Unassigned' — the dialog will refuse to import
        // and surface a clear message instead of silently stamping every
        // row into workspaces[0].
        workspaceId={isAllWorkspaces ? null : activeLeadWorkspaceId}
        workspaceName={selectedWorkspace?.name ?? null}
        userId={user?.userId}
        userName={user?.displayName}
        onComplete={(result) => {
          // Always audit the attempt — even when zero rows landed, finance/
          // compliance reviewers need to see that a bulk action ran.
          void recordAuditEvent(
            organizationId,
            { userId: user?.userId ?? null, displayName: user?.displayName ?? null },
            {
              action: result.imported.length > 0 ? 'lead_imported' : 'lead_import_failed',
              targetType: 'lead',
              targetLabel: `${result.imported.length}/${result.imported.length + result.errors.length} lead(s) via CSV`,
              metadata: {
                imported: result.imported.length,
                errors: result.errors.length,
                coercions: result.coercions.length,
                unknownHeaders: result.unknownHeaders,
                missingRequired: result.missingRequired,
                aborted: result.aborted,
                workspaceId: activeLeadWorkspaceId,
                workspaceName: selectedWorkspace?.name ?? null,
              },
            },
          );

          if (result.imported.length === 0) {
            toast.error('No leads were imported. Check the row errors above.');
            return;
          }
          if (result.errors.length > 0 || result.coercions.length > 0) {
            toast.warning(
              `Imported ${result.imported.length} of ${result.imported.length + result.errors.length} leads — review the warnings above.`,
            );
          } else {
            toast.success(`Imported ${result.imported.length} lead${result.imported.length === 1 ? '' : 's'} into ${selectedWorkspace?.name ?? 'workspace'}`);
          }
        }}
      />

      <LeadFormDialog
        open={openCreateLead || !!editingLead}
        onOpenChange={(o) => {
          if (!o) {
            setOpenCreateLead(false);
            setEditingLead(null);
          }
        }}
        lead={editingLead}
        onSubmit={async (input) => {
          try {
            if (editingLead) {
              await updateLeadSvc(editingLead.leadId, input);
              toast.success(`Updated lead ${editingLead.leadNumber}`);
              setEditingLead(null);
            } else {
              const created = await createLeadSvc(input);
              toast.success(`Created lead ${created.leadNumber}`);
              void recordAuditEvent(
                organizationId,
                { userId: user?.userId ?? null, displayName: user?.displayName ?? null },
                {
                  action: 'lead_created',
                  targetType: 'lead',
                  targetId: created.leadId,
                  targetLabel: `${leadDisplayName(created)} — ${created.company}`,
                  metadata: { leadNumber: created.leadNumber, workspaceId: created.workspaceId },
                },
              );
              setOpenCreateLead(false);
            }
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to save lead');
            throw err;
          }
        }}
      />

      {liveSelectedLead && (
        <LeadDetailDrawer
          lead={liveSelectedLead}
          organizationId={organizationId}
          canManage={canManageLead}
          readOnly={!canEditModule('leads')}
          canConvert={!isLocalOrg}
          onClose={() => setSelectedLead(null)}
          onEdit={(l) => setEditingLead(l)}
          onDelete={(l) => setConfirmDeleteLead(l)}
          onConvert={(l) => {
            if (isLocalOrg) {
              toast.info('Lead conversion needs a Supabase-backed org. Connect Supabase, then try again.');
              return;
            }
            setConvertingLead(l);
          }}
          onClone={async (l) => {
            try {
              const cloned = await createLeadSvc({
                // Pin the clone to the SOURCE lead's workspace, not whichever
                // workspace the sidebar happens to be on at click time.
                workspaceId: l.workspaceId,
                salutation: l.salutation,
                firstName: l.firstName,
                lastName: l.lastName,
                title: l.title,
                email: l.email,
                phone: l.phone,
                mobile: l.mobile,
                fax: l.fax,
                website: l.website,
                skypeId: l.skypeId,
                twitter: l.twitter,
                linkedinUrl: l.linkedinUrl,
                company: l.company,
                industry: l.industry,
                annualRevenue: l.annualRevenue,
                noOfEmployees: l.noOfEmployees,
                street: l.street,
                city: l.city,
                state: l.state,
                postalCode: l.postalCode,
                country: l.country,
                leadSource: l.leadSource,
                leadStatus: 'new',
                rating: l.rating,
                emailOptOut: l.emailOptOut,
                description: l.description,
                tags: l.tags,
              });
              toast.success(`Cloned to ${cloned.leadNumber}`);
              setSelectedLead(cloned);
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Clone failed');
            }
          }}
          onSendEmail={(l) => {
            if (!l.email) {
              toast.error('This lead has no email on file.');
              return;
            }
            setEmailRecipient({
              entityType: 'lead',
              entityId: l.leadId,
              name: [l.firstName, l.lastName].filter(Boolean).join(' ') || l.email,
              email: l.email,
              accountOwnerName: l.company ?? null,
            });
          }}
          onStatusChange={async (l, next) => {
            await updateLeadSvc(l.leadId, { leadStatus: next });
          }}
          onUpdate={async (leadId, patch) => {
            const updated = await updateLeadSvc(leadId, patch);
            // Keep the selected-lead pointer in sync so liveSelectedLead
            // reflects the saved values if the drawer is closed and re-opened.
            setSelectedLead(updated);
            return updated;
          }}
        />
      )}

      <LeadConvertDialog
        open={!!convertingLead}
        onOpenChange={(o) => { if (!o) setConvertingLead(null); }}
        lead={convertingLead}
        existingClients={allClients}
        onConvert={async (l, input) => {
          const result = await convertLeadSvc(l, input);
          void recordAuditEvent(
            organizationId,
            { userId: user?.userId ?? null, displayName: user?.displayName ?? null },
            {
              action: 'lead_converted',
              targetType: 'lead',
              targetId: l.leadId,
              targetLabel: `${leadDisplayName(l)} — ${l.company}`,
              metadata: {
                leadNumber: l.leadNumber,
                clientId: result.clientId,
                contactId: result.contactId,
                dealId: result.dealId,
                warnings: result.warnings,
              },
            },
          );
          return result;
        }}
        onConverted={(result) => {
          setSelectedLead(null);
          const acct = allClients.find((c) => c.clientId === result.clientId);
          if (acct) setSelected(acct);
        }}
      />

      <AlertDialog
        open={!!confirmDeleteLead}
        onOpenChange={(o) => { if (!o) setConfirmDeleteLead(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this lead?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDeleteLead && (
                <>
                  Permanently remove <strong>{leadDisplayName(confirmDeleteLead)}</strong>
                  {' '}({confirmDeleteLead.leadNumber}) and any notes attached to it.
                  This cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingLead}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingLead}
              onClick={async () => {
                if (!confirmDeleteLead) return;
                setDeletingLead(true);
                try {
                  await removeLeadSvc(confirmDeleteLead.leadId);
                  void recordAuditEvent(
                    organizationId,
                    { userId: user?.userId ?? null, displayName: user?.displayName ?? null },
                    {
                      action: 'lead_deleted',
                      targetType: 'lead',
                      targetId: confirmDeleteLead.leadId,
                      targetLabel: `${leadDisplayName(confirmDeleteLead)} — ${confirmDeleteLead.company}`,
                      metadata: { leadNumber: confirmDeleteLead.leadNumber },
                    },
                  );
                  toast.success('Lead deleted');
                  if (selectedLead?.leadId === confirmDeleteLead.leadId) {
                    setSelectedLead(null);
                  }
                  setConfirmDeleteLead(null);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Delete failed');
                } finally {
                  setDeletingLead(false);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingLead && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Deal detail drawer — HubSpot-style 3-column view.
          Suppressed on the Pipeline tab: that tab uses the new Zoho-style
          inline DealDetailView instead, so we don't want the drawer and the
          inline view racing for the same selectedDealId. */}
      {activeTab !== 'pipeline' && (() => {
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
            readOnly={!canEditModule('deals')}
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
            <AlertDialogTitle>Delete this account?</AlertDialogTitle>
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
            <AlertDialogTitle>Delete selected accounts?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {selectedClients.length} selected account
              {selectedClients.length === 1 ? '' : 's'}. Only the accounts you
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
        onClear={() => {
          // Fires after the dialog finishes applying changes to every row.
          void recordAuditEvent(
            organizationId,
            { userId: user?.userId ?? null, displayName: user?.displayName ?? null },
            {
              action: 'bulk_edit',
              targetType: 'client',
              targetLabel: `${selectedClients.length} account(s)`,
              metadata: {
                count: selectedClients.length,
                workspaceId: activeWorkspaceId,
              },
            },
          );
          clearSelection();
        }}
      />
    </>
  );
};

export default Clients;
// Avoid unused-imports warnings for icons reserved for future row actions.
void MoreVertical;
