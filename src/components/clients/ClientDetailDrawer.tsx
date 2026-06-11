import React, { useEffect, useMemo, useRef, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import {
  Building2, X, Star, Plus,
  FileText, Trash2, Loader2, Paperclip, ExternalLink, MessageSquare,
  Calendar as CalendarIcon, Mailbox, Edit,
  ChevronDown, ChevronRight, Tag, UserPlus, ArrowRight,
  Upload, Download,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/context/AuthContext';
import { useEmailEnabled } from '@/hooks/useEmailEnabled';
import {
  Client,
  ClientAttachment,
  ClientContact,
  ClientNote,
  createNote,
  deleteAttachment,
  deleteNote,
  formatRevenue,
  getClientAttachments,
  getClientContacts,
  getClientNotes,
  uploadClientAttachment,
} from '@/services/supabase/clients';
import { ScoreBadge } from '@/components/clients/ScoreBadge';
import { InlineField } from '@/components/leads/InlineField';
import {
  addLeadCategory as addLeadCategorySvc,
  removeLeadCategory as removeLeadCategorySvc,
} from '@/services/supabase/clients';
import {
  Lead, CreateLeadInput,
  leadDisplayName, leadStatusLabel,
  listAccountLeads, createLead as createLeadSvc, updateLead as updateLeadSvc,
  exportLeadsToCsv, type ImportLeadsResult,
} from '@/services/supabase/leads';
import { LeadFormDialog } from '@/components/leads/LeadFormDialog';
import { ImportLeadsDialog } from '@/components/leads/ImportLeadsDialog';
import { LeadDetailDrawer } from '@/components/leads/LeadDetailDrawer';
import { recordAuditEvent } from '@/services/supabase/auditLog';
import { DealFormDialog } from '@/components/deals/DealFormDialog';
import { useOrganization } from '@/context/OrganizationContext';
import {
  listActivities, filterByEntity, type Activity,
} from '@/services/supabase/activities';
import { ActivitiesTimeline } from '@/components/activities/ActivitiesTimeline';
import {
  getOrganizationDeals, DEAL_STAGES, type Deal, type DealStage,
} from '@/services/supabase/deals';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import {
  SendEmailDialog, type SendEmailRecipient,
} from '@/components/activities/SendEmailDialog';
import { EntityEmailsSection } from '@/components/activities/EntityEmailsSection';
import { CreateMeetingDialog } from '@/components/activities/CreateMeetingDialog';
import { listMeetings, type Meeting } from '@/services/supabase/meetings';
import { InvoicesPanel } from './InvoicesPanel';
import { toast } from 'sonner';

type MainTab = 'notes' | 'emails' | 'meetings' | 'files' | 'invoices' | 'leads';

interface Props {
  client: Client | null;
  organizationId: string | null;
  canManage: boolean;
  onClose: () => void;
  onEdit: (client: Client) => void;
  onDelete: (client: Client) => void;
  /** Persist a partial update to the account and return the saved Client.
   *  Wired in Clients.tsx → updateClient(orgId, clientId, patch). When
   *  omitted the left fields render read-only. */
  onUpdate?: (clientId: string, patch: Partial<Client>) => Promise<Client>;
}

export const ClientDetailDrawer: React.FC<Props> = ({
  client: clientProp, organizationId, canManage, onClose, onEdit, onDelete,
  onUpdate,
}) => {
  const { user } = useAuth();
  const emailEnabled = useEmailEnabled();
  const { canEditModule } = useOrganization();
  // Account (client) write access isn't a grant module — there is no
  // canEditModule('crm'). It's governed by canManage (owner/admin/manager),
  // same as the Edit/Delete controls. Deals/Leads sub-features still use
  // their own grant modules below.
  const canEdit = canManage;
  const [tab, setTab] = useState<MainTab>('notes');

  // Local merged copy of the account so inline edits reflect immediately
  // without waiting for the parent to re-query (mirrors LeadDetailDrawer).
  const [client, setClient] = useState<Client | null>(clientProp);
  useEffect(() => { setClient(clientProp); }, [clientProp]);

  const [contacts, setContacts] = useState<ClientContact[]>([]);
  const [notes, setNotes] = useState<ClientNote[]>([]);
  const [attachments, setAttachments] = useState<ClientAttachment[]>([]);
  const [loading, setLoading] = useState(false);

  /** Persist one inline-field patch and merge the returned account into
   *  local state so the panel updates without a round-trip. */
  const handleInlineUpdate = async (
    clientId: string,
    patch: Partial<Client>,
  ): Promise<void> => {
    if (!onUpdate) return;
    const updated = await onUpdate(clientId, patch);
    setClient(updated);
  };

  // Right-rail: this account's deals + read-only activity timeline.
  const [deals, setDeals] = useState<Deal[]>([]);
  const [clientActivities, setClientActivities] = useState<Activity[]>([]);
  const [openCreateDeal, setOpenCreateDeal] = useState(false);

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

  // Right-rail deals — filtered to this account.
  useEffect(() => {
    if (!client || !organizationId) return;
    let cancelled = false;
    getOrganizationDeals(organizationId)
      .then((all) => {
        if (!cancelled) setDeals(all.filter((d) => d.clientId === client.clientId));
      })
      .catch(() => {/* non-blocking */});
    return () => { cancelled = true; };
  }, [client?.clientId, organizationId, openCreateDeal]);

  // Right-rail activity timeline — the record's notes/emails/calls/meetings.
  useEffect(() => {
    if (!client || !organizationId) return;
    let cancelled = false;
    listActivities(organizationId, { openDealIds: new Set(), customerClientIds: new Set() })
      .then((all) => {
        if (!cancelled) setClientActivities(filterByEntity(all, 'client', client.clientId));
      })
      .catch(() => {/* non-blocking */});
    return () => { cancelled = true; };
  }, [client?.clientId, organizationId]);

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
  }, [client]);

  if (!client || !organizationId) return null;

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden
      />

      {/* Wide modal — HubSpot-style 3-column record view. 95vw on desktop,
          full-screen on mobile. */}
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
          {/* ── LEFT: identity + about (inline-editable) ───────────────── */}
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

            <div className="border-t border-border pt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                About this company
              </h3>
              <AboutCompany
                client={client}
                fullAddress={fullAddress}
                editable={canEdit}
                onSave={handleInlineUpdate}
              />
            </div>
          </aside>

          {/* ── MIDDLE: tabbed activity ─────────────────────────────────── */}
          <section className="flex flex-col overflow-hidden">
            <Tabs value={tab} onValueChange={(v) => setTab(v as MainTab)} className="px-4 pt-3">
              <TabsList className="bg-transparent border-b border-border rounded-none w-full justify-start gap-1 h-auto p-0">
                {([
                  { v: 'notes', label: 'Notes' },
                  { v: 'emails', label: 'Emails' },
                  { v: 'meetings', label: 'Meetings' },
                  { v: 'files', label: 'Files' },
                  { v: 'invoices', label: 'Invoices' },
                  { v: 'leads', label: 'Leads' },
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

              {tab === 'notes' && (
                <NotesTab
                  clientId={client.clientId}
                  organizationId={organizationId}
                  userId={user?.userId}
                  userName={user?.displayName}
                  canManage={canManage}
                  notes={notes}
                  onChanged={reloadNotes}
                />
              )}

              {tab === 'emails' && (
                <EmailsTab
                  client={client}
                  organizationId={organizationId}
                  emailEnabled={emailEnabled}
                />
              )}

              {tab === 'meetings' && (
                <MeetingsTab
                  client={client}
                  organizationId={organizationId}
                  userId={user?.userId}
                  userName={user?.displayName}
                  canManage={canManage}
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

              {tab === 'leads' && (
                <LeadsTab
                  account={client}
                  organizationId={organizationId}
                  contacts={contacts}
                  canManage={canManage}
                  canEditLeads={canEditModule('leads')}
                />
              )}
            </div>
          </section>

          {/* ── RIGHT: deals + activity timeline ────────────────────────── */}
          <aside className="border-l border-border bg-card/40 overflow-y-auto p-4 space-y-4">
            <DealsCard
              deals={deals}
              canCreate={canManage && canEditModule('deals')}
              onNewDeal={() => setOpenCreateDeal(true)}
            />

            <div className="border-t pt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Activity timeline
              </h3>
              <ActivitiesTimeline activities={clientActivities} />
            </div>
          </aside>
        </div>
      </aside>

      {/* New deal scoped to this account. */}
      <DealFormDialog
        open={openCreateDeal}
        onOpenChange={setOpenCreateDeal}
        clients={[client]}
        contacts={contacts}
        defaultClientId={client.clientId}
      />
    </div>
  );
};

// ─── Left: About this company (inline-editable) ──────────────────────────────

/** Make a user-entered website safe to link to. */
const toExternalUrl = (raw: string | null | undefined): string | undefined => {
  const v = raw?.trim();
  if (!v) return undefined;
  return /^(https?:|mailto:|tel:)/i.test(v) ? v : `https://${v}`;
};

const AboutCompany: React.FC<{
  client: Client;
  fullAddress: string;
  editable: boolean;
  onSave: (clientId: string, patch: Partial<Client>) => Promise<void>;
}> = ({ client, fullAddress, editable, onSave }) => {
  const save = (patch: Partial<Client>) => onSave(client.clientId, patch);
  return (
    <div className="space-y-3 text-sm">
      <InlineField
        label="Email"
        value={client.email}
        type="text"
        editable={editable}
        onSave={(v) => save({ email: v as string | null })}
        render={(v) => v
          ? <a href={`mailto:${v}`} className="text-primary hover:underline break-all">{String(v)}</a>
          : null}
      />
      <InlineField
        label="Phone"
        value={client.phone}
        type="text"
        editable={editable}
        onSave={(v) => save({ phone: v as string | null })}
        render={(v) => v ? <a href={`tel:${v}`} className="hover:underline">{String(v)}</a> : null}
      />
      <InlineField
        label="Website"
        value={client.website}
        type="text"
        editable={editable}
        onSave={(v) => save({ website: v as string | null })}
        render={(v) => {
          const url = toExternalUrl(v as string | null | undefined);
          return v && url ? (
            <a href={url} target="_blank" rel="noopener noreferrer"
               className="text-primary hover:underline inline-flex items-center gap-1 break-all">
              {String(v)} <ExternalLink className="w-3 h-3" />
            </a>
          ) : null;
        }}
      />
      <InlineField
        label="Owner"
        value={client.accountOwnerName}
        type="text"
        editable={editable}
        onSave={(v) => save({ accountOwnerName: v as string | null })}
      />
      <InlineField
        label="Address"
        value={client.addressLine1}
        type="text"
        editable={editable}
        onSave={(v) => save({ addressLine1: v as string | null })}
        render={() => fullAddress
          ? <span className="break-words">{fullAddress}</span>
          : null}
      />
      <InlineField
        label="City"
        value={client.city}
        type="text"
        editable={editable}
        onSave={(v) => save({ city: v as string | null })}
      />
      <InlineField
        label="State"
        value={client.state}
        type="text"
        editable={editable}
        onSave={(v) => save({ state: v as string | null })}
      />
      <InlineField
        label="Postal code"
        value={client.postalCode}
        type="text"
        editable={editable}
        onSave={(v) => save({ postalCode: v as string | null })}
      />
      <InlineField
        label="Country"
        value={client.country}
        type="text"
        editable={editable}
        onSave={(v) => save({ country: v as string | null })}
      />
      <InlineField
        label="Annual revenue"
        value={client.annualRevenue}
        type="number"
        editable={editable}
        onSave={(v) => save({ annualRevenue: v as number | null })}
        render={(v) => v != null ? <span>{formatRevenue(Number(v))}</span> : null}
      />
      <InlineField
        label="Employees"
        value={client.employeeCount}
        type="number"
        editable={editable}
        onSave={(v) => save({ employeeCount: v as number | null })}
      />
      <InlineField
        label="Source"
        value={client.source}
        type="text"
        editable={editable}
        onSave={(v) => save({ source: v as string | null })}
      />
      <InlineField
        label="Industry"
        value={client.industry}
        type="text"
        editable={editable}
        onSave={(v) => save({ industry: v as string | null })}
      />
      <InlineField
        label="Description"
        value={client.description}
        type="textarea"
        editable={editable}
        onSave={(v) => save({ description: v as string | null })}
        render={(v) => v ? <span className="whitespace-pre-wrap break-words">{String(v)}</span> : null}
      />
      <div className="grid grid-cols-[140px_1fr] items-baseline gap-2">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground text-right">
          Created
        </span>
        <span className="text-foreground">{format(client.createdAt, 'PP')}</span>
      </div>

      {client.tags && client.tags.length > 0 && (
        <div className="pt-1">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Tags
          </p>
          <div className="flex flex-wrap gap-1.5">
            {client.tags.map((t) => (
              <Badge key={t} variant="secondary">{t}</Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Right rail: Deals card ──────────────────────────────────────────────────

const STAGE_LABEL: Record<DealStage, string> = DEAL_STAGES.reduce(
  (acc, s) => { acc[s.id] = s.label; return acc; },
  {} as Record<DealStage, string>,
);

const DealsCard: React.FC<{
  deals: Deal[];
  canCreate: boolean;
  onNewDeal: () => void;
}> = ({ deals, canCreate, onNewDeal }) => {
  const formatMoney = useFormatMoney();
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Deals
          {deals.length > 0 && (
            <span className="ml-1 text-muted-foreground normal-case">({deals.length})</span>
          )}
        </h3>
        {canCreate && (
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onNewDeal}>
            <Plus className="w-3.5 h-3.5 mr-1" /> New deal
          </Button>
        )}
      </div>

      {deals.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No deals for this account yet.{canCreate ? ' Use “New deal” to start tracking an opportunity.' : ''}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {deals.map((d) => (
            <li key={d.dealId} className="rounded-md border p-2.5">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium truncate">{d.title}</span>
                <span className="text-sm font-semibold shrink-0">
                  {formatMoney(d.value, d.currency)}
                </span>
              </div>
              <Badge variant="outline" className="mt-1 text-[10px]">
                {STAGE_LABEL[d.stage] ?? d.stage}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ─── Notes tab ───────────────────────────────────────────────────────────────

const NotesTab: React.FC<{
  clientId: string;
  organizationId: string;
  userId: string | undefined;
  userName: string | undefined;
  canManage: boolean;
  notes: ClientNote[];
  onChanged: () => Promise<void> | void;
}> = ({ clientId, organizationId, userId, userName, canManage, notes, onChanged }) => {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!userId || !userName) return;
    if (!subject.trim() && !body.trim()) {
      toast.error('Write something to add');
      return;
    }
    setSubmitting(true);
    try {
      await createNote(organizationId, clientId, userId, userName, {
        kind: 'note',
        subject: subject.trim() || null,
        body: body.trim() || null,
        occurredAt: new Date(),
      });
      setSubject('');
      setBody('');
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add note');
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (n: ClientNote) => {
    if (!confirm('Delete this note?')) return;
    try {
      await deleteNote(organizationId, n.noteId);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const canDelete = (n: ClientNote) => canManage || n.authorId === userId;
  const visibleNotes = useMemo(() => notes.filter((n) => n.kind === 'note'), [notes]);

  return (
    <div className="space-y-3">
      {userId && (
        <div className="border rounded-md p-3 space-y-2 bg-secondary/30">
          <Input
            placeholder="Add a title (optional)" maxLength={200}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
          <Textarea
            placeholder="Add a note…" rows={3} maxLength={5000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Add note
            </Button>
          </div>
        </div>
      )}

      {visibleNotes.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No notes yet. Capture context, decisions, or reminders so everyone on the account stays aligned.
        </p>
      )}

      <ul className="space-y-2">
        {visibleNotes.map((n) => (
          <li key={n.noteId} className="rounded-md border p-3">
            <div className="flex items-start gap-2">
              <MessageSquare className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                {n.subject && (
                  <p className="font-medium text-sm">{n.subject}</p>
                )}
                {n.body && (
                  <p className="text-sm whitespace-pre-wrap mt-0.5">{n.body}</p>
                )}
                <p className="text-[11px] text-muted-foreground mt-1">
                  {n.authorName ?? 'Someone'} · {formatDistanceToNow(n.occurredAt, { addSuffix: true })}
                </p>
              </div>
              {canDelete(n) && (
                <Button
                  size="icon" variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Delete note"
                  onClick={() => remove(n)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

// ─── Emails tab ──────────────────────────────────────────────────────────────

const EmailsTab: React.FC<{
  client: Client;
  organizationId: string;
  emailEnabled: boolean;
}> = ({ client, organizationId, emailEnabled }) => {
  const [openEmail, setOpenEmail] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  if (!emailEnabled) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Email sending is available once Gmail is verified.
        </p>
        <EntityEmailsSection
          organizationId={organizationId}
          entityType="client"
          entityId={client.clientId}
        />
      </div>
    );
  }

  const recipient: SendEmailRecipient = {
    entityType: 'client',
    entityId: client.clientId,
    name: client.name,
    email: client.email ?? null,
    legalName: client.legalName ?? null,
    industry: client.industry ?? null,
    country: client.country ?? null,
    accountOwnerName: client.accountOwnerName ?? null,
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Send an email to {client.email ? client.email : 'this account'} and track replies here.
        </p>
        <Button
          size="sm"
          onClick={() => {
            if (!client.email) {
              toast.error('This account has no email on file. Add one in About this company.');
              return;
            }
            setOpenEmail(true);
          }}
        >
          <Mailbox className="w-4 h-4 mr-1" /> Send email
        </Button>
      </div>

      <EntityEmailsSection
        organizationId={organizationId}
        entityType="client"
        entityId={client.clientId}
        refreshKey={refreshKey}
      />

      <SendEmailDialog
        open={openEmail}
        onOpenChange={setOpenEmail}
        recipient={recipient}
        onSent={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
};

// ─── Meetings tab ────────────────────────────────────────────────────────────

const MeetingsTab: React.FC<{
  client: Client;
  organizationId: string;
  userId: string | undefined;
  userName: string | undefined;
  canManage: boolean;
}> = ({ client, organizationId, canManage }) => {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [openSchedule, setOpenSchedule] = useState(false);

  const reload = async () => {
    const all = await listMeetings(organizationId);
    setMeetings(all.filter((m) => m.clientId === client.clientId));
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listMeetings(organizationId)
      .then((all) => {
        if (!cancelled) setMeetings(all.filter((m) => m.clientId === client.clientId));
      })
      .catch(() => {/* non-blocking */})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [organizationId, client.clientId]);

  const now = Date.now();
  const upcoming = meetings.filter((m) => m.startAt.getTime() >= now);
  const past = meetings.filter((m) => m.startAt.getTime() < now);

  const renderMeeting = (m: Meeting) => (
    <li key={m.meetingId} className="rounded-md border p-3">
      <div className="flex items-start gap-2">
        <CalendarIcon className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm">{m.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {m.allDay
              ? `${format(m.startAt, 'PP')} · All day`
              : `${format(m.startAt, 'PPp')} – ${format(m.endAt, 'p')}`}
          </p>
          {m.participants.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              {m.participants.map((p) => p.name).join(', ')}
            </p>
          )}
        </div>
      </div>
    </li>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Schedule and review meetings for this account.
        </p>
        {canManage && (
          <Button size="sm" onClick={() => setOpenSchedule(true)}>
            <Plus className="w-4 h-4 mr-1" /> Schedule meeting
          </Button>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading meetings…
        </div>
      )}

      {!loading && meetings.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No meetings yet. Use “Schedule meeting” to book the first one.
        </p>
      )}

      {upcoming.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-primary mb-1.5">Upcoming</h4>
          <ul className="space-y-2">{upcoming.map(renderMeeting)}</ul>
        </div>
      )}

      {past.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Past</h4>
          <ul className="space-y-2">{past.map(renderMeeting)}</ul>
        </div>
      )}

      <CreateMeetingDialog
        open={openSchedule}
        onOpenChange={setOpenSchedule}
        defaultRelatedTo={{
          type: 'client',
          id: client.clientId,
          label: client.name,
          clientId: client.clientId,
        }}
        onCreated={reload}
      />
    </div>
  );
};

// ─── Files tab ───────────────────────────────────────────────────────────────

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

// ─── Leads tab (account-scoped leads grouped by category) ─────────────────────

const LeadsTab: React.FC<{
  account: Client;
  organizationId: string;
  contacts: ClientContact[];
  canManage: boolean;
  canEditLeads: boolean;
}> = ({ account, organizationId, contacts, canManage, canEditLeads }) => {
  const { user } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  // The account's own category list (read-modify-write target). Seeded from the
  // account record and kept in local state so add/remove reflect immediately.
  const [categories, setCategories] = useState<string[]>(account.leadCategories ?? []);
  const [openCategories, setOpenCategories] = useState<Set<string>>(() => new Set());
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);

  // Lead create dialog: which category the new lead lands in (null = no
  // pre-selected category, e.g. the toolbar's "Add single lead").
  const [createCategory, setCreateCategory] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  // Import-leads dialog (scoped to this account).
  const [importOpen, setImportOpen] = useState(false);
  // Lead detail drawer (opened from a row).
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  // Promote-to-deal dialog state.
  const [promoteLead, setPromoteLead] = useState<Lead | null>(null);

  const canEdit = canManage && canEditLeads;

  const reload = async () => {
    setLeads(await listAccountLeads(organizationId, account.clientId));
  };

  // Export this account's leads to a CSV download. Re-fetch so the export is
  // current even if a row changed elsewhere since the tab mounted.
  const handleExport = async () => {
    try {
      const rows = await listAccountLeads(organizationId, account.clientId);
      if (rows.length === 0) {
        toast.info('No leads to export for this account yet.');
        return;
      }
      const csv = exportLeadsToCsv(rows);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = account.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'account';
      a.href = url;
      a.download = `leads-${safeName}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${rows.length} lead${rows.length === 1 ? '' : 's'}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    }
  };

  // Lazy-load this account's leads only when the tab mounts.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listAccountLeads(organizationId, account.clientId)
      .then((rows) => { if (!cancelled) setLeads(rows); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [organizationId, account.clientId]);

  // Keep the local category list in sync if the account record refreshes.
  useEffect(() => {
    setCategories(account.leadCategories ?? []);
  }, [account.leadCategories]);

  // Group leads by category.
  const groups = useMemo(() => {
    const byKey = new Map<string, { label: string; leads: Lead[] }>();
    for (const c of categories) {
      byKey.set(c.toLowerCase(), { label: c, leads: [] });
    }
    for (const l of leads) {
      const raw = l.category?.trim();
      if (!raw) continue;
      const k = raw.toLowerCase();
      if (!byKey.has(k)) byKey.set(k, { label: raw, leads: [] });
      byKey.get(k)!.leads.push(l);
    }
    const out = Array.from(byKey.values()).sort((a, b) => a.label.localeCompare(b.label));
    const uncategorized = leads.filter((l) => !l.category?.trim());
    if (uncategorized.length > 0) {
      out.push({ label: 'Uncategorized', leads: uncategorized });
    }
    return out;
  }, [categories, leads]);

  const toggleGroup = (label: string) =>
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  const submitCategory = async () => {
    const name = newCategory.trim();
    if (!name) return;
    setSavingCategory(true);
    try {
      const updated = await addLeadCategorySvc(organizationId, account.clientId, name);
      setCategories(updated.leadCategories ?? []);
      setNewCategory('');
      setAddingCategory(false);
      setOpenCategories((prev) => new Set(prev).add(name));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add category');
    } finally {
      setSavingCategory(false);
    }
  };

  const removeCategory = async (label: string) => {
    if (!confirm(`Remove the "${label}" category from this account? Leads keep their data; they just become uncategorized here.`)) return;
    try {
      const updated = await removeLeadCategorySvc(organizationId, account.clientId, label);
      setCategories(updated.leadCategories ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove category');
    }
  };

  return (
    <div className="space-y-3">
      {/* Toolbar — account-scoped lead actions. No "All workspaces" control
          here: every action operates on THIS account's leads only. */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-muted-foreground">
          Leads grouped by category for this account. Add a category, then add leads under it.
        </p>
        <div className="flex items-center gap-1.5 flex-wrap">
          {canEdit && (
            <>
              <Button size="sm" variant="outline" onClick={() => { setCreateCategory(null); setCreateOpen(true); }}>
                <UserPlus className="w-4 h-4 mr-1" /> Add single lead
              </Button>
              <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="w-4 h-4 mr-1" /> Import leads
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" onClick={handleExport} disabled={leads.length === 0}>
            <Download className="w-4 h-4 mr-1" /> Export leads
          </Button>
          {canEdit && !addingCategory && (
            <Button size="sm" variant="outline" onClick={() => setAddingCategory(true)}>
              <Tag className="w-4 h-4 mr-1" /> Add category
            </Button>
          )}
        </div>
      </div>

      {addingCategory && (
        <div className="flex items-center gap-2 border rounded-md p-2 bg-secondary/30">
          <Input
            autoFocus
            placeholder="Category name (e.g. Enterprise)"
            value={newCategory}
            maxLength={80}
            onChange={(e) => setNewCategory(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitCategory(); }}
          />
          <Button size="sm" onClick={submitCategory} disabled={savingCategory || !newCategory.trim()}>
            {savingCategory && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            Add
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setAddingCategory(false); setNewCategory(''); }}>
            Cancel
          </Button>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading leads…
        </div>
      )}

      {!loading && groups.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No categories or leads yet. {canEdit ? 'Use “Add category” to create your first group, then add leads under it.' : ''}
        </p>
      )}

      <div className="space-y-2">
        {groups.map((g) => {
          const isUncategorized = g.label === 'Uncategorized';
          const open = openCategories.has(g.label);
          return (
            <div key={g.label} className="border rounded-md">
              <div className="flex items-center gap-2 px-3 py-2">
                <button
                  type="button"
                  className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
                  onClick={() => toggleGroup(g.label)}
                >
                  {open ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                  <span className="font-medium truncate">{g.label}</span>
                  <Badge variant="outline" className="ml-1 text-[10px]">{g.leads.length}</Badge>
                </button>
                {canEdit && !isUncategorized && (
                  <>
                    <Button
                      size="sm" variant="ghost"
                      onClick={() => { setCreateCategory(g.label); setCreateOpen(true); }}
                    >
                      <UserPlus className="w-4 h-4 mr-1" /> Add lead
                    </Button>
                    <Button
                      size="icon" variant="ghost"
                      aria-label={`Remove category ${g.label}`}
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => removeCategory(g.label)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </>
                )}
              </div>
              {open && (
                <ul className="border-t divide-y">
                  {g.leads.length === 0 && (
                    <li className="px-3 py-2 text-sm text-muted-foreground">No leads in this category yet.</li>
                  )}
                  {g.leads.map((l) => (
                    <li key={l.leadId} className="px-3 py-2 flex items-center gap-2">
                      <button
                        type="button"
                        className="flex-1 min-w-0 text-left hover:text-primary"
                        onClick={() => setSelectedLead(l)}
                      >
                        <span className="font-medium">{leadDisplayName(l)}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {l.leadNumber} · {leadStatusLabel(l.leadStatus)}
                        </span>
                      </button>
                      {canEdit && (
                        <Button
                          size="sm" variant="outline"
                          onClick={() => setPromoteLead(l)}
                        >
                          <ArrowRight className="w-4 h-4 mr-1" /> Promote to deal
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {/* Add lead — prefilled to this account + the chosen category + workspace. */}
      <LeadFormDialog
        open={createOpen}
        onOpenChange={(o) => { if (!o) { setCreateOpen(false); setCreateCategory(null); } }}
        defaultAccountId={account.clientId}
        defaultCategory={createCategory}
        defaultWorkspaceId={account.workspaceId}
        onSubmit={async (input: CreateLeadInput) => {
          try {
            const created = await createLeadSvc(
              organizationId, user?.userId ?? null, user?.displayName ?? null, input,
            );
            toast.success(`Created lead ${created.leadNumber}`);
            await reload();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to create lead');
            throw err;
          }
        }}
      />

      {/* Import leads — scoped to THIS account: imported rows attach to it
          (accountId set), with HubSpot/Salesforce-style dedupe in the preview. */}
      <ImportLeadsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        organizationId={organizationId}
        workspaceId={account.workspaceId}
        workspaceName={null}
        userId={user?.userId}
        userName={user?.displayName}
        defaultAccountId={account.clientId}
        defaultAccountName={account.name}
        onComplete={(result: ImportLeadsResult) => {
          void recordAuditEvent(
            organizationId,
            { userId: user?.userId ?? null, displayName: user?.displayName ?? null },
            {
              action: result.imported.length > 0 ? 'lead_imported' : 'lead_import_failed',
              targetType: 'lead',
              targetLabel: `${result.imported.length}/${result.imported.length + result.errors.length} lead(s) via CSV → ${account.name}`,
              metadata: {
                imported: result.imported.length,
                errors: result.errors.length,
                coercions: result.coercions.length,
                aborted: result.aborted,
                accountId: account.clientId,
                accountName: account.name,
              },
            },
          );
          if (result.imported.length === 0) {
            toast.error('No leads were imported. Check the row errors above.');
            return;
          }
          void reload();
          if (result.errors.length > 0 || result.coercions.length > 0) {
            toast.warning(
              `Imported ${result.imported.length} of ${result.imported.length + result.errors.length} leads — review the warnings above.`,
            );
          } else {
            toast.success(`Imported ${result.imported.length} lead${result.imported.length === 1 ? '' : 's'} into ${account.name}`);
          }
        }}
      />

      {/* Lead detail drawer — opened from a row inside this account. */}
      {selectedLead && (
        <LeadDetailDrawer
          lead={selectedLead}
          organizationId={organizationId}
          canManage={canManage}
          readOnly={!canEditLeads}
          canConvert={false}
          onClose={() => setSelectedLead(null)}
          onEdit={() => {/* edit handled inline in the drawer */}}
          onDelete={() => {/* deletion lives in the top-level leads flow */}}
          onConvert={() => {/* in-account path is Promote to deal, not convert */}}
          onSendEmail={() => {/* no-op here */}}
          onClone={() => {/* no-op here */}}
          onStatusChange={async (l, next) => {
            const updated = await updateLeadSvc(organizationId, l.leadId, { leadStatus: next });
            setSelectedLead(updated);
            await reload();
          }}
          onUpdate={async (leadId, patch) => {
            const updated = await updateLeadSvc(organizationId, leadId, patch);
            setSelectedLead(updated);
            await reload();
            return updated;
          }}
        />
      )}

      {/* Promote to deal — scoped to THIS account (no new account created). */}
      <DealFormDialog
        open={!!promoteLead}
        onOpenChange={(o) => { if (!o) setPromoteLead(null); }}
        clients={[account]}
        contacts={contacts}
        defaultClientId={account.clientId}
        defaultTitle={promoteLead ? `${leadDisplayName(promoteLead)} — ${promoteLead.company}` : null}
      />
    </div>
  );
};
