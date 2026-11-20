// The left side of the agents screen: the chain in order, the agents in no chain, and adding one.
import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { startPhrase } from '@/lib/automation/draft';
import { StatusPill } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PANEL } from '@/components/automation/assistant/PageStates';
import type { StepStart } from '../../../../api/_automation/shared/types';

/** One agent as the list shows it. */
export type AgentRow = { agentId: string; name: string; does: string; paused: boolean };
/** One step of the chain. */
export type ChainRow = AgentRow & { stepId: string; starts: StepStart };

export interface ChainListProps {
  /** The automation's name, or null when the workspace has none yet. */
  title: string | null;
  rows: ChainRow[];
  /** Agents that are in no chain. */
  others: AgentRow[];
  /** The agent that is open. `stepId` is null for one in no chain. */
  selected: { agentId: string; stepId: string | null } | null;
  readOnly: boolean;
  /** True while the chain is being saved. */
  busy: boolean;
  /** The server's sentence when the chain could not be saved. */
  error: string;
  /** A quiet line, such as that the chain was changed elsewhere. */
  notice: string;
  onPick: (agentId: string, stepId: string | null) => void;
  onMove: (index: number, by: -1 | 1) => void;
  /** Left out when nothing can be added (a member, or no automation yet). */
  onAdd?: () => void;
}

const PickButton: React.FC<{
  row: AgentRow;
  n?: number;
  pressed: boolean;
  onClick: () => void;
}> = ({ row, n, pressed, onClick }) => (
  <button
    type="button"
    aria-pressed={pressed}
    onClick={onClick}
    className={cn(
      'flex min-w-0 flex-1 items-start gap-3 rounded-lg border p-3 text-left transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      pressed ? 'border-foreground bg-muted' : 'border-border bg-background hover:bg-muted/50',
    )}
  >
    {n != null && (
      <span
        aria-hidden
        className={cn(
          'grid h-7 w-7 shrink-0 place-items-center rounded-md text-xs font-semibold tabular-nums',
          pressed ? 'bg-foreground text-background' : 'border border-border text-foreground',
        )}
      >
        {n}
      </span>
    )}
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span data-testid="agent-name" className="break-words text-sm font-semibold text-foreground">{row.name}</span>
        {' '}
        {row.paused && <StatusPill tone="warning">Paused</StatusPill>}
      </span>
      {' '}
      {row.does && <span className="break-words text-xs text-muted-foreground">{row.does}</span>}
    </span>
  </button>
);

export const ChainList: React.FC<ChainListProps> = ({
  title, rows, others, selected, readOnly, busy, error, notice, onPick, onMove, onAdd,
}) => (
  <section aria-label="Agents in this chain" className={cn(PANEL, 'flex flex-col gap-3 p-4')}>
    <div>
      <h2 className="break-words text-sm font-semibold text-foreground">{title ?? 'No chain yet'}</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {title
          ? 'Each agent has one job. When it finishes, it hands its result to the next one.'
          : (
            <>
              There is no automation in this workspace yet, so no agent is in a chain.{' '}
              <Link to="/crm/automation/assistant" className="font-medium text-foreground underline underline-offset-4">
                Build one with the assistant
              </Link>.
            </>
          )}
      </p>
    </div>

    {notice && <p role="status" className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{notice}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

    {title && rows.length === 0 && (
      <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        The chain is empty.
      </p>
    )}

    {rows.length > 0 && (
      <ol aria-label="Chain" className="flex flex-col">
        {rows.map((row, i) => {
          const next = rows[i + 1];
          return (
            <li key={row.stepId} className="flex flex-col">
              <div className="flex items-stretch gap-1">
                <PickButton
                  row={row}
                  n={i + 1}
                  pressed={selected?.stepId === row.stepId}
                  onClick={() => onPick(row.agentId, row.stepId)}
                />
                {!readOnly && (
                  <div className="flex shrink-0 flex-col justify-center gap-0.5">
                    <Button
                      type="button" size="icon" variant="ghost" aria-label={`Move step ${i + 1} up`}
                      disabled={busy || i === 0}
                      onClick={() => onMove(i, -1)}
                    >
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      type="button" size="icon" variant="ghost" aria-label={`Move step ${i + 1} down`}
                      disabled={busy || i === rows.length - 1}
                      onClick={() => onMove(i, 1)}
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                  </div>
                )}
              </div>
              {next && (
                <div className="flex items-center gap-2 py-1.5 pl-6 text-xs text-muted-foreground">
                  <ArrowDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="min-w-0 break-words">
                    hands on to {next.name}
                    {next.starts.type !== 'after_previous' && `, which starts ${startPhrase(next.starts, false)}`}
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    )}

    {onAdd && (
      <Button type="button" variant="outline" className="border-dashed" onClick={onAdd} disabled={busy}>
        <Plus aria-hidden /> Add an agent to the chain
      </Button>
    )}

    {others.length > 0 && (
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <h3 className="text-xs font-medium text-muted-foreground">Not in a chain</h3>
        <ul aria-label="Not in a chain" className="flex flex-col gap-1.5">
          {others.map((row) => (
            <li key={row.agentId} className="flex">
              <PickButton
                row={row}
                pressed={selected?.agentId === row.agentId && selected.stepId === null}
                onClick={() => onPick(row.agentId, null)}
              />
            </li>
          ))}
        </ul>
      </div>
    )}
  </section>
);

export default ChainList;
