import React, { useMemo, useState } from 'react';
import { Plus, Search, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useCrmContacts, useCrmCompanies } from '@/hooks/useCrmHub';
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

const humanize = (s: string) =>
  s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const CrmContactsPage: React.FC = () => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const { items: contacts, loading, refresh } = useCrmContacts();
  const { items: companies } = useCrmCompanies();

  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => {
      const name = `${c.firstName} ${c.lastName ?? ''}`.toLowerCase();
      return (
        name.includes(q) ||
        (c.email?.toLowerCase().includes(q) ?? false) ||
        (c.phone?.includes(q) ?? false) ||
        (c.jobTitle?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [contacts, search]);

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
      toast.success('Contact created');
      resetForm();
      setShowCreate(false);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create contact');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    setBusy(true);
    try {
      await deleteContact(id);
      toast.success('Contact deleted');
      setConfirmDelete(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete contact');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-background">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Contacts</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Every person in your pipeline — sorted by first name.
            </p>
          </div>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4 mr-2" /> New contact
          </Button>
        </div>

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, phone…"
            className="pl-9"
          />
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{filtered.length} contact{filtered.length === 1 ? '' : 's'}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="py-12 text-center">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                {search ? 'No contacts match your search.' : 'No contacts yet. Create your first one.'}
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
                      <tr key={c.id} className="border-b border-border/60 hover:bg-muted/40">
                        <td className="py-2 pr-4 font-medium text-foreground">
                          {c.firstName} {c.lastName ?? ''}
                          {c.jobTitle && (
                            <div className="text-xs text-muted-foreground font-normal">{c.jobTitle}</div>
                          )}
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
            <DialogTitle>New contact</DialogTitle>
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

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this contact?</AlertDialogTitle>
            <AlertDialogDescription>
              This can't be undone. Any deals or activities linked to this contact will lose the reference.
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
