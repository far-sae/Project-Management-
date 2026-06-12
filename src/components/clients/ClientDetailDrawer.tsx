import React, { useEffect, useMemo, useRef, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import {
  Building2, X, Star, Plus,
  FileText, Trash2, Loader2, Paperclip, ExternalLink, MessageSquare,
  Calendar as CalendarIcon, Mailbox, Edit,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
import { DealFormDialog } from '@/components/deals/DealFormDialog';
import { CustomItemDialog } from '@/components/deals/CustomItemDialog';
import { DealStagePicker } from '@/components/deals/DealStagePicker';
import { useDeals } from '@/hooks/useDeals';
import { AccountStageHistoryCard } from '@/components/clients/AccountStageHistoryCard';
import {
  listAccountStageHistory, type DealStageHistoryEntry,
} from '@/services/supabase/dealRelations';
import { useOrganization } from '@/context/OrganizationContext';
import { usePipelines } from '@/hooks/usePipelines';
import {
  listActivities, filterByEntity, dealTimelineActivities, type Activity,
} from '@/services/supabase/activities';
import { ActivitiesTimeline } from '@/components/activities/ActivitiesTimeline';
import {
  getOrganizationDeals, DEAL_STAGES, type Deal,
} from '@/services/supabase/deals';
import { type PipelineStage } from '@/services/supabase/pipelines';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { useOrgCurrency } from '@/hooks/useOrgCurrency';
import { convertAmount, useFxRates } from '@/lib/fxRates';
import {
  SendEmailDialog, type SendEmailRecipient,
} from '@/components/activities/SendEmailDialog';
import { EntityEmailsSection } from '@/components/activities/EntityEmailsSection';
import { CreateMeetingDialog } from '@/components/activities/CreateMeetingDialog';
import { listMeetings, deleteMeeting, type Meeting } from '@/services/supabase/meetings';
import { InvoicesPanel } from './InvoicesPanel';
import { toast } from 'sonner';

type MainTab = 'activity' | 'notes' | 'pipeline' | 'emails' | 'meetings' | 'files' | 'invoices';

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
  const { remove: removeDeal } = useDeals();
  const formatMoney = useFormatMoney();
  const orgCurrency = useOrgCurrency();
  // Account (client) write access isn't a grant module — there is no
  // canEditModule('crm'). It's governed by canManage (owner/admin/manager),
  // same as the Edit/Delete controls. Deals/Leads sub-features still use
  // their own grant modules below.
  const canEdit = canManage;
  const [tab, setTab] = useState<MainTab>('activity');
  const { defaultPipeline, stagesByPipeline } = usePipelines();

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

  // Right-rail: this account's deals + Activity-tab timeline.
  const [deals, setDeals] = useState<Deal[]>([]);
  const [clientActivities, setClientActivities] = useState<Activity[]>([]);
  // Deal stage-change trail across this account's deals — folded into the
  // Activity timeline (and shown raw in the Pipeline tab).
  const [stageHistory, setStageHistory] = useState<DealStageHistoryEntry[]>([]);
  const [openCreateDeal, setOpenCreateDeal] = useState(false);
  // Standard-deal edit (DealFormDialog in edit mode), opened from a rail row's
  // Edit action.
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  // Custom-item create / edit. `editingCustomItem` holds the custom deal being
  // edited (clicking a custom row opens the dialog in edit mode).
  const [openCustomItem, setOpenCustomItem] = useState(false);
  const [editingCustomItem, setEditingCustomItem] = useState<Deal | null>(null);
  // Bumped after a deal is added or its stage changes so the rail re-queries.
  const [dealsRefresh, setDealsRefresh] = useState(0);
  // Rail delete: which deal is pending a confirm, and whether a delete is
  // in flight.
  const [deletingDeal, setDeletingDeal] = useState<Deal | null>(null);
  const [dealDeleteBusy, setDealDeleteBusy] = useState(false);

  const handleDeleteDeal = async () => {
    if (!deletingDeal) return;
    setDealDeleteBusy(true);
    try {
      await removeDeal(deletingDeal.dealId);
      toast.success(`Deleted "${deletingDeal.title}"`);
      setDeletingDeal(null);
      setDealsRefresh((k) => k + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete');
    } finally {
      setDealDeleteBusy(false);
    }
  };

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

  // Right-rail deals — filtered to this account. Re-queries when a deal is
  // added (openCreateDeal toggles) or its stage changes (dealsRefresh bumps).
  useEffect(() => {
    if (!client || !organizationId) return;
    let cancelled = false;
    getOrganizationDeals(organizationId)
      .then((all) => {
        if (!cancelled) setDeals(all.filter((d) => d.clientId === client.clientId));
      })
      .catch(() => {/* non-blocking */});
    return () => { cancelled = true; };
  }, [client?.clientId, organizationId, openCreateDeal, dealsRefresh]);

  // Activity timeline base — the record's notes/emails/calls/meetings/pm-tasks.
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

  // Deal stage history for this account — re-queries when a deal is added or
  // its stage changes (dealsRefresh), so new pipeline activity shows up.
  useEffect(() => {
    if (!client || !organizationId) return;
    let cancelled = false;
    listAccountStageHistory(organizationId, client.clientId)
      .then((rows) => { if (!cancelled) setStageHistory(rows); })
      .catch(() => {/* non-blocking */});
    return () => { cancelled = true; };
  }, [client?.clientId, organizationId, dealsRefresh]);

  // The Activity tab feed = base activities + the account's deal lifecycle
  // (deal added + stage moves), newest first. Deals weren't surfacing in the
  // timeline before, so a fresh account with only a deal read as "no activity".
  const timelineActivities = useMemo(() => {
    const stageLabel = (key: string | null) =>
      DEAL_STAGES.find((s) => s.id === key)?.label ?? key ?? '(new)';
    const dealEvents = dealTimelineActivities(deals, stageHistory, { formatMoney, stageLabel });
    return [...clientActivities, ...dealEvents].sort(
      (a, b) => (b.whenAt?.getTime() ?? -Infinity) - (a.whenAt?.getTime() ?? -Infinity),
    );
  }, [clientActivities, deals, stageHistory, formatMoney]);

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
                  { v: 'activity', label: 'Activity' },
                  { v: 'notes', label: 'Notes' },
                  { v: 'pipeline', label: 'Pipeline' },
                  { v: 'emails', label: 'Emails' },
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
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Activity timeline
                  </h3>
                  <ActivitiesTimeline activities={timelineActivities} />
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

              {tab === 'pipeline' && (
                <div className="space-y-5">
                  <PipelineDealsList
                    deals={deals}
                    stagesByPipeline={stagesByPipeline}
                    defaultPipelineId={defaultPipeline?.pipelineId ?? null}
                  />
                  <AccountStageHistoryCard
                    organizationId={organizationId}
                    clientId={client.clientId}
                    currency={deals[0]?.currency ?? orgCurrency}
                  />
                </div>
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
            </div>
          </section>

          {/* ── RIGHT: interactive pipeline (deals) ─────────────────────── */}
          <aside className="border-l border-border bg-card/40 overflow-y-auto p-4 space-y-4">
            <DealsCard
              deals={deals}
              canCreate={canManage && canEditModule('deals')}
              canChangeStage={canManage && canEditModule('deals')}
              stagesByPipeline={stagesByPipeline}
              defaultPipelineId={defaultPipeline?.pipelineId ?? null}
              onNewDeal={() => setOpenCreateDeal(true)}
              onNewCustomItem={() => { setEditingCustomItem(null); setOpenCustomItem(true); }}
              onEditCustomItem={(d) => { setEditingCustomItem(d); setOpenCustomItem(true); }}
              onEditDeal={(d) => setEditingDeal(d)}
              onDeleteDeal={(d) => setDeletingDeal(d)}
              onStageChanged={() => setDealsRefresh((k) => k + 1)}
            />
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

      {/* Custom item (create / edit) scoped to this account. */}
      <CustomItemDialog
        open={openCustomItem}
        onOpenChange={(o) => {
          setOpenCustomItem(o);
          if (!o) { setEditingCustomItem(null); setDealsRefresh((k) => k + 1); }
        }}
        clientId={client.clientId}
        deal={editingCustomItem}
      />

      {/* Edit a standard deal from the rail (DealFormDialog in edit mode). */}
      <DealFormDialog
        open={!!editingDeal}
        onOpenChange={(o) => {
          if (!o) { setEditingDeal(null); setDealsRefresh((k) => k + 1); }
        }}
        deal={editingDeal}
        clients={[client]}
        contacts={contacts}
        defaultClientId={client.clientId}
      />

      {/* Confirm deal/custom-item delete from the rail. */}
      <AlertDialog
        open={!!deletingDeal}
        onOpenChange={(o) => { if (!o && !dealDeleteBusy) setDeletingDeal(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this item?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes <strong>{deletingDeal?.title}</strong> from
              the pipeline. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={dealDeleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteDeal}
              disabled={dealDeleteBusy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {dealDeleteBusy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <Trash2 className="w-4 h-4 mr-1" /> Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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

// ─── Right rail: interactive pipeline (deals) ────────────────────────────────

const DealsCard: React.FC<{
  deals: Deal[];
  canCreate: boolean;
  canChangeStage: boolean;
  stagesByPipeline: Record<string, PipelineStage[]>;
  defaultPipelineId: string | null;
  onNewDeal: () => void;
  onNewCustomItem: () => void;
  onEditCustomItem: (d: Deal) => void;
  onEditDeal: (d: Deal) => void;
  onDeleteDeal: (d: Deal) => void;
  onStageChanged: () => void;
}> = ({
  deals, canCreate, canChangeStage, stagesByPipeline, defaultPipelineId,
  onNewDeal, onNewCustomItem, onEditCustomItem, onEditDeal, onDeleteDeal,
  onStageChanged,
}) => {
  const formatMoney = useFormatMoney();
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Pipeline
          {deals.length > 0 && (
            <span className="ml-1 text-muted-foreground normal-case">({deals.length})</span>
          )}
        </h3>
      </div>
      {canCreate && (
        <div className="flex items-center gap-1 mb-2">
          <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={onNewDeal}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Pipeline deal
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={onNewCustomItem}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Custom item
          </Button>
        </div>
      )}

      {deals.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No deals for this account yet.{canCreate ? ' Use “Pipeline deal” or “Custom item” to start tracking.' : ''}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {deals.map((d) => {
            const stages = stagesByPipeline[d.pipelineId]
              ?? (defaultPipelineId ? stagesByPipeline[defaultPipelineId] : undefined);
            const isCustom = d.dealType === 'custom';
            return (
              <li
                key={d.dealId}
                className="rounded-md border p-2.5 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium truncate inline-flex items-center gap-1.5">
                    {d.title}
                    {isCustom && (
                      <Badge variant="secondary" className="text-[9px] px-1 py-0 shrink-0">Custom</Badge>
                    )}
                  </span>
                  <span className="text-sm font-semibold shrink-0">
                    {formatMoney(d.value, d.currency)}
                  </span>
                </div>
                {/* Standard deals keep the stage control; custom items show
                    only their value (above) — no stage control. */}
                {!isCustom && (
                  canChangeStage ? (
                    <DealStagePicker deal={d} stages={stages} onChanged={onStageChanged} />
                  ) : (
                    <Badge variant="outline" className="text-[10px]">
                      {stages?.find((s) => s.key === d.stage)?.label ?? d.stage}
                    </Badge>
                  )
                )}
                {canChangeStage && (
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm" variant="ghost"
                      className="h-7 text-xs px-2"
                      onClick={() => (isCustom ? onEditCustomItem(d) : onEditDeal(d))}
                    >
                      <Edit className="w-3.5 h-3.5 mr-1" /> Edit
                    </Button>
                    <Button
                      size="sm" variant="ghost"
                      className="h-7 text-xs px-2 text-destructive hover:text-destructive"
                      onClick={() => onDeleteDeal(d)}
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

// ─── Pipeline tab: deals + total (above the Stage History) ──────────────────

/** Lists the record's deals (incl. custom items) with their stage + value,
 *  plus a total row. Rendered above the cross-deal Stage History in the
 *  Pipeline tab so reps see the money before the stage trail. */
const PipelineDealsList: React.FC<{
  deals: Deal[];
  stagesByPipeline: Record<string, PipelineStage[]>;
  defaultPipelineId: string | null;
}> = ({ deals, stagesByPipeline, defaultPipelineId }) => {
  const formatMoney = useFormatMoney();
  const orgCurrency = useOrgCurrency();
  const { rates } = useFxRates();

  const total = useMemo(
    () => deals.reduce((sum, d) => sum + convertAmount(d.value, d.currency, orgCurrency, rates), 0),
    [deals, orgCurrency, rates],
  );

  const stageLabel = (d: Deal) => {
    const stages = stagesByPipeline[d.pipelineId]
      ?? (defaultPipelineId ? stagesByPipeline[defaultPipelineId] : undefined);
    return stages?.find((s) => s.key === d.stage)?.label ?? d.stage;
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold inline-flex items-center gap-1.5">
          Deals
          <span className="text-xs text-muted-foreground font-normal">{deals.length}</span>
        </h3>
      </div>

      {deals.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          No deals for this account yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {deals.map((d) => (
            <li
              key={d.dealId}
              className="flex items-center justify-between gap-2 rounded-md border p-2.5"
            >
              <div className="min-w-0 flex items-center gap-1.5">
                <span className="text-sm font-medium truncate">{d.title}</span>
                {d.dealType === 'custom' && (
                  <Badge variant="secondary" className="text-[9px] px-1 py-0 shrink-0">Custom</Badge>
                )}
                <Badge variant="outline" className="text-[10px] shrink-0">{stageLabel(d)}</Badge>
              </div>
              <span className="text-sm font-semibold shrink-0 tabular-nums">
                {formatMoney(d.value, d.currency)}
              </span>
            </li>
          ))}
          <li className="flex items-center justify-between gap-2 pt-1.5 mt-1 border-t">
            <span className="text-sm font-semibold">Total</span>
            <span className="text-sm font-bold tabular-nums">
              {formatMoney(total, orgCurrency)}
            </span>
          </li>
        </ul>
      )}
    </section>
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
  const [editing, setEditing] = useState<Meeting | null>(null);

  const reload = async () => {
    const all = await listMeetings(organizationId);
    setMeetings(all.filter((m) => m.clientId === client.clientId));
  };

  const handleDelete = async (m: Meeting) => {
    if (!confirm(`Delete meeting "${m.title}"?`)) return;
    try {
      await deleteMeeting(m.meetingId, organizationId);
      await reload();
      toast.success('Meeting deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete meeting');
    }
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
          <div className="flex items-center gap-3 mt-2">
            {m.googleMeetLink && (
              <a
                href={m.googleMeetLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline inline-flex items-center gap-1"
              >
                <ExternalLink className="w-3 h-3" /> Join
              </a>
            )}
            {canManage && (
              <>
                <button
                  type="button"
                  onClick={() => setEditing(m)}
                  className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                >
                  <Edit className="w-3 h-3" /> Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(m)}
                  className="text-xs text-destructive hover:text-destructive/80 inline-flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
              </>
            )}
          </div>
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
        open={openSchedule || !!editing}
        onOpenChange={(o) => { setOpenSchedule(o); if (!o) setEditing(null); }}
        editMeeting={editing}
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
