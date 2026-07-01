import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ChevronLeft, Copy, StickyNote, Mail, Phone, Calendar as CalendarIcon,
  Video, Loader2, Pencil, Trash2, Plus, Building2, MoreHorizontal, Settings as SettingsIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { supabase } from '@/services/supabase/config';
import {
  getContact, updateContact, deleteContact,
} from '@/services/supabase/crmHub/contacts';
import { listActivities, logActivity } from '@/services/supabase/crmHub/activities';
import { listNotes, createNote } from '@/services/supabase/crmHub/notes';
import { listTasks } from '@/services/supabase/crmHub/tasks';
import { listDeals } from '@/services/supabase/crmHub/deals';
import { getCompany } from '@/services/supabase/crmHub/companies';
import {
  LIFECYCLE_STAGES, LEAD_STATUSES,
} from '@/types/crmHub';
import type {
  CrmContact, CrmActivity, CrmNote, CrmTask, CrmDeal, CrmCompany,
  ActivityType, LifecycleStage, LeadStatus,
} from '@/types/crmHub';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ContactTagPicker } from '@/components/crmHub/ContactTagPicker';
import { useCrmCurrency } from '@/context/CrmCurrencyContext';
import { useCrmCompanies } from '@/hooks/useCrmHub';
import { createTask } from '@/services/supabase/crmHub/tasks';
import { TASK_PRIORITIES } from '@/types/crmHub';
import type { TaskPriority } from '@/types/crmHub';

const initials = (name: string) => {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
};

const humanize = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const ACTIVITY_TABS: { key: 'all' | 'note' | 'call' | 'email' | 'meeting'; label: string }[] = [
  { key: 'all', label: 'All activities' },
  { key: 'note', label: 'Notes' },
  { key: 'call', label: 'Calls' },
  { key: 'email', label: 'Emails' },
  { key: 'meeting', label: 'Meetings' },
];

const activityIcon = (t: ActivityType) => {
  if (t === 'note') return StickyNote;
  if (t === 'call') return Phone;
  if (t === 'email') return Mail;
  if (t === 'meeting') return Video;
  return MoreHorizontal;
};

const activityTint = (t: ActivityType) => {
  if (t === 'note') return 'bg-amber-500/15 text-amber-500';
  if (t === 'call') return 'bg-blue-500/15 text-blue-500';
  if (t === 'email') return 'bg-violet-500/15 text-violet-500';
  if (t === 'meeting') return 'bg-emerald-500/15 text-emerald-500';
  return 'bg-muted text-muted-foreground';
};

export const CrmContactDetailPage: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { organization } = useOrganization();
  const orgId = organization?.organizationId ?? null;

  const [contact, setContact] = useState<CrmContact | null>(null);
  const [company, setCompany] = useState<CrmCompany | null>(null);
  const [notes, setNotes] = useState<CrmNote[]>([]);
  const [activities, setActivities] = useState<CrmActivity[]>([]);
  const [tasks, setTasks] = useState<CrmTask[]>([]);
  const [deals, setDeals] = useState<CrmDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [noteBody, setNoteBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'all' | 'note' | 'call' | 'email' | 'meeting'>('all');

  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showNewTask, setShowNewTask] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDueDate, setTaskDueDate] = useState('');
  const [taskPriority, setTaskPriority] = useState<TaskPriority>('medium');
  const { format: fmtCurrency } = useCrmCurrency();
  const [logType, setLogType] = useState<ActivityType>('call');
  const [logBody, setLogBody] = useState('');

  const refresh = React.useCallback(async () => {
    if (!id || !orgId) return;
    setLoading(true);
    try {
      const c = await getContact(id);
      if (!c) { setNotFound(true); return; }
      setContact(c);
      const [notesRows, actRows, taskRows, dealRows] = await Promise.all([
        listNotes(orgId, { contactId: id }),
        listActivities(orgId, { contactId: id, limit: 100 }),
        listTasks(orgId, { contactId: id }),
        listDeals(orgId, { contactId: id }),
      ]);
      setNotes(notesRows);
      setActivities(actRows);
      setTasks(taskRows);
      setDeals(dealRows);
      if (c.companyId) {
        const co = await getCompany(c.companyId);
        setCompany(co);
      } else {
        setCompany(null);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load contact');
    } finally {
      setLoading(false);
    }
  }, [id, orgId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!orgId || !id) return;
    const channel = supabase
      .channel(`crm-contact-detail-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_notes', filter: `contact_id=eq.${id}` }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_activities', filter: `contact_id=eq.${id}` }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_tasks', filter: `contact_id=eq.${id}` }, () => void refresh())
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [orgId, id, refresh]);

  const handleAddNote = async () => {
    if (!orgId || !noteBody.trim()) return;
    setBusy(true);
    try {
      await createNote({ organizationId: orgId, workspaceId: contact?.workspaceId ?? null, body: noteBody.trim(), contactId: id }, user?.userId ?? null);
      toast.success('Note added');
      setNoteBody('');
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save note');
    } finally {
      setBusy(false);
    }
  };

  const handleLog = async () => {
    if (!orgId || !logBody.trim()) return;
    setBusy(true);
    try {
      await logActivity({
        organizationId: orgId,
        workspaceId: contact?.workspaceId ?? null,
        type: logType,
        description: logBody.trim(),
        contactId: id,
      }, user?.userId ?? null);
      toast.success('Activity logged');
      setShowLog(false);
      setLogBody('');
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not log');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await deleteContact(id);
      toast.success('Contact deleted');
      navigate('/crm/contacts');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete contact');
      setBusy(false);
    }
  };

  const copyEmail = () => {
    if (!contact?.email) return;
    void navigator.clipboard.writeText(contact.email);
    toast.success('Email copied');
  };

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (notFound || !contact) {
    return (
      <main className="flex-1 p-8 text-center">
        <p className="text-muted-foreground mb-4">Contact not found.</p>
        <Button asChild variant="outline"><Link to="/crm/contacts"><ChevronLeft className="w-4 h-4 mr-1" /> Back to contacts</Link></Button>
      </main>
    );
  }

  const fullName = `${contact.firstName} ${contact.lastName ?? ''}`.trim();

  const filteredActivities = activities.filter((a) => {
    if (tab === 'all') return true;
    return a.type === tab;
  });

  return (
    <main className="flex-1 min-w-0 overflow-y-auto bg-background">
      <div className="flex items-center justify-between border-b border-border bg-card/40 px-4 py-2 sm:px-6">
        <Button variant="ghost" size="sm" asChild className="gap-1">
          <Link to="/crm/contacts"><ChevronLeft className="h-4 w-4" />Leads</Link>
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

      <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[320px_minmax(0,1fr)_320px] lg:gap-6 lg:p-6">
        {/* LEFT */}
        <aside className="space-y-3">
          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="flex flex-col items-center text-center">
                <Avatar className="h-16 w-16">
                  <AvatarFallback className="bg-primary text-primary-foreground text-lg">{initials(fullName)}</AvatarFallback>
                </Avatar>
                <h2 className="mt-3 text-lg font-bold">{fullName}</h2>
                {contact.jobTitle && <p className="text-xs text-muted-foreground">{contact.jobTitle}</p>}
                {contact.email && (
                  <button onClick={copyEmail} className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                    {contact.email} <Copy className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-5 gap-1">
                <QuickAction icon={StickyNote} label="Note" onClick={() => { setLogType('note'); setLogBody(''); setShowLog(true); }} />
                <QuickAction icon={Mail} label="Email" onClick={() => {
                  if (contact.email) window.location.href = `mailto:${contact.email}`;
                  else { setLogType('email'); setLogBody(''); setShowLog(true); }
                }} />
                <QuickAction icon={Phone} label="Call" onClick={() => {
                  if (contact.phone) window.location.href = `tel:${contact.phone}`;
                  else { setLogType('call'); setLogBody(''); setShowLog(true); }
                }} />
                <QuickAction icon={CalendarIcon} label="Task" onClick={() => setShowNewTask(true)} />
                <QuickAction icon={Video} label="Meet" onClick={() => { setLogType('meeting'); setLogBody(''); setShowLog(true); }} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Key information</h3>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowEdit(true)}>
                  <SettingsIcon className="h-3.5 w-3.5" />
                </Button>
              </div>
              <KV label="Email" value={contact.email} />
              <KV label="Phone number" value={contact.phone} />
              <KV label="Company" value={
                company ? <Link to={`/crm/companies/${company.id}`} className="text-primary hover:underline">{company.name}</Link> : null
              } />
              <KV label="Job title" value={contact.jobTitle} />
              <KV label="Lead status" value={<Badge variant="outline" className="capitalize">{humanize(contact.leadStatus)}</Badge>} />
              <KV label="Lifecycle stage" value={<Badge className="capitalize bg-primary/15 text-primary hover:bg-primary/20">{humanize(contact.lifecycleStage)}</Badge>} />
              <KV label="Source" value={contact.source} />
            </CardContent>
          </Card>
        </aside>

        {/* CENTER */}
        <section className="space-y-4 min-w-0">
          <Card>
            <CardContent className="space-y-2 p-4">
              <Textarea
                id="contact-note-composer"
                rows={3}
                placeholder="Add a note about this contact…"
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                disabled={busy}
              />
              <div className="flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={() => { setLogType('call'); setLogBody(''); setShowLog(true); }}>
                  <Plus className="mr-1 h-4 w-4" />Log activity
                </Button>
                <Button size="sm" onClick={handleAddNote} disabled={busy || !noteBody.trim()}>
                  {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save note
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between gap-2 border-b border-border">
            <div className="flex items-center gap-2 overflow-x-auto">
              {ACTIVITY_TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                    tab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {tab !== 'all' && (
              <Button
                size="sm"
                variant="outline"
                className="mb-1 whitespace-nowrap"
                onClick={() => { setLogType(tab as ActivityType); setLogBody(''); setShowLog(true); }}
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Log {tab}
              </Button>
            )}
          </div>

          <div className="space-y-3">
            {filteredActivities.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-10 text-center space-y-3">
                <p className="text-sm text-muted-foreground">
                  No {tab === 'all' ? 'activity' : `${tab}s`} yet.
                </p>
                {tab !== 'all' && (
                  <Button
                    size="sm"
                    onClick={() => { setLogType(tab as ActivityType); setLogBody(''); setShowLog(true); }}
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    Log first {tab}
                  </Button>
                )}
                {tab === 'all' && (
                  <Button
                    size="sm"
                    onClick={() => { setLogType('call'); setLogBody(''); setShowLog(true); }}
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    Log activity
                  </Button>
                )}
              </div>
            ) : filteredActivities.map((a) => {
              const Icon = activityIcon(a.type);
              return (
                <Card key={a.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${activityTint(a.type)}`}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold capitalize">{humanize(a.type)}</p>
                          {a.description && <p className="mt-0.5 text-sm text-muted-foreground break-words">{a.description}</p>}
                        </div>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">{a.createdAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        {/* RIGHT — Associations */}
        <aside className="space-y-3">
          <AssocPanel
            title="Companies"
            count={company ? 1 : 0}
            onAdd={() => setShowEdit(true)}
            addLabel={company ? 'Change' : 'Add'}
          >
            {company ? (
              <Link to={`/crm/companies/${company.id}`} className="flex items-center gap-2 rounded-lg border border-border p-3 hover:border-primary transition-colors">
                <span className="grid h-9 w-9 place-items-center rounded-md bg-primary/10 text-primary"><Building2 className="h-4 w-4" /></span>
                <span className="text-sm font-medium truncate">{company.name}</span>
              </Link>
            ) : <EmptyAssoc label="company" />}
          </AssocPanel>

          <AssocPanel
            title="Deals"
            count={deals.length}
            onAdd={() => navigate('/crm/deals')}
          >
            {deals.length === 0 ? <EmptyAssoc label="deal" /> : deals.map((d) => (
              <Link key={d.id} to={`/crm/deals/${d.id}`} className="block rounded-lg border border-border p-3 hover:border-primary transition-colors">
                <p className="text-sm font-semibold text-primary hover:underline">{d.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{fmtCurrency(d.value)}</p>
                <Badge variant="secondary" className="mt-2 capitalize">{d.status}</Badge>
              </Link>
            ))}
          </AssocPanel>

          <AssocPanel
            title="Tasks"
            count={tasks.length}
            onAdd={() => setShowNewTask(true)}
          >
            {tasks.length === 0 ? <EmptyAssoc label="task" /> : tasks.slice(0, 5).map((t) => (
              <div key={t.id} className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium">{t.title}</p>
                <div className="mt-1 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">{t.dueDate ? t.dueDate.toLocaleDateString() : 'No due date'}</p>
                  <Badge variant="secondary" className="capitalize">{humanize(t.status)}</Badge>
                </div>
              </div>
            ))}
          </AssocPanel>

          <AssocPanel
            title="Notes"
            count={notes.length}
            onAdd={() => {
              document.getElementById('contact-note-composer')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              (document.getElementById('contact-note-composer') as HTMLTextAreaElement | null)?.focus();
            }}
          >
            {notes.length === 0 ? <EmptyAssoc label="note" /> : notes.slice(0, 3).map((n) => (
              <div key={n.id} className="rounded-lg border border-border p-3">
                <p className="text-sm whitespace-pre-wrap break-words line-clamp-3">{n.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">{n.createdAt.toLocaleDateString()}</p>
              </div>
            ))}
          </AssocPanel>

          <Card>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Tags</h3>
              </div>
              <Separator />
              <div className="pt-1">
                <ContactTagPicker contactId={contact.id} />
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>

      <EditContactDialog
        contact={contact}
        open={showEdit}
        onOpenChange={setShowEdit}
        onSaved={refresh}
      />

      <Dialog open={showLog} onOpenChange={setShowLog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Log {humanize(logType).toLowerCase()}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Type</Label>
              <Select value={logType} onValueChange={(v) => setLogType(v as ActivityType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="note">Note</SelectItem>
                  <SelectItem value="call">Call</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="meeting">Meeting</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Description</Label>
              <Textarea rows={3} value={logBody} onChange={(e) => setLogBody(e.target.value)} disabled={busy} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLog(false)} disabled={busy}>Cancel</Button>
            <Button onClick={handleLog} disabled={busy || !logBody.trim()}>
              {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Log
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showNewTask} onOpenChange={(o) => { setShowNewTask(o); if (!o) { setTaskTitle(''); setTaskDueDate(''); setTaskPriority('medium'); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New task for {contact.firstName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Title *</Label>
              <Input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} disabled={busy} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Due date</Label>
                <Input type="date" value={taskDueDate} onChange={(e) => setTaskDueDate(e.target.value)} disabled={busy} />
              </div>
              <div>
                <Label>Priority</Label>
                <Select value={taskPriority} onValueChange={(v) => setTaskPriority(v as TaskPriority)} disabled={busy}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TASK_PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewTask(false)} disabled={busy}>Cancel</Button>
            <Button
              onClick={async () => {
                if (!orgId || !taskTitle.trim()) return;
                setBusy(true);
                try {
                  await createTask({
                    organizationId: orgId,
                    workspaceId: contact.workspaceId ?? null,
                    title: taskTitle.trim(),
                    dueDate: taskDueDate || null,
                    priority: taskPriority,
                    contactId: id,
                    companyId: contact.companyId,
                  }, user?.userId ?? null);
                  toast.success('Task created');
                  setShowNewTask(false);
                  setTaskTitle(''); setTaskDueDate(''); setTaskPriority('medium');
                  await refresh();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Could not create task');
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy || !taskTitle.trim()}
            >
              {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this contact?</AlertDialogTitle>
            <AlertDialogDescription>
              This can't be undone. Linked deals and tasks will lose the reference.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
};

// ─── Small helpers ───────────────────────────────────────────────

const QuickAction: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}> = ({ icon: Icon, label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex flex-col items-center gap-1 rounded-lg p-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
  >
    <span className="grid h-9 w-9 place-items-center rounded-md bg-primary/10 text-primary">
      <Icon className="h-4 w-4" />
    </span>
    {label}
  </button>
);

const KV: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    <div className="text-sm">{value ?? <span className="text-muted-foreground">—</span>}</div>
  </div>
);

const AssocPanel: React.FC<{
  title: string;
  count: number;
  onAdd?: () => void;
  addLabel?: string;
  children: React.ReactNode;
}> = ({ title, count, onAdd, addLabel = 'Add', children }) => (
  <Card>
    <CardContent className="space-y-2 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title} ({count})</h3>
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <Plus className="h-3.5 w-3.5" />
            {addLabel}
          </button>
        )}
      </div>
      <Separator />
      <div className="space-y-2 pt-1">{children}</div>
    </CardContent>
  </Card>
);

const EmptyAssoc: React.FC<{ label: string }> = ({ label }) => (
  <p className="text-xs text-muted-foreground italic px-1">No {label} associated yet.</p>
);

// ─── Edit dialog inline (uses updateContact) ────────────────────

const EditContactDialog: React.FC<{
  contact: CrmContact;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void | Promise<void>;
}> = ({ contact, open, onOpenChange, onSaved }) => {
  const { items: companies } = useCrmCompanies();
  const [firstName, setFirstName] = useState(contact.firstName);
  const [lastName, setLastName] = useState(contact.lastName ?? '');
  const [email, setEmail] = useState(contact.email ?? '');
  const [phone, setPhone] = useState(contact.phone ?? '');
  const [jobTitle, setJobTitle] = useState(contact.jobTitle ?? '');
  const [companyId, setCompanyId] = useState(contact.companyId ?? '');
  const [source, setSource] = useState(contact.source ?? '');
  const [lifecycleStage, setLifecycleStage] = useState<LifecycleStage>(contact.lifecycleStage);
  const [leadStatus, setLeadStatus] = useState<LeadStatus>(contact.leadStatus);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setFirstName(contact.firstName);
      setLastName(contact.lastName ?? '');
      setEmail(contact.email ?? '');
      setPhone(contact.phone ?? '');
      setJobTitle(contact.jobTitle ?? '');
      setCompanyId(contact.companyId ?? '');
      setSource(contact.source ?? '');
      setLifecycleStage(contact.lifecycleStage);
      setLeadStatus(contact.leadStatus);
    }
  }, [open, contact]);

  const handleSave = async () => {
    setBusy(true);
    try {
      await updateContact(contact.id, {
        firstName: firstName.trim(),
        lastName: lastName.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        jobTitle: jobTitle.trim() || null,
        companyId: companyId || null,
        source: source.trim() || null,
        lifecycleStage,
        leadStatus,
      });
      toast.success('Contact updated');
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
          <DialogTitle>Edit contact</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>First name *</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={busy} />
            </div>
            <div>
              <Label>Last name</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={busy} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} />
            </div>
          </div>
          <div>
            <Label>Job title</Label>
            <Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} disabled={busy} />
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
          <div>
            <Label>Source</Label>
            <Input value={source} onChange={(e) => setSource(e.target.value)} disabled={busy} />
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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={handleSave} disabled={busy || !firstName.trim()}>
            {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CrmContactDetailPage;
