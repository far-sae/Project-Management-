import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ChevronLeft, Globe, Mail, MapPin, Pencil, Phone, Trash2,
  Loader2, Building2, User, StickyNote, Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { supabase } from '@/services/supabase/config';
import {
  getCompany, updateCompany, deleteCompany,
} from '@/services/supabase/crmHub/companies';
import { listContacts } from '@/services/supabase/crmHub/contacts';
import { listDeals } from '@/services/supabase/crmHub/deals';
import { listActivities } from '@/services/supabase/crmHub/activities';
import { listTasks } from '@/services/supabase/crmHub/tasks';
import { listNotes, createNote } from '@/services/supabase/crmHub/notes';
import type {
  CrmCompany, CrmContact, CrmDeal, CrmActivity, CrmTask, CrmNote,
} from '@/types/crmHub';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const fmtCurrency = (n: number) => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  } catch { return `$${Math.round(n)}`; }
};

export const CrmCompanyDetailPage: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { organization } = useOrganization();
  const orgId = organization?.organizationId ?? null;

  const [company, setCompany] = useState<CrmCompany | null>(null);
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [deals, setDeals] = useState<CrmDeal[]>([]);
  const [activities, setActivities] = useState<CrmActivity[]>([]);
  const [tasks, setTasks] = useState<CrmTask[]>([]);
  const [notes, setNotes] = useState<CrmNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [noteBody, setNoteBody] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = React.useCallback(async () => {
    if (!id || !orgId) return;
    setLoading(true);
    try {
      const c = await getCompany(id);
      if (!c) { setNotFound(true); return; }
      setCompany(c);
      const [contactRows, dealRows, actRows, taskRows, noteRows] = await Promise.all([
        listContacts(orgId, { companyId: id }),
        listDeals(orgId, { companyId: id }),
        listActivities(orgId, { companyId: id, limit: 100 }),
        listTasks(orgId, { companyId: id }),
        listNotes(orgId, { companyId: id }),
      ]);
      setContacts(contactRows);
      setDeals(dealRows);
      setActivities(actRows);
      setTasks(taskRows);
      setNotes(noteRows);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load company');
    } finally {
      setLoading(false);
    }
  }, [id, orgId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!orgId || !id) return;
    const channel = supabase
      .channel(`crm-company-detail-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_notes', filter: `company_id=eq.${id}` }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_activities', filter: `company_id=eq.${id}` }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_deals', filter: `company_id=eq.${id}` }, () => void refresh())
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [orgId, id, refresh]);

  const handleAddNote = async () => {
    if (!orgId || !noteBody.trim()) return;
    setBusy(true);
    try {
      await createNote({ organizationId: orgId, body: noteBody.trim(), companyId: id }, user?.userId ?? null);
      toast.success('Note added');
      setNoteBody('');
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save note');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await deleteCompany(id);
      toast.success('Company deleted');
      navigate('/crm/companies');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete');
      setBusy(false);
    }
  };

  if (loading) return (
    <main className="flex-1 flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
    </main>
  );

  if (notFound || !company) return (
    <main className="flex-1 p-8 text-center">
      <p className="text-muted-foreground mb-4">Company not found.</p>
      <Button asChild variant="outline"><Link to="/crm/companies"><ChevronLeft className="w-4 h-4 mr-1" /> Back to companies</Link></Button>
    </main>
  );

  return (
    <main className="flex-1 min-w-0 overflow-y-auto bg-background">
      <div className="flex items-center justify-between border-b border-border bg-card/40 px-4 py-2 sm:px-6">
        <Button variant="ghost" size="sm" asChild className="gap-1">
          <Link to="/crm/companies"><ChevronLeft className="h-4 w-4" />Companies</Link>
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowEdit(true)}>
            <Pencil className="mr-1.5 h-4 w-4" />Edit
          </Button>
          <Button variant="outline" size="sm" className="text-destructive" onClick={() => setShowDelete(true)}>
            <Trash2 className="mr-1.5 h-4 w-4" />Delete
          </Button>
        </div>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-3 lg:gap-6 lg:p-6">
        {/* LEFT — Details */}
        <Card className="lg:col-span-1">
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-lg bg-primary/10 text-primary">
                <Building2 className="h-6 w-6" />
              </span>
              <div>
                <h2 className="text-xl font-bold">{company.name}</h2>
                <p className="text-sm text-muted-foreground">{company.industry ?? '—'}</p>
              </div>
            </div>
            <Separator />
            <div className="space-y-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-2"><Globe className="h-4 w-4" />{company.website ? (
                <a href={company.website.startsWith('http') ? company.website : `https://${company.website}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  {company.website}
                </a>
              ) : '—'}</div>
              <div className="flex items-center gap-2"><Mail className="h-4 w-4" />{company.email ?? '—'}</div>
              <div className="flex items-center gap-2"><Phone className="h-4 w-4" />{company.phone ?? '—'}</div>
              <div className="flex items-center gap-2"><MapPin className="h-4 w-4" />{[company.city, company.country].filter(Boolean).join(', ') || '—'}</div>
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Size</p>
                <p className="font-semibold">{company.companySize ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Revenue</p>
                <p className="font-semibold">{company.annualRevenue != null ? fmtCurrency(company.annualRevenue) : '—'}</p>
              </div>
            </div>
            {company.notes && (
              <>
                <Separator />
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Notes</p>
                  <p className="text-sm whitespace-pre-wrap break-words">{company.notes}</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* RIGHT — Contacts + Deals + Timeline */}
        <div className="space-y-4 lg:col-span-2 min-w-0">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">Contacts ({contacts.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {contacts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No contacts at this company.</p>
              ) : contacts.map((c) => (
                <Link key={c.id} to={`/crm/contacts/${c.id}`} className="flex items-center justify-between rounded-lg border border-border p-3 hover:border-primary transition-colors">
                  <div className="flex items-center gap-3">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-primary">
                      <User className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold">{c.firstName} {c.lastName ?? ''}</p>
                      <p className="text-xs text-muted-foreground">{c.jobTitle ?? c.email ?? '—'}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">Deals ({deals.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {deals.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No deals linked.</p>
              ) : deals.map((d) => (
                <Link key={d.id} to={`/crm/deals/${d.id}`} className="flex items-center justify-between rounded-lg border border-border p-3 hover:border-primary transition-colors">
                  <p className="text-sm font-semibold">{d.name}</p>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="capitalize">{d.status}</Badge>
                    <span className="text-sm font-semibold">{fmtCurrency(d.value)}</span>
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">Add note</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Textarea rows={3} value={noteBody} onChange={(e) => setNoteBody(e.target.value)} placeholder="Type a note…" disabled={busy} />
              <div className="flex justify-end">
                <Button size="sm" onClick={handleAddNote} disabled={busy || !noteBody.trim()}>
                  {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save note
                </Button>
              </div>
            </CardContent>
          </Card>

          {notes.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <StickyNote className="w-4 h-4 text-primary" />Notes ({notes.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {notes.slice(0, 5).map((n) => (
                  <div key={n.id} className="rounded-lg border border-border p-3">
                    <p className="text-sm whitespace-pre-wrap break-words">{n.body}</p>
                    <p className="text-xs text-muted-foreground mt-1">{n.createdAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Timeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {activities.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity yet.</p>
              ) : activities.slice(0, 20).map((a) => (
                <div key={a.id} className="border-l-2 border-primary/40 pl-3">
                  <p className="text-sm">{a.description ?? a.type}</p>
                  <p className="text-xs text-muted-foreground capitalize">{a.type.replace(/_/g, ' ')} · {a.createdAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          {tasks.length > 0 && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base">Tasks ({tasks.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {tasks.slice(0, 5).map((t) => (
                  <div key={t.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                    <div>
                      <p className="text-sm font-medium">{t.title}</p>
                      <p className="text-xs text-muted-foreground">{t.dueDate ? t.dueDate.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'No due date'}</p>
                    </div>
                    <Badge variant="secondary" className="capitalize">{t.status.replace('_', ' ')}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <EditCompanyDialog company={company} open={showEdit} onOpenChange={setShowEdit} onSaved={refresh} />

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this company?</AlertDialogTitle>
            <AlertDialogDescription>
              Contacts and deals linked here will lose the reference. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={busy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Suppress unused-import for Plus (kept for future actions) */}
      <span className="hidden"><Plus /></span>
    </main>
  );
};

const EditCompanyDialog: React.FC<{
  company: CrmCompany;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void | Promise<void>;
}> = ({ company, open, onOpenChange, onSaved }) => {
  const [name, setName] = useState(company.name);
  const [website, setWebsite] = useState(company.website ?? '');
  const [industry, setIndustry] = useState(company.industry ?? '');
  const [phone, setPhone] = useState(company.phone ?? '');
  const [email, setEmail] = useState(company.email ?? '');
  const [city, setCity] = useState(company.city ?? '');
  const [country, setCountry] = useState(company.country ?? '');
  const [companySize, setCompanySize] = useState(company.companySize ?? '');
  const [annualRevenue, setAnnualRevenue] = useState<string>(company.annualRevenue?.toString() ?? '');
  const [notes, setNotes] = useState(company.notes ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(company.name);
      setWebsite(company.website ?? '');
      setIndustry(company.industry ?? '');
      setPhone(company.phone ?? '');
      setEmail(company.email ?? '');
      setCity(company.city ?? '');
      setCountry(company.country ?? '');
      setCompanySize(company.companySize ?? '');
      setAnnualRevenue(company.annualRevenue?.toString() ?? '');
      setNotes(company.notes ?? '');
    }
  }, [open, company]);

  const handleSave = async () => {
    setBusy(true);
    try {
      await updateCompany(company.id, {
        name: name.trim(),
        website: website.trim() || null,
        industry: industry.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        city: city.trim() || null,
        country: country.trim() || null,
        companySize: companySize.trim() || null,
        annualRevenue: annualRevenue ? Number(annualRevenue) : null,
        notes: notes.trim() || null,
      });
      toast.success('Company updated');
      await onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit company</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Website</Label>
              <Input value={website} onChange={(e) => setWebsite(e.target.value)} disabled={busy} />
            </div>
            <div>
              <Label>Industry</Label>
              <Input value={industry} onChange={(e) => setIndustry(e.target.value)} disabled={busy} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} />
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>City</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} disabled={busy} />
            </div>
            <div>
              <Label>Country</Label>
              <Input value={country} onChange={(e) => setCountry(e.target.value)} disabled={busy} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Size</Label>
              <Input value={companySize} onChange={(e) => setCompanySize(e.target.value)} placeholder="1-10, 11-50, 51-200…" disabled={busy} />
            </div>
            <div>
              <Label>Annual revenue</Label>
              <Input type="number" min={0} value={annualRevenue} onChange={(e) => setAnnualRevenue(e.target.value)} disabled={busy} />
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={handleSave} disabled={busy || !name.trim()}>
            {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CrmCompanyDetailPage;
