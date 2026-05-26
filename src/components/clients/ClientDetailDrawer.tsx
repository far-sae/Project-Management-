import React, { useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import {
  Building2, X, Mail, Phone, Globe, MapPin, Star, User, Plus,
  FileText, Trash2, Loader2, Paperclip, ExternalLink, MessageSquare,
  Calendar as CalendarIcon, PhoneCall, Mailbox, Edit, Activity,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/context/AuthContext';
import {
  Client,
  ClientAttachment,
  ClientContact,
  ClientNote,
  ClientNoteKind,
  createContact,
  createNote,
  deleteAttachment,
  deleteContact,
  deleteNote,
  formatRevenue,
  getClientAttachments,
  getClientContacts,
  getClientNotes,
  isValidEmail,
  uploadClientAttachment,
} from '@/services/supabase/clients';
import { ScoreBadge } from '@/components/clients/ScoreBadge';
import { ActivityTimeline } from './ActivityTimeline';
import { SendEmailDialog } from './SendEmailDialog';
import { SendSmsDialog } from './SendSmsDialog';
import { InvoicesPanel } from './InvoicesPanel';
import { toast } from 'sonner';

type MainTab = 'activity' | 'notes' | 'calls' | 'emails' | 'meetings' | 'tasks' | 'files' | 'invoices';

const KIND_FOR_TAB: Partial<Record<MainTab, ClientNoteKind>> = {
  notes: 'note',
  calls: 'call',
  emails: 'email',
  meetings: 'meeting',
  tasks: 'task',
};

interface Props {
  client: Client | null;
  organizationId: string | null;
  canManage: boolean;
  onClose: () => void;
  onEdit: (client: Client) => void;
  onDelete: (client: Client) => void;
}

const NOTE_KIND_ICON: Record<ClientNoteKind, React.ComponentType<{ className?: string }>> = {
  note: MessageSquare,
  call: PhoneCall,
  meeting: CalendarIcon,
  email: Mailbox,
  task: FileText,
};

export const ClientDetailDrawer: React.FC<Props> = ({
  client, organizationId, canManage, onClose, onEdit, onDelete,
}) => {
  const { user } = useAuth();
  const [tab, setTab] = useState<MainTab>('activity');
  const [openEmail, setOpenEmail] = useState(false);
  const [openSms, setOpenSms] = useState(false);

  const [contacts, setContacts] = useState<ClientContact[]>([]);
  const [notes, setNotes] = useState<ClientNote[]>([]);
  const [attachments, setAttachments] = useState<ClientAttachment[]>([]);
  const [loading, setLoading] = useState(false);

  // Reload everything when the open client changes.
  useEffect(() => {
    if (!client || !organizationId) return;
    setLoading(true);
    let cancelled = false;
    Promise.all([
      getClientContacts(organizationId, client.clientId),
      getClientNotes(organizationId, client.clientId),
      getClientAttachments(organizationId, client.clientId),
    ])
      .then(([c, n, a]) => {
        if (cancelled) return;
        setContacts(c);
        setNotes(n);
        setAttachments(a);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client?.clientId, organizationId]);

  const reloadContacts = async () => {
    if (!client || !organizationId) return;
    setContacts(await getClientContacts(organizationId, client.clientId));
  };
  const reloadNotes = async () => {
    if (!client || !organizationId) return;
    setNotes(await getClientNotes(organizationId, client.clientId));
  };
  const reloadAttachments = async () => {
    if (!client || !organizationId) return;
    setAttachments(await getClientAttachments(organizationId, client.clientId));
  };

  const fullAddress = useMemo(() => {
    if (!client) return '';
    return [
      client.addressLine1,
      [client.city, client.state].filter(Boolean).join(', '),
      [client.postalCode, client.country].filter(Boolean).join(' '),
    ]
      .filter((s) => !!(s && s.trim()))
      .join(', ');
  }, [client, organizationId]);

  if (!client || !organizationId) return null;

  const quickAction = (target: MainTab) => () => setTab(target);

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden
      />

      {/* Wide modal — HubSpot-style 3-column record view. 95vw on desktop,
          full-screen on mobile. Right-side slide animation reuses the
          existing drawer affordance so the UX is familiar. */}
      <aside className="relative ml-auto h-full w-full sm:w-[95vw] sm:max-w-[1400px] bg-background border-l border-border shadow-xl flex flex-col animate-in slide-in-from-right-2 duration-200">
        {/* Top bar — name, badges, close + edit/delete */}
        <div className="px-4 py-3 border-b border-border flex items-center gap-3 bg-card">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <X className="w-4 h-4" /> Close
          </button>
          <div className="h-5 w-px bg-border" />
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground truncate">Accounts</span>
            <span className="text-sm text-muted-foreground">/</span>
            <span className="text-sm font-semibold text-foreground truncate">{client.name}</span>
          </div>
          <div className="ml-auto flex items-center gap-1">
            {canManage && (
              <>
                <Button variant="outline" size="sm" onClick={() => onEdit(client)}>
                  <Edit className="w-3.5 h-3.5 mr-1" /> Edit
                </Button>
                <Button
                  variant="ghost" size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => onDelete(client)}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                </Button>
              </>
            )}
          </div>
        </div>

        {/* 3-column body */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)_320px]">
          {/* ── LEFT: identity + quick actions + about ─────────────────── */}
          <aside className="border-r border-border bg-card/40 overflow-y-auto p-4 space-y-4">
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary-soft text-primary-soft-foreground flex items-center justify-center text-lg font-bold">
                {client.name.charAt(0).toUpperCase()}
              </div>
              <h2 className="mt-3 text-xl font-bold truncate w-full">{client.name}</h2>
              {client.phone && (
                <a href={`tel:${client.phone}`} className="mt-0.5 text-sm text-muted-foreground hover:text-foreground">
                  {client.phone}
                </a>
              )}
              <div className="flex items-center gap-1 flex-wrap justify-center mt-2">
                <Badge variant="outline" className="capitalize text-[10px]">{client.type}</Badge>
                <Badge
                  className={`text-[10px] ${
                    client.status === 'active'
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                      : client.status === 'archived'
                      ? 'bg-muted text-muted-foreground border-border'
                      : 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30'
                  }`}
                >
                  {client.status}
                </Badge>
                {client.category && (
                  <Badge variant="secondary" className="text-[10px]">{client.category}</Badge>
                )}
                {client.rating && (
                  <Badge variant="outline" className="text-[10px]">
                    <Star className="w-3 h-3 mr-0.5" /> {client.rating}
                  </Badge>
                )}
                <ScoreBadge score={client.score} band={client.scoreBand} />
              </div>
            </div>

            {/* Quick action row — HubSpot's row of round icon buttons */}
            <div className="flex items-center justify-center gap-2 pt-1">
              <QuickAction icon={MessageSquare} label="Note" onClick={quickAction('notes')} />
              <QuickAction icon={Mailbox} label="Email" onClick={() => setOpenEmail(true)} />
              <QuickAction icon={MessageSquare} label="SMS" onClick={() => setOpenSms(true)} />
              <QuickAction icon={PhoneCall} label="Call" onClick={quickAction('calls')} href={client.phone ? `tel:${client.phone}` : undefined} />
              <QuickAction icon={FileText} label="Task" onClick={quickAction('tasks')} />
              <QuickAction icon={CalendarIcon} label="Meeting" onClick={quickAction('meetings')} />
            </div>

            <div className="border-t border-border pt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                About this company
              </h3>
              <OverviewTab client={client} fullAddress={fullAddress} />
            </div>
          </aside>

          {/* ── MIDDLE: tabbed activity ─────────────────────────────────── */}
          <section className="flex flex-col overflow-hidden">
            <Tabs value={tab} onValueChange={(v) => setTab(v as MainTab)} className="px-4 pt-3">
              <TabsList className="bg-transparent border-b border-border rounded-none w-full justify-start gap-1 h-auto p-0">
                {([
                  { v: 'activity', label: 'Activity', icon: Activity },
                  { v: 'notes', label: 'Notes' },
                  { v: 'emails', label: 'Emails' },
                  { v: 'calls', label: 'Calls' },
                  { v: 'tasks', label: 'Tasks' },
                  { v: 'meetings', label: 'Meetings' },
                  { v: 'files', label: 'Files' },
                  { v: 'invoices', label: 'Invoices' },
                ] as const).map((t) => (
                  <TabsTrigger
                    key={t.v}
                    value={t.v}
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-orange-500 data-[state=active]:bg-transparent px-3 pb-2"
                  >
                    {t.label}
                    {t.v === 'files' && attachments.length > 0 && (
                      <span className="ml-1 text-xs text-muted-foreground">({attachments.length})</span>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <div className="flex-1 overflow-y-auto p-4">
              {loading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                </div>
              )}

              {tab === 'activity' && (
                <ActivityTimeline
                  clientId={client.clientId}
                  emptyHint="No timeline events yet. Notes, deal moves, tasks, and form submissions will appear here automatically."
                />
              )}

              {(tab === 'notes' || tab === 'calls' || tab === 'emails' || tab === 'meetings' || tab === 'tasks') && (
                <ActivityTab
                  clientId={client.clientId}
                  organizationId={organizationId}
                  userId={user?.userId}
                  userName={user?.displayName}
                  canManage={canManage}
                  notes={notes}
                  onChanged={reloadNotes}
                  kindFilter={KIND_FOR_TAB[tab]}
                />
              )}

              {tab === 'files' && (
                <FilesTab
                  clientId={client.clientId}
                  organizationId={organizationId}
                  userId={user?.userId}
                  userName={user?.displayName}
                  canManage={canManage}
                  attachments={attachments}
                  onChanged={reloadAttachments}
                />
              )}

              {tab === 'invoices' && (
                <InvoicesPanel
                  organizationId={organizationId}
                  client={client}
                  canManage={canManage}
                />
              )}
            </div>
          </section>

          {/* ── RIGHT: contacts list ────────────────────────────────────── */}
          <aside className="border-l border-border bg-card/40 overflow-y-auto p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Contacts
                {contacts.length > 0 && (
                  <span className="ml-1 text-muted-foreground normal-case">({contacts.length})</span>
                )}
              </h3>
            </div>
            <ContactsTab
              clientId={client.clientId}
              organizationId={organizationId}
              userId={user?.userId}
              canManage={canManage}
              contacts={contacts}
              onChanged={reloadContacts}
            />
          </aside>
        </div>
      </aside>

      <SendEmailDialog
        open={openEmail}
        onOpenChange={setOpenEmail}
        client={client}
        organizationId={organizationId}
        onLogged={reloadNotes}
      />

      <SendSmsDialog
        open={openSms}
        onOpenChange={setOpenSms}
        client={client}
        organizationId={organizationId}
        onLogged={reloadNotes}
      />
    </div>
  );
};

// Tiny round icon button used in the quick-action row.
const QuickAction: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  href?: string;
}> = ({ icon: Icon, label, onClick, href }) => {
  const Inner = (
    <span className="flex flex-col items-center gap-1">
      <span className="h-9 w-9 rounded-full bg-orange-500/15 text-orange-600 dark:text-orange-400 grid place-items-center transition-colors hover:bg-orange-500/25">
        <Icon className="h-4 w-4" />
      </span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </span>
  );
  if (href) {
    return (
      <a href={href} aria-label={label}>
        {Inner}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-label={label}>
      {Inner}
    </button>
  );
};

// ─── Overview tab ────────────────────────────────────────────────────────────

const OverviewTab: React.FC<{ client: Client; fullAddress: string }> = ({
  client, fullAddress,
}) => (
  <div className="space-y-4 text-sm">
    <div className="grid grid-cols-2 gap-3">
      <Field icon={Mail} label="Email" value={client.email} href={client.email ? `mailto:${client.email}` : undefined} />
      <Field icon={Phone} label="Phone" value={client.phone} href={client.phone ? `tel:${client.phone}` : undefined} />
      <Field icon={Globe} label="Website" value={client.website} href={client.website ?? undefined} external />
      <Field icon={User} label="Owner" value={client.accountOwnerName} />
      <Field
        icon={MapPin} label="Address"
        value={fullAddress || null} className="col-span-2"
      />
    </div>

    <div className="grid grid-cols-2 gap-3">
      <Field
        label="Annual revenue"
        value={
          client.annualRevenue == null
            ? null
            : formatRevenue(client.annualRevenue)
        }
      />
      <Field
        label="Employees"
        value={
          client.employeeCount == null ? null : String(client.employeeCount)
        }
      />
      <Field label="Source" value={client.source} />
      <Field label="Created" value={format(client.createdAt, 'PP')} />
    </div>

    {client.tags && client.tags.length > 0 && (
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
          Tags
        </p>
        <div className="flex flex-wrap gap-1.5">
          {client.tags.map((t) => (
            <Badge key={t} variant="secondary">{t}</Badge>
          ))}
        </div>
      </div>
    )}

    {client.description && (
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
          Description
        </p>
        <p className="whitespace-pre-wrap text-foreground/90">
          {client.description}
        </p>
      </div>
    )}
  </div>
);

const Field: React.FC<{
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | null | undefined;
  href?: string;
  external?: boolean;
  className?: string;
}> = ({ icon: Icon, label, value, href, external, className }) => (
  <div className={className}>
    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5 flex items-center gap-1">
      {Icon && <Icon className="w-3 h-3" />} {label}
    </p>
    {value ? (
      href ? (
        <a
          href={href}
          target={external ? '_blank' : undefined}
          rel={external ? 'noopener noreferrer' : undefined}
          className="text-foreground hover:text-primary inline-flex items-center gap-1 break-all"
        >
          {value}
          {external && <ExternalLink className="w-3 h-3" />}
        </a>
      ) : (
        <span className="text-foreground break-words">{value}</span>
      )
    ) : (
      <span className="text-muted-foreground">—</span>
    )}
  </div>
);

// ─── Contacts tab ────────────────────────────────────────────────────────────

const ContactsTab: React.FC<{
  clientId: string;
  organizationId: string;
  userId: string | undefined;
  canManage: boolean;
  contacts: ClientContact[];
  onChanged: () => Promise<void> | void;
}> = ({ clientId, organizationId, userId, canManage, contacts, onChanged }) => {
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    title: '',
    email: '',
    phone: '',
    isPrimary: false,
  });

  const reset = () => setForm({
    firstName: '', lastName: '', title: '', email: '', phone: '', isPrimary: false,
  });

  const submit = async () => {
    if (!userId) return;
    if (form.email && !isValidEmail(form.email)) {
      toast.error('Invalid email');
      return;
    }
    if (!form.firstName.trim() && !form.lastName.trim() && !form.email.trim()) {
      toast.error('Add at least a name or email');
      return;
    }
    setSubmitting(true);
    try {
      await createContact(organizationId, clientId, userId, {
        firstName: form.firstName.trim() || null,
        lastName: form.lastName.trim() || null,
        title: form.title.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        isPrimary: form.isPrimary,
      });
      reset();
      setShowForm(false);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add contact');
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (c: ClientContact) => {
    if (!confirm(`Delete contact "${c.fullName || c.email || 'Unnamed'}"?`)) return;
    try {
      await deleteContact(organizationId, c.contactId);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  return (
    <div className="space-y-3">
      {canManage && !showForm && (
        <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4 mr-1" /> Add contact
        </Button>
      )}

      {showForm && (
        <div className="border rounded-md p-3 space-y-2 bg-secondary/30">
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="First name" maxLength={100}
              value={form.firstName}
              onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
            />
            <Input
              placeholder="Last name" maxLength={100}
              value={form.lastName}
              onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
            />
            <Input
              placeholder="Title" maxLength={150}
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
            <Input
              placeholder="Phone" maxLength={50}
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
            <Input
              className="col-span-2"
              placeholder="Email" type="email" maxLength={250}
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox" checked={form.isPrimary}
              onChange={(e) => setForm((f) => ({ ...f, isPrimary: e.target.checked }))}
            />
            Primary contact
          </label>
          <div className="flex justify-end gap-2">
            <Button
              size="sm" variant="ghost"
              onClick={() => { setShowForm(false); reset(); }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Add
            </Button>
          </div>
        </div>
      )}

      {contacts.length === 0 && !showForm && (
        <p className="text-sm text-muted-foreground">
          No contacts yet. Add the main person your team should talk to for this client.
        </p>
      )}

      <ul className="space-y-2">
        {contacts.map((c) => (
          <li
            key={c.contactId}
            className="rounded-md border p-3 flex items-start gap-3"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">
                  {c.fullName || c.email || 'Unnamed'}
                </span>
                {c.isPrimary && (
                  <Badge className="bg-primary/10 text-primary border-primary/20">
                    Primary
                  </Badge>
                )}
              </div>
              {c.title && (
                <p className="text-sm text-muted-foreground">{c.title}</p>
              )}
              <div className="text-xs text-muted-foreground mt-1 space-x-3">
                {c.email && (
                  <a
                    className="hover:text-foreground"
                    href={`mailto:${c.email}`}
                  >
                    {c.email}
                  </a>
                )}
                {c.phone && (
                  <a className="hover:text-foreground" href={`tel:${c.phone}`}>
                    {c.phone}
                  </a>
                )}
              </div>
            </div>
            {canManage && (
              <Button
                size="icon" variant="ghost" aria-label="Delete contact"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => remove(c)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

// ─── Notes tab (notes / calls / meetings / emails) ───────────────────────────

const ActivityTab: React.FC<{
  clientId: string;
  organizationId: string;
  userId: string | undefined;
  userName: string | undefined;
  canManage: boolean;
  notes: ClientNote[];
  onChanged: () => Promise<void> | void;
  /** If set, only show notes of this kind and pre-select the composer to it. */
  kindFilter?: ClientNoteKind;
}> = ({ clientId, organizationId, userId, userName, canManage, notes, onChanged, kindFilter }) => {
  const [kind, setKind] = useState<ClientNoteKind>(kindFilter ?? 'note');
  useEffect(() => {
    if (kindFilter) setKind(kindFilter);
  }, [kindFilter]);
  const visibleNotes = kindFilter ? notes.filter((n) => n.kind === kindFilter) : notes;
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!userId || !userName) return;
    if (!subject.trim() && !body.trim()) {
      toast.error('Write something to log');
      return;
    }
    setSubmitting(true);
    try {
      await createNote(organizationId, clientId, userId, userName, {
        kind,
        subject: subject.trim() || null,
        body: body.trim() || null,
        occurredAt: new Date(),
      });
      setSubject('');
      setBody('');
      setKind('note');
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to log');
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (n: ClientNote) => {
    if (!confirm('Delete this entry?')) return;
    try {
      await deleteNote(organizationId, n.noteId);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const canDelete = (n: ClientNote) => canManage || n.authorId === userId;

  return (
    <div className="space-y-3">
      {userId && (
        <div className="border rounded-md p-3 space-y-2 bg-secondary/30">
          <div className="flex gap-2">
            {!kindFilter && (
              <Select value={kind} onValueChange={(v) => setKind(v as ClientNoteKind)}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="note">Note</SelectItem>
                  <SelectItem value="call">Call</SelectItem>
                  <SelectItem value="meeting">Meeting</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="task">Task</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Input
              placeholder="Subject (optional)" maxLength={200}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <Textarea
            placeholder="Details…" rows={3} maxLength={5000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Log
            </Button>
          </div>
        </div>
      )}

      {visibleNotes.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {kindFilter
            ? `No ${kindFilter}s logged yet. Use the composer above to add the first.`
            : 'No notes yet. Log calls, meetings, emails, or quick reminders so everyone has context.'}
        </p>
      )}

      <ul className="space-y-2">
        {visibleNotes.map((n) => {
          const Icon = NOTE_KIND_ICON[n.kind] ?? MessageSquare;
          return (
            <li key={n.noteId} className="rounded-md border p-3">
              <div className="flex items-start gap-2">
                <Icon className="w-4 h-4 mt-0.5 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap text-sm">
                    <span className="font-medium capitalize">{n.kind}</span>
                    {n.subject && (
                      <span className="text-foreground">— {n.subject}</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {n.authorName ?? 'Unknown'} · {format(n.occurredAt, 'PPp')}
                  </p>
                  {n.body && (
                    <p className="text-sm whitespace-pre-wrap mt-2">{n.body}</p>
                  )}
                </div>
                {canDelete(n) && (
                  <Button
                    size="icon" variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Delete entry"
                    onClick={() => remove(n)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

// ─── Files tab ────────────────────────────────────────────────────────────

const ActivityKindLabel: Record<ClientNoteKind, string> = {
  note: 'Note', call: 'Call', meeting: 'Meeting', email: 'Email', task: 'Task',
};
// (kept exported in spirit even if unused — useful for reports later)
void ActivityKindLabel;

const FilesTab: React.FC<{
  clientId: string;
  organizationId: string;
  userId: string | undefined;
  userName: string | undefined;
  canManage: boolean;
  attachments: ClientAttachment[];
  onChanged: () => Promise<void> | void;
}> = ({
  clientId, organizationId, userId, userName, canManage, attachments, onChanged,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!userId || !userName) return;
    setUploading(true);
    try {
      await uploadClientAttachment(organizationId, clientId, userId, userName, f);
      await onChanged();
      toast.success('File uploaded');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const remove = async (a: ClientAttachment) => {
    if (!confirm(`Delete "${a.fileName}"?`)) return;
    try {
      await deleteAttachment(organizationId, a);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const fmtSize = (bytes: number | null | undefined): string => {
    if (bytes == null) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-3">
      <div>
        <input
          ref={fileRef} type="file" className="hidden"
          onChange={onPick}
        />
        <Button
          size="sm" variant="outline"
          disabled={uploading || !userId}
          onClick={() => fileRef.current?.click()}
        >
          {uploading
            ? <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            : <Paperclip className="w-4 h-4 mr-1" />}
          Upload file
        </Button>
        <p className="text-xs text-muted-foreground mt-1">
          PDF, image, doc/spreadsheet, csv, or zip — up to 500 MB.
        </p>
      </div>

      {attachments.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No files yet. Upload contracts, briefs, spreadsheets, or other documents for this client.
        </p>
      )}

      <ul className="space-y-2">
        {attachments.map((a) => {
          const canDelete = canManage || a.uploadedBy === userId;
          return (
            <li
              key={a.attachmentId}
              className="rounded-md border p-3 flex items-center gap-3"
            >
              <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <a
                  href={a.fileUrl ?? '#'}
                  target="_blank" rel="noopener noreferrer"
                  className="font-medium hover:text-primary inline-flex items-center gap-1 break-all"
                >
                  {a.fileName}
                  <ExternalLink className="w-3 h-3" />
                </a>
                <p className="text-xs text-muted-foreground">
                  {fmtSize(a.fileSize)} · {a.uploadedByName ?? 'Unknown'} ·{' '}
                  {format(a.createdAt, 'PPp')}
                </p>
              </div>
              {canDelete && (
                <Button
                  size="icon" variant="ghost"
                  aria-label="Delete file"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => remove(a)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
