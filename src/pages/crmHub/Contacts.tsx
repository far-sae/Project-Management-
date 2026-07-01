import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Trash2, Loader2, Download, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useCrmContacts, useCrmCompanies, useContactTagsMap, useCrmTags, useWorkspaceForCreate } from '@/hooks/useCrmHub';
import { createContact, deleteContact } from '@/services/supabase/crmHub/contacts';
import { LIFECYCLE_STAGES, LEAD_STATUSES } from '@/types/crmHub';
import type { LifecycleStage, LeadStatus } from '@/types/crmHub';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toCSV, downloadCSV } from '@/lib/csv';
import { CsvImportWizard } from '@/components/crmHub/CsvImportWizard';

const humanize = (s: string) =>
  s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const CrmContactsPage: React.FC = () => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const { items: contacts, loading, refresh } = useCrmContacts();
  const { items: companies } = useCrmCompanies();
  const { items: allTags } = useCrmTags();
  const { map: contactTagsMap } = useContactTagsMap();
  const workspaceId = useWorkspaceForCreate();

  const [search, setSearch] = useState('');
  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleStage | 'all'>('all');
  const [view, setView] = useState<'all' | 'mine'>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [companyId, setCompanyId] = useState<string>('');
  const [lifecycleStage, setLifecycleStage] = useState<LifecycleStage>('lead');
  const [leadStatus, setLeadStatus] = useState<LeadStatus>('new');

  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  const tagById = useMemo(() => new Map(allTags.map((t) => [t.id, t])), [allTags]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (view === 'mine' && user && c.ownerId !== user.userId) return false;
      if (lifecycleFilter !== 'all' && c.lifecycleStage !== lifecycleFilter) return false;
      if (!q) return true;
      const name = `${c.firstName} ${c.lastName ?? ''}`.toLowerCase();
      return (
        name.includes(q) ||
        (c.email?.toLowerCase().includes(q) ?? false) ||
        (c.phone?.includes(q) ?? false) ||
        (c.jobTitle?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [contacts, search, lifecycleFilter, view, user]);

  const handleExportCsv = () => {
    if (!filtered.length) { toast.error('Nothing to export'); return; }
    const csv = toCSV(filtered.map((c) => ({
      first_name: c.firstName,
      last_name: c.lastName ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
      job_title: c.jobTitle ?? '',
      company: companyById.get(c.companyId ?? '')?.name ?? '',
      lifecycle_stage: c.lifecycleStage,
      lead_status: c.leadStatus,
    })));
    downloadCSV('contacts.csv', csv);
    toast.success(`Exported ${filtered.length} leads`);
  };

  const resetForm = () => {
    setFirstName(''); setLastName(''); setEmail(''); setPhone('');
    setJobTitle(''); setCompanyId(''); setLifecycleStage('lead'); setLeadStatus('new');
  };

  const handleCreate = async () => {
    if (!organization) return;
    if (!firstName.trim()) { toast.error('First name is required'); return; }
    setBusy(true);
    try {
      await createContact(
        {
          organizationId: organization.organizationId,
          workspaceId,
          firstName: firstName.trim(),
          lastName: lastName.trim() || null,
          email: email.trim() || null,
          phone: phone.trim() || null,
          jobTitle: jobTitle.trim() || null,
          companyId: companyId || null,
          lifecycleStage,
          leadStatus,
        },
        user?.userId ?? null,
      );
      toast.success('Lead created');
      resetForm();
      setShowCreate(false);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create lead');
    } finally {
      setBusy(false);
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
      toast.error(err instanceof Error ? err.message : 'Could not delete lead');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-background">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Leads</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Every person in your pipeline — sorted by first name.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
              <Upload className="w-4 h-4 mr-2" /> Import CSV
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportCsv}>
              <Download className="w-4 h-4 mr-2" /> Export CSV
            </Button>
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4 mr-2" /> New lead
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 border-b border-border">
          <button
            type="button"
            onClick={() => setView('all')}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              view === 'all' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            All leads
          </button>
          <button
            type="button"
            onClick={() => setView('mine')}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              view === 'mine' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            My leads
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-60 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, phone…"
              className="pl-9"
            />
          </div>
          <Select value={lifecycleFilter} onValueChange={(v) => setLifecycleFilter(v as LifecycleStage | 'all')}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All lifecycle stages</SelectItem>
              {LIFECYCLE_STAGES.map((s) => (
                <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{filtered.length} lead{filtered.length === 1 ? '' : 's'}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="py-12 text-center">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                {search ? 'No leads match your search.' : 'No leads yet. Create your first one.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                      <th className="text-left py-2 pr-4 font-medium">Name</th>
                      <th className="text-left py-2 pr-4 font-medium">Email</th>
                      <th className="text-left py-2 pr-4 font-medium">Phone</th>
                      <th className="text-left py-2 pr-4 font-medium">Company</th>
                      <th className="text-left py-2 pr-4 font-medium">Lifecycle</th>
                      <th className="text-left py-2 pr-4 font-medium">Status</th>
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
                          <Link to={`/crm/contacts/${c.id}`} className="hover:text-primary">
                            {c.firstName} {c.lastName ?? ''}
                          </Link>
                          {c.jobTitle && (
                            <div className="text-xs text-muted-foreground font-normal">{c.jobTitle}</div>
                          )}
                          {(() => {
                            const tagIds = contactTagsMap.get(c.id) ?? [];
                            if (tagIds.length === 0) return null;
                            return (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {tagIds.map((tid) => {
                                  const t = tagById.get(tid);
                                  if (!t) return null;
                                  return (
                                    <span
                                      key={tid}
                                      className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                                      style={{ backgroundColor: `${t.color}22`, color: t.color, border: `1px solid ${t.color}44` }}
                                    >
                                      {t.name}
                                    </span>
                                  );
                                })}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">{c.email ?? '—'}</td>
                        <td className="py-2 pr-4 text-muted-foreground">{c.phone ?? '—'}</td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {c.companyId ? companyById.get(c.companyId)?.name ?? '—' : '—'}
                        </td>
                        <td className="py-2 pr-4">
                          <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                            {humanize(c.lifecycleStage)}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-xs text-muted-foreground">{humanize(c.leadStatus)}</td>
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
            <DialogTitle>New lead</DialogTitle>
            <DialogDescription>Add a person to your pipeline.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="fn">First name *</Label>
                <Input id="fn" value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={busy} />
              </div>
              <div>
                <Label htmlFor="ln">Last name</Label>
                <Input id="ln" value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={busy} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="em">Email</Label>
                <Input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
              </div>
              <div>
                <Label htmlFor="ph">Phone</Label>
                <Input id="ph" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} />
              </div>
            </div>
            <div>
              <Label htmlFor="jt">Job title</Label>
              <Input id="jt" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} disabled={busy} />
            </div>
            <div>
              <Label>Company</Label>
              <Select value={companyId || '__none__'} onValueChange={(v) => setCompanyId(v === '__none__' ? '' : v)} disabled={busy}>
                <SelectTrigger><SelectValue placeholder="No company" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— None —</SelectItem>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Lifecycle stage</Label>
                <Select value={lifecycleStage} onValueChange={(v) => setLifecycleStage(v as LifecycleStage)} disabled={busy}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LIFECYCLE_STAGES.map((s) => (
                      <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Lead status</Label>
                <Select value={leadStatus} onValueChange={(v) => setLeadStatus(v as LeadStatus)} disabled={busy}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LEAD_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} disabled={busy}>Cancel</Button>
            <Button onClick={handleCreate} disabled={busy || !firstName.trim()}>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CsvImportWizard
        open={showImport}
        onOpenChange={setShowImport}
        resource="contacts"
        onImported={refresh}
      />

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this lead?</AlertDialogTitle>
            <AlertDialogDescription>
              This can't be undone. Any contracts or activities linked to this lead will lose the reference.
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
