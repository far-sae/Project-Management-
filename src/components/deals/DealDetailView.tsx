import React, { useMemo, useState } from 'react';
import {
  ArrowLeft, Edit, Loader2, Phone,
  Users, History, Swords,
  CheckCircle2, MessageSquare, Trash2,
} from 'lucide-react';
import { format, differenceInCalendarDays } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { useDeals } from '@/hooks/useDeals';
import { useClients } from '@/hooks/useClients';
import { useContacts } from '@/hooks/useContacts';
import { useDealRelations } from '@/hooks/useDealRelations';
import {
  DEAL_STAGES, DealStage, STAGE_DEFAULT_PROBABILITY, formatDealMoney,
} from '@/services/supabase/deals';
import { DealStagePath } from '@/components/deals/DealStagePath';
import { DealVerifyDetailsDialog } from '@/components/deals/DealVerifyDetailsDialog';
import { DealFormDialog } from '@/components/deals/DealFormDialog';
import { DealCompetitorsCard } from '@/components/deals/DealCompetitorsCard';
import { DealContactRolesCard } from '@/components/deals/DealContactRolesCard';
import { recordLocalStageChange } from '@/services/supabase/dealRelations';

const fmtDate = (d: Date | null | undefined) =>
  d ? format(d, 'MMM d, yyyy') : '—';

export interface DealDetailViewProps {
  dealId: string;
  /** Called when the user taps the back chevron. Lets the parent decide
   *  whether to clear a selection, change tab, or navigate elsewhere. */
  onBack: () => void;
  /** When true, the back arrow renders. Hidden when the detail view is the
   *  page's primary content (no place to go back to). */
  showBack?: boolean;
}

/**
 * Zoho-style Deal detail view. Embeddable — lives inside the Pipeline tab
 * of the CRM page rather than a dedicated route. Layout matches the Zoho
 * screenshots: summary grid, Stage Path, Contact Person, Competitors,
 * Contact Roles, Stage History, with a side rail of Sales Summary numbers.
 */
export const DealDetailView: React.FC<DealDetailViewProps> = ({
  dealId, onBack, showBack = true,
}) => {
  const { deals, update, remove, loading, canManage } = useDeals();
  const { clients } = useClients();
  const { contacts } = useContacts();

  const deal = useMemo(() => deals.find((d) => d.dealId === dealId) ?? null, [deals, dealId]);

  const primaryContact = useMemo(
    () => (deal?.contactId ? contacts.find((c) => c.contactId === deal.contactId) ?? null : null),
    [deal, contacts],
  );

  const candidateContacts = useMemo(() => {
    if (!deal?.clientId) return contacts;
    return contacts.filter((c) => c.clientId === deal.clientId);
  }, [contacts, deal?.clientId]);

  const {
    competitors, contactRoles, stageHistory,
    addCompetitor, removeCompetitor,
    addContactRole, patchContactRole, removeContactRole,
    canManage: canManageRelations,
  } = useDealRelations(deal?.dealId ?? null);

  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifyTarget, setVerifyTarget] = useState<DealStage | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleStagePick = (next: DealStage) => {
    if (!deal || next === deal.stage) return;
    setVerifyTarget(next);
    setVerifyOpen(true);
  };

  const handleVerifyConfirm = async (patch: {
    stage: DealStage;
    value: number;
    expectedCloseDate: Date | null;
  }) => {
    if (!deal) return;
    const previousStage = deal.stage;
    await update(deal.dealId, {
      stage: patch.stage,
      value: patch.value,
      expectedCloseDate: patch.expectedCloseDate,
      probability: STAGE_DEFAULT_PROBABILITY[patch.stage],
    });
    recordLocalStageChange(deal.organizationId, {
      dealId: deal.dealId,
      fromStage: previousStage,
      toStage: patch.stage,
      amount: patch.value,
      probability: STAGE_DEFAULT_PROBABILITY[patch.stage],
      expectedCloseDate: patch.expectedCloseDate,
      changedBy: null,
      changedByName: null,
    });
    toast.success(`Stage moved to ${DEAL_STAGES.find((s) => s.id === patch.stage)?.label ?? patch.stage}`);
  };

  const handleDelete = async () => {
    if (!deal) return;
    setDeleting(true);
    try {
      await remove(deal.dealId);
      toast.success('Deal deleted');
      onBack();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete deal');
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const salesCycleDays = useMemo(() => {
    if (!deal) return null;
    const start = deal.createdAt;
    const end = deal.closedAt ?? new Date();
    return differenceInCalendarDays(end, start);
  }, [deal]);

  if (loading || !deal) {
    return (
      <div className="min-h-[40vh] grid place-items-center text-muted-foreground">
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Deal not found'}
      </div>
    );
  }

  const stageMeta = DEAL_STAGES.find((s) => s.id === deal.stage);
  const expectedRevenue = Math.round((deal.value * deal.probability) / 100);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <aside className="lg:w-56 shrink-0 space-y-4">
        {showBack && (
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
            <ArrowLeft className="w-4 h-4 mr-1" /> All Deals
          </Button>
        )}
        <nav className="space-y-1 text-sm">
          <a href="#info" className="block px-2 py-1 rounded text-primary font-medium bg-primary/10">Info</a>
          <a href="#timeline" className="block px-2 py-1 rounded hover:bg-muted text-muted-foreground">Timeline</a>
        </nav>
        <div className="space-y-1">
          <p className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground px-2">Related List</p>
          <nav className="space-y-0.5 text-sm">
            <a href="#notes" className="block px-2 py-1 rounded hover:bg-muted text-muted-foreground inline-flex items-center gap-1.5"><MessageSquare className="w-3 h-3" /> Notes</a>
            <a href="#stage-history" className="block px-2 py-1 rounded hover:bg-muted text-muted-foreground inline-flex items-center gap-1.5">
              <History className="w-3 h-3" /> Stage History
              {stageHistory.length > 0 && <Badge variant="outline" className="ml-1 text-[9px]">{stageHistory.length}</Badge>}
            </a>
            <a href="#competitors" className="block px-2 py-1 rounded hover:bg-muted text-muted-foreground inline-flex items-center gap-1.5"><Swords className="w-3 h-3" /> Competitors</a>
            <a href="#contact-roles" className="block px-2 py-1 rounded hover:bg-muted text-muted-foreground inline-flex items-center gap-1.5">
              <Users className="w-3 h-3" /> Contact Roles
              {contactRoles.length > 0 && <Badge variant="outline" className="ml-1 text-[9px]">{contactRoles.length}</Badge>}
            </a>
          </nav>
        </div>
        <div className="border-t pt-3 space-y-1">
          <p className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground px-2">Sales Summary</p>
          <p className="text-xs px-2"><span className="text-muted-foreground">Lead Conversion Time:</span> NA</p>
          <p className="text-xs px-2">
            <span className="text-muted-foreground">Sales Cycle Duration:</span>{' '}
            {salesCycleDays != null ? `${salesCycleDays} day${salesCycleDays === 1 ? '' : 's'}` : '—'}
          </p>
          <p className="text-xs px-2">
            <span className="text-muted-foreground">Overall Sales Duration:</span>{' '}
            {salesCycleDays != null ? `${salesCycleDays} day${salesCycleDays === 1 ? '' : 's'}` : '—'}
          </p>
        </div>
      </aside>

      <main className="flex-1 min-w-0 space-y-5">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-semibold break-words">
              {deal.title}
              <span className="text-muted-foreground font-medium ml-2">- {formatDealMoney(deal.value, deal.currency)}</span>
            </h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canManage && (
              <>
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  <Edit className="w-3.5 h-3.5 mr-1" /> Edit
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </>
            )}
          </div>
        </div>

        <Card>
          <CardContent className="pt-5 grid grid-cols-2 md:grid-cols-4 gap-y-3 gap-x-6">
            <div>
              <p className="text-xs text-muted-foreground">Stage</p>
              <p className="font-semibold inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: stageMeta?.color ?? '#999' }} />
                {stageMeta?.label ?? deal.stage}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Probability (%)</p>
              <p className="font-semibold">{deal.probability}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Expected Revenue</p>
              <p className="font-semibold tabular-nums">{formatDealMoney(expectedRevenue, deal.currency)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Closing Date</p>
              <p className="font-semibold">{fmtDate(deal.expectedCloseDate)}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <DealStagePath
              current={deal.stage}
              onPick={canManage ? handleStagePick : undefined}
              expectedCloseLabel={fmtDate(deal.expectedCloseDate)}
              readOnly={!canManage}
            />
          </CardContent>
        </Card>

        {(deal.dealType || deal.nextStep || deal.leadSource || deal.campaignSource) && (
          <Card>
            <CardContent className="pt-5 grid grid-cols-1 md:grid-cols-2 gap-y-2 gap-x-6 text-sm">
              {deal.dealType && (<p><span className="text-muted-foreground">Type:</span> <span className="font-medium">{deal.dealType}</span></p>)}
              {deal.nextStep && (<p><span className="text-muted-foreground">Next Step:</span> <span className="font-medium">{deal.nextStep}</span></p>)}
              {deal.leadSource && (<p><span className="text-muted-foreground">Lead Source:</span> <span className="font-medium">{deal.leadSource}</span></p>)}
              {deal.campaignSource && (<p><span className="text-muted-foreground">Campaign Source:</span> <span className="font-medium">{deal.campaignSource}</span></p>)}
            </CardContent>
          </Card>
        )}

        {primaryContact && (
          <Card>
            <CardContent className="pt-5">
              <p className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground mb-2">Contact Person</p>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-muted grid place-items-center shrink-0">
                  <Users className="w-5 h-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">
                    {[primaryContact.firstName, primaryContact.lastName].filter(Boolean).join(' ') || '(no name)'}
                  </p>
                  {primaryContact.email && (
                    <a href={`mailto:${primaryContact.email}`} className="text-sm text-primary hover:underline block">
                      {primaryContact.email}
                    </a>
                  )}
                  {primaryContact.phone && (
                    <p className="text-sm text-muted-foreground inline-flex items-center gap-1">
                      <Phone className="w-3 h-3" /> {primaryContact.phone}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card id="competitors">
          <CardContent className="pt-5">
            <DealCompetitorsCard
              competitors={competitors}
              canManage={canManage && canManageRelations}
              onAdd={addCompetitor}
              onRemove={removeCompetitor}
              dealId={deal.dealId}
            />
          </CardContent>
        </Card>

        <Card id="contact-roles">
          <CardContent className="pt-5">
            <DealContactRolesCard
              contactRoles={contactRoles}
              candidateContacts={candidateContacts}
              canManage={canManage && canManageRelations}
              dealId={deal.dealId}
              onAdd={addContactRole}
              onPatch={patchContactRole}
              onRemove={removeContactRole}
            />
          </CardContent>
        </Card>

        <Card id="stage-history">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold">Stage History</h3>
              <span className="text-xs text-muted-foreground">{stageHistory.length}</span>
            </div>
            {stageHistory.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No stage changes recorded yet.</p>
            ) : (
              <ul className="space-y-2">
                {stageHistory.map((h) => {
                  const from = DEAL_STAGES.find((s) => s.id === h.fromStage)?.label ?? h.fromStage ?? '(new)';
                  const to = DEAL_STAGES.find((s) => s.id === h.toStage)?.label ?? h.toStage;
                  return (
                    <li key={h.historyId} className="text-xs flex flex-wrap items-baseline gap-1.5">
                      <CheckCircle2 className="w-3 h-3 text-emerald-500 self-center" />
                      <span className="font-medium">{from} → {to}</span>
                      {h.amount != null && (
                        <span className="text-muted-foreground tabular-nums">
                          · {formatDealMoney(h.amount, deal.currency)}
                        </span>
                      )}
                      <span className="text-muted-foreground ml-auto">{format(h.changedAt, 'MMM d, yyyy · HH:mm')}</span>
                      {h.changedByName && <span className="text-muted-foreground">by {h.changedByName}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card id="notes">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base font-semibold">Notes</h3>
            </div>
            <p className="text-xs text-muted-foreground italic">
              Notes, calls, meetings, and tasks for this deal live on the deal's drawer in the kanban — extending this section
              with the ActivityTimeline is the next iteration.
            </p>
          </CardContent>
        </Card>
      </main>

      {editing && (
        <DealFormDialog
          open={editing}
          onOpenChange={setEditing}
          deal={deal}
          clients={clients}
          contacts={contacts}
        />
      )}

      <DealVerifyDetailsDialog
        open={verifyOpen}
        onOpenChange={setVerifyOpen}
        deal={deal}
        targetStage={verifyTarget}
        onConfirm={handleVerifyConfirm}
      />

      <AlertDialog open={confirmDelete} onOpenChange={(o) => { if (!deleting) setConfirmDelete(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this deal?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deal.title}" will be permanently removed along with its competitors, contact roles, and stage history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void handleDelete(); }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Deleting…</> : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
