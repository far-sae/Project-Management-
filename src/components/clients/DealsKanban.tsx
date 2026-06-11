import React, { useMemo, useState } from 'react';
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
import {
  Building2,
  Calendar as CalendarIcon,
  ChevronDown,
  GripVertical,
  ListPlus,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  User,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { format, isPast } from 'date-fns';
import { useDeals } from '@/hooks/useDeals';
import {
  DEAL_STAGES,
  Deal,
  DealStage,
  STAGE_DEFAULT_PROBABILITY,
  formatDealMoney,
  resolveStageChange,
} from '@/services/supabase/deals';
import { PipelineStage } from '@/services/supabase/pipelines';
import { Client } from '@/services/supabase/clients';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { toast } from 'sonner';
import { NewDealDialog } from './NewDealDialog';
import { DealWonModal } from './DealWonModal';
import { CustomItemDialog } from '@/components/deals/CustomItemDialog';
import { convertAmount, useFxRates } from '@/lib/fxRates';

interface Props {
  clients: Client[];
  /** When set, the kanban only shows deals for this client. */
  scopedClientId?: string | null;
  /** When set, the kanban only shows deals whose linked client is in this
   *  set. Used by the workspace-scoped Pipeline tab to hide deals belonging
   *  to clients in other workspaces. */
  restrictToClientIds?: Set<string> | null;
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
  /** Called after a deal is successfully transitioned to a Won stage.
   *  Parent (Clients.tsx) uses this to open the handoff dialog. */
  onDealWon?: (deal: Deal) => void;
  /** Called when the rep clicks "Assign task" on any deal card. Parent
   *  (Clients.tsx) opens the (generalized) DealHandoffDialog for it. */
  onAssignTask?: (deal: Deal) => void;
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
  /** Per-stage probability (%) — shown in the column header next to the
   *  stage name, matching Zoho's "Qualification 10%" style. */
  defaultProbability: number;
}

const DealCard: React.FC<{
  deal: Deal;
  onSelect?: (d: Deal) => void;
  onEdit?: (d: Deal) => void;
  onMove?: (deal: Deal, stage: EffectiveStage) => void;
  onAssignTask?: (d: Deal) => void;
  stages: EffectiveStage[];
  displayCurrency?: string;
  rates: Record<string, number>;
}> = ({ deal, onSelect, onEdit, onMove, onAssignTask, stages, displayCurrency, rates }) => {
  const fmtMoney = useFormatMoney();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.dealId,
    data: { type: 'deal', deal },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'group rounded-md border border-border bg-card p-2.5 transition-shadow',
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
        <div className="flex min-w-0 items-start gap-1.5">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="mt-0.5 cursor-grab rounded p-0.5 text-muted-foreground opacity-60 hover:bg-muted hover:opacity-100 active:cursor-grabbing"
            aria-label="Drag deal"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          <p className="text-sm font-medium leading-tight line-clamp-2">
            {deal.title}
            {deal.dealType === 'custom' && (
              <Badge variant="secondary" className="ml-1.5 align-middle text-[9px] px-1 py-0">
                Custom
              </Badge>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-sm font-semibold text-foreground">
            {displayCurrency
              ? formatDealMoney(
                  convertAmount(deal.value, deal.currency, displayCurrency, rates),
                  displayCurrency,
                )
              : fmtMoney(deal.value, deal.currency)}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-6 w-6 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                aria-label="Deal actions"
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit?.(deal);
                }}
              >
                <Pencil className="mr-2 h-3.5 w-3.5" /> Edit deal
              </DropdownMenuItem>
              {stages
                .filter((s) => s.key !== deal.stage)
                .map((stage) => (
                  <DropdownMenuItem
                    key={stage.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onMove?.(deal, stage);
                    }}
                  >
                    Move to {stage.label}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
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

      {/* Primary controls: a stage dropdown (the obvious way to advance a
          deal — drag still works but isn't required) + an Assign-task
          action that works on ANY deal, not just won ones. Both stop the
          click from bubbling to the card's onSelect. */}
      {(onMove || onAssignTask) && (
        <div
          className="mt-2 flex items-center gap-1.5"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {onMove && (
            <Select
              value={deal.stage}
              onValueChange={(key) => {
                const next = stages.find((s) => s.key === key);
                // Route through the SAME path drag uses (moveDealToStage),
                // so a Won/Lost pick still hits the won-confirm / lost flow.
                if (next) onMove(deal, next);
              }}
            >
              <SelectTrigger
                className="h-7 flex-1 text-xs"
                aria-label="Change stage"
                onClick={(e) => e.stopPropagation()}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.key} className="text-xs">
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {onAssignTask && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground"
              title="Create a PM task for this deal"
              onClick={(e) => {
                e.stopPropagation();
                onAssignTask(deal);
              }}
            >
              <ListPlus className="mr-1 h-3.5 w-3.5" /> Assign task
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

const StageColumn: React.FC<{
  stage: EffectiveStage;
  deals: Deal[];
  onAdd: (stage: EffectiveStage) => void;
  onAddCustom: (stage: EffectiveStage) => void;
  onSelect?: (d: Deal) => void;
  onEdit?: (d: Deal) => void;
  onMove?: (deal: Deal, stage: EffectiveStage) => void;
  onAssignTask?: (d: Deal) => void;
  stages: EffectiveStage[];
  canCreate: boolean;
  displayCurrency?: string;
  rates: Record<string, number>;
}> = ({
  stage,
  deals,
  onAdd,
  onAddCustom,
  onSelect,
  onEdit,
  onMove,
  onAssignTask,
  stages,
  canCreate,
  displayCurrency,
  rates,
}) => {
  const fmtMoney = useFormatMoney();
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
      <div
        className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border"
        style={{ background: `${stage.color}14` }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ background: stage.color }}
          />
          <span className="text-sm font-semibold truncate">{stage.label}</span>
          {/* Zoho-style "·  10%" probability hint in the header. */}
          <span className="text-[11px] font-medium text-muted-foreground tabular-nums shrink-0">
            · {stage.defaultProbability}%
          </span>
          <Badge variant="outline" className="text-[10px] px-1 py-0">
            {deals.length}
          </Badge>
        </div>
        <span className="text-xs font-mono text-muted-foreground tabular-nums">
          {fmtMoney(total, totalCurrency)}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[12rem] max-h-[calc(100vh-16rem)]">
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
              onEdit={onEdit}
              onMove={onMove}
              onAssignTask={onAssignTask}
              stages={stages}
              displayCurrency={displayCurrency}
              rates={rates}
            />
          ))
        )}
      </div>
      {canCreate && (
        <div className="border-t border-border p-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="w-full justify-start text-xs text-muted-foreground hover:text-foreground"
              >
                <Plus className="w-3.5 h-3.5 mr-1" /> Add <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => onAdd(stage)}>Pipeline deal</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onAddCustom(stage)}>Custom item</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
};

export const DealsKanban: React.FC<Props> = ({
  clients,
  scopedClientId,
  restrictToClientIds,
  onSelectDeal,
  displayCurrency,
  pipelineId,
  stages,
  onDealWon,
  onAssignTask,
}) => {
  const { dealsByStage, loading, update, canManage } = useDeals(pipelineId);
  const { rates } = useFxRates();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const [draggingDeal, setDraggingDeal] = useState<Deal | null>(null);
  const [showNew, setShowNew] = useState<{
    stage: DealStage;
    pipelineId?: string | null;
    stageId?: string | null;
  } | null>(null);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  // Custom-item create (scoped to the current stage) / edit (clicking a custom
  // card). `customItemStage` carries the stage for a new item; `editingCustom`
  // carries the deal being edited.
  const [customItemStage, setCustomItemStage] = useState<DealStage | null>(null);
  const [editingCustom, setEditingCustom] = useState<Deal | null>(null);
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
        defaultProbability: s.defaultProbability ?? 0,
      }));
    }
    return DEAL_STAGES.map((s) => ({
      id: s.id, // legacy: id === key, so drag-end can resolve either way
      key: s.id,
      label: s.label,
      color: s.color,
      isWon: s.id === 'won',
      isLost: s.id === 'lost',
      defaultProbability: STAGE_DEFAULT_PROBABILITY[s.id] ?? 0,
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
        if (restrictToClientIds && d.clientId && !restrictToClientIds.has(d.clientId)) continue;
        const key = d.stage;
        if (map.has(key)) map.get(key)!.push(d);
      }
    }
    return map;
  }, [dealsByStage, effectiveStages, scopedClientId, restrictToClientIds]);

  const handleDragStart = (e: DragStartEvent) => {
    const deal = e.active?.data?.current?.deal as Deal | undefined;
    setDraggingDeal(deal ?? null);
  };

  const handleDragOver = (_e: DragOverEvent) => {
    /* no-op — we commit on drop only */
  };

  const moveDealToStage = async (deal: Deal, targetStageRecord: EffectiveStage) => {
    const action = resolveStageChange(deal.stage, targetStageRecord);
    if (action === 'noop') return;
    // Won stages are intercepted — they need the project-creation handoff
    // via DealWonModal rather than a plain stage update.
    if (action === 'won-confirm') {
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

  const handleDragEnd = async (e: DragEndEvent) => {
    setDraggingDeal(null);
    const overId = e.over?.id?.toString();
    const deal = e.active?.data?.current?.deal as Deal | undefined;
    if (!overId || !deal) return;
    const targetStageRecord = overId.startsWith('stage:')
      ? effectiveStages.find((s) => s.id === overId.slice('stage:'.length))
      : null;
    if (!targetStageRecord) return;
    await moveDealToStage(deal, targetStageRecord);
  };

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
              onAdd={(s) =>
                setShowNew({
                  stage: s.key as DealStage,
                  pipelineId: pipelineId ?? null,
                  stageId: stages?.length ? s.id : null,
                })
              }
              onAddCustom={(s) => { setEditingCustom(null); setCustomItemStage(s.key as DealStage); }}
              onSelect={(d) => {
                // Custom items open their own edit dialog; standard deals keep
                // their existing open behaviour (parent's onSelectDeal).
                if (d.dealType === 'custom') {
                  setCustomItemStage(null);
                  setEditingCustom(d);
                } else {
                  onSelectDeal?.(d);
                }
              }}
              onEdit={(deal) =>
                deal.dealType === 'custom'
                  ? (setCustomItemStage(null), setEditingCustom(deal))
                  : setEditingDeal(deal)
              }
              onMove={
                canManage
                  ? (deal, targetStage) => {
                      moveDealToStage(deal, targetStage);
                    }
                  : undefined
              }
              onAssignTask={onAssignTask}
              stages={effectiveStages}
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
                stages={effectiveStages}
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
          defaultPipelineId={showNew.pipelineId ?? null}
          defaultStageId={showNew.stageId ?? null}
          defaultClientId={scopedClientId ?? null}
          clients={clients}
          stages={stages}
        />
      )}

      {editingDeal && (
        <NewDealDialog
          open={!!editingDeal}
          onOpenChange={(o) => !o && setEditingDeal(null)}
          defaultClientId={scopedClientId ?? null}
          clients={clients}
          stages={stages}
          deal={editingDeal}
        />
      )}

      {(customItemStage !== null || editingCustom) && canManage !== false && (
        <CustomItemDialog
          open={customItemStage !== null || !!editingCustom}
          onOpenChange={(o) => {
            if (!o) { setCustomItemStage(null); setEditingCustom(null); }
          }}
          clientId={editingCustom ? editingCustom.clientId : scopedClientId ?? null}
          defaultStage={customItemStage ?? undefined}
          deal={editingCustom}
        />
      )}

      {pendingWonStage && (
        <DealWonModal
          deal={pendingWonStage.deal}
          targetStage={
            (stages && stages.find((s) => s.stageId === pendingWonStage.stageId)) ||
            // Fallback shape for the legacy mode where no stages prop is passed.
            ({
              stageId: pendingWonStage.stageId,
              key: 'won',
              label: pendingWonStage.label,
              isWon: true,
              isLost: false,
              defaultProbability: 100,
              position: 99,
              color: '#10B981',
              pipelineId: '',
              organizationId: '',
              requiredFields: [],
              createdAt: new Date(),
            } as PipelineStage)
          }
          onWon={onDealWon}
          onClose={() => setPendingWonStage(null)}
        />
      )}
    </>
  );
};

export default DealsKanban;
