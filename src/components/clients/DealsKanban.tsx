import React, { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { Building2, Calendar as CalendarIcon, Loader2, Plus, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { format, isPast } from 'date-fns';
import { useDeals } from '@/hooks/useDeals';
import {
  DEAL_STAGES,
  Deal,
  DealStage,
  formatDealMoney,
} from '@/services/supabase/deals';
import { PipelineStage } from '@/services/supabase/pipelines';
import { Client } from '@/services/supabase/clients';
import { toast } from 'sonner';
import { NewDealDialog } from './NewDealDialog';
import { convertAmount, useFxRates } from '@/lib/fxRates';

interface Props {
  clients: Client[];
  /** When set, the kanban only shows deals for this client. */
  scopedClientId?: string | null;
  onSelectDeal?: (deal: Deal) => void;
  /** Show every amount converted into this currency. When omitted, each
   *  deal is shown in the currency it was entered in. */
  displayCurrency?: string;
  /** Optional pipeline scope. When set, the kanban only shows deals in this
   *  pipeline and drag targets are interpreted against the supplied stages. */
  pipelineId?: string;
  /** Stages that drive the column layout. When empty, falls back to the
   *  legacy hardcoded six-stage list so existing screens keep working before
   *  the pipelines layer has finished loading. */
  stages?: PipelineStage[];
}

/** Internal stage shape used by the column renderer and grouping logic. The
 *  `id` is the source-of-truth identifier for drag targets — a stage uuid
 *  when driven by `pipeline_stages`, or the legacy stage key when falling
 *  back to `DEAL_STAGES`. `key` is the value persisted on `deals.stage`. */
interface EffectiveStage {
  id: string;
  key: string;
  label: string;
  color: string;
  isWon: boolean;
  isLost: boolean;
}

const DealCard: React.FC<{
  deal: Deal;
  onSelect?: (d: Deal) => void;
  displayCurrency?: string;
  rates: Record<string, number>;
}> = ({ deal, onSelect, displayCurrency, rates }) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.dealId,
    data: { type: 'deal', deal },
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        'group rounded-md border border-border bg-card p-2.5 cursor-grab active:cursor-grabbing transition-shadow',
        isDragging ? 'opacity-40 shadow-lg' : 'hover:shadow-sm',
      )}
      onClick={(e) => {
        // Skip click-to-open while a drag is in progress (dnd-kit cancels but
        // the click event can still bubble on touch).
        if (e.defaultPrevented) return;
        onSelect?.(deal);
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-tight line-clamp-2">{deal.title}</p>
        <span className="text-sm font-semibold text-foreground shrink-0">
          {displayCurrency
            ? formatDealMoney(
                convertAmount(deal.value, deal.currency, displayCurrency, rates),
                displayCurrency,
              )
            : formatDealMoney(deal.value, deal.currency)}
        </span>
      </div>
      {deal.clientName && (
        <p className="mt-1 text-xs text-muted-foreground inline-flex items-center gap-1">
          <Building2 className="w-3 h-3" /> {deal.clientName}
        </p>
      )}
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <User className="w-3 h-3" />
          {deal.ownerName ?? 'Unassigned'}
        </span>
        {deal.expectedCloseDate ? (
          <span
            className={cn(
              'inline-flex items-center gap-1',
              isPast(deal.expectedCloseDate) &&
                deal.stage !== 'won' &&
                deal.stage !== 'lost' &&
                'text-red-600 dark:text-red-400',
            )}
          >
            <CalendarIcon className="w-3 h-3" />
            {format(deal.expectedCloseDate, 'MMM d')}
          </span>
        ) : (
          <span>—</span>
        )}
      </div>
      {deal.probability > 0 && deal.probability < 100 && (
        <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary"
            style={{ width: `${deal.probability}%` }}
            aria-label={`${deal.probability}% probability`}
          />
        </div>
      )}
    </div>
  );
};

const StageColumn: React.FC<{
  stage: EffectiveStage;
  deals: Deal[];
  onAdd: (stage: EffectiveStage) => void;
  onSelect?: (d: Deal) => void;
  canCreate: boolean;
  displayCurrency?: string;
  rates: Record<string, number>;
}> = ({ stage, deals, onAdd, onSelect, canCreate, displayCurrency, rates }) => {
  const { setNodeRef, isOver } = useDroppable({
    id: `stage:${stage.id}`,
    data: { type: 'stage', stage: stage.id },
  });
  const total = useMemo(() => {
    if (displayCurrency) {
      return deals.reduce(
        (s, d) =>
          s + convertAmount(d.value, d.currency, displayCurrency, rates),
        0,
      );
    }
    return deals.reduce((s, d) => s + d.value, 0);
  }, [deals, displayCurrency, rates]);
  const totalCurrency = displayCurrency ?? deals[0]?.currency ?? 'USD';
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col w-[18.5rem] shrink-0 rounded-lg border border-border bg-card/40 transition-colors',
        isOver && 'ring-2 ring-primary/40 bg-primary/5',
      )}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ background: stage.color }}
          />
          <span className="text-sm font-semibold truncate">{stage.label}</span>
          <Badge variant="outline" className="text-[10px] px-1 py-0">
            {deals.length}
          </Badge>
        </div>
        <span className="text-xs font-mono text-muted-foreground tabular-nums">
          {formatDealMoney(total, totalCurrency)}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[8rem] max-h-[calc(100vh-22rem)]">
        {deals.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            Drop deals here
          </p>
        ) : (
          deals.map((d) => (
            <DealCard
              key={d.dealId}
              deal={d}
              onSelect={onSelect}
              displayCurrency={displayCurrency}
              rates={rates}
            />
          ))
        )}
      </div>
      {canCreate && (
        <div className="border-t border-border p-1.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="w-full justify-start text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onAdd(stage)}
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Add deal
          </Button>
        </div>
      )}
    </div>
  );
};

export const DealsKanban: React.FC<Props> = ({
  clients,
  scopedClientId,
  onSelectDeal,
  displayCurrency,
  pipelineId,
  stages,
}) => {
  const { dealsByStage, loading, update, canManage } = useDeals(pipelineId);
  const { rates } = useFxRates();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const [draggingDeal, setDraggingDeal] = useState<Deal | null>(null);
  const [showNew, setShowNew] = useState<{ stage: DealStage } | null>(null);
  // Won-stage drop intercept. Set by handleDragEnd when the target stage has
  // `isWon`; Task 11 will mount <DealWonModal/> against this state. For now we
  // surface a placeholder toast and clear it so the user still gets feedback.
  const [pendingWonStage, setPendingWonStage] = useState<{
    deal: Deal;
    stageId: string;
    label: string;
  } | null>(null);

  const effectiveStages = useMemo<EffectiveStage[]>(() => {
    if (stages && stages.length > 0) {
      return stages.map((s) => ({
        id: s.stageId,
        key: s.key,
        label: s.label,
        color: s.color,
        isWon: s.isWon,
        isLost: s.isLost,
      }));
    }
    return DEAL_STAGES.map((s) => ({
      id: s.id, // legacy: id === key, so drag-end can resolve either way
      key: s.id,
      label: s.label,
      color: s.color,
      isWon: s.id === 'won',
      isLost: s.id === 'lost',
    }));
  }, [stages]);

  // Build a key-indexed map of deals so column rendering can look up each
  // stage's list in O(1). We re-key from the per-deal `stage` text (the
  // denormalized convenience column) to stay independent of how `useDeals`
  // currently groups.
  const dealsByKey = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const stage of effectiveStages) map.set(stage.key, []);
    for (const list of dealsByStage.values()) {
      for (const d of list) {
        if (scopedClientId && d.clientId !== scopedClientId) continue;
        const key = d.stage;
        if (map.has(key)) map.get(key)!.push(d);
      }
    }
    return map;
  }, [dealsByStage, effectiveStages, scopedClientId]);

  const handleDragStart = (e: DragStartEvent) => {
    const deal = e.active?.data?.current?.deal as Deal | undefined;
    setDraggingDeal(deal ?? null);
  };

  const handleDragOver = (_e: DragOverEvent) => {
    /* no-op — we commit on drop only */
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    setDraggingDeal(null);
    const overId = e.over?.id?.toString();
    const deal = e.active?.data?.current?.deal as Deal | undefined;
    if (!overId || !deal) return;
    const targetStageRecord = overId.startsWith('stage:')
      ? effectiveStages.find((s) => s.id === overId.slice('stage:'.length))
      : null;
    if (!targetStageRecord || targetStageRecord.key === deal.stage) return;

    // Won stages are intercepted — they need the project-creation handoff in
    // Task 11 rather than a plain stage update.
    if (targetStageRecord.isWon) {
      setPendingWonStage({
        deal,
        stageId: targetStageRecord.id,
        label: targetStageRecord.label,
      });
      return;
    }

    try {
      await update(deal.dealId, { stageId: targetStageRecord.id });
      toast.success(`Moved "${deal.title}" to ${targetStageRecord.label}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not move deal');
    }
  };

  // Temporary placeholder for Task 11. When a deal is dropped into a Won
  // stage we set `pendingWonStage`; the modal will mount here in the next
  // commit. Until then, surface a toast and clear so the user still sees
  // feedback rather than a silent drop.
  useEffect(() => {
    if (!pendingWonStage) return;
    toast.info(
      `"${pendingWonStage.deal.title}" reached ${pendingWonStage.label} — won-handoff modal lands next commit.`,
    );
    setPendingWonStage(null);
  }, [pendingWonStage]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const totalCount = Array.from(dealsByKey.values()).reduce(
    (n, l) => n + l.length,
    0,
  );

  return (
    <>
      {totalCount === 0 && (
        <Card className="mb-4">
          <CardContent className="text-center py-8 text-sm text-muted-foreground">
            No deals yet. Click <strong>Add deal</strong> in any column below to
            start a sales pipeline.
          </CardContent>
        </Card>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-3 overflow-x-auto pb-3">
          {effectiveStages.map((stage) => (
            <StageColumn
              key={stage.id}
              stage={stage}
              deals={dealsByKey.get(stage.key) ?? []}
              // NewDealDialog still expects the legacy DealStage union. The
              // mapping is safe in the fallback path (id === key) and in the
              // pipeline path the column key is the persisted stage text the
              // dialog will write to `deals.stage` via the sync trigger.
              onAdd={(s) => setShowNew({ stage: s.key as DealStage })}
              onSelect={onSelectDeal}
              canCreate={canManage}
              displayCurrency={displayCurrency}
              rates={rates}
            />
          ))}
        </div>
        <DragOverlay>
          {draggingDeal ? (
            <div className="w-[18.5rem]">
              <DealCard
                deal={draggingDeal}
                displayCurrency={displayCurrency}
                rates={rates}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {showNew && canManage !== false && (
        <NewDealDialog
          open={!!showNew}
          onOpenChange={(o) => !o && setShowNew(null)}
          defaultStage={showNew.stage}
          defaultClientId={scopedClientId ?? null}
          clients={clients}
        />
      )}
    </>
  );
};

export default DealsKanban;
