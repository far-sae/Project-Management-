import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Building2, Loader2, UserPlus, X, Trash2, Receipt, CheckCircle2,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { InlineField } from '@/components/leads/InlineField';
import { LeadDetailDrawer } from '@/components/leads/LeadDetailDrawer';
import { LeadFormDialog } from '@/components/leads/LeadFormDialog';
// Reused from the account drawer so the business page mirrors the lead window's
// tabbed experience (Notes / Meetings, etc.) for this account.
import { NotesTab, MeetingsTab } from '@/components/clients/ClientDetailDrawer';
import { AccountStageHistoryCard } from '@/components/clients/AccountStageHistoryCard';
import { InvoicesPanel } from '@/components/clients/InvoicesPanel';
import { EntityEmailsSection } from '@/components/activities/EntityEmailsSection';
import { EntityAttachmentsSection } from '@/components/activities/EntityAttachmentsSection';
import { ActivitiesTimeline } from '@/components/activities/ActivitiesTimeline';
import {
  listActivities, filterByEntity, dealTimelineActivities, type Activity,
} from '@/services/supabase/activities';
import {
  listAccountStageHistory, type DealStageHistoryEntry,
} from '@/services/supabase/dealRelations';
import { useClients } from '@/hooks/useClients';
import { useLeads } from '@/hooks/useLeads';
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
import { useDeals } from '@/hooks/useDeals';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { useOrgCurrency } from '@/hooks/useOrgCurrency';
import { formatRevenue, getClientNotes, type ClientNote } from '@/services/supabase/clients';
import { Lead, leadDisplayName, leadStatusLabel, createLeadNote } from '@/services/supabase/leads';
import { DEAL_STAGES, type Deal } from '@/services/supabase/deals';
import { createInvoice } from '@/services/supabase/invoices';
import { createSchedule } from '@/services/supabase/invoiceSchedules';
import { toast } from 'sonner';

// Per-deal billing preference, stored in deal.customFields.billingType.
type BillingMode = 'on_completion' | 'monthly' | 'none';
const BILLING_LABEL: Record<BillingMode, string> = {
  on_completion: 'Bill on completion',
  monthly: 'Monthly (recurring)',
  none: "Don't bill",
};

type BusinessTab =
  | 'activity' | 'notes' | 'leads' | 'pipeline'
  | 'emails' | 'meetings' | 'files' | 'invoices';

/**
 * Standalone Business page (reuses the company/account record). Tabbed like the
 * lead window: business details on the left, then Activity / Notes / Leads /
 * Pipeline / Emails / Meetings / Files / Invoices. A business can have many
 * leads (lead.accountId === clientId); the Leads tab manages that link.
 */
export const BusinessAccountPage: React.FC = () => {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const { organizationId, allClients, update, canManage, loading } = useClients();
  const { allLeads, update: updateLead, remove: removeLead } = useLeads();
  const { deals, update: updateDeal } = useDeals();
  const { workspaces } = useSelectedWorkspace();
  const { user } = useAuth();
  const { canEditModule } = useOrganization();
  const formatMoney = useFormatMoney();
  const orgCurrency = useOrgCurrency();
  const canEdit = canManage;

  const [tab, setTab] = useState<BusinessTab>('activity');

  const client = useMemo(
    () => allClients.find((c) => c.clientId === clientId) ?? null,
    [allClients, clientId],
  );
  const attachedLeads = useMemo(
    () => allLeads.filter((l) => l.accountId === clientId),
    [allLeads, clientId],
  );
  // Leads selectable in the "add a lead" dropdown: only leads from this
  // business's own category (the leads that live inside that category on the
  // accounts page) and not already on this business.
  const attachableLeads = useMemo(() => {
    const cat = (client?.category ?? '').trim().toLowerCase();
    return allLeads.filter((l) =>
      l.accountId !== clientId
      && (l.category ?? '').trim().toLowerCase() === cat,
    );
  }, [allLeads, clientId, client?.category]);
  // This business's deals = its "projects" for billing + the Pipeline tab.
  const businessDeals = useMemo(
    () => deals.filter((d) => d.clientId === clientId),
    [deals, clientId],
  );

  // Lead drawer / edit / delete state (mirrors the CRM page's lead wiring).
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [confirmDeleteLead, setConfirmDeleteLead] = useState<Lead | null>(null);
  const [deletingLead, setDeletingLead] = useState(false);

  // Keep the open drawer reactive to realtime updates.
  const liveSelectedLead = useMemo(
    () => (selectedLead ? allLeads.find((l) => l.leadId === selectedLead.leadId) ?? null : null),
    [allLeads, selectedLead],
  );

  // ── Account-level data for the tabs (activity / notes / pipeline) ──────────
  const [clientActivities, setClientActivities] = useState<Activity[]>([]);
  const [stageHistory, setStageHistory] = useState<DealStageHistoryEntry[]>([]);
  const [clientNotes, setClientNotes] = useState<ClientNote[]>([]);

  useEffect(() => {
    if (!organizationId || !clientId) return;
    let cancelled = false;
    listActivities(organizationId, { openDealIds: new Set(), customerClientIds: new Set() })
      .then((all) => { if (!cancelled) setClientActivities(filterByEntity(all, 'client', clientId)); })
      .catch(() => {/* non-blocking */});
    listAccountStageHistory(organizationId, clientId)
      .then((rows) => { if (!cancelled) setStageHistory(rows); })
      .catch(() => {/* non-blocking */});
    return () => { cancelled = true; };
  }, [organizationId, clientId]);

  useEffect(() => {
    if (!organizationId || !clientId) return;
    let cancelled = false;
    getClientNotes(organizationId, clientId)
      .then((n) => { if (!cancelled) setClientNotes(n); })
      .catch(() => {/* non-blocking */});
    return () => { cancelled = true; };
  }, [organizationId, clientId]);

  const reloadNotes = async () => {
    if (!organizationId || !clientId) return;
    setClientNotes(await getClientNotes(organizationId, clientId));
  };

  // Activity feed = the account's own activities + its deal lifecycle events.
  const timelineActivities = useMemo(() => {
    const stageLabel = (key: string | null) =>
      DEAL_STAGES.find((s) => s.id === key)?.label ?? key ?? '(new)';
    const dealEvents = dealTimelineActivities(businessDeals, stageHistory, { formatMoney, stageLabel });
    return [...clientActivities, ...dealEvents].sort(
      (a, b) => (b.whenAt?.getTime() ?? -Infinity) - (a.whenAt?.getTime() ?? -Infinity),
    );
  }, [clientActivities, businessDeals, stageHistory, formatMoney]);

  const save = async (patch: Parameters<typeof update>[1]) => {
    if (!client) return;
    try {
      await update(client.clientId, patch);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    }
  };

  const attachLead = async (leadId: string) => {
    if (!clientId) return;
    try {
      await updateLead(leadId, { accountId: clientId });
      toast.success('Lead attached to this business');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not attach lead');
    }
  };

  const detachLead = async (lead: Lead) => {
    try {
      await updateLead(lead.leadId, { accountId: null });
      toast.success(`Removed ${leadDisplayName(lead)} from this business`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove lead');
    }
  };

  // ── Billing (Phase 2/3) ──────────────────────────────────────────────────
  const billingOf = (d: Deal): BillingMode => {
    const v = d.customFields?.billingType;
    return v === 'on_completion' || v === 'monthly' ? v : 'none';
  };
  const lineItemsFor = (d: Deal) => [
    { description: d.title, qty: 1, unitPrice: d.value, lineTotal: d.value },
  ];

  const setBilling = async (d: Deal, mode: BillingMode) => {
    try {
      await updateDeal(d.dealId, { customFields: { ...d.customFields, billingType: mode } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save billing');
    }
  };

  // Manual one-off: create a draft invoice for this deal right now.
  const generateInvoice = async (d: Deal) => {
    if (!organizationId || !client) return;
    try {
      await createInvoice(organizationId, user?.userId ?? null, user?.displayName ?? null, {
        clientId: client.clientId, dealId: d.dealId, title: d.title,
        currency: d.currency, lineItems: lineItemsFor(d),
      });
      toast.success(`Draft invoice created for "${d.title}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create invoice');
    }
  };

  // Mark the project (deal) delivered: apply its billing preference (one-time
  // invoice or start a monthly schedule) AND log it to every attached lead's
  // Activity timeline (Phase 3).
  const markDelivered = async (d: Deal) => {
    if (!organizationId || !client) return;
    const mode = billingOf(d);
    try {
      if (mode === 'monthly') {
        await createSchedule(organizationId, user?.userId ?? null, user?.displayName ?? null, {
          clientId: client.clientId, frequency: 'monthly', currency: d.currency,
          lineItems: lineItemsFor(d), nextRunDate: new Date(),
        });
      } else if (mode === 'on_completion') {
        await createInvoice(organizationId, user?.userId ?? null, user?.displayName ?? null, {
          clientId: client.clientId, dealId: d.dealId, title: d.title,
          currency: d.currency, lineItems: lineItemsFor(d),
        });
      }
      await Promise.all(attachedLeads.map((l) =>
        createLeadNote(organizationId, l.leadId, user?.userId ?? null, user?.displayName ?? null, {
          kind: 'note', subject: 'Project delivered',
          body: `Project "${d.title}" was marked delivered.`, occurredAt: new Date(),
        })));
      const billNote = mode === 'monthly'
        ? ' Monthly billing started.'
        : mode === 'on_completion' ? ' Invoice generated.' : '';
      toast.success(
        `Marked "${d.title}" delivered.${billNote}`
        + (attachedLeads.length ? ` Logged to ${attachedLeads.length} lead${attachedLeads.length === 1 ? '' : 's'}.` : ''),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not mark delivered');
    }
  };

  if (loading && !client) {
    return (
      <main className="flex-1 min-w-0 overflow-y-auto p-4 md:p-8">
        <div className="py-16 flex items-center justify-center text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading business…
        </div>
      </main>
    );
  }

  if (!client || !organizationId) {
    return (
      <main className="flex-1 min-w-0 overflow-y-auto p-4 md:p-8">
        <div className="max-w-2xl mx-auto text-center space-y-3 py-16">
          <Building2 className="w-8 h-8 mx-auto text-muted-foreground" />
          <p className="text-base font-semibold">Business not found</p>
          <p className="text-sm text-muted-foreground">
            This business may have been deleted, or you don't have access to it.
          </p>
          <Button variant="outline" onClick={() => navigate('/clients')}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to CRM
          </Button>
        </div>
      </main>
    );
  }

  const leadsCount = attachedLeads.length;

  return (
    <>
      <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-4 md:p-8">
        <div className="space-y-4 max-w-[1400px] mx-auto">
          {/* Header */}
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              // Back returns to this business's category in the CRM (not the
              // CRM landing). Falls back to /clients when it has no category.
              onClick={() => navigate(
                client.category
                  ? `/clients?cat=${encodeURIComponent(client.category)}`
                  : '/clients',
              )}
            >
              <ArrowLeft className="w-4 h-4 mr-2" /> Back
            </Button>
            <span className="w-9 h-9 rounded-lg bg-primary-soft text-primary-soft-foreground grid place-items-center shrink-0">
              <Building2 className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <h1 className="text-xl md:text-2xl font-bold truncate">{client.name}</h1>
              <p className="text-xs text-muted-foreground">Business account</p>
            </div>
            {client.category && (
              <Badge variant="secondary" className="text-[10px] ml-1">{client.category}</Badge>
            )}
          </div>

          {/* Body — business details (left) + tabbed content (right), mirroring
              the lead window's layout. */}
          <div className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] gap-4 items-start">
            {/* LEFT: business details (inline-editable) */}
            <Card>
              <CardContent className="pt-5">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                  Business details
                </h2>
                <div className="grid grid-cols-1 gap-y-3 text-sm">
                  <InlineField
                    label="Name" value={client.name} type="text" editable={canEdit}
                    onSave={(v) => save({ name: (v as string | null) ?? client.name })}
                  />
                  <InlineField
                    label="Legal name" value={client.legalName} type="text" editable={canEdit}
                    onSave={(v) => save({ legalName: v as string | null })}
                  />
                  <InlineField
                    label="Industry" value={client.industry} type="text" editable={canEdit}
                    onSave={(v) => save({ industry: v as string | null })}
                  />
                  <InlineField
                    label="Website" value={client.website} type="text" editable={canEdit}
                    onSave={(v) => save({ website: v as string | null })}
                    render={(v) => v ? (
                      <a href={String(v).startsWith('http') ? String(v) : `https://${v}`}
                         target="_blank" rel="noreferrer noopener" className="text-primary hover:underline break-all">
                        {String(v)}
                      </a>
                    ) : null}
                  />
                  <InlineField
                    label="Email" value={client.email} type="text" editable={canEdit}
                    onSave={(v) => save({ email: v as string | null })}
                    render={(v) => v ? <a href={`mailto:${v}`} className="text-primary hover:underline break-all">{String(v)}</a> : null}
                  />
                  <InlineField
                    label="Phone" value={client.phone} type="text" editable={canEdit}
                    onSave={(v) => save({ phone: v as string | null })}
                    render={(v) => v ? <a href={`tel:${v}`} className="hover:underline">{String(v)}</a> : null}
                  />
                  <InlineField
                    label="City" value={client.city} type="text" editable={canEdit}
                    onSave={(v) => save({ city: v as string | null })}
                  />
                  <InlineField
                    label="State" value={client.state} type="text" editable={canEdit}
                    onSave={(v) => save({ state: v as string | null })}
                  />
                  <InlineField
                    label="Postal code" value={client.postalCode} type="text" editable={canEdit}
                    onSave={(v) => save({ postalCode: v as string | null })}
                  />
                  <InlineField
                    label="Country" value={client.country} type="text" editable={canEdit}
                    onSave={(v) => save({ country: v as string | null })}
                  />
                  <InlineField
                    label="Annual revenue" value={client.annualRevenue} type="number" editable={canEdit}
                    onSave={(v) => save({ annualRevenue: v as number | null })}
                    render={(v) => v != null ? <span>{formatRevenue(Number(v))}</span> : null}
                  />
                  <InlineField
                    label="Employees" value={client.employeeCount} type="number" editable={canEdit}
                    onSave={(v) => save({ employeeCount: v as number | null })}
                  />
                  <InlineField
                    label="Source" value={client.source} type="text" editable={canEdit}
                    onSave={(v) => save({ source: v as string | null })}
                  />
                  <InlineField
                    label="Owner" value={client.accountOwnerName} type="text" editable={canEdit}
                    onSave={(v) => save({ accountOwnerName: v as string | null })}
                  />
                  <InlineField
                    label="Description" value={client.description} type="textarea" editable={canEdit}
                    onSave={(v) => save({ description: v as string | null })}
                    render={(v) => v ? <span className="whitespace-pre-wrap break-words">{String(v)}</span> : null}
                  />
                </div>
              </CardContent>
            </Card>

            {/* RIGHT: tabbed content (mirrors the lead window) */}
            <Card>
              <CardContent className="pt-3">
                <Tabs value={tab} onValueChange={(v) => setTab(v as BusinessTab)}>
                  <TabsList className="bg-transparent border-b border-border rounded-none w-full justify-start gap-1 h-auto p-0 flex-wrap">
                    {([
                      { v: 'activity', label: 'Activity' },
                      { v: 'notes', label: 'Notes' },
                      { v: 'leads', label: 'Leads' },
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
                        {t.v === 'leads' && leadsCount > 0 && (
                          <span className="ml-1 text-xs text-muted-foreground">({leadsCount})</span>
                        )}
                        {t.v === 'notes' && clientNotes.length > 0 && (
                          <span className="ml-1 text-xs text-muted-foreground">({clientNotes.length})</span>
                        )}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>

                <div className="pt-4">
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
                      organizationId={organizationId!}
                      userId={user?.userId}
                      userName={user?.displayName}
                      canManage={canManage}
                      notes={clientNotes}
                      onChanged={reloadNotes}
                    />
                  )}

                  {tab === 'leads' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-2">
                          Leads
                          <Badge variant="outline" className="text-[10px]">{leadsCount}</Badge>
                        </h3>
                        {canManage && (
                          <div className="w-[280px] max-w-full">
                            <Select value="" onValueChange={attachLead}>
                              <SelectTrigger>
                                <SelectValue placeholder="+ Add a lead to this business…" />
                              </SelectTrigger>
                              <SelectContent>
                                {attachableLeads.length === 0 ? (
                                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                                    No other leads to add.
                                  </div>
                                ) : (
                                  attachableLeads.map((l) => (
                                    <SelectItem key={l.leadId} value={l.leadId}>
                                      {leadDisplayName(l)}{l.company ? ` — ${l.company}` : ''}
                                    </SelectItem>
                                  ))
                                )}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>

                      {attachedLeads.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No leads on this business yet. Use the dropdown above to attach one.
                        </p>
                      ) : (
                        <ul className="divide-y divide-border rounded-md border">
                          {attachedLeads.map((l) => (
                            <li
                              key={l.leadId}
                              onClick={() => setSelectedLead(l)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedLead(l); }
                              }}
                              tabIndex={0}
                              className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/50 focus:bg-muted/60 outline-none"
                            >
                              <span className="w-7 h-7 rounded-md bg-primary-soft text-primary-soft-foreground grid place-items-center shrink-0">
                                <UserPlus className="w-3.5 h-3.5" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="font-medium truncate">{leadDisplayName(l)}</span>
                                  <Badge variant="outline" className="text-[9px] shrink-0">
                                    {leadStatusLabel(l.leadStatus)}
                                  </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground truncate">
                                  {[l.company, l.email, l.phone].filter(Boolean).join(' · ') || '—'}
                                </p>
                              </div>
                              {canManage && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); detachLead(l); }}
                                  className="text-muted-foreground hover:text-destructive p-1 rounded opacity-60 hover:opacity-100 transition-opacity shrink-0"
                                  title="Remove from this business"
                                  aria-label={`Remove ${leadDisplayName(l)} from this business`}
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {tab === 'pipeline' && (
                    <div className="space-y-5">
                      <div>
                        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-2 mb-1">
                          <Receipt className="w-4 h-4" /> Projects &amp; billing
                        </h3>
                        <p className="text-sm text-muted-foreground mb-3">
                          Deals for this business. Pick how each is billed, generate the invoice now, or
                          mark it delivered — delivering applies the billing choice and logs to the leads' Activity.
                        </p>
                        {businessDeals.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No deals for this business yet. Create one from the Pipeline.
                          </p>
                        ) : (
                          <ul className="space-y-2">
                            {businessDeals.map((d) => {
                              const mode = billingOf(d);
                              return (
                                <li key={d.dealId} className="rounded-md border p-3">
                                  <div className="flex items-start justify-between gap-2 flex-wrap">
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span className="font-medium truncate">{d.title}</span>
                                        <Badge variant="outline" className="text-[9px] capitalize shrink-0">{d.stage}</Badge>
                                      </div>
                                      <p className="text-xs text-muted-foreground mt-0.5">
                                        {formatMoney(d.value, d.currency)}
                                      </p>
                                    </div>
                                    <span className="text-[11px] text-muted-foreground shrink-0">
                                      Billing: {BILLING_LABEL[mode]}
                                    </span>
                                  </div>
                                  {canManage && (
                                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                                      <Select value={mode} onValueChange={(v) => setBilling(d, v as BillingMode)}>
                                        <SelectTrigger className="w-[200px] h-8 text-xs">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="on_completion">{BILLING_LABEL.on_completion}</SelectItem>
                                          <SelectItem value="monthly">{BILLING_LABEL.monthly}</SelectItem>
                                          <SelectItem value="none">{BILLING_LABEL.none}</SelectItem>
                                        </SelectContent>
                                      </Select>
                                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => generateInvoice(d)}>
                                        <Receipt className="w-3.5 h-3.5 mr-1" /> Generate invoice
                                      </Button>
                                      <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => markDelivered(d)}>
                                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Mark delivered
                                      </Button>
                                    </div>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                      <AccountStageHistoryCard
                        organizationId={organizationId!}
                        clientId={client.clientId}
                        currency={businessDeals[0]?.currency ?? orgCurrency}
                      />
                    </div>
                  )}

                  {tab === 'emails' && (
                    <EntityEmailsSection
                      organizationId={organizationId!}
                      entityType="client"
                      entityId={client.clientId}
                    />
                  )}

                  {tab === 'meetings' && (
                    <MeetingsTab
                      client={client}
                      organizationId={organizationId!}
                      userId={user?.userId}
                      userName={user?.displayName}
                      canManage={canManage}
                    />
                  )}

                  {tab === 'files' && (
                    <EntityAttachmentsSection
                      organizationId={organizationId!}
                      entityType="client"
                      entityId={client.clientId}
                      canManage={canManage}
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
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      {/* Lead detail drawer */}
      {liveSelectedLead && (
        <LeadDetailDrawer
          lead={liveSelectedLead}
          organizationId={organizationId}
          canManage={canManage}
          readOnly={!canEditModule('leads')}
          accountName={client.name}
          onClose={() => setSelectedLead(null)}
          onEdit={(l) => setEditingLead(l)}
          onDelete={(l) => setConfirmDeleteLead(l)}
          onStatusChange={async (l, next) => { await updateLead(l.leadId, { leadStatus: next }); }}
          onUpdate={async (leadId, patch) => {
            const updated = await updateLead(leadId, patch);
            setSelectedLead(updated);
            return updated;
          }}
        />
      )}

      {/* Lead edit form */}
      <LeadFormDialog
        open={!!editingLead}
        onOpenChange={(o) => { if (!o) setEditingLead(null); }}
        lead={editingLead}
        accounts={allClients}
        workspaces={workspaces}
        onSubmit={async (input) => {
          if (!editingLead) return;
          try {
            await updateLead(editingLead.leadId, input);
            toast.success(`Updated lead ${editingLead.leadNumber}`);
            setEditingLead(null);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to save lead');
            throw err;
          }
        }}
      />

      {/* Delete lead confirmation */}
      <AlertDialog
        open={!!confirmDeleteLead}
        onOpenChange={(o) => { if (!o) setConfirmDeleteLead(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this lead?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDeleteLead && (
                <>
                  Permanently remove <strong>{leadDisplayName(confirmDeleteLead)}</strong>
                  {' '}({confirmDeleteLead.leadNumber}) and any notes attached to it.
                  This cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingLead}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingLead}
              onClick={async () => {
                if (!confirmDeleteLead) return;
                setDeletingLead(true);
                try {
                  await removeLead(confirmDeleteLead.leadId);
                  toast.success('Lead deleted');
                  if (selectedLead?.leadId === confirmDeleteLead.leadId) setSelectedLead(null);
                  setConfirmDeleteLead(null);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Delete failed');
                } finally {
                  setDeletingLead(false);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingLead && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <Trash2 className="w-4 h-4 mr-1" /> Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default BusinessAccountPage;
