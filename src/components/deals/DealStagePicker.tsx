import React, { useMemo, useState } from 'react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useDeals } from '@/hooks/useDeals';
import {
  DEAL_STAGES, Deal, DealStage, STAGE_DEFAULT_PROBABILITY,
  resolveStageChange,
} from '@/services/supabase/deals';
import { PipelineStage } from '@/services/supabase/pipelines';
import { DealWonModal } from '@/components/clients/DealWonModal';
import { toast } from 'sonner';

/** A stage option the picker can route a change to. Both `PipelineStage` and
 *  the legacy `DEAL_STAGES` fallback are normalised into this shape so the
 *  won-confirm decision (`resolveStageChange`) works identically to the
 *  kanban board. */
interface PickerStage {
  id: string;       // stage_id (pipeline) or the legacy stage key
  key: string;      // value persisted on deals.stage
  label: string;
  isWon: boolean;
  isLost: boolean;
}

interface Props {
  deal: Deal;
  /** Pipeline stages for the deal's pipeline. When absent (or empty), falls
   *  back to the legacy six-stage list so the rail keeps working before the
   *  pipelines layer has loaded. */
  stages?: PipelineStage[];
  /** Called after a successful plain stage update OR a won-confirm. */
  onChanged?: () => void;
  className?: string;
}

/**
 * Reusable per-deal stage `<Select>` that routes a stage pick through the
 * SAME path the pipeline board uses: `resolveStageChange` decides whether the
 * pick is a no-op, a plain `updateDeal({ stageId })`, or a Won transition that
 * must open `DealWonModal` (project-creation + handoff). Used by the record
 * drawers' right-rail pipeline so a Won pick still confirms + hands off.
 */
export const DealStagePicker: React.FC<Props> = ({ deal, stages, onChanged, className }) => {
  const { update } = useDeals();
  const [pendingWon, setPendingWon] = useState<PipelineStage | null>(null);

  const pickerStages = useMemo<PickerStage[]>(() => {
    if (stages && stages.length > 0) {
      return stages.map((s) => ({
        id: s.stageId, key: s.key, label: s.label, isWon: s.isWon, isLost: s.isLost,
      }));
    }
    return DEAL_STAGES.map((s) => ({
      id: s.id, key: s.id, label: s.label,
      isWon: s.id === 'won', isLost: s.id === 'lost',
    }));
  }, [stages]);

  const moveToStage = async (target: PickerStage) => {
    const action = resolveStageChange(deal.stage, target);
    if (action === 'noop') return;

    // Won stages need the project-creation handoff via DealWonModal rather
    // than a plain stage update — exactly like the kanban board.
    if (action === 'won-confirm') {
      const fromStages = stages?.find((s) => s.stageId === target.id);
      setPendingWon(
        fromStages ?? ({
          stageId: target.id,
          key: 'won',
          label: target.label,
          isWon: true,
          isLost: false,
          defaultProbability: 100,
          position: 99,
          color: '#10B981',
          pipelineId: '',
          organizationId: '',
          requiredFields: [],
          createdAt: new Date(),
        } as PipelineStage),
      );
      return;
    }

    try {
      // For the legacy fallback, target.id === target.key (a stage key), so
      // pass `stage` to drive probability/close-timestamp logic. With real
      // pipeline stages, pass `stageId` (the source of truth).
      if (stages && stages.length > 0) {
        await update(deal.dealId, { stageId: target.id });
      } else {
        await update(deal.dealId, {
          stage: target.key as DealStage,
          probability: STAGE_DEFAULT_PROBABILITY[target.key as DealStage] ?? deal.probability,
        });
      }
      toast.success(`Moved "${deal.title}" to ${target.label}`);
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not move deal');
    }
  };

  return (
    <>
      <Select
        value={deal.stage}
        onValueChange={(key) => {
          const next = pickerStages.find((s) => s.key === key);
          if (next) void moveToStage(next);
        }}
      >
        <SelectTrigger
          className={className ?? 'h-7 w-full text-xs'}
          aria-label="Change stage"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {pickerStages.map((s) => (
            <SelectItem key={s.id} value={s.key} className="text-xs">
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {pendingWon && (
        <DealWonModal
          deal={deal}
          targetStage={pendingWon}
          onWon={() => onChanged?.()}
          onClose={() => setPendingWon(null)}
        />
      )}
    </>
  );
};

export default DealStagePicker;
