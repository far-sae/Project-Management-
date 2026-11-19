import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Download, ExternalLink, Loader2, Plus, Search, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useCrmCompanies, useWorkspaceForCreate } from '@/hooks/useCrmHub';
import { createCompany, deleteCompany } from '@/services/supabase/crmHub/companies';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toCSV, downloadCSV } from '@/lib/csv';
import { useCrmCurrency } from '@/context/CrmCurrencyContext';
import { CsvImportWizard } from '@/components/crmHub/CsvImportWizard';
import { PageHeader } from '@/components/common/PageHeader';

/** One labelled field in the "New company" form. */
const FIELD = 'space-y-1.5';
/** Two fields side by side; stacked on phones. */
const FIELD_ROW = 'grid grid-cols-1 gap-3 sm:grid-cols-2';

export const CrmCompaniesPage: React.FC = () => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const { items: companies, loading, refresh } = useCrmCompanies();
  const orgCurrency = useCrmCurrency();
  const workspaceId = useWorkspaceForCreate();

  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [industry, setIndustry] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [companySize, setCompanySize] = useState('');
  const [annualRevenue, setAnnualRevenue] = useState('');
  const [notes, setNotes] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.industry?.toLowerCase().includes(q) ?? false) ||
        (c.city?.toLowerCase().includes(q) ?? false),
    );
  }, [companies, search]);

  const resetForm = () => {
    setName(''); setWebsite(''); setIndustry(''); setAddress('');
    setCity(''); setCountry(''); setPhone(''); setEmail('');
    setCompanySize(''); setAnnualRevenue(''); setNotes('');
  };

  const handleCreate = async () => {
    if (!organization) return;
    if (!name.trim()) { toast.error('Company name is required'); return; }
    setBusy(true);
    try {
      await createCompany(
        {
          organizationId: organization.organizationId,
          workspaceId,
          name: name.trim(),
          website: website.trim() || null,
          industry: industry.trim() || null,
          address: address.trim() || null,
          city: city.trim() || null,
          country: country.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          companySize: companySize.trim() || null,
          annualRevenue: annualRevenue ? Number(annualRevenue) : null,
          notes: notes.trim() || null,
        },
        user?.userId ?? null,
      );
      toast.success('Company created');
      resetForm();
      setShowCreate(false);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create company');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    setBusy(true);
    try {
      await deleteCompany(id);
      toast.success('Company deleted');
      setConfirmDelete(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete company');
    } finally {
      setBusy(false);
    }
  };

  const handleExport = () => {
    if (!filtered.length) { toast.error('Nothing to export'); return; }
    const csv = toCSV(filtered.map((c) => ({
      name: c.name, website: c.website ?? '', industry: c.industry ?? '',
      phone: c.phone ?? '', email: c.email ?? '', address: c.address ?? '',
      city: c.city ?? '', country: c.country ?? '',
      company_size: c.companySize ?? '', annual_revenue: c.annualRevenue ?? '',
    })));
    downloadCSV('companies.csv', csv);
    toast.success(`Exported ${filtered.length} companies`);
  };

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-background">
      <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">
        <PageHeader
          title="Companies"
          description="The companies your leads work for."
          actions={
            <>
              <Button variant="outline" onClick={() => setShowImport(true)}>
                <Upload aria-hidden /> Import CSV
              </Button>
              <Button variant="outline" onClick={handleExport}>
                <Download aria-hidden /> Export CSV
              </Button>
              <Button onClick={() => setShowCreate(true)}>
                <Plus aria-hidden /> New company
              </Button>
            </>
          }
        />

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="relative w-full max-w-sm">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, industry, city…"
              aria-label="Search companies"
              className="pl-8"
            />
          </div>
          {!loading && (
            <p className="text-xs tabular-nums text-muted-foreground">
              {filtered.length} {filtered.length === 1 ? 'company' : 'companies'}
            </p>
          )}
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading companies" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-4 py-12 text-center">
              <Building2 className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
              {search ? (
                <>
                  <p className="text-sm font-medium">No companies match your search.</p>
                  <Button variant="outline" className="mt-3" onClick={() => setSearch('')}>
                    Clear search
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium">No companies yet.</p>
                  <p className="text-xs text-muted-foreground">Add the first company your leads work for.</p>
                  <Button className="mt-3" onClick={() => setShowCreate(true)}>
                    <Plus aria-hidden /> New company
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-sm">
                <thead>
                  <tr className="h-10 border-b border-border text-xs text-muted-foreground">
                    <th className="px-4 text-left font-medium">Name</th>
                    <th className="px-4 text-left font-medium">Industry</th>
                    <th className="px-4 text-left font-medium">Location</th>
                    <th className="px-4 text-left font-medium">Website</th>
                    <th className="px-4 text-left font-medium">Phone</th>
                    <th className="px-4 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr
                      key={c.id}
                      className="h-12 border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40"
                    >
                      <td className="px-4 font-medium text-foreground">
                        <Link to={`/crm/companies/${c.id}`} className="hover:text-primary hover:underline">
                          {c.name}
                        </Link>
                      </td>
                      <td className="px-4 text-muted-foreground">{c.industry ?? '—'}</td>
                      <td className="px-4 text-muted-foreground">
                        {[c.city, c.country].filter(Boolean).join(', ') || '—'}
                      </td>
                      <td className="px-4 text-muted-foreground">
                        {c.website ? (
                          <a
                            href={c.website.startsWith('http') ? c.website : `https://${c.website}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            {c.website} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                          </a>
                        ) : '—'}
                      </td>
                      <td className="px-4 tabular-nums text-muted-foreground">{c.phone ?? '—'}</td>
                      <td className="px-4 text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setConfirmDelete(c.id)}
                          className="text-muted-foreground hover:bg-destructive-soft hover:text-destructive"
                          title="Delete company"
                          aria-label={`Delete ${c.name}`}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <Dialog open={showCreate} onOpenChange={(o) => { setShowCreate(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New company</DialogTitle>
            <DialogDescription>Add a company to your CRM.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className={FIELD}>
              <Label htmlFor="cname">Name *</Label>
              <Input id="cname" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
            </div>
            <div className={FIELD_ROW}>
              <div className={FIELD}>
                <Label htmlFor="cweb">Website</Label>
                <Input id="cweb" value={website} onChange={(e) => setWebsite(e.target.value)} disabled={busy} placeholder="acme.com" />
              </div>
              <div className={FIELD}>
                <Label htmlFor="cind">Industry</Label>
                <Input id="cind" value={industry} onChange={(e) => setIndustry(e.target.value)} disabled={busy} />
              </div>
            </div>
            <div className={FIELD_ROW}>
              <div className={FIELD}>
                <Label htmlFor="ccity">City</Label>
                <Input id="ccity" value={city} onChange={(e) => setCity(e.target.value)} disabled={busy} />
              </div>
              <div className={FIELD}>
                <Label htmlFor="ccountry">Country</Label>
                <Input id="ccountry" value={country} onChange={(e) => setCountry(e.target.value)} disabled={busy} />
              </div>
            </div>
            <div className={FIELD_ROW}>
              <div className={FIELD}>
                <Label htmlFor="cph">Phone</Label>
                <Input id="cph" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} />
              </div>
              <div className={FIELD}>
                <Label htmlFor="cem">Email</Label>
                <Input id="cem" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
              </div>
            </div>
            <div className={FIELD_ROW}>
              <div className={FIELD}>
                <Label htmlFor="csize">Company size</Label>
                <Input id="csize" value={companySize} onChange={(e) => setCompanySize(e.target.value)} disabled={busy} placeholder="e.g. 51-200" />
              </div>
              <div className={FIELD}>
                <Label htmlFor="crev">Annual revenue ({orgCurrency.def.symbol})</Label>
                <Input id="crev" type="number" min={0} value={annualRevenue} onChange={(e) => setAnnualRevenue(e.target.value)} disabled={busy} />
              </div>
            </div>
            <div className={FIELD}>
              <Label htmlFor="caddr">Address</Label>
              <Input id="caddr" value={address} onChange={(e) => setAddress(e.target.value)} disabled={busy} />
            </div>
            <div className={FIELD}>
              <Label htmlFor="cnotes">Notes</Label>
              <Textarea id="cnotes" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} disabled={busy}>Cancel</Button>
            <Button onClick={handleCreate} disabled={busy || !name.trim()}>
              {busy && <Loader2 className="animate-spin" aria-hidden />} Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CsvImportWizard
        open={showImport}
        onOpenChange={setShowImport}
        resource="companies"
        onImported={refresh}
      />

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this company?</AlertDialogTitle>
            <AlertDialogDescription>
              Leads and deals linked to this company will lose the reference. This can't be undone.
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
