import React from 'react';
import { Check, ThumbsUp, ThumbsDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DEAL_STAGES, DealStage, OPEN_STAGES } from '@/services/supabase/deals';

interface DealStagePathProps {
  current: DealStage;
  onPick?: (next: DealStage) => void;
  /** Optional closing-date label rendered at the end of the path so the rep
   *  always sees the expected close at a glance (matches Zoho's layout). */
  expectedCloseLabel?: string | null;
  readOnly?: boolean;
}

/**
 * Visual stage stepper for a deal: green check pills for stages already
 * passed, a filled accent pill for the current stage, hollow pills for
 * upcoming stages, then thumbs-up (Won) / thumbs-down (Lost) terminators.
 *
 * Picking a stage fires onPick with the new key. Won/Lost are picked by
 * clicking their respective thumb. Closed deals render the closed stage as
 * the highlighted one.
 */
export const DealStagePath: React.FC<DealStagePathProps> = ({
  current, onPick, expectedCloseLabel, readOnly = false,
}) => {
  const openIdx = OPEN_STAGES.indexOf(current as Exclude<DealStage, 'won' | 'lost'>);
  const isClosed = current === 'won' || current === 'lost';
  const interactive = !readOnly && typeof onPick === 'function';

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground shrink-0 pr-2">
          Stage
        </span>

        {OPEN_STAGES.map((key, idx) => {
          const passed = !isClosed && idx < openIdx;
          const isCurrent = !isClosed && idx === openIdx;
          const meta = DEAL_STAGES.find((s) => s.id === key);
          return (
            <React.Fragment key={key}>
              <button
                type="button"
                disabled={!interactive}
                onClick={() => interactive && onPick!(key)}
                className={cn(
                  'group flex flex-col items-center gap-1 shrink-0',
                  interactive ? 'cursor-pointer' : 'cursor-default',
                )}
                title={meta?.label ?? key}
              >
                <span
                  className={cn(
                    'w-7 h-7 rounded-full grid place-items-center border-2 transition-all',
                    passed && 'bg-emerald-500/15 border-emerald-500 text-emerald-600',
                    isCurrent && 'bg-emerald-500 border-emerald-500 text-white shadow-md scale-110',
                    !passed && !isCurrent && 'bg-background border-border text-muted-foreground',
                    interactive && !isCurrent && !passed && 'group-hover:border-primary/60',
                  )}
                >
                  {passed ? <Check className="w-3.5 h-3.5" /> : <span className="w-2 h-2 rounded-full bg-current opacity-50" />}
                </span>
                <span
                  className={cn(
                    'text-[10px] font-medium whitespace-nowrap',
                    isCurrent ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {meta?.label ?? key}
                </span>
              </button>
              {idx < OPEN_STAGES.length - 1 && (
                <span className={cn('flex-1 min-w-[24px] h-[2px] mb-4', passed ? 'bg-emerald-500/50' : 'bg-border')} />
              )}
            </React.Fragment>
          );
        })}

        <span className={cn('flex-1 min-w-[24px] h-[2px] mb-4', current === 'won' || current === 'lost' ? 'bg-emerald-500/50' : 'bg-border')} />

        {/* Won terminator */}
        <button
          type="button"
          disabled={!interactive}
          onClick={() => interactive && onPick!('won')}
          className={cn(
            'flex flex-col items-center gap-1 shrink-0',
            interactive ? 'cursor-pointer' : 'cursor-default',
          )}
          title="Closed Won"
        >
          <span
            className={cn(
              'w-7 h-7 rounded-full grid place-items-center border-2 transition-all',
              current === 'won'
                ? 'bg-emerald-500 border-emerald-500 text-white shadow-md scale-110'
                : 'bg-background border-border text-muted-foreground hover:border-emerald-500/60',
            )}
          >
            <ThumbsUp className="w-3.5 h-3.5" />
          </span>
          <span className={cn('text-[10px] font-medium', current === 'won' ? 'text-foreground' : 'text-muted-foreground')}>
            Won
          </span>
        </button>

        <span className="w-2" />

        {/* Lost terminator */}
        <button
          type="button"
          disabled={!interactive}
          onClick={() => interactive && onPick!('lost')}
          className={cn(
            'flex flex-col items-center gap-1 shrink-0',
            interactive ? 'cursor-pointer' : 'cursor-default',
          )}
          title="Closed Lost"
        >
          <span
            className={cn(
              'w-7 h-7 rounded-full grid place-items-center border-2 transition-all',
              current === 'lost'
                ? 'bg-rose-500 border-rose-500 text-white shadow-md scale-110'
                : 'bg-background border-border text-muted-foreground hover:border-rose-500/60',
            )}
          >
            <ThumbsDown className="w-3.5 h-3.5" />
          </span>
          <span className={cn('text-[10px] font-medium', current === 'lost' ? 'text-foreground' : 'text-muted-foreground')}>
            Lost
          </span>
        </button>

        {expectedCloseLabel && (
          <>
            <span className="w-2" />
            <span className="text-xs font-medium text-foreground whitespace-nowrap pl-2 border-l">
              {expectedCloseLabel}
            </span>
          </>
        )}
      </div>
    </div>
  );
};
