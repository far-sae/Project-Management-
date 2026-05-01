import React, { useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import {
  Building2, X, Mail, Phone, Globe, MapPin, Star, User, Plus,
  FileText, Trash2, Loader2, Paperclip, ExternalLink, MessageSquare,
  Calendar as CalendarIcon, PhoneCall, Mailbox, Edit,
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
import { toast } from 'sonner';

type Tab = 'overview' | 'contacts' | 'activity' | 'files';

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
  const [tab, setTab] = useState<Tab>('overview');

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

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden
      />

      {/* drawer */}
      <aside className="relative ml-auto h-full w-full sm:w-[640px] bg-card border-l border-border shadow-xl flex flex-col animate-in slide-in-from-right-2 duration-200">
        {/* header */}
        <div className="p-4 border-b border-border flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-md bg-primary-soft text-primary-soft-foreground flex items-center justify-center">
            <Building2 className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold truncate">{client.name}</h2>
            <div className="flex items-center gap-2 flex-wrap mt-1">
              <Badge variant="outline" className="capitalize">{client.type}</Badge>
              <Badge
                className={
                  client.status === 'active'
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                    : client.status === 'archived'
                    ? 'bg-muted text-muted-foreground border-border'
                    : 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30'
                }
              >
                {client.status}
              </Badge>
              {client.rating && (
                <Badge variant="outline">
                  <Star className="w-3 h-3 mr-1" /> {client.rating}
                </Badge>
              )}
              {client.industry && (
                <Badge variant="outline">{client.industry}</Badge>
              )}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* tabs */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="px-4 pt-3">
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="contacts">
              Contacts {contacts.length > 0 && `(${contacts.length})`}
            </TabsTrigger>
            <TabsTrigger value="activity">
              Activity {notes.length > 0 && `(${notes.length})`}
            </TabsTrigger>
            <TabsTrigger value="files">
              Files {attachments.length > 0 && `(${attachments.length})`}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          )}

          {tab === 'overview' && (
            <OverviewTab client={client} fullAddress={fullAddress} />
          )}
          {tab === 'contacts' && (
            <ContactsTab
              clientId={client.clientId}
              organizationId={organizationId}
              userId={user?.userId}
              canManage={canManage}
              contacts={contacts}
              onChanged={reloadContacts}
            />
          )}
          {tab === 'activity' && (
            <ActivityTab
              clientId={client.clientId}
              organizationId={organizationId}
              userId={user?.userId}
              userName={user?.displayName}
              canManage={canManage}
              notes={notes}
              onChanged={reloadNotes}
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
        </div>

        {canManage && (
          <div className="border-t border-border p-3 flex items-center justify-between gap-2">
            <Button variant="outline" onClick={() => onEdit(client)}>
              <Edit className="w-4 h-4 mr-2" /> Edit
            </Button>
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => onDelete(client)}
            >
              <Trash2 className="w-4 h-4 mr-2" /> Delete
            </Button>
          </div>
        )}
      </aside>
    </div>
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
        <p className="text-sm text-muted-foreground">No contacts yet.</p>
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

// ─── Activity tab (notes / calls / meetings / emails) ────────────────────────

const ActivityTab: React.FC<{
  clientId: string;
  organizationId: string;
  userId: string | undefined;
  userName: string | undefined;
  canManage: boolean;
  notes: ClientNote[];
  onChanged: () => Promise<void> | void;
}> = ({ clientId, organizationId, userId, userName, canManage, notes, onChanged }) => {
  const [kind, setKind] = useState<ClientNoteKind>('note');
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

      {notes.length === 0 && (
        <p className="text-sm text-muted-foreground">No activity logged yet.</p>
      )}

      <ul className="space-y-2">
        {notes.map((n) => {
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
          PDF, image, doc/spreadsheet, csv, or zip — up to 10 MB.
        </p>
      </div>

      {attachments.length === 0 && (
        <p className="text-sm text-muted-foreground">No files yet.</p>
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
