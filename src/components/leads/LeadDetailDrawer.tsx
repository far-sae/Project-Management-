import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import {
  X, Edit, Trash2, Loader2, Mail,
  User as UserIcon, MoreVertical, ChevronDown,
  Copy, Printer, FileSearch, RefreshCw, Repeat, FileText,
  CheckCircle2, Plus,
} from 'lucide-react';
import { InlineField } from './InlineField';
import { CustomPropertiesEditor } from './CustomPropertiesEditor';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/context/AuthContext';
import { useEmailEnabled } from '@/hooks/useEmailEnabled';
import {
  Lead, LeadNote, LeadStatus,
  leadDisplayName, leadStatusLabel, LEAD_STATUS_OPTIONS,
  getLeadNotes, createLeadNote, deleteLeadNote,
} from '@/services/supabase/leads';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { EntityAttachmentsSection } from '@/components/activities/EntityAttachmentsSection';
import { EntityEmailsSection } from '@/components/activities/EntityEmailsSection';
import { EnrollAutomationDialog } from '@/components/activities/EnrollAutomationDialog';
import { Zap } from 'lucide-react';
import { useOrganization } from '@/context/OrganizationContext';
import {
  listActivities, filterByEntity, dealTimelineActivities, type Activity,
} from '@/services/supabase/activities';
import { ActivitiesTimeline } from '@/components/activities/ActivitiesTimeline';
import { QuickLogComposer } from '@/components/activities/QuickLogComposer';
import { NextBestAction } from '@/components/activities/NextBestAction';
import {
  getOrganizationDeals, DEAL_STAGES, type Deal,
} from '@/services/supabase/deals';
import {
  listAccountStageHistory, type DealStageHistoryEntry,
} from '@/services/supabase/dealRelations';
import { type PipelineStage } from '@/services/supabase/pipelines';
import { usePipelines } from '@/hooks/usePipelines';
import { getOrganizationClients, type Client } from '@/services/supabase/clients';
import { DealFormDialog } from '@/components/deals/DealFormDialog';
import { CustomItemDialog } from '@/components/deals/CustomItemDialog';
import { DealStagePicker } from '@/components/deals/DealStagePicker';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { useDeals } from '@/hooks/useDeals';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Props {
  lead: Lead | null;
  organizationId: string | null;
  canManage: boolean;
  /** When true, hides/disables all save and delete controls regardless of canManage. */
  readOnly?: boolean;
  /** When false the Convert button is hidden — typically because the
   *  caller is in local-org mode where the convert service isn't supported. */
  canConvert?: boolean;
  onClose: () => void;
  onEdit: (lead: Lead) => void;
  onDelete: (lead: Lead) => void;
  onConvert: (lead: Lead) => void;
  onSendEmail: (lead: Lead) => void;
  onClone: (lead: Lead) => void;
  onStatusChange?: (lead: Lead, next: LeadStatus) => Promise<void> | void;
  /** Patch a lead field (or customFields) and return the updated Lead. */
  onUpdate?: (leadId: string, patch: Partial<Lead>) => Promise<Lead>;
}

// Middle-column tabs — mirrors the account drawer's tabbed layout so leads and
// accounts read the same. A lead has no pipeline/meetings/invoices of its own
// (deals live on its account, shown in the right rail), so the set is trimmed.
type LeadTab = 'activity' | 'notes' | 'emails' | 'files' | 'details';

const STATUS_TONE: Record<LeadStatus, string> = {
  new:                  'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  attempted_to_contact: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  contacted:            'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  contact_in_future:    'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30',
  not_contacted:        'bg-muted text-muted-foreground border-border',
  pre_qualified:        'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  not_qualified:        'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  junk_lead:            'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
  lost_lead:            'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
  converted:            'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
};

export const LeadDetailDrawer: React.FC<Props> = ({
  lead: leadProp, organizationId, canManage, readOnly = false, canConvert = true,
  onClose, onEdit, onDelete, onConvert,
  onSendEmail, onClone, onStatusChange, onUpdate,
}) => {
  const { user } = useAuth();
  const emailEnabled = useEmailEnabled();
  const { canEditModule } = useOrganization();
  const { defaultPipeline, stagesByPipeline } = usePipelines();
  const { remove: removeDeal } = useDeals();
  const formatMoney = useFormatMoney();
  const canEdit = canManage && !readOnly && canEditModule('leads');

  // Local copy of lead data so inline edits reflect immediately in the panel
  // without waiting for the parent to re-query.
  const [lead, setLead] = useState<Lead | null>(leadProp);
  useEffect(() => { setLead(leadProp); }, [leadProp]);
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [tab, setTab] = useState<LeadTab>('activity');
  const [enrolOpen, setEnrolOpen] = useState(false);

  /** Called by every InlineField/CustomPropertiesEditor save. Persists the
   *  patch via onUpdate (when provided) and merges the returned Lead into
   *  local state so the panel reflects the new values without a round-trip. */
  const handleInlineUpdate = async (
    leadId: string,
    patch: Partial<Lead>,
  ): Promise<void> => {
    if (!onUpdate) return;
    const updated = await onUpdate(leadId, patch);
    setLead(updated);
  };

  // Right-rail: read-only activity timeline for this lead (mirrors the
  // account drawer's rail timeline).
  const [leadActivities, setLeadActivities] = useState<Activity[]>([]);
  const [activitiesKey, setActivitiesKey] = useState(0);
  useEffect(() => {
    if (!lead || !organizationId) return;
    let cancelled = false;
    listActivities(organizationId, { openDealIds: new Set(), customerClientIds: new Set() })
      .then((all) => {
        if (!cancelled) setLeadActivities(filterByEntity(all, 'lead', lead.leadId));
      })
      .catch(() => {/* non-blocking */});
    return () => { cancelled = true; };
  }, [lead?.leadId, organizationId, activitiesKey]);

  // Right-rail: deals shown for the lead. A lead isn't itself a deal, so we
  // surface the lead's ACCOUNT's deals when the lead is attached to one
  // (accountId === client_id). No lead→deal link is invented; when the lead
  // has no account (or the account has no deals) the card shows an empty state.
  const [accountDeals, setAccountDeals] = useState<Deal[]>([]);
  // The lead's account as a full Client record — needed so a new deal can be
  // scoped to it (DealFormDialog wants a Client + defaultClientId). Null when
  // the lead has no account.
  const [accountClient, setAccountClient] = useState<Client | null>(null);
  // Stage-change trail for the account's deals — folded into the timeline.
  const [stageHistory, setStageHistory] = useState<DealStageHistoryEntry[]>([]);
  const [openCreateDeal, setOpenCreateDeal] = useState(false);
  // Standard-deal edit (DealFormDialog in edit mode), opened from a rail row.
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  // Custom-item create / edit, scoped to the lead's account.
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
  useEffect(() => {
    if (!lead || !organizationId || !lead.accountId) {
      setAccountDeals([]);
      setAccountClient(null);
      return;
    }
    const accountId = lead.accountId;
    let cancelled = false;
    getOrganizationDeals(organizationId)
      .then((all) => {
        if (!cancelled) setAccountDeals(all.filter((d) => d.clientId === accountId));
      })
      .catch(() => {/* non-blocking */});
    getOrganizationClients(organizationId)
      .then((all) => {
        if (!cancelled) setAccountClient(all.find((c) => c.clientId === accountId) ?? null);
      })
      .catch(() => {/* non-blocking */});
    return () => { cancelled = true; };
  }, [lead?.leadId, lead?.accountId, organizationId, openCreateDeal, dealsRefresh]);

  // Deal stage history for the lead's account — re-queries on deal changes.
  useEffect(() => {
    if (!lead || !organizationId || !lead.accountId) {
      setStageHistory([]);
      return;
    }
    const accountId = lead.accountId;
    let cancelled = false;
    listAccountStageHistory(organizationId, accountId)
      .then((rows) => { if (!cancelled) setStageHistory(rows); })
      .catch(() => {/* non-blocking */});
    return () => { cancelled = true; };
  }, [lead?.leadId, lead?.accountId, organizationId, dealsRefresh]);

  // Timeline = the lead's own activities (notes/emails) + its account's deal
  // lifecycle (deal added + stage moves), newest first — so pipeline movement
  // shows here, not just an empty feed.
  const timelineActivities = useMemo(() => {
    const stageLabel = (key: string | null) =>
      DEAL_STAGES.find((s) => s.id === key)?.label ?? key ?? '(new)';
    const dealEvents = dealTimelineActivities(accountDeals, stageHistory, { formatMoney, stageLabel });
    return [...leadActivities, ...dealEvents].sort(
      (a, b) => (b.whenAt?.getTime() ?? -Infinity) - (a.whenAt?.getTime() ?? -Infinity),
    );
  }, [leadActivities, accountDeals, stageHistory, formatMoney]);

  useEffect(() => {
    if (!lead || !organizationId) return;
    setLoadingNotes(true);
    let cancelled = false;
    getLeadNotes(organizationId, lead.leadId)
      .then((n) => { if (!cancelled) setNotes(n); })
      .finally(() => { if (!cancelled) setLoadingNotes(false); });
    return () => { cancelled = true; };
  }, [lead?.leadId, organizationId]);

  const reloadNotes = async () => {
    if (!lead || !organizationId) return;
    setNotes(await getLeadNotes(organizationId, lead.leadId));
  };

  const handleStatusPick = async (next: LeadStatus) => {
    if (!lead || !onStatusChange) return;
    try {
      await onStatusChange(lead, next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Status update failed');
    }
  };

  if (!lead || !organizationId) return null;

  const isConverted = lead.leadStatus === 'converted';
  const fullAddress = [
    lead.street,
    [lead.city, lead.state].filter(Boolean).join(', '),
    [lead.postalCode, lead.country].filter(Boolean).join(' '),
  ].filter((s) => !!(s && s.trim())).join(', ');
  const displayName = leadDisplayName(lead);

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden
      />

      <aside className="relative ml-auto h-full w-full sm:w-[95vw] sm:max-w-[1400px] bg-background border-l border-border shadow-xl flex flex-col animate-in slide-in-from-right-2 duration-200">
        {/* Top bar */}
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
            <UserIcon className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">Leads</span>
            <span className="text-sm text-muted-foreground">/</span>
            <span className="text-sm font-semibold text-foreground truncate">
              {displayName}
            </span>
            <Badge variant="outline" className="text-[10px] font-mono ml-1">
              {lead.leadNumber}
            </Badge>
          </div>
          <div className="ml-auto flex items-center gap-1">
            {canManage && !isConverted && !readOnly && (
              <>
                {emailEnabled && (
                  <Button variant="outline" size="sm" onClick={() => onSendEmail(lead)}>
                    <Mail className="w-3.5 h-3.5 mr-1" /> Send Email
                  </Button>
                )}
                {canConvert && (
                  <Button
                    variant="outline" size="sm"
                    className="text-emerald-600 border-emerald-600/40 hover:bg-emerald-500/10"
                    onClick={() => onConvert(lead)}
                  >
                    <Repeat className="w-3.5 h-3.5 mr-1" /> Convert
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => onEdit(lead)}>
                  <Edit className="w-3.5 h-3.5 mr-1" /> Edit
                </Button>
              </>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <MoreVertical className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={() => onClone(lead)} disabled={!canManage}>
                  <Copy className="w-4 h-4 mr-2" /> Clone
                </DropdownMenuItem>
                {/* Run automation — synthesises a trigger event so an
                    enabled recipe fires against this lead (after it
                    becomes a client via convertedToClientId, or via
                    a 'scheduled' / 'agent_intake' generic trigger). */}
                <DropdownMenuItem
                  onClick={() => setEnrolOpen(true)}
                  disabled={!canManage || !lead.convertedToClientId}
                  title={!lead.convertedToClientId
                    ? 'Convert the lead first — recipes target the resulting client'
                    : 'Run an enabled automation against this lead'}
                >
                  <Zap className="w-4 h-4 mr-2" /> Run automation
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onDelete(lead)}
                  disabled={!canManage || readOnly}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="w-4 h-4 mr-2" /> Delete
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => window.print()}>
                  <Printer className="w-4 h-4 mr-2" /> Print Preview
                </DropdownMenuItem>
                <DropdownMenuItem disabled>
                  <FileSearch className="w-4 h-4 mr-2" /> Find and Merge Duplicates
                </DropdownMenuItem>
                <DropdownMenuItem disabled>
                  <RefreshCw className="w-4 h-4 mr-2" /> Review History
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Body — 3 columns mirroring the account drawer: identity + About
            (left), tabbed content (middle), account deals (right). */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)_320px]">
          {/* ── LEFT: identity + About this lead (inline-editable) ───────── */}
          <aside className="border-r border-border bg-card/40 overflow-y-auto p-4 space-y-4">
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-400 to-pink-400 text-white grid place-items-center text-lg font-bold">
                {displayName.charAt(0).toUpperCase()}
              </div>
              <h2 className="mt-3 text-xl font-bold truncate w-full">{displayName}</h2>
              <p className="text-sm text-muted-foreground truncate w-full">{lead.company}</p>
              {lead.title && (
                <p className="text-xs text-muted-foreground mt-0.5">{lead.title}</p>
              )}
              <div className="flex items-center gap-1 flex-wrap justify-center mt-2">
                {onStatusChange ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger disabled={!canManage || isConverted}>
                      <Badge
                        className={cn('text-[10px] cursor-pointer inline-flex items-center gap-1', STATUS_TONE[lead.leadStatus])}
                        title="Click to change status"
                      >
                        {leadStatusLabel(lead.leadStatus)}
                        {canManage && !isConverted && <ChevronDown className="w-3 h-3" />}
                      </Badge>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {LEAD_STATUS_OPTIONS
                        .filter((o) => o.value !== 'converted')
                        .map((o) => (
                          <DropdownMenuItem key={o.value} onClick={() => handleStatusPick(o.value)}>
                            {o.label}
                          </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Badge className={cn('text-[10px]', STATUS_TONE[lead.leadStatus])}>
                    {leadStatusLabel(lead.leadStatus)}
                  </Badge>
                )}
                {lead.leadSource && (
                  <Badge variant="outline" className="text-[10px]">
                    Source: {lead.leadSource}
                  </Badge>
                )}
                {lead.rating && (
                  <Badge variant="outline" className="text-[10px]">
                    Rating: {lead.rating}
                  </Badge>
                )}
                {isConverted && (
                  <Badge className="text-[10px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
                    <CheckCircle2 className="w-3 h-3 mr-1" /> Converted
                  </Badge>
                )}
              </div>
            </div>

            <div className="border-t border-border pt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                About this lead
              </h3>
              <AboutLead
                lead={lead}
                fullAddress={fullAddress}
                editable={canEdit && !isConverted}
                onSave={handleInlineUpdate}
              />
            </div>

            {isConverted && (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs">
                <p className="font-semibold inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Converted {lead.convertedAt && format(lead.convertedAt, 'PP')}
                </p>
                <ul className="mt-1 space-y-0.5 text-muted-foreground">
                  {lead.convertedToClientId && <li>→ Account: <code className="font-mono">{lead.convertedToClientId.slice(0, 8)}…</code></li>}
                  {lead.convertedToContactId && <li>→ Contact: <code className="font-mono">{lead.convertedToContactId.slice(0, 8)}…</code></li>}
                  {lead.convertedToDealId && <li>→ Deal: <code className="font-mono">{lead.convertedToDealId.slice(0, 8)}…</code></li>}
                </ul>
              </div>
            )}
          </aside>

          {/* ── MIDDLE: tabbed content (parity with the account drawer) ───── */}
          <section className="flex flex-col overflow-hidden">
            <Tabs value={tab} onValueChange={(v) => setTab(v as LeadTab)} className="px-4 pt-3">
              <TabsList className="bg-transparent border-b border-border rounded-none w-full justify-start gap-1 h-auto p-0">
                {([
                  { v: 'activity', label: 'Activity' },
                  { v: 'notes', label: 'Notes' },
                  { v: 'emails', label: 'Emails' },
                  { v: 'files', label: 'Files' },
                  { v: 'details', label: 'Details' },
                ] as const).map((t) => (
                  <TabsTrigger
                    key={t.v}
                    value={t.v}
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-orange-500 data-[state=active]:bg-transparent px-3 pb-2"
                  >
                    {t.label}
                    {t.v === 'notes' && notes.length > 0 && (
                      <span className="ml-1 text-xs text-muted-foreground">({notes.length})</span>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <div className="flex-1 overflow-y-auto p-4">
              {tab === 'activity' && (
                <div id="lead-activity-timeline" className="space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Activity timeline
                  </h3>
                  {/* AI next-best-action for this lead, above the timeline */}
                  <NextBestAction entity={{ type: 'lead', id: lead.leadId, label: displayName }} />
                  {canManage && !isConverted && (
                    <QuickLogComposer
                      entity={{ type: 'lead', id: lead.leadId, label: displayName }}
                      onPosted={() => setActivitiesKey((k) => k + 1)}
                    />
                  )}
                  <ActivitiesTimeline activities={timelineActivities} />
                </div>
              )}

              {tab === 'notes' && (
                <div id="lead-notes-section">
                  <NotesSection
                    lead={lead}
                    organizationId={organizationId}
                    notes={notes}
                    loading={loadingNotes}
                    canCompose={canManage && !isConverted}
                    userId={user?.userId ?? null}
                    userName={user?.displayName ?? null}
                    onChanged={reloadNotes}
                  />
                </div>
              )}

              {tab === 'emails' && (
                <div id="lead-emails-section">
                  <EntityEmailsSection
                    organizationId={organizationId}
                    entityType="lead"
                    entityId={lead.leadId}
                  />
                </div>
              )}

              {tab === 'files' && (
                <div id="lead-attachments-section">
                  {/* Attachments — wired to attachments table + Storage bucket
                      (migration 116). Upload / list / download / delete work. */}
                  <EntityAttachmentsSection
                    organizationId={organizationId}
                    entityType="lead"
                    entityId={lead.leadId}
                    canManage={canManage && !isConverted}
                  />
                </div>
              )}

              {tab === 'details' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold border-b pb-1.5 mb-3">
                      Custom properties
                    </h3>
                    <CustomPropertiesEditor
                      fields={lead.customFields}
                      editable={canEdit && !isConverted}
                      onChange={(next) => handleInlineUpdate(lead.leadId, { customFields: next })}
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm border-t pt-4">
                    <Field label="Lead Source" value={lead.leadSource} />
                    <Field label="Rating" value={lead.rating} />
                    <Field label="Email Opt-Out" value={lead.emailOptOut ? 'Yes' : 'No'} />
                    <Field label="Created" value={format(lead.createdAt, 'PPp')} />
                    <Field label="Updated" value={format(lead.updatedAt, 'PPp')} />
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* ── RIGHT: account deals (parity with the account drawer's rail) ── */}
          <aside className="border-l border-border bg-card/40 overflow-y-auto p-4 space-y-4">
            <AccountDealsCard
              deals={accountDeals}
              hasAccount={!!lead.accountId}
              canCreate={canEdit}
              canChangeStage={canEdit}
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

      <EnrollAutomationDialog
        open={enrolOpen}
        onOpenChange={setEnrolOpen}
        clientId={lead.convertedToClientId ?? null}
        entityName={leadDisplayName(lead)}
      />

      {/* New deal scoped to the lead's account (a lead isn't itself a deal —
          its deals live on the account it's attached to). Only mounts when an
          account exists; the rail's Add button is disabled otherwise. */}
      {accountClient && (
        <DealFormDialog
          open={openCreateDeal}
          onOpenChange={setOpenCreateDeal}
          clients={[accountClient]}
          defaultClientId={accountClient.clientId}
          defaultTitle={`${displayName} — ${lead.company}`}
        />
      )}

      {/* Custom item (create / edit) scoped to the lead's account. */}
      {accountClient && (
        <CustomItemDialog
          open={openCustomItem}
          onOpenChange={(o) => {
            setOpenCustomItem(o);
            if (!o) { setEditingCustomItem(null); setDealsRefresh((k) => k + 1); }
          }}
          clientId={accountClient.clientId}
          deal={editingCustomItem}
        />
      )}

      {/* Edit a standard deal from the rail (DealFormDialog in edit mode). */}
      {accountClient && (
        <DealFormDialog
          open={!!editingDeal}
          onOpenChange={(o) => {
            if (!o) { setEditingDeal(null); setDealsRefresh((k) => k + 1); }
          }}
          deal={editingDeal}
          clients={[accountClient]}
          defaultClientId={accountClient.clientId}
        />
      )}

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

// ─── Left: About this lead (inline-editable) ─────────────────────────────────

const AboutLead: React.FC<{
  lead: Lead;
  fullAddress: string;
  editable: boolean;
  onSave: (leadId: string, patch: Partial<Lead>) => Promise<void>;
}> = ({ lead, fullAddress, editable, onSave }) => {
  const save = (patch: Partial<Lead>) => onSave(lead.leadId, patch);
  return (
    <div className="space-y-3 text-sm">
      <Field label="Lead Owner" value={lead.leadOwnerName} />
      <InlineField
        label="Email"
        value={lead.email}
        type="text"
        editable={editable}
        onSave={(v) => save({ email: v as string | null })}
        render={(v) => v
          ? <a href={`mailto:${v}`} className="text-primary hover:underline break-all">{String(v)}</a>
          : null}
      />
      <InlineField
        label="Phone"
        value={lead.phone}
        type="text"
        editable={editable}
        onSave={(v) => save({ phone: v as string | null })}
        render={(v) => v ? <a href={`tel:${v}`} className="hover:underline">{String(v)}</a> : null}
      />
      <InlineField
        label="Mobile"
        value={lead.mobile}
        type="text"
        editable={editable}
        onSave={(v) => save({ mobile: v as string | null })}
      />
      <InlineField
        label="Website"
        value={lead.website}
        type="text"
        editable={editable}
        onSave={(v) => save({ website: v as string | null })}
        render={(v) => v ? (
          <a href={String(v).startsWith('http') ? String(v) : `https://${v}`}
             target="_blank" rel="noreferrer noopener" className="text-primary hover:underline break-all">
            {String(v)}
          </a>
        ) : null}
      />
      <InlineField
        label="Company"
        value={lead.company}
        type="text"
        editable={editable}
        onSave={(v) => save({ company: (v as string | null) ?? lead.company })}
      />
      <InlineField
        label="Title"
        value={lead.title}
        type="text"
        editable={editable}
        onSave={(v) => save({ title: v as string | null })}
      />
      <InlineField
        label="Industry"
        value={lead.industry}
        type="text"
        editable={editable}
        onSave={(v) => save({ industry: v as string | null })}
      />
      <InlineField
        label="Annual Revenue"
        value={lead.annualRevenue}
        type="number"
        editable={editable}
        onSave={(v) => save({ annualRevenue: v as number | null })}
        render={(v) => v != null
          ? <span>{new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(v))}</span>
          : null}
      />
      <InlineField
        label="No. of Employees"
        value={lead.noOfEmployees}
        type="number"
        editable={editable}
        onSave={(v) => save({ noOfEmployees: v as number | null })}
      />
      <InlineField
        label="Fax"
        value={lead.fax}
        type="text"
        editable={editable}
        onSave={(v) => save({ fax: v as string | null })}
      />
      <InlineField
        label="Skype"
        value={lead.skypeId}
        type="text"
        editable={editable}
        onSave={(v) => save({ skypeId: v as string | null })}
      />
      <InlineField
        label="Twitter"
        value={lead.twitter}
        type="text"
        editable={editable}
        onSave={(v) => save({ twitter: v as string | null })}
      />
      <InlineField
        label="LinkedIn"
        value={lead.linkedinUrl}
        type="text"
        editable={editable}
        onSave={(v) => save({ linkedinUrl: v as string | null })}
      />
      <Field label="Address" value={fullAddress || null} />
      <InlineField
        label="Description"
        value={lead.description}
        type="textarea"
        editable={editable}
        onSave={(v) => save({ description: v as string | null })}
        render={(v) => v ? <span className="whitespace-pre-wrap break-words">{String(v)}</span> : null}
      />
      {lead.tags && lead.tags.length > 0 && (
        <div className="pt-1">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Tags
          </p>
          <div className="flex flex-wrap gap-1.5">
            {lead.tags.map((t) => (
              <Badge key={t} variant="secondary">{t}</Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Right rail: interactive account pipeline ────────────────────────────────

/** Deals shown for a lead = the lead's ACCOUNT's deals (a lead isn't itself a
 *  deal). Renders an interactive pipeline: ＋ Add deal scoped to the account,
 *  plus a per-deal stage picker (reuses the board's won-confirm path). When the
 *  lead has no account, Add is disabled with a tooltip prompting to move the
 *  lead into an account first — no lead→deal link is invented. */
const AccountDealsCard: React.FC<{
  deals: Deal[];
  hasAccount: boolean;
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
  deals, hasAccount, canCreate, canChangeStage, stagesByPipeline,
  defaultPipelineId, onNewDeal, onNewCustomItem, onEditCustomItem,
  onEditDeal, onDeleteDeal, onStageChanged,
}) => {
  const formatMoney = useFormatMoney();
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Account deals
          {deals.length > 0 && (
            <span className="ml-1 text-muted-foreground normal-case">({deals.length})</span>
          )}
        </h3>
      </div>
      {canCreate && (
        <div
          className="flex items-center gap-1 mb-2"
          title={hasAccount ? undefined : 'Move this lead into an account first'}
        >
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs px-2"
            disabled={!hasAccount}
            onClick={onNewDeal}
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Pipeline deal
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs px-2"
            disabled={!hasAccount}
            onClick={onNewCustomItem}
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Custom item
          </Button>
        </div>
      )}

      {!hasAccount || deals.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {hasAccount
            ? `No deals yet.${canCreate ? ' Use “Pipeline deal” or “Custom item” to start tracking.' : ''}`
            : 'No account. Move this lead into an account to track deals.'}
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

const Field: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="grid grid-cols-[140px_1fr] items-baseline gap-2">
    <span className="text-[11px] uppercase tracking-wide text-muted-foreground text-right">{label}</span>
    <span className="text-foreground truncate">
      {value == null || value === '' ? <span className="text-muted-foreground">—</span> : value}
    </span>
  </div>
);

// ─── Notes section ────────────────────────────────────────────────────────

interface NotesSectionProps {
  lead: Lead;
  organizationId: string;
  notes: LeadNote[];
  loading: boolean;
  canCompose: boolean;
  userId: string | null;
  userName: string | null;
  onChanged: () => Promise<void> | void;
}

const NotesSection: React.FC<NotesSectionProps> = ({
  lead, organizationId, notes, loading, canCompose, userId, userName, onChanged,
}) => {
  const [composing, setComposing] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSave = async () => {
    if (!body.trim() && !subject.trim()) {
      toast.error('Note must have a subject or body');
      return;
    }
    setBusy(true);
    try {
      await createLeadNote(organizationId, lead.leadId, userId, userName, {
        kind: 'note', subject: subject || null, body: body || null, occurredAt: new Date(),
      });
      setSubject('');
      setBody('');
      setComposing(false);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add note');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (noteId: string) => {
    if (!confirm('Delete this note?')) return;
    try {
      await deleteLeadNote(organizationId, noteId);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between border-b pb-1.5 mb-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <FileText className="w-4 h-4 text-muted-foreground" /> Notes
          {notes.length > 0 && (
            <Badge variant="outline" className="text-[10px]">{notes.length}</Badge>
          )}
        </h3>
        {canCompose && !composing && (
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="text-xs text-primary hover:underline"
          >
            Add a note...
          </button>
        )}
      </div>

      {canCompose && composing && (
        <div className="rounded-md border p-3 mb-3 space-y-2 bg-card">
          <Input
            placeholder="Add a title (optional)"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
            disabled={busy}
          />
          <Textarea
            placeholder="Add a note…"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={4000}
            disabled={busy}
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost" size="sm"
              onClick={() => { setComposing(false); setSubject(''); setBody(''); }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} size="sm" disabled={busy}>
              {busy && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      )}

      {!canCompose && !composing && (
        <button
          type="button"
          disabled
          className="w-full text-left text-sm text-muted-foreground border rounded-md py-2 px-3 mb-3 bg-muted/30"
        >
          Add a note...
        </button>
      )}

      {loading ? (
        <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading…
        </p>
      ) : notes.length === 0 && !composing ? (
        <p className="text-xs text-muted-foreground">No notes logged on this lead yet.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.noteId} className="rounded-md border p-3 bg-card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  {n.subject && <p className="font-semibold text-sm mb-1">{n.subject}</p>}
                  {n.body && <p className="text-sm whitespace-pre-wrap">{n.body}</p>}
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {n.authorName ?? 'Someone'} · {format(n.occurredAt, 'PPp')}
                  </p>
                </div>
                {canCompose && (
                  <button
                    type="button"
                    onClick={() => handleDelete(n.noteId)}
                    className="text-muted-foreground hover:text-destructive p-1"
                    title="Delete note"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
