// On a lead's page: where the automation stands with this lead, and a way to say they replied.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Run, RunSummary } from '../../../api/_automation/shared/types';
import { ago, isOpen, lastDone } from '@/lib/automation/format';
import { Button } from '@/components/ui/button';
import { RepliedDialog } from '@/components/automation/RepliedDialog';
import { RunStatusPill } from '@/components/automation/RunStatusPill';
import { useAutomationRead } from '@/components/automation/useAutomationRead';
import { Card } from '@/components/signroom/billing/shared';

/**
 * The newest run for one lead. Renders nothing while it loads, when the lead
 * has no run in the selected workspace, when no workspace is selected, and
 * when the server says automation is not set up (or cannot be reached): a
 * lead's page should not carry a box about a feature that is not in use.
 */
export const LeadAutomationCard: React.FC<{ contactId: string }> = ({ contactId }) => {
  const list = useAutomationRead<RunSummary[]>(contactId ? `runs?contactId=${encodeURIComponent(contactId)}` : null);
  const newest = list.data?.[0] ?? null;
  // The list has the status and the result; what it waits for and what was done last are on the run itself.
  const full = useAutomationRead<Run>(newest ? `runs/${encodeURIComponent(newest.id)}` : null);
  const [replying, setReplying] = useState(false);

  if (!newest) return null;
  const run: RunSummary = full.data ?? newest;
  const last = full.data ? lastDone(full.data.steps) : null;
  const waitingFor = full.data?.waitingFor ?? null;
  const path = `/crm/automation/runs/${run.id}`;

  return (
    <>
      <Card
        title="Automation"
        action={(
          <Link
            to={path}
            className="rounded-md text-xs font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open the run
          </Link>
        )}
      >
        <div className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <RunStatusPill status={run.status} />
            <span className="min-w-0 break-words text-sm font-medium text-foreground">{run.automationName}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{run.stepsDone} of {run.stepCount} steps done</span>
          </div>
          {run.result && <p className="break-words text-sm text-muted-foreground">{run.result}</p>}
          {(waitingFor || last) && (
            <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
              {waitingFor && (
                <>
                  <dt className="pt-0.5 text-xs text-muted-foreground">Waiting for</dt>
                  <dd className="break-words text-foreground">{waitingFor}</dd>
                </>
              )}
              {last && (
                <>
                  <dt className="pt-0.5 text-xs text-muted-foreground">Last done</dt>
                  <dd className="break-words text-foreground">
                    {last.agentName}: {last.text}{' '}
                    <span className="whitespace-nowrap text-xs text-muted-foreground">{ago(last.when)}</span>
                  </dd>
                </>
              )}
            </dl>
          )}
          {isOpen(run.status) && full.data?.canReply !== false && (
            <div>
              <Button size="sm" variant="outline" onClick={() => setReplying(true)}>They replied</Button>
            </div>
          )}
        </div>
      </Card>
      <RepliedDialog
        run={replying ? run : null}
        onClose={() => setReplying(false)}
        onSaved={(next) => { full.setData(next); setReplying(false); }}
      />
    </>
  );
};

export default LeadAutomationCard;
