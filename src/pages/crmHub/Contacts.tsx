import { publicMessage } from '@/lib/publicError';
import { LeadFormsDialog } from '@/components/crmHub/LeadFormsDialog';
import { duplicateGroups, findLeadByEmail } from '@/lib/crmDuplicates';
import { forEachLead, nextSort, sortLeadIds, type LeadSort, type LeadSortKey } from '@/lib/crmListTools';
import { DuplicateLeadsDialog } from '@/components/crmHub/DuplicateLeadsDialog';
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Loader2, Download, Upload, MoreHorizontal, FileInput } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import {
  useCrmContacts, useCrmCompanies, useContactTagsMap, useCrmTags, useCrmDealStages, useWorkspaceForCreate,
} from '@/hooks/useCrmHub';
import {
  createContact, deleteContact, listLeadCategories, updateContact,
} from '@/services/supabase/crmHub/contacts';
import { ensureCompaniesByName } from '@/services/supabase/crmHub/companies';
import {
  LEAD_STEPS, MANUAL_LEAD_STEPS, leadName, leadOwnerMatches, leadStep, leadStepPatch,
  type LeadOwnerView, type LeadStep,
} from '@/lib/crmFlow';
import { companyKey } from '@/lib/crmImport';
import {
  customFieldLabel, knownCustomFieldKeys, readCustomFieldRows, type CustomFieldRow,
} from '@/lib/customFields';
import type { CrmContact } from '@/types/crmHub';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusPill } from '@/components/common/StatusPill';
import { ConvertLeadDialog } from '@/components/crmHub/ConvertLeadDialog';
import { LeadViews } from '@/components/crmHub/LeadViews';
import { viewsKey, type LeadViewState } from '@/lib/crmSavedViews';
import { CsvImportWizard } from '@/components/crmHub/CsvImportWizard';
import { CustomFieldsEditor } from '@/components/crmHub/CustomFieldsEditor';
import { rowsProblem } from '@/lib/crmFieldTypes';
import { useFieldDefs } from '@/services/supabase/crmHub/fieldDefs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toCSV, downloadCSV } from '@/lib/csv';

const NONE = '__none__';
/** Select value standing in for "nobody" in the bulk owner change. */
const BULK_NOBODY = '__nobody__';
const STEP_ORDER: LeadStep[] = ['new', 'contacted', 'qualified', 'deal', 'customer', 'unqualified'];
/** Leads that can still be turned into their first deal. */
const CONVERTIBLE: LeadStep[] = ['new', 'contacted', 'qualified'];

export const CrmContactsPage: React.FC = () => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const { items: contacts, loading, refresh } = useCrmContacts();
  const { items: companies } = useCrmCompanies();
  const { items: stages } = useCrmDealStages();
  const { items: allTags } = useCrmTags();
  const { map: contactTagsMap } = useContactTagsMap();
  const workspaceId = useWorkspaceForCreate();
  const { defs: fieldDefs } = useFieldDefs(workspaceId);

  const [search, setSearch] = useState('');
  const [stepFilter, setStepFilter] = useState<LeadStep | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [view, setView] = useState<LeadOwnerView>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showForms, setShowForms] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  /** How the list is sorted; null keeps the order it arrives in (newest first). */
  const [sort, setSort] = useState<LeadSort | null>(null);
  /** The leads ticked in the list, for doing one thing to many. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [converting, setConverting] = useState<CrmContact | null>(null);
  const [busy, setBusy] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  /** True once the person has seen that this email is already in the CRM and chosen to add the lead anyway. */
  const [addAnyway, setAddAnyway] = useState(false);
  const [phone, setPhone] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [source, setSource] = useState('');
  const [category, setCategory] = useState('');
  const [customRows, setCustomRows] = useState<CustomFieldRow[]>([]);
  const [customError, setCustomError] = useState<string | null>(null);
  const [existingCategories, setExistingCategories] = useState<string[]>([]);

  // Merge server-known categories with values already on loaded leads so
  // filters and suggestions don't miss anything.
  const allCategories = useMemo(() => {
    const set = new Set<string>(existingCategories);
    for (const c of contacts) if (c.category?.trim()) set.add(c.category.trim());
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [existingCategories, contacts]);

  /** Custom field names already on leads, so the form can offer them again. */
  const customKeys = useMemo(() => knownCustomFieldKeys(contacts.map((c) => c.customFields)), [contacts]);

  const organizationId = organization?.organizationId ?? null;
  useEffect(() => {
    if (!organizationId) return;
    listLeadCategories(organizationId, workspaceId)
      .then(setExistingCategories)
      .catch(() => { /* non-fatal */ });
  }, [organizationId, workspaceId, contacts.length]);

  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  const tagById = useMemo(() => new Map(allTags.map((t) => [t.id, t])), [allTags]);
  const memberById = useMemo(
    () => new Map((organization?.members ?? []).map((m) => [m.userId, m])),
    [organization],
  );
  // Leads already in the list that share an email address. The button only shows when there are some.
  const duplicateCount = useMemo(() => duplicateGroups(contacts).length, [contacts]);
  const companyNames = useMemo(() => new Map(companies.map((c) => [c.id, c.name])), [companies]);
  const ownerNames = useMemo(
    () => new Map((organization?.members ?? []).map((m) => [m.userId, m.displayName || m.email || 'Teammate'])),
    [organization],
  );
  /** The company typed in the New lead form, and whether it is already in the CRM. */
  const typedCompany = companyName.trim();
  const typedCompanyExists = useMemo(
    () => companies.some((c) => companyKey(c.name) === companyKey(typedCompany)),
    [companies, typedCompany],
  );

  /** Everything except the step filter, so the step tabs can show their counts. */
  const scoped = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (!leadOwnerMatches(view, c.ownerId, user?.userId ?? null)) return false;
      if (categoryFilter !== 'all') {
        if (categoryFilter === NONE) {
          if (c.category?.trim()) return false;
        } else if ((c.category ?? '') !== categoryFilter) {
          return false;
        }
      }
      if (!q) return true;
      return (
        leadName(c).toLowerCase().includes(q) ||
        (c.email?.toLowerCase().includes(q) ?? false) ||
        (c.phone?.includes(q) ?? false) ||
        (c.jobTitle?.toLowerCase().includes(q) ?? false) ||
        (companyById.get(c.companyId ?? '')?.name.toLowerCase().includes(q) ?? false) ||
        Object.values(c.customFields ?? {}).some((v) => String(v).toLowerCase().includes(q))
      );
    });
  }, [contacts, search, categoryFilter, view, user, companyById]);

  const stepCounts = useMemo(() => {
    const counts = new Map<LeadStep, number>();
    for (const c of scoped) counts.set(leadStep(c), (counts.get(leadStep(c)) ?? 0) + 1);
    return counts;
  }, [scoped]);

  const filtered = useMemo(
    () => (stepFilter === 'all' ? scoped : scoped.filter((c) => leadStep(c) === stepFilter)),
    [scoped, stepFilter],
  );

  const rows = useMemo(() => {
    if (!sort) return filtered;
    const byId = new Map(filtered.map((c) => [c.id, c]));
    const order = sortLeadIds(
      filtered.map((c) => ({
        id: c.id,
        name: leadName(c),
        company: (c.companyId && companyById.get(c.companyId)?.name) || '',
        stepOrder: STEP_ORDER.indexOf(leadStep(c)),
        owner: memberById.get(c.ownerId ?? '')?.displayName ?? '',
        createdAt: c.createdAt,
      })),
      sort,
    );
    return order.map((id) => byId.get(id)).filter((c): c is CrmContact => !!c);
  }, [filtered, sort, companyById, memberById]);

  /** What a saved view keeps: the search, the filters and the sorting. */
  const viewState = useMemo<LeadViewState>(
    () => ({ search, step: stepFilter, category: categoryFilter, owner: view, sort }),
    [search, stepFilter, categoryFilter, view, sort],
  );

  // Only leads still in view stay ticked: a hidden lead must never be changed by a bulk action.
  const selectedInView = useMemo(() => rows.filter((c) => selected.has(c.id)).map((c) => c.id), [rows, selected]);
  const allTicked = rows.length > 0 && selectedInView.length === rows.length;
  const toggleOne = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected(allTicked ? new Set() : new Set(rows.map((c) => c.id)));

  const bulkOwner = async (ownerId: string | null) => {
    const ids = selectedInView;
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const { done, failed } = await forEachLead(ids, (id) => updateContact(id, { ownerId }));
      const who = ownerId ? memberById.get(ownerId)?.displayName || 'the new owner' : 'nobody';
      if (failed > 0) toast.error(`${done} of ${ids.length} leads were given to ${who}. Try the rest again.`);
      else toast.success(`${done} lead${done === 1 ? '' : 's'} given to ${who}`);
      setSelected(new Set());
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const bulkDelete = async () => {
    const ids = selectedInView;
    setBusy(true);
    try {
      const { done, failed } = await forEachLead(ids, (id) => deleteContact(id));
      if (failed > 0) toast.error(`${done} of ${ids.length} leads were deleted. Try the rest again.`);
      else toast.success(`${done} lead${done === 1 ? '' : 's'} deleted`);
      setSelected(new Set());
      setConfirmBulkDelete(false);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  /** A column heading that sorts the list when pressed. */
  const sortHeading = (key: LeadSortKey, label: string) => (
    <th
      className="px-3 py-2 text-left font-medium"
      aria-sort={sort?.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setSort((current) => nextSort(current, key))}
      >
        {label}
        {sort?.key === key && <span aria-hidden>{sort.direction === 'asc' ? '↑' : '↓'}</span>}
      </button>
    </th>
  );

  const handleExportCsv = () => {
    if (!filtered.length) { toast.error('Nothing to export'); return; }
    // Every custom field in use becomes a column, so no lead loses one in the file.
    const customColumns = knownCustomFieldKeys(filtered.map((c) => c.customFields)).sort();
    const csv = toCSV(filtered.map((c) => ({
      first_name: c.firstName,
      last_name: c.lastName ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
      job_title: c.jobTitle ?? '',
      company: companyById.get(c.companyId ?? '')?.name ?? '',
      owner: memberById.get(c.ownerId ?? '')?.displayName ?? '',
      step: LEAD_STEPS[leadStep(c)].label,
      lifecycle_stage: c.lifecycleStage,
      lead_status: c.leadStatus,
      category: c.category ?? '',
      ...Object.fromEntries(customColumns.map((key) => [customFieldLabel(key), c.customFields?.[key] ?? ''])),
    })));
    downloadCSV('leads.csv', csv);
    toast.success(`Exported ${filtered.length} lead${filtered.length === 1 ? '' : 's'}`);
  };

  const openCreate = () => {
    setFirstName(''); setLastName(''); setEmail(''); setPhone(''); setAddAnyway(false);
    setJobTitle(''); setCompanyName(''); setSource(''); setCategory('');
    setCustomRows([]); setCustomError(null);
    setShowCreate(true);
  };

  // The lead already in this workspace with the email being typed, if any.
  const duplicate = findLeadByEmail(contacts, email);

  const handleCreate = async () => {
    if (!organization || !firstName.trim()) return;
    // The form shows who the email belongs to; the button then reads "Add anyway".
    if (duplicate && !addAnyway) { setAddAnyway(true); return; }
    const custom = readCustomFieldRows(customRows);
    // A typed field must hold its own kind of value: a number, a date, one of its choices.
    const customProblem = custom.error ?? rowsProblem(fieldDefs, customRows);
    setCustomError(customProblem);
    if (customProblem) return;
    setBusy(true);
    try {
      // A typed company is linked when it exists and added when it does not.
      let companyId: string | null = null;
      if (typedCompany) {
        const ids = await ensureCompaniesByName(
          organization.organizationId, workspaceId, [typedCompany], user?.userId ?? null,
        );
        companyId = ids.get(companyKey(typedCompany)) ?? null;
      }
      await createContact(
        {
          organizationId: organization.organizationId,
          workspaceId,
          firstName: firstName.trim(),
          lastName: lastName.trim() || null,
          email: email.trim() || null,
          phone: phone.trim() || null,
          jobTitle: jobTitle.trim() || null,
          companyId,
          lifecycleStage: 'lead',
          leadStatus: 'new',
          source: source.trim() || null,
          category: category.trim() || null,
          customFields: custom.fields,
        },
        user?.userId ?? null,
      );
      toast.success('Lead added');
      setShowCreate(false);
      await refresh();
    } catch (err) {
      toast.error(publicMessage(err, 'Could not add the lead'));
    } finally {
      setBusy(false);
    }
  };

  const handleSetStep = async (lead: CrmContact, step: 'new' | 'contacted' | 'qualified' | 'unqualified') => {
    try {
      await updateContact(lead.id, leadStepPatch(step));
      toast.success(`${leadName(lead)} marked ${LEAD_STEPS[step].label.toLowerCase()}`);
      await refresh();
    } catch (err) {
      toast.error(publicMessage(err, 'Could not update the lead'));
    }
  };

  const handleDelete = async (id: string) => {
    setBusy(true);
    try {
      await deleteContact(id);
      toast.success('Lead deleted');
      setConfirmDelete(null);
      await refresh();
    } catch (err) {
      toast.error(publicMessage(err, 'Could not delete the lead'));
    } finally {
      setBusy(false);
    }
  };

  const chip = (active: boolean) =>
    cn(
      'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors',
      active
        ? 'border-foreground bg-foreground text-background'
        : 'border-border text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground',
    );

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-background">
      <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">
        <PageHeader
          title="Leads"
          description="People you might do business with. Qualify a lead, then convert it to a deal."
          actions={
            <>
              {duplicateCount > 0 && (
                <Button variant="outline" onClick={() => setShowDuplicates(true)}>
                  {duplicateCount} duplicate{duplicateCount === 1 ? '' : 's'}
                </Button>
              )}
              {/* A form on your website, so leads come in by themselves. */}
              <Button variant="outline" onClick={() => setShowForms(true)} disabled={!organizationId || !workspaceId}>
                <FileInput /> Web form
              </Button>
              <Button variant="outline" onClick={() => setShowImport(true)}>
                <Upload /> Import
              </Button>
              <Button variant="outline" onClick={handleExportCsv}>
                <Download /> Export
              </Button>
              <Button onClick={openCreate}>
                <Plus /> New lead
              </Button>
            </>
          }
        />

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by step">
            <button type="button" className={chip(stepFilter === 'all')} aria-pressed={stepFilter === 'all'} onClick={() => setStepFilter('all')}>
              All <span className="tabular-nums opacity-70">{scoped.length}</span>
            </button>
            {STEP_ORDER.map((step) => (
              <button
                key={step}
                type="button"
                className={chip(stepFilter === step)}
                aria-pressed={stepFilter === step}
                onClick={() => setStepFilter(step)}
                title={LEAD_STEPS[step].hint}
              >
                {LEAD_STEPS[step].label} <span className="tabular-nums opacity-70">{stepCounts.get(step) ?? 0}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-60 max-w-md flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, company, email, phone"
                className="pl-8"
                aria-label="Search leads"
              />
            </div>
            <Select value={view} onValueChange={(v) => setView(v as LeadOwnerView)}>
              <SelectTrigger className="w-44" aria-label="Owner"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All leads</SelectItem>
                <SelectItem value="mine">My leads</SelectItem>
                <SelectItem value="none">No owner</SelectItem>
              </SelectContent>
            </Select>
            {allCategories.length > 0 && (
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-44" aria-label="Category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  <SelectItem value={NONE}>No category</SelectItem>
                  {allCategories.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {user && workspaceId && organizationId && (
              <LeadViews
                storageKey={viewsKey(user.userId, workspaceId)}
                organizationId={organizationId}
                workspaceId={workspaceId}
                current={viewState}
                onApply={(state) => {
                  setSearch(state.search);
                  setStepFilter(state.step);
                  setCategoryFilter(state.category);
                  setView(state.owner);
                  setSort(state.sort);
                }}
              />
            )}
          </div>
        </div>

        {loading && contacts.length === 0 ? (
          <div className="py-16 text-center">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
            <p className="text-sm text-muted-foreground">
              {contacts.length === 0 ? 'No leads yet. Add the first person you want to win as a customer.' : 'No leads match these filters.'}
            </p>
            {contacts.length === 0 && (
              <Button onClick={openCreate}><Plus /> New lead</Button>
            )}
          </div>
        ) : (
          <>
          {selectedInView.length > 0 && (
            <div role="toolbar" aria-label="Selected leads" className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-sm">
              <span className="font-medium tabular-nums">{selectedInView.length} selected</span>
              <Select value="" onValueChange={(v) => void bulkOwner(v === BULK_NOBODY ? null : v)} disabled={busy}>
                <SelectTrigger className="h-8 w-48" aria-label="Give the selected leads to"><SelectValue placeholder="Give to…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={BULK_NOBODY}>Nobody</SelectItem>
                  {(organization?.members ?? []).filter((m) => !m.status || m.status === 'active').map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>{m.displayName || m.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setConfirmBulkDelete(true)} disabled={busy}>
                Delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={busy}>Clear</Button>
            </div>
          )}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="w-9 px-3 py-2">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={allTicked}
                      onChange={toggleAll}
                      aria-label={allTicked ? 'Untick every lead' : 'Tick every lead in the list'}
                    />
                  </th>
                  {sortHeading('name', 'Name')}
                  {sortHeading('company', 'Company')}
                  <th className="px-3 py-2 text-left font-medium">Email</th>
                  <th className="px-3 py-2 text-left font-medium">Phone</th>
                  {sortHeading('step', 'Step')}
                  <th className="px-3 py-2 text-left font-medium">Category</th>
                  {sortHeading('owner', 'Owner')}
                  <th className="px-3 py-2 text-right font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const step = leadStep(c);
                  const tagIds = contactTagsMap.get(c.id) ?? [];
                  return (
                    <tr key={c.id} className={cn('border-b border-border last:border-b-0 hover:bg-muted/40', selected.has(c.id) && 'bg-secondary/60')}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          checked={selected.has(c.id)}
                          onChange={() => toggleOne(c.id)}
                          aria-label={`Tick ${leadName(c)}`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Link to={`/crm/contacts/${c.id}`} className="font-medium text-foreground hover:underline">
                          {leadName(c)}
                        </Link>
                        {c.jobTitle && <div className="text-xs text-muted-foreground">{c.jobTitle}</div>}
                        {tagIds.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {tagIds.map((tid) => {
                              const t = tagById.get(tid);
                              if (!t) return null;
                              return (
                                <span
                                  key={tid}
                                  className="inline-block rounded-full px-1.5 py-0.5 text-[0.6875rem] font-medium"
                                  style={{ backgroundColor: `${t.color}22`, color: t.color, border: `1px solid ${t.color}44` }}
                                >
                                  {t.name}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {c.companyId && companyById.get(c.companyId) ? (
                          <Link to={`/crm/companies/${c.companyId}`} className="hover:text-foreground hover:underline">
                            {companyById.get(c.companyId)?.name}
                          </Link>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{c.email ?? '—'}</td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{c.phone ?? '—'}</td>
                      <td className="px-3 py-2">
                        <StatusPill tone={LEAD_STEPS[step].tone} title={LEAD_STEPS[step].hint}>{LEAD_STEPS[step].label}</StatusPill>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{c.category || '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {c.ownerId && c.ownerId === user?.userId ? 'You' : memberById.get(c.ownerId ?? '')?.displayName ?? '—'}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center justify-end gap-1">
                          {CONVERTIBLE.includes(step) && (
                            <Button size="sm" variant={step === 'qualified' ? 'default' : 'outline'} onClick={() => setConverting(c)}>
                              Convert to deal
                            </Button>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon" variant="ghost" aria-label={`More actions for ${leadName(c)}`}>
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {MANUAL_LEAD_STEPS.filter((s) => s !== step).map((s) => (
                                <DropdownMenuItem
                                  key={s}
                                  onClick={() => void handleSetStep(c, s as 'new' | 'contacted' | 'qualified' | 'unqualified')}
                                >
                                  Mark as {LEAD_STEPS[s].label.toLowerCase()}
                                </DropdownMenuItem>
                              ))}
                              {!CONVERTIBLE.includes(step) && (
                                <DropdownMenuItem onClick={() => setConverting(c)}>Open another deal</DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setConfirmDelete(c.id)}>
                                Delete lead
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      <Dialog open={showCreate} onOpenChange={(o) => !busy && setShowCreate(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New lead</DialogTitle>
            <DialogDescription>Starts as “New”. Move it on as you speak with them.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="fn">First name</Label>
                <Input id="fn" value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={busy} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ln">Last name</Label>
                <Input id="ln" value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={busy} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="em">Email</Label>
                <Input id="em" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setAddAnyway(false); }} disabled={busy} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ph">Phone</Label>
                <Input id="ph" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="jt">Job title</Label>
                <Input id="jt" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} disabled={busy} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="co">Company</Label>
                <Input
                  id="co"
                  list="lead-companies"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Type to pick or add"
                  maxLength={120}
                  autoComplete="off"
                  disabled={busy}
                />
                <datalist id="lead-companies">
                  {companies.map((c) => <option key={c.id} value={c.name} />)}
                </datalist>
              </div>
            </div>
            {typedCompany && (
              <p className="-mt-2 text-xs text-muted-foreground" aria-live="polite">
                {typedCompanyExists
                  ? `${typedCompany} is already in the CRM. The lead is linked to it.`
                  : `New company. ${typedCompany} is added to Companies and the lead is linked to it.`}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="src">Where it came from</Label>
                <Input id="src" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Website, referral…" disabled={busy} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cat">Category</Label>
                <Input
                  id="cat"
                  list="lead-categories"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="Optional"
                  maxLength={64}
                  disabled={busy}
                />
                <datalist id="lead-categories">
                  {allCategories.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
            </div>
            <div className="border-t border-border pt-4">
              <CustomFieldsEditor
                rows={customRows}
                onChange={(rows) => { setCustomRows(rows); setCustomError(null); }}
                suggestions={customKeys}
                defs={fieldDefs}
                error={customError}
                disabled={busy}
              />
            </div>
          </div>
          {duplicate && (
            <div role="alert" className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2.5 text-sm text-warning-soft-foreground">
              <p>
                A lead with this email is already in the CRM:{' '}
                <Link className="font-medium underline underline-offset-4" to={`/crm/contacts/${duplicate.id}`}>
                  {leadName(duplicate)}
                </Link>
                .
              </p>
              <p className="mt-0.5 text-xs">Open that lead, or add this one anyway if it really is someone else.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} disabled={busy}>Cancel</Button>
            <Button onClick={handleCreate} disabled={busy || !firstName.trim()}>
              {busy && <Loader2 className="animate-spin" />} {duplicate && addAnyway ? 'Add anyway' : 'Add lead'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConvertLeadDialog
        lead={converting}
        stages={stages}
        companies={companies}
        open={converting !== null}
        onOpenChange={(o) => !o && setConverting(null)}
        onConverted={refresh}
      />

      <CsvImportWizard
        open={showImport}
        onOpenChange={setShowImport}
        resource="contacts"
        onImported={refresh}
      />

      <DuplicateLeadsDialog
        open={showDuplicates}
        onOpenChange={setShowDuplicates}
        leads={contacts}
        companyNames={companyNames}
        ownerNames={ownerNames}
        onMerged={refresh}
      />

      {organizationId && workspaceId && (
        <LeadFormsDialog open={showForms} onOpenChange={setShowForms} organizationId={organizationId} workspaceId={workspaceId} />
      )}

      <AlertDialog open={confirmBulkDelete} onOpenChange={(o) => { if (!busy) setConfirmBulkDelete(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedInView.length} lead{selectedInView.length === 1 ? '' : 's'}?</AlertDialogTitle>
            <AlertDialogDescription>
              The leads, their notes and their timelines are removed for good. Their deals stay, without a lead. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy}
              onClick={(e) => { e.preventDefault(); void bulkDelete(); }}
            >
              Delete {selectedInView.length} lead{selectedInView.length === 1 ? '' : 's'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this lead?</AlertDialogTitle>
            <AlertDialogDescription>
              This can't be undone. Deals and activity linked to this lead stay, but lose the link to it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && void handleDelete(confirmDelete)}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
};

export default CrmContactsPage;
