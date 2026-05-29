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
                  'group flex flex-col items-center gap-1 shrink-0 px-1 py-1 rounded-md transition-colors',
                  interactive
                    ? 'cursor-pointer hover:bg-primary/5'
                    : 'cursor-default',
                )}
                title={interactive ? `Move to ${meta?.label ?? key}` : meta?.label ?? key}
              >
                <span
                  className={cn(
                    'w-9 h-9 rounded-full grid place-items-center border-2 transition-all',
                    passed && 'bg-emerald-500/15 border-emerald-500 text-emerald-600',
                    isCurrent && 'bg-emerald-500 border-emerald-500 text-white shadow-md scale-110',
                    !passed && !isCurrent && 'bg-background border-border text-muted-foreground',
                    interactive && !isCurrent && !passed && 'group-hover:border-primary group-hover:text-primary group-hover:scale-105',
                  )}
                >
                  {passed ? <Check className="w-4 h-4" /> : <span className="w-2 h-2 rounded-full bg-current opacity-50" />}
                </span>
                <span
                  className={cn(
                    'text-[11px] font-medium whitespace-nowrap',
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
            'group flex flex-col items-center gap-1 shrink-0 px-1 py-1 rounded-md transition-colors',
            interactive ? 'cursor-pointer hover:bg-emerald-500/10' : 'cursor-default',
          )}
          title={interactive ? 'Mark as Closed Won' : 'Closed Won'}
        >
          <span
            className={cn(
              'w-9 h-9 rounded-full grid place-items-center border-2 transition-all',
              current === 'won'
                ? 'bg-emerald-500 border-emerald-500 text-white shadow-md scale-110'
                : 'bg-background border-border text-muted-foreground',
              interactive && current !== 'won' && 'group-hover:border-emerald-500 group-hover:text-emerald-600 group-hover:scale-105',
            )}
          >
            <ThumbsUp className="w-4 h-4" />
          </span>
          <span className={cn('text-[11px] font-medium', current === 'won' ? 'text-foreground' : 'text-muted-foreground')}>
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
            'group flex flex-col items-center gap-1 shrink-0 px-1 py-1 rounded-md transition-colors',
            interactive ? 'cursor-pointer hover:bg-rose-500/10' : 'cursor-default',
          )}
          title={interactive ? 'Mark as Closed Lost' : 'Closed Lost'}
        >
          <span
            className={cn(
              'w-9 h-9 rounded-full grid place-items-center border-2 transition-all',
              current === 'lost'
                ? 'bg-rose-500 border-rose-500 text-white shadow-md scale-110'
                : 'bg-background border-border text-muted-foreground',
              interactive && current !== 'lost' && 'group-hover:border-rose-500 group-hover:text-rose-600 group-hover:scale-105',
            )}
          >
            <ThumbsDown className="w-4 h-4" />
          </span>
          <span className={cn('text-[11px] font-medium', current === 'lost' ? 'text-foreground' : 'text-muted-foreground')}>
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
