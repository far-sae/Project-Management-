import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Building2, Download, Loader2, MoreHorizontal, Plus, Search, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useCrmCurrency } from '@/context/CrmCurrencyContext';
import { useCrmActivities, useCrmCompanies, useCrmContacts, useCrmDeals } from '@/hooks/useCrmHub';
import { useDealMoney } from '@/hooks/useDealMoney';
import { deleteCompany } from '@/services/supabase/crmHub/companies';
import {
  companyDomain, companyRelationship, companyRollups, filterCompanies, sortCompanies, websiteHref,
  type CompanyOwnerFilter, type CompanySort,
} from '@/lib/crmCompany';
import { toCSV, downloadCSV } from '@/lib/csv';
import { cn } from '@/lib/utils';
import type { CrmCompany } from '@/types/crmHub';
import { PageHeader } from '@/components/common/PageHeader';
import { StatStrip } from '@/components/common/StatStrip';
import { StatusPill } from '@/components/common/StatusPill';
import { CompanyFormDialog } from '@/components/crmHub/CompanyFormDialog';
import { CsvImportWizard } from '@/components/crmHub/CsvImportWizard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

export const CrmCompaniesPage: React.FC = () => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const { items: companies, loading, refresh } = useCrmCompanies();
  const { items: contacts } = useCrmContacts();
  const { items: deals } = useCrmDeals();
  const { items: activities } = useCrmActivities(500);
  const { format: money } = useCrmCurrency();
  const { allInCompany } = useDealMoney();
  const meId = user?.userId ?? null;

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [owner, setOwner] = useState<CompanyOwnerFilter>('all');
  const [sort, setSort] = useState<CompanySort>('name');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<CrmCompany | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<CrmCompany | null>(null);
  const [busy, setBusy] = useState(false);

  const memberById = useMemo(
    () => new Map((organization?.members ?? []).map((m) => [m.userId, m])),
    [organization],
  );
  const ownerName = (ownerId: string | null): string | null => {
    if (!ownerId) return null;
    if (ownerId === meId) return 'You';
    return memberById.get(ownerId)?.displayName ?? null;
  };

  /** Leads, deals and latest activity per company. Deal values are in the company currency. */
  const rollups = useMemo(
    () => companyRollups({ contacts, deals: allInCompany(deals), activities }),
    [contacts, deals, activities, allInCompany],
  );

  /** Everything except the type filter, so the type chips can show their counts. */
  const scoped = useMemo(
    () => filterCompanies(companies, rollups, { search, type: 'all', owner, meId }),
    [companies, rollups, search, owner, meId],
  );
  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of scoped) {
      const { label } = companyRelationship(c, rollups.get(c.id));
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [scoped, rollups]);

  const visible = useMemo(() => {
    const ofType = typeFilter === 'all'
      ? scoped
      : scoped.filter((c) => companyRelationship(c, rollups.get(c.id)).label === typeFilter);
    return sortCompanies(ofType, rollups, sort);
  }, [scoped, rollups, typeFilter, sort]);

  const totals = useMemo(() => {
    let customers = 0;
    let withOpenDeals = 0;
    let openValue = 0;
    for (const c of companies) {
      const rollup = rollups.get(c.id);
      if (companyRelationship(c, rollup).label === 'Customer') customers += 1;
      if (rollup && rollup.openDeals > 0) withOpenDeals += 1;
      openValue += rollup?.openValue ?? 0;
    }
    return { customers, withOpenDeals, openValue };
  }, [companies, rollups]);

  const handleDelete = async (company: CrmCompany) => {
    setBusy(true);
    try {
      await deleteCompany(company.id);
      toast.success(`${company.name} deleted`);
      setConfirmDelete(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the company');
    } finally {
      setBusy(false);
    }
  };

  const handleExport = () => {
    if (!visible.length) { toast.error('Nothing to export'); return; }
    const csv = toCSV(visible.map((c) => {
      const rollup = rollups.get(c.id);
      return {
        name: c.name,
        website: c.website ?? '',
        industry: c.industry ?? '',
        type: companyRelationship(c, rollup).label,
        owner: memberById.get(c.ownerId ?? '')?.displayName ?? '',
        phone: c.phone ?? '',
        email: c.email ?? '',
        linkedin: c.linkedinUrl ?? '',
        address: c.address ?? '',
        city: c.city ?? '',
        state: c.state ?? '',
        postal_code: c.postalCode ?? '',
        country: c.country ?? '',
        company_size: c.companySize ?? '',
        annual_revenue: c.annualRevenue ?? '',
        leads: rollup?.leads ?? 0,
        open_deals: rollup?.openDeals ?? 0,
        open_pipeline: Math.round(rollup?.openValue ?? 0),
        won_value: Math.round(rollup?.wonValue ?? 0),
      };
    }));
    downloadCSV('companies.csv', csv);
    toast.success(`Exported ${plural(visible.length, 'company', 'companies')}`);
  };

  const chip = (active: boolean) =>
    cn(
      'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors',
      active
        ? 'border-foreground bg-foreground text-background'
        : 'border-border text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground',
    );

  const filtering = Boolean(search.trim()) || typeFilter !== 'all' || owner !== 'all';
  const clearFilters = () => { setSearch(''); setTypeFilter('all'); setOwner('all'); };

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-background">
      <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">
        <PageHeader
          title="Companies"
          description="The businesses you sell to, with their leads, deals and latest activity."
          actions={
            <>
              <Button variant="outline" onClick={() => setShowImport(true)}>
                <Upload aria-hidden /> Import
              </Button>
              <Button variant="outline" onClick={handleExport}>
                <Download aria-hidden /> Export
              </Button>
              <Button onClick={() => setShowCreate(true)}>
                <Plus aria-hidden /> New company
              </Button>
            </>
          }
        />

        {companies.length > 0 && (
          <StatStrip
            items={[
              { label: 'Companies', value: companies.length },
              { label: 'Customers', value: totals.customers, note: 'Won at least one deal, or marked as a customer' },
              { label: 'With open deals', value: totals.withOpenDeals },
              { label: 'Open pipeline', value: money(totals.openValue), note: 'Across all companies' },
            ]}
          />
        )}

        <div className="flex flex-col gap-3">
          {typeCounts.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by type">
              <button type="button" className={chip(typeFilter === 'all')} aria-pressed={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>
                All <span className="tabular-nums opacity-70">{scoped.length}</span>
              </button>
              {typeCounts.map(([label, count]) => (
                <button
                  key={label}
                  type="button"
                  className={chip(typeFilter === label)}
                  aria-pressed={typeFilter === label}
                  onClick={() => setTypeFilter(label)}
                >
                  {label} <span className="tabular-nums opacity-70">{count}</span>
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-60 max-w-md flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, website, industry, city"
                aria-label="Search companies"
                className="pl-8"
              />
            </div>
            <Select value={owner} onValueChange={(v) => setOwner(v as CompanyOwnerFilter)}>
              <SelectTrigger className="w-44" aria-label="Owner"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All companies</SelectItem>
                <SelectItem value="mine">My companies</SelectItem>
                <SelectItem value="none">No owner</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => setSort(v as CompanySort)}>
              <SelectTrigger className="w-48" aria-label="Sort by"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Sort by name</SelectItem>
                <SelectItem value="activity">Sort by latest activity</SelectItem>
                <SelectItem value="pipeline">Sort by open pipeline</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {loading && companies.length === 0 ? (
          <div className="py-16 text-center">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading companies" />
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-16 text-center">
            <Building2 className="h-5 w-5 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              {filtering ? 'No companies match these filters.' : 'No companies yet. Add the first business you want to sell to.'}
            </p>
            {filtering
              ? <Button variant="outline" onClick={clearFilters}>Clear filters</Button>
              : <Button onClick={() => setShowCreate(true)}><Plus aria-hidden /> New company</Button>}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[60rem] text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Company</th>
                  <th className="px-3 py-2 text-left font-medium">Type</th>
                  <th className="px-3 py-2 text-left font-medium">Owner</th>
                  <th className="px-3 py-2 text-left font-medium">Industry</th>
                  <th className="px-3 py-2 text-left font-medium">Location</th>
                  <th className="px-3 py-2 text-right font-medium">Leads</th>
                  <th className="px-3 py-2 text-right font-medium">Open deals</th>
                  <th className="px-3 py-2 text-left font-medium">Last activity</th>
                  <th className="px-3 py-2 text-right font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => {
                  const rollup = rollups.get(c.id);
                  const relationship = companyRelationship(c, rollup);
                  const domain = companyDomain(c.website);
                  const href = websiteHref(c.website);
                  return (
                    <tr key={c.id} className="border-b border-border last:border-b-0 hover:bg-muted/40">
                      <td className="px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-secondary text-xs font-semibold text-muted-foreground">
                            {c.name.trim().charAt(0).toUpperCase() || '?'}
                          </span>
                          <div className="min-w-0">
                            <Link to={`/crm/companies/${c.id}`} className="block truncate font-medium text-foreground hover:underline">
                              {c.name}
                            </Link>
                            {domain && href && (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
                              >
                                {domain}
                              </a>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <StatusPill
                          tone={relationship.tone}
                          title={relationship.chosen ? undefined : 'Worked out from this company’s deals'}
                        >
                          {relationship.label}
                        </StatusPill>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{ownerName(c.ownerId) ?? '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground">{c.industry ?? '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {[c.city, c.country].filter(Boolean).join(', ') || '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{rollup?.leads || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {rollup && rollup.openDeals > 0 ? (
                          <>
                            <span className="font-medium text-foreground">{money(rollup.openValue)}</span>
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              {plural(rollup.openDeals, 'deal', 'deals')}
                            </span>
                          </>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {rollup?.lastActivityAt
                          ? formatDistanceToNow(rollup.lastActivityAt, { addSuffix: true })
                          : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost" aria-label={`More actions for ${c.name}`}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link to={`/crm/companies/${c.id}`}>Open company</Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setEditing(c)}>Edit details</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setConfirmDelete(c)}>
                              Delete company
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CompanyFormDialog open={showCreate} onOpenChange={setShowCreate} onSaved={refresh} />
      <CompanyFormDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        company={editing}
        onSaved={refresh}
      />

      <CsvImportWizard
        open={showImport}
        onOpenChange={setShowImport}
        resource="companies"
        onImported={refresh}
      />

      <AlertDialog open={confirmDelete !== null} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its leads and deals stay, but lose the link to this company. This can&apos;t be undone.
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

export default CrmCompaniesPage;
