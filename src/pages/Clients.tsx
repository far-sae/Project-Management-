import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2, Plus, Search, Upload, Loader2,
  Filter, Trash2, MoreVertical,
  ArrowLeft, ChevronDown,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
  GitBranch, Home as HomeIcon,
  LayoutGrid, List,
} from 'lucide-react';
import { DealsKanban } from '@/components/clients/DealsKanban';
import { DealDetailDrawer } from '@/components/clients/DealDetailDrawer';
import { DealDetailView } from '@/components/deals/DealDetailView';
import { DealsEmptyState } from '@/components/deals/DealsEmptyState';
import { DealsListView } from '@/components/deals/DealsListView';
import { DealFormDialog } from '@/components/deals/DealFormDialog';
import { CustomItemDialog } from '@/components/deals/CustomItemDialog';
import { DealHandoffDialog } from '@/components/deals/DealHandoffDialog';
import { DealWonModal } from '@/components/clients/DealWonModal';
import type { PipelineStage } from '@/services/supabase/pipelines';
import { ImportDealsDialog } from '@/components/deals/ImportDealsDialog';
import { useDeals } from '@/hooks/useDeals';
import type { Deal } from '@/services/supabase/deals';
import { resolveStageChange } from '@/services/supabase/deals';
import { ForecastTab } from '@/components/clients/ForecastTab';
import { PipelineAnalyticsCard } from '@/components/clients/PipelineAnalyticsCard';
import { PipelineSelector } from '@/components/clients/PipelineSelector';
import { useClients } from '@/hooks/useClients';
import { usePipelines } from '@/hooks/usePipelines';
import {
  Client,
  CreateClientInput, exportClientsToCsv,
} from '@/services/supabase/clients';
import { ClientFormDialog } from '@/components/clients/ClientFormDialog';
import { ImportClientsDialog } from '@/components/clients/ImportClientsDialog';
import { ClientDetailDrawer } from '@/components/clients/ClientDetailDrawer';
import { CrmCategoryLanding } from '@/components/clients/CrmCategoryLanding';
import { BusinessAccountsTab } from '@/components/clients/BusinessAccountsTab';
import { CrmHomeDashboard } from '@/components/clients/CrmHomeDashboard';
import { AccountsLanding } from '@/components/clients/AccountsLanding';
import { ManageCategoriesDialog } from '@/components/clients/ManageCategoriesDialog';
import { useClientCategories } from '@/hooks/useClientCategories';
import { LeadFormDialog } from '@/components/leads/LeadFormDialog';
import { LeadsTable } from '@/components/leads/LeadsTable';
import { LeadDetailDrawer } from '@/components/leads/LeadDetailDrawer';
import { LeadConvertDialog } from '@/components/leads/LeadConvertDialog';
import { ImportLeadsDialog } from '@/components/leads/ImportLeadsDialog';
import { useContacts } from '@/hooks/useContacts';
import { useLeads } from '@/hooks/useLeads';
import type { Lead } from '@/services/supabase/leads';
import { leadDisplayName, exportLeadsToCsv } from '@/services/supabase/leads';
import { recordAuditEvent } from '@/services/supabase/auditLog';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { toast } from 'sonner';
import { COMMON_CURRENCIES } from '@/lib/countries';
import { useOrgCurrency } from '@/hooks/useOrgCurrency';
import { useFxRates } from '@/lib/fxRates';
import { Coins } from 'lucide-react';
import { SendEmailDialog, type SendEmailRecipient } from '@/components/activities/SendEmailDialog';

export const Clients: React.FC = () => {
  const { user } = useAuth();
  const { canViewModule, canEditModule, canEditPage } = useOrganization();
  // Page-level CRM access: when the user's role grants only 'view' on CRM,
  // every CRM mutation is disabled (read-only). ANDed into the capability
  // flags below so all existing canManage/canCreate-gated controls inherit it.
  const crmEditable = canEditPage('crm');
  const {
    organizationId, workspaceId: activeWorkspaceId,
    clients, allClients, loading, create, update, remove,
    canCreate: rawCanCreate, canManage: rawCanManage,
    selectedWorkspace, isAllWorkspaces,
  } = useClients();
  const canCreate = rawCanCreate && crmEditable;
  const canManage = rawCanManage && crmEditable;
  const { pipelines, defaultPipeline, stagesByPipeline } = usePipelines();
  const { deals: allDeals, create: createDealHook, remove: removeDeal, update: updateDeal } = useDeals();
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  // Handoff dialog state: deal that just became Won (or any deal the rep
  // clicked "Assign task" on), triggering the PM task prompt. `handoffWon`
  // tracks which entry point opened it so the dialog copy is correct.
  const [handoffDeal, setHandoffDeal] = useState<Deal | null>(null);
  const [handoffWon, setHandoffWon] = useState(false);
  // List-view stage dropdown → Won pick. Reuses the SAME DealWonModal the
  // kanban uses, so the won-confirm + project handoff fires identically
  // regardless of which view the rep is in.
  const [listWonStage, setListWonStage] = useState<{ deal: Deal; stage: PipelineStage } | null>(null);
  // Helpers so both entry points (won → handoff, Assign-task button) open
  // the one DealHandoffDialog with the right copy.
  const openWonHandoff = (deal: Deal) => { setHandoffWon(true); setHandoffDeal(deal); };
  const openAssignTask = (deal: Deal) => { setHandoffWon(false); setHandoffDeal(deal); };
  // Pipeline-tab-local state: which deal is open inline (Zoho detail view),
  // which view mode the rep prefers, and whether the Create Deal dialog is
  // open from the empty state or the kanban header.
  const [pipelineDealId, setPipelineDealId] = useState<string | null>(null);
  const [pipelineView, setPipelineView] = useState<'kanban' | 'list'>('kanban');
  const [openCreateDeal, setOpenCreateDeal] = useState(false);
  // Pipeline-tab "Custom item" create (two-button add alongside Create Deal).
  const [openCustomItem, setOpenCustomItem] = useState(false);
  const [openImportDeals, setOpenImportDeals] = useState(false);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('');
  useEffect(() => {
    if (!selectedPipelineId && defaultPipeline) {
      setSelectedPipelineId(defaultPipeline.pipelineId);
    }
  }, [defaultPipeline, selectedPipelineId]);

  const [search, setSearch] = useState('');
  // Category filter is no longer surfaced in the Accounts toolbar, but it is
  // still driven by the category landing gate (a tile picker → exitLanding).
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  // 'tasks' is retained in the union for backwards compat — some hub
  // callbacks (e.g. CrmHomeDashboard) may still pass it. The useEffect below
  // redirects those legacy values to a live tab now that the Activities tab
  // is gone (its timeline moved into each record's right rail).
  const [activeTab, setActiveTab] = useState<'home' | 'accounts' | 'pipeline' | 'business_accounts' | 'tasks' | 'forecast'>('home');
  // "Add business account" / "Import" from the Business-accounts tab carry the
  // category bucket the user is in, so the new/imported company files into it.
  const [createDefaultCategory, setCreateDefaultCategory] = useState<string | null>(null);
  const [importDefaultCategory, setImportDefaultCategory] = useState<string | null>(null);
  useEffect(() => {
    // The removed 'tasks'/'activities'/'leads' tabs all redirect: tasks &
    // activities → home (the Activities tab is gone; its feed now lives in
    // each record's right rail), leads → accounts (leads live in accounts).
    if (activeTab === 'tasks' || (activeTab as string) === 'activities') setActiveTab('home');
    if ((activeTab as string) === 'leads') setActiveTab('accounts');
  }, [activeTab]);

  // Guard: if the active tab requires a module the user can't view, fall back to home.
  useEffect(() => {
    if (activeTab === 'pipeline' && !canViewModule('deals')) setActiveTab('home');
  }, [activeTab, canViewModule]);

  // ─── Contacts (still needed for DealFormDialog's contact picker) ──
  const { contacts } = useContacts();
  // Send-email composer state (used by lead drawer Send Email button).
  const [emailRecipient, setEmailRecipient] = useState<SendEmailRecipient | null>(null);

  // ─── Leads state ────────────────────────────────────────────────────────
  const {
    leads, allLeads,
    workspaceId: activeLeadWorkspaceId,
    create: createLeadSvc, update: updateLeadSvc, remove: removeLeadSvc, convert: convertLeadSvc,
    canManage: rawCanManageLead,
  } = useLeads();
  const canManageLead = rawCanManageLead && crmEditable;
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
    canManage: rawCanManageCategories,
    canAdminCategories,
  } = useClientCategories();
  const canManageCategories = rawCanManageCategories && crmEditable;
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
  const [deleting, setDeleting] = useState(false);

  // Keep the selected client's data in sync when the list refreshes via realtime.
  const liveSelected = useMemo(() => {
    if (!selected) return null;
    // Prefer the live row from the scoped list, but fall back to the captured
    // `selected` (kept fresh via onUpdate/onEdit) so the drawer never vanishes
    // back to the list + search when the account momentarily isn't in `clients`
    // (e.g. during an edit, or a workspace-scope mismatch).
    return clients.find((c) => c.clientId === selected.clientId) ?? selected;
  }, [clients, selected]);

  // Leads shown inside the Accounts category view (the Accounts tab is the
  // LEADS surface; companies live on the Business accounts tab). 'all' → every
  // lead, '__uncategorized__' → leads with no category, else the category's
  // leads — then filtered by the search box.
  const viewLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    let base = allLeads;
    if (categoryFilter === '__uncategorized__') {
      base = allLeads.filter((l) => !(l.category && l.category.trim()));
    } else if (categoryFilter !== 'all') {
      const cf = categoryFilter.trim().toLowerCase();
      base = allLeads.filter((l) => (l.category ?? '').trim().toLowerCase() === cf);
    }
    if (!q) return base;
    return base.filter((l) =>
      [leadDisplayName(l), l.company, l.email, l.leadOwnerName, l.leadNumber]
        .filter(Boolean).join(' ').toLowerCase().includes(q));
  }, [allLeads, categoryFilter, search]);

  // The concrete category bucket new/imported leads should land in (null when
  // viewing 'all' or 'uncategorised').
  const leadScopeCategory = (categoryFilter === 'all' || categoryFilter === '__uncategorized__')
    ? null : categoryFilter;
  // Carried to the lead create / import dialogs so they file into the bucket.
  const [leadCreateCategory, setLeadCreateCategory] = useState<string | null>(null);
  const [importLeadCategory, setImportLeadCategory] = useState<string | null>(null);
  // When set, the next business account created via ClientFormDialog is linked
  // to this lead (the "Create business account" action on a lead window).
  const [linkLeadAfterCreate, setLinkLeadAfterCreate] = useState<Lead | null>(null);

  // Shared allow-list for every workspace-scoped view (kanban, analytics,
  // tasks, forecast). When the sidebar shows "All workspaces" we pass null
  // so the downstream components skip filtering entirely.
  // CRM is org-global now — no workspace restriction on the kanban /
  // analytics / forecast views (null = show everything in the org).
  const workspaceClientIds = useMemo<Set<string> | null>(() => null, []);


  useEffect(() => {
    const handler = (event: Event) => {
      const clientId = (event as CustomEvent<string>).detail;
      const match = clients.find((c) => c.clientId === clientId);
      if (match) setSelected(match);
    };
    window.addEventListener('open-client', handler);
    return () => window.removeEventListener('open-client', handler);
  }, [clients]);

  const handleCreate = async (input: CreateClientInput) => {
    try {
      const created = await create(input);
      // When this create was launched from a lead's "Create business account",
      // link the new company to that lead (lead stays active).
      if (linkLeadAfterCreate) {
        try {
          const updated = await updateLeadSvc(linkLeadAfterCreate.leadId, { accountId: created.clientId });
          setSelectedLead(updated);
          toast.success(`Created "${created.name}" and linked it to ${leadDisplayName(linkLeadAfterCreate)}`);
        } catch {
          toast.success(`Created "${created.name}" (couldn't auto-link the lead — link it from the lead window)`);
        } finally {
          setLinkLeadAfterCreate(null);
        }
      } else {
        toast.success(`Created "${created.name}"`);
      }
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

  /** Export one category's accounts AND the leads attached to those accounts
   *  as a single CSV (accounts block, then a leads block). */
  const handleExportCategory = (categoryKey: string, label: string) => {
    const inCategory = (c: Client) =>
      categoryKey === '__uncategorized__'
        ? !(c.category && c.category.trim())
        : (c.category ?? '').trim().toLowerCase() === categoryKey.toLowerCase();
    const catAccounts = clients.filter(inCategory);
    const acctIds = new Set(catAccounts.map((a) => a.clientId));
    const catLeads = allLeads.filter((l) => l.accountId && acctIds.has(l.accountId));
    const csv =
      `ACCOUNTS\n${exportClientsToCsv(catAccounts)}\n\nLEADS\n${exportLeadsToCsv(catLeads)}\n`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(label || 'category').replace(/[^\w-]+/g, '_')}_accounts_leads.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${catAccounts.length} account(s) + ${catLeads.length} lead(s)`);
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

  // List-view stage dropdown handler. Mirrors DealsKanban.moveDealToStage:
  // a Won pick is intercepted and routed through DealWonModal (so the
  // project-creation + handoff still fires); everything else is a plain
  // stageId update — identical to the kanban's drag/dropdown path.
  const handleListStageChange = async (deal: Deal, stage: PipelineStage) => {
    const action = resolveStageChange(deal.stage, stage);
    if (action === 'noop') return;
    if (action === 'won-confirm') {
      setListWonStage({ deal, stage });
      return;
    }
    try {
      await updateDeal(deal.dealId, { stageId: stage.stageId });
      toast.success(`Moved "${deal.title}" to ${stage.label}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not move deal');
    }
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
              {canCreate && activeTab === 'accounts' && showLanding && (
                // An account IS a category bucket — "Add account" registers a
                // category (no company/lead record), and only belongs on the
                // category landing. Inside a category you add leads; companies
                // live on the Business accounts tab.
                <Button onClick={() => setOpenManageCategories(true)}>
                  <Plus className="w-4 h-4 mr-2" /> Add account
                </Button>
              )}
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
            <TabsList>
              <TabsTrigger value="home">
                <HomeIcon className="w-4 h-4 mr-1.5" /> Home
              </TabsTrigger>
              <TabsTrigger value="accounts">
                <Building2 className="w-4 h-4 mr-1.5" /> Accounts
              </TabsTrigger>
              {canViewModule('deals') && (
                <TabsTrigger value="pipeline">
                  <GitBranch className="w-4 h-4 mr-1.5" /> Pipeline
                </TabsTrigger>
              )}
              <TabsTrigger value="business_accounts">
                <Building2 className="w-4 h-4 mr-1.5" /> Business accounts
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
                  onCreate={() => setOpenManageCategories(true)}
                  onImport={() => setOpenImport(true)}
                />
              ) : showLanding ? (
                <CrmCategoryLanding
                  clients={clients}
                  registered={registeredCategories}
                  leads={allLeads}
                  onPick={exitLanding}
                  onExport={handleExportCategory}
                  onManageCategories={canManageCategories
                    ? () => setOpenManageCategories(true)
                    : undefined}
                />
              ) : (
              <>
              <div className="flex items-center justify-between gap-3 flex-wrap pt-2">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold truncate">
                    {categoryFilter === 'all'
                      ? 'All leads'
                      : categoryFilter === '__uncategorized__'
                        ? 'Uncategorised leads'
                        : `Leads in ${categoryFilter}`}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Leads in this category. Open a lead to see its details and its business account.
                  </p>
                </div>
                {canManageLead && (
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline" size="sm"
                      onClick={() => { setImportLeadCategory(leadScopeCategory); setOpenImportLead(true); }}
                    >
                      <Upload className="w-4 h-4 mr-1" /> Import leads
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => { setLeadCreateCategory(leadScopeCategory); setOpenCreateLead(true); }}
                    >
                      <Plus className="w-4 h-4 mr-1" /> Add lead
                    </Button>
                  </div>
                )}
              </div>

              <Card>
                <CardContent className="pt-4 flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 flex-1 min-w-[240px]">
                    <Search className="w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search leads by name, company, owner…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      maxLength={200}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground inline-flex items-center gap-1 ml-auto">
                    <Filter className="w-3 h-3" />
                    {viewLeads.length} lead{viewLeads.length === 1 ? '' : 's'}
                  </span>
                </CardContent>
              </Card>

              {viewLeads.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center text-sm text-muted-foreground">
                    No leads in this category yet. Use <strong>Import leads</strong> or <strong>Add lead</strong> to get started.
                  </CardContent>
                </Card>
              ) : (
                <LeadsTable rows={viewLeads} onOpen={(l) => setSelectedLead(l)} />
              )}
              </>
              )}
            </TabsContent>

            <TabsContent value="pipeline" className="mt-4 space-y-4">
              {/* Forecast moved here (its own tab was removed): KPI tiles +
                  charts on top, the pipeline board below. */}
              {canViewModule('deals') && (
                <div className="space-y-4 pb-2 border-b border-border">
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
                </div>
              )}
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
                      onDealWon={(won) => openWonHandoff(won)}
                      onAssignTask={(d) => openAssignTask(d)}
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
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="sm">
                                  <Plus className="w-3.5 h-3.5 mr-1" /> Add
                                  <ChevronDown className="w-3 h-3 ml-1" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setOpenCreateDeal(true)}>
                                  Pipeline deal
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setOpenCustomItem(true)}>
                                  Custom item
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
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
                        onDealWon={(won) => openWonHandoff(won)}
                        onAssignTask={(d) => openAssignTask(d)}
                      />
                    ) : (
                      <DealsListView
                        deals={scopedDeals}
                        onSelectDeal={(d) => setPipelineDealId(d.dealId)}
                        stagesByPipeline={stagesByPipeline}
                        onStageChange={
                          canManage && canEditModule('deals')
                            ? handleListStageChange
                            : undefined
                        }
                        onAssignTask={(d) => openAssignTask(d)}
                      />
                    )}
                  </>
                );
              })()}
            </TabsContent>

            <TabsContent value="business_accounts" className="mt-4">
              <BusinessAccountsTab
                clients={clients}
                registeredCategories={registeredCategories}
                leads={allLeads}
                canCreate={canCreate}
                onOpenCompany={(c) => setSelected(c)}
                onExportCategory={handleExportCategory}
                onManageCategories={canManageCategories ? () => setOpenManageCategories(true) : undefined}
                onAddCompany={(cat) => { setCreateDefaultCategory(cat); setOpenCreate(true); }}
                onImportCompanies={(cat) => { setImportDefaultCategory(cat); setOpenImport(true); }}
              />
            </TabsContent>

          </Tabs>
        </div>
      </main>

      {/* New business account */}
      <ClientFormDialog
        open={openCreate}
        onOpenChange={(o) => { setOpenCreate(o); if (!o) { setCreateDefaultCategory(null); setLinkLeadAfterCreate(null); } }}
        onSubmit={handleCreate}
        onUpdateExisting={canManage ? handleUpdateExistingFromCreate : undefined}
        organizationId={organizationId}
        defaultCategory={createDefaultCategory}
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
        onOpenChange={(o) => { setOpenImport(o); if (!o) setImportDefaultCategory(null); }}
        organizationId={organizationId}
        workspaceId={activeWorkspaceId}
        workspaceName={selectedWorkspace?.name ?? null}
        userId={user?.userId}
        userName={user?.displayName}
        defaultCategory={importDefaultCategory}
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
          onUpdate={async (clientId, patch) => {
            const updated = await update(clientId, patch);
            // Keep the selected pointer in sync so the drawer reflects the
            // saved values even after a close/reopen.
            setSelected(updated);
            return updated;
          }}
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
        // CRM is org-global, so don't block category creation on "All
        // workspaces" — the hook already resolves a default workspace to file
        // new categories into. Passing null here used to trip the dialog's
        // "Pick a workspace" gate and hide the Add-category input entirely.
        workspaceId={categoriesWorkspaceId}
        workspaceName={selectedWorkspace?.name ?? 'Default'}
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

      {/* Pipeline-tab "Custom item" create — a freeform deal (dealType custom). */}
      <CustomItemDialog
        open={openCustomItem}
        onOpenChange={setOpenCustomItem}
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
        onOpenChange={(o) => { setOpenImportLead(o); if (!o) setImportLeadCategory(null); }}
        organizationId={organizationId}
        // Skip the implicit-workspace fallback when the user is in 'All
        // workspaces' / 'Unassigned' — the dialog will refuse to import
        // and surface a clear message instead of silently stamping every
        // row into workspaces[0].
        workspaceId={isAllWorkspaces ? null : activeLeadWorkspaceId}
        workspaceName={selectedWorkspace?.name ?? null}
        defaultCategory={importLeadCategory}
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
            setLeadCreateCategory(null);
          }
        }}
        lead={editingLead}
        defaultCategory={editingLead ? undefined : leadCreateCategory}
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
          onOpenAccount={(c) => setSelected(c)}
          onCreateAccountForLead={(l) => {
            // Create a business account, then link it to this lead (lead stays
            // active). handleCreate links it once the company is created.
            setLinkLeadAfterCreate(l);
            setCreateDefaultCategory(l.category ?? null);
            setOpenCreate(true);
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

      {/* Deal → PM handoff dialog. Owned here so there is exactly one
          instance regardless of the entry point: the won transition (kanban
          drag, kanban/list stage dropdown, or detail-view stage path) OR the
          "Assign task" action on any deal. `wonContext` swaps the copy.
          Cancelling never changes the deal. */}
      <DealHandoffDialog
        open={!!handoffDeal}
        onOpenChange={(o) => { if (!o) { setHandoffDeal(null); setHandoffWon(false); } }}
        deal={handoffDeal}
        wonContext={handoffWon}
      />

      {/* List-view Won pick → reuse the SAME DealWonModal the kanban mounts,
          so the project-creation handoff fires identically. onWon opens the
          handoff dialog in won-context, matching the kanban flow. */}
      {listWonStage && (
        <DealWonModal
          deal={listWonStage.deal}
          targetStage={listWonStage.stage}
          onWon={(won) => openWonHandoff(won)}
          onClose={() => setListWonStage(null)}
        />
      )}
    </>
  );
};

export default Clients;
// Avoid unused-imports warnings for icons reserved for future row actions.
void MoreVertical;
