import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Trash2, Loader2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useCrmCompanies, useWorkspaceForCreate } from '@/hooks/useCrmHub';
import { createCompany, deleteCompany } from '@/services/supabase/crmHub/companies';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Download, Upload } from 'lucide-react';

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

  return (
    <main className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-background">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Companies</h1>
            <p className="text-sm text-muted-foreground mt-1">
              The businesses your contacts work for.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
              <Upload className="w-4 h-4 mr-2" /> Import CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => {
              if (!filtered.length) { toast.error('Nothing to export'); return; }
              const csv = toCSV(filtered.map((c) => ({
                name: c.name, website: c.website ?? '', industry: c.industry ?? '',
                phone: c.phone ?? '', email: c.email ?? '', address: c.address ?? '',
                city: c.city ?? '', country: c.country ?? '',
                company_size: c.companySize ?? '', annual_revenue: c.annualRevenue ?? '',
              })));
              downloadCSV('companies.csv', csv);
              toast.success(`Exported ${filtered.length} companies`);
            }}>
              <Download className="w-4 h-4 mr-2" /> Export CSV
            </Button>
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4 mr-2" /> New company
            </Button>
          </div>
        </div>

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, industry, city…"
            className="pl-9"
          />
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{filtered.length} compan{filtered.length === 1 ? 'y' : 'ies'}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="py-12 text-center">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                {search ? 'No companies match your search.' : 'No companies yet. Create your first one.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                      <th className="text-left py-2 pr-4 font-medium">Name</th>
                      <th className="text-left py-2 pr-4 font-medium">Industry</th>
                      <th className="text-left py-2 pr-4 font-medium">Location</th>
                      <th className="text-left py-2 pr-4 font-medium">Website</th>
                      <th className="text-left py-2 pr-4 font-medium">Phone</th>
                      <th className="text-right py-2 pl-4 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((c) => (
                      <tr
                        key={c.id}
                        className="border-b border-border/60 hover:bg-muted/40"
                      >
                        <td className="py-2 pr-4 font-medium text-foreground">
                          <Link to={`/crm/companies/${c.id}`} className="hover:text-primary">{c.name}</Link>
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">{c.industry ?? '—'}</td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {[c.city, c.country].filter(Boolean).join(', ') || '—'}
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {c.website ? (
                            <a
                              href={c.website.startsWith('http') ? c.website : `https://${c.website}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-primary hover:underline"
                            >
                              {c.website} <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : '—'}
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">{c.phone ?? '—'}</td>
                        <td className="py-2 pl-4 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setConfirmDelete(c.id)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={showCreate} onOpenChange={(o) => { setShowCreate(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New company</DialogTitle>
            <DialogDescription>Add a business to your CRM.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="cname">Name *</Label>
              <Input id="cname" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cweb">Website</Label>
                <Input id="cweb" value={website} onChange={(e) => setWebsite(e.target.value)} disabled={busy} placeholder="acme.com" />
              </div>
              <div>
                <Label htmlFor="cind">Industry</Label>
                <Input id="cind" value={industry} onChange={(e) => setIndustry(e.target.value)} disabled={busy} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="ccity">City</Label>
                <Input id="ccity" value={city} onChange={(e) => setCity(e.target.value)} disabled={busy} />
              </div>
              <div>
                <Label htmlFor="ccountry">Country</Label>
                <Input id="ccountry" value={country} onChange={(e) => setCountry(e.target.value)} disabled={busy} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cph">Phone</Label>
                <Input id="cph" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} />
              </div>
              <div>
                <Label htmlFor="cem">Email</Label>
                <Input id="cem" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="csize">Company size</Label>
                <Input id="csize" value={companySize} onChange={(e) => setCompanySize(e.target.value)} disabled={busy} placeholder="e.g. 51-200" />
              </div>
              <div>
                <Label htmlFor="crev">Annual revenue ({orgCurrency.def.symbol})</Label>
                <Input id="crev" type="number" min={0} value={annualRevenue} onChange={(e) => setAnnualRevenue(e.target.value)} disabled={busy} />
              </div>
            </div>
            <div>
              <Label htmlFor="caddr">Address</Label>
              <Input id="caddr" value={address} onChange={(e) => setAddress(e.target.value)} disabled={busy} />
            </div>
            <div>
              <Label htmlFor="cnotes">Notes</Label>
              <Textarea id="cnotes" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} disabled={busy}>Cancel</Button>
            <Button onClick={handleCreate} disabled={busy || !name.trim()}>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Create
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
              Contacts and deals linked to this company will lose the reference. This can't be undone.
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
