// The right side of the assistant: the automation as it stands, which the person can adjust by hand.
import React, { useId } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import {
  moveDraftStep, removeDraftStep, renameDraft, setDraftStepStart, setSkipImports, startInWords,
} from '@/lib/automation/draft';
import { StatusPill } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { AutomationDraft, AutomationStatus, Autonomy } from '../../../../api/_automation/shared/types';
import { ApprovalPill } from './ApprovalPill';
import { PANEL } from './PageStates';
import { StartControl } from './StartControl';

export interface DraftPanelProps {
  /** Null until the assistant has built something. */
  draft: AutomationDraft | null;
  workspaceName: string;
  /** The saved automation's status, or null while it has never been saved. */
  status: AutomationStatus | null;
  /** The workspace's rule on how much agents may do alone, when it could be read. */
  autonomy: Autonomy | null;
  /** A member: everything is shown and nothing can be changed. */
  readOnly: boolean;
  /** True while a reply or a save is on its way, so the draft is not changed under it. */
  locked: boolean;
  onChange: (next: AutomationDraft) => void;
  /** The buttons and their messages, under the steps. */
  footer?: React.ReactNode;
}

const StatusOf: React.FC<{ status: AutomationStatus | null }> = ({ status }) => {
  if (status === 'on') return <StatusPill tone="success">Turned on</StatusPill>;
  if (status === 'paused') return <StatusPill tone="warning">Paused</StatusPill>;
  return <StatusPill tone="neutral">Not turned on yet</StatusPill>;
};

export const DraftPanel: React.FC<DraftPanelProps> = ({
  draft, workspaceName, status, autonomy, readOnly, locked, onChange, footer,
}) => {
  const id = useId();
  const place = workspaceName || 'this workspace';
  const fixed = readOnly || locked;

  if (!draft) {
    return (
      <section aria-label="Draft automation" className={cn(PANEL, 'flex min-h-[32rem] flex-col gap-4 p-4')}>
        <p className="text-xs font-medium text-muted-foreground">Draft automation</p>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <p className="text-sm font-medium text-foreground">No draft yet.</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            The automation appears here as soon as you have described it: when it starts, each agent’s step, and what it hands on.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">Runs only in {place}. Other workspaces are not touched.</p>
      </section>
    );
  }

  return (
    <section aria-label="Draft automation" className={cn(PANEL, 'flex min-h-[32rem] flex-col gap-4 p-4')}>
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
          {readOnly ? (
            <>
              <p className="text-xs font-medium text-muted-foreground">Automation</p>
              <h2 className="break-words text-sm font-semibold text-foreground">{draft.name}</h2>
            </>
          ) : (
            <>
              <label htmlFor={`${id}-name`} className="text-xs font-medium text-muted-foreground">Draft automation</label>
              <Input
                id={`${id}-name`}
                value={draft.name}
                maxLength={120}
                disabled={locked}
                aria-label="Automation name"
                className="font-semibold"
                onChange={(e) => onChange(renameDraft(draft, e.target.value))}
              />
            </>
          )}
        </div>
        <StatusOf status={status} />
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-background px-3 py-3">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">When</span>
          <span className="text-sm font-medium text-foreground">A new lead is added in {place}</span>
        </div>
        <label className="flex items-start gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
            checked={draft.trigger.skipImports}
            disabled={fixed}
            onChange={(e) => onChange(setSkipImports(draft, e.target.checked))}
          />
          <span className="min-w-0">Skip leads that came from an import</span>
        </label>
      </div>

      {draft.steps.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No steps. Ask the assistant to add one.
        </p>
      ) : (
        <ol aria-label="Steps" className="flex flex-col gap-2">
          {draft.steps.map((step, i) => {
            const n = i + 1;
            const next = draft.steps[i + 1];
            return (
              <li key={`${i}-${step.agent.id ?? step.agent.name}`} className="flex gap-3 rounded-lg border border-border bg-background px-3 py-3">
                <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-border text-xs font-semibold tabular-nums text-foreground">
                  {n}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="sr-only">Step {n}: </span>
                    <span data-testid="step-agent" className="break-words text-sm font-semibold text-foreground">{step.agent.name}</span>
                    <ApprovalPill agent={step.agent} autonomy={autonomy} />
                  </div>
                  {step.does && <p className="break-words text-sm text-foreground/80">{step.does}</p>}
                  {step.gives
                    ? <p className="break-words text-xs text-muted-foreground">Hands on: {step.gives}</p>
                    : next && <p className="break-words text-xs text-muted-foreground">Hands on to {next.agent.name}</p>}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="text-xs text-muted-foreground">{startInWords(step.starts, i === 0)}</span>
                    {!readOnly && (
                      <StartControl
                        value={step.starts}
                        disabled={locked}
                        label={`When step ${n} starts`}
                        onChange={(starts) => onChange(setDraftStepStart(draft, i, starts))}
                      />
                    )}
                  </div>
                </div>
                {!readOnly && (
                  <div className="flex shrink-0 flex-col items-center gap-0.5 sm:flex-row">
                    <Button
                      type="button" size="icon" variant="ghost" aria-label={`Move step ${n} up`}
                      disabled={locked || i === 0}
                      onClick={() => onChange(moveDraftStep(draft, i, -1))}
                    >
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      type="button" size="icon" variant="ghost" aria-label={`Move step ${n} down`}
                      disabled={locked || i === draft.steps.length - 1}
                      onClick={() => onChange(moveDraftStep(draft, i, 1))}
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button
                      type="button" size="icon" variant="ghost" aria-label={`Remove step ${n}`}
                      disabled={locked}
                      onClick={() => onChange(removeDraftStep(draft, i))}
                    >
                      <X aria-hidden />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <div className="mt-auto flex flex-col gap-3 border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">Runs only in {place}. Other workspaces are not touched.</p>
        {footer}
      </div>
    </section>
  );
};

export default DraftPanel;
