import React, { useEffect, useMemo, useState } from 'react';
import { Briefcase, CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useOrganization } from '@/context/OrganizationContext';
import {
  listActivities, type Activity,
} from '@/services/supabase/activities';
import { onMeetingsChanged } from '@/services/supabase/meetings';
import { onCallsChanged } from '@/services/supabase/calls';
import { ActivityCard } from './ActivityCard';
import { ActivityDetailDialog } from './ActivityDetailDialog';
import { CreateTaskDialog } from './CreateTaskDialog';
import { CreateMeetingDialog } from './CreateMeetingDialog';
import { CreateCallDialog } from './CreateCallDialog';
import type { RelatedTo } from './RelatedToPicker';
import type { RelatedToType } from '@/services/supabase/meetings';

interface EntityActivitiesSectionProps {
  /** What the parent screen calls itself — controls section-anchor ids. */
  entityKind: 'lead' | 'contact' | 'account' | 'deal';
  /** Display name used to pre-fill the Related To pill on the create
   *  dialogs (so the rep doesn't re-pick the same record). */
  entityName: string;
  /** Required: id of the row this section belongs to. Drives both the
   *  defaultRelatedTo and the activity filter. */
  entityId: string;
  /** Optional: if the entity is a Contact (whose parent is a Client), or
   *  a Lead that's been converted, pass the parent clientId here.
   *  Activities created via the +Task / +Meeting / +Call buttons attach
   *  to this clientId so the same activity also surfaces on the Account
   *  drawer's section. Pass null to skip. */
  clientId?: string | null;
  /** Same idea — pass a related dealId when known so quick-create
   *  activities land on the deal too. */
  dealId?: string | null;
  /** Section type — 'open' shows activities whose `open` is true,
   *  'closed' shows the rest. */
  mode: 'open' | 'closed';
  /** When true the section is read-only (no quick-create buttons). */
  readOnly?: boolean;
}

/**
 * Drop-in replacement for the disabled `RelatedPlaceholder` blocks on
 * the Lead / Contact / Account / Deal drawers. Pulls the unified
 * activities feed via the existing aggregator and filters down to the
 * rows that touch this entity (via clientId/dealId, since that's what
 * the underlying meetings/calls/tasks tables actually store).
 *
 * Lead-specific note: Leads aren't in `clients` yet (they live in
 * `leads`). Until a converted lead has a client_id, no activities will
 * link to it — clicking +Task here creates a task with no client/deal
 * link (still visible on the org-wide Activities hub, just not back-
 * linked to this lead). That's the cleanest behavior without a schema
 * change to add lead_id to client_tasks / meetings / calls.
 */
export const EntityActivitiesSection: React.FC<EntityActivitiesSectionProps> = ({
  entityKind, entityName, entityId, clientId = null, dealId = null,
  mode, readOnly = false,
}) => {
  const { organization } = useOrganization();
  const orgId = organization?.organizationId ?? null;

  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [taskOpen, setTaskOpen] = useState(false);
  const [meetingOpen, setMeetingOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const [detail, setDetail] = useState<Activity | null>(null);

  // The Related To we want pre-filled on the create dialogs.
  // We can only pre-fill if the entity has a real picker-supported
  // record (account/client/deal/contact) — leads aren't yet a
  // pickable type, so leave undefined for a non-converted lead.
  const defaultRelatedTo: RelatedTo | null = useMemo(() => {
    if (entityKind === 'lead') return null;
    const type: RelatedToType =
      entityKind === 'contact' ? 'contact' :
      entityKind === 'deal'    ? 'deal'    :
      'client';
    return {
      type, id: entityId, label: entityName,
      clientId, dealId,
    };
  }, [entityKind, entityId, entityName, clientId, dealId]);

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    (async () => {
      try {
        // The aggregator wants the same openDealIds/customerClientIds
        // sets the hub uses — but at the drawer level we don't actually
        // surface the category pills, so empty sets are fine. Categorize
        // by relationship instead at the row level.
        const rows = await listActivities(orgId, {
          openDealIds: new Set(),
          customerClientIds: new Set(),
        });
        setActivities(rows);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not load activities');
      } finally {
        setLoading(false);
      }
    })();
  }, [orgId, reloadKey]);

  useEffect(() => {
    if (!orgId) return;
    const off1 = onMeetingsChanged((o) => { if (o === orgId) setReloadKey((k) => k + 1); });
    const off2 = onCallsChanged((o) => { if (o === orgId) setReloadKey((k) => k + 1); });
    return () => { off1(); off2(); };
  }, [orgId]);

  // Pick the rows that touch this entity. We match on clientId and
  // dealId because those are the only relational columns the source
  // tables currently carry. A row touches the entity if either id
  // matches one of ours (the contact case typically has just clientId;
  // the deal case has dealId).
  const filtered = useMemo(() => {
    const rows = activities.filter((a) => {
      const src = a.source.kind === 'task' ? a.source.row
        : a.source.kind === 'meeting' ? a.source.row
        : a.source.row;
      const rowClient = (src as { clientId?: string | null }).clientId ?? null;
      const rowDeal = (src as { dealId?: string | null }).dealId ?? null;
      if (clientId && rowClient === clientId) return true;
      if (dealId && rowDeal === dealId) return true;
      // For Contact, also match meetings whose related_to_id is our contactId.
      if (entityKind === 'contact' && a.source.kind === 'meeting'
        && a.source.row.relatedToType === 'contact'
        && a.source.row.relatedToId === entityId) return true;
      if (entityKind === 'contact' && a.source.kind === 'call'
        && a.source.row.relatedToType === 'contact'
        && a.source.row.relatedToId === entityId) return true;
      return false;
    });
    return rows.filter((a) => mode === 'open' ? a.open : !a.open);
  }, [activities, clientId, dealId, entityKind, entityId, mode]);

  const Icon = mode === 'open' ? Briefcase : CheckCircle2;
  const title = mode === 'open' ? 'Open Activities' : 'Closed Activities';
  const canQuickCreate = !readOnly && mode === 'open';

  return (
    <div>
      <h3 className="text-sm font-semibold flex items-center justify-between border-b pb-1.5 mb-2">
        <span className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-muted-foreground" /> {title}
          <span className="text-[11px] text-muted-foreground font-normal">
            ({filtered.length})
          </span>
        </span>
        {canQuickCreate && (
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button" onClick={() => setTaskOpen(true)}
              className="text-primary hover:underline"
            >
              + Task
            </button>
            <button
              type="button" onClick={() => setMeetingOpen(true)}
              className="text-primary hover:underline"
            >
              + Meeting
            </button>
            <button
              type="button" onClick={() => setCallOpen(true)}
              className="text-primary hover:underline"
            >
              + Call
            </button>
          </div>
        )}
      </h3>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground py-1.5">
          {mode === 'open'
            ? canQuickCreate
              ? 'No open activities. Use + Task / + Meeting / + Call to add one.'
              : 'No open activities.'
            : 'No closed activities yet.'}
        </p>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((a) => (
            <ActivityCard key={a.id} activity={a} onClick={setDetail} compact />
          ))}
        </div>
      )}

      <CreateTaskDialog
        open={taskOpen} onOpenChange={setTaskOpen}
        defaultRelatedTo={defaultRelatedTo}
        onCreated={() => setReloadKey((k) => k + 1)}
      />
      <CreateMeetingDialog
        open={meetingOpen} onOpenChange={setMeetingOpen}
        defaultRelatedTo={defaultRelatedTo}
        onCreated={() => setReloadKey((k) => k + 1)}
      />
      <CreateCallDialog
        open={callOpen} onOpenChange={setCallOpen}
        defaultRelatedTo={defaultRelatedTo}
        onCreated={() => setReloadKey((k) => k + 1)}
      />
      <ActivityDetailDialog
        activity={detail}
        onOpenChange={(open) => { if (!open) setDetail(null); }}
        onChanged={() => setReloadKey((k) => k + 1)}
      />
    </div>
  );
};
