// One run at /crm/automation/runs/:id: what each agent received, decided and did, in order.
import React, { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Approval, Run, RunStep } from '../../../api/_automation/shared/types';
import { useAutomation } from '@/hooks/useAutomation';
import { approvalsForSteps, dateTime, dayTime, dollars, isOpen } from '@/lib/automation/format';
import { errorSentence } from '@/services/automation/client';
import { StatusPill } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { ApprovalList } from '@/components/automation/ApprovalReview';
import { AutomationPage } from '@/components/automation/AutomationPage';
import { RepliedDialog } from '@/components/automation/RepliedDialog';
import { RunStatusPill, StepStatusPill } from '@/components/automation/RunStatusPill';
import { Bar, CardSkeleton, LoadFailed, Loading, NotReady, StaleNote } from '@/components/automation/states';
import { useAutomationRead } from '@/components/automation/useAutomationRead';
import { useConfirm } from '@/components/signroom/agreements/useConfirm';
import { Card, PickWorkspace } from '@/components/signroom/billing/shared';

const LAYOUT = 'grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]';
const STEP = 'flex gap-3 rounded-lg border border-border bg-card p-4';
const TERM = 'pt-0.5 text-xs text-muted-foreground';

/** One step of the run, with the approvals it is waiting for underneath. */
const StepCard: React.FC<{
  step: RunStep;
  approvals: Approval[];
  onDecided: () => void;
}> = ({ step, approvals, onDecided }) => (
  <li className={STEP}>
    <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-foreground text-xs font-semibold tabular-nums text-background">
      {step.n}
    </span>
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="break-words text-sm font-semibold text-foreground">
            <span className="sr-only">Step {step.n}: </span>{step.agentName}
          </h3>
          {step.status !== 'done' && <StepStatusPill status={step.status} />}
          {step.approvedBy && <StatusPill tone="neutral" dot={false}>Approved by {step.approvedBy}</StatusPill>}
        </div>
        <time dateTime={step.when} className="text-xs tabular-nums text-muted-foreground">{dayTime(step.when)}</time>
      </div>
      <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        <dt className={TERM}>Received</dt>
        <dd className="whitespace-pre-wrap break-words text-foreground/80">{step.received || '—'}</dd>
        <dt className={TERM}>Decided</dt>
        <dd className="whitespace-pre-wrap break-words text-foreground/80">{step.decided || '—'}</dd>
        <dt className={TERM}>Did</dt>
        <dd className="break-words font-medium text-foreground">
          {step.did.length === 0 ? (
            <span className="font-normal text-muted-foreground">{step.status === 'waiting_approval' ? 'Nothing yet' : 'Nothing'}</span>
          ) : step.did.length === 1 ? step.did[0] : (
            <ul className="flex flex-col gap-0.5">
              {step.did.map((line, i) => <li key={i}>{line}</li>)}
            </ul>
          )}
        </dd>
      </dl>
      {approvals.length > 0 && (
        <div className="mt-1 overflow-hidden rounded-md border border-border">
          <p className="border-b border-border bg-muted/40 px-4 py-1.5 text-xs font-medium text-foreground">Waiting for approval</p>
          <ApprovalList approvals={approvals} onDecided={onDecided} />
        </div>
      )}
    </div>
  </li>
);

const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-baseline justify-between gap-3 border-b border-border py-1.5 last:border-b-0">
    <dt className="text-sm text-muted-foreground">{label}</dt>
    <dd className="text-right text-sm font-medium tabular-nums text-foreground">{children}</dd>
  </div>
);

const Placeholder: React.FC = () => (
  <Loading label="Loading the run" className={LAYOUT}>
    <div className="flex min-w-0 flex-col gap-4">
      <Bar className="h-5 w-56 max-w-full" />
      <Bar className="w-full max-w-xl" />
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className={STEP}>
          <Bar className="h-7 w-7 shrink-0 rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-2.5 py-1">
            <Bar className="w-32" />
            <Bar className="w-full" />
            <Bar className="w-2/3" />
            <Bar className="w-1/2" />
          </div>
        </div>
      ))}
    </div>
    <div className="flex min-w-0 flex-col gap-4">
      <CardSkeleton rows={1} />
      <CardSkeleton rows={3} />
    </div>
  </Loading>
);

export const AutomationRunPage: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const { client, workspaceId } = useAutomation();
  const { ask, dialog: confirmDialog } = useConfirm();
  const { data: run, error, notReady, reload, setData } = useAutomationRead<Run>(id ? `runs/${encodeURIComponent(id)}` : null);
  const waitsForApproval = Boolean(run && (run.status === 'needs_approval' || run.steps.some((s) => s.status === 'waiting_approval')));
  const pending = useAutomationRead<Approval[]>(waitsForApproval ? 'approvals' : null);
  const [replying, setReplying] = useState(false);
  const [stopping, setStopping] = useState(false);

  const byStep = useMemo(
    () => (run ? approvalsForSteps(run.id, run.steps, pending.data ?? []) : new Map<string, Approval[]>()),
    [run, pending.data],
  );
  const readAgain = () => { void reload(); void pending.reload(); };

  const stop = async (current: Run) => {
    const yes = await ask({
      title: 'Stop this run?',
      description: `The agents do nothing more for ${current.subject}. What they have already done stays as it is. A stopped run cannot be started again.`,
      confirmLabel: 'Stop this run',
      cancelLabel: 'Keep it going',
      destructive: true,
    });
    if (!yes) return;
    setStopping(true);
    try {
      setData(await client.call<Run>(`runs/${current.id}/stop`, {}));
      toast.success('Run stopped.');
    } catch (e) {
      toast.error(errorSentence(e));
    } finally {
      setStopping(false);
    }
  };

  const loaded = (current: Run) => {
    const open = isOpen(current.status);
    return (
      <>
        {error && <StaleNote error={error} onRetry={() => void reload()} />}
        <div className={LAYOUT}>
          <section aria-label="What happened" className="flex min-w-0 flex-col gap-4">
            <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h2 className="break-words text-sm font-semibold text-foreground">{current.automationName}</h2>
              <RunStatusPill status={current.status} />
            </header>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Everything each agent received, decided and did, in order. Nothing happens that is not written here.
            </p>
            {current.waitingFor && (
              <p role="status" className="break-words rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
                <span className="font-medium">Waiting: </span>{current.waitingFor}
              </p>
            )}
            {pending.error && <StaleNote error={pending.error} onRetry={() => void pending.reload()} />}
            {current.steps.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                No agent has worked on this run yet.
              </p>
            ) : (
              <ol aria-label="Steps of this run" className="flex flex-col gap-3">
                {current.steps.map((step) => (
                  <StepCard key={step.id} step={step} approvals={byStep.get(step.id) ?? []} onDecided={readAgain} />
                ))}
              </ol>
            )}
          </section>

          <aside className="flex min-w-0 flex-col gap-4">
            <Card title="Result">
              <div className="flex flex-col gap-3 p-4">
                <p className="break-words text-sm font-medium text-foreground">{current.result || 'Nothing to show yet.'}</p>
                <div className="flex flex-col gap-2">
                  {current.projectId && (
                    <Button asChild>
                      <Link to={`/project/${current.projectId}`}>Open project</Link>
                    </Button>
                  )}
                  {current.dealId && (
                    <Button asChild variant="outline">
                      <Link to={`/crm/deals/${current.dealId}`}>Open the deal</Link>
                    </Button>
                  )}
                  <Button asChild variant="outline">
                    <Link to={`/crm/contacts/${current.contactId}`}>Open the lead</Link>
                  </Button>
                </div>
              </div>
            </Card>

            <Card title="This run">
              <dl className="px-4 py-2">
                <Fact label="Started">{dateTime(current.started)}</Fact>
                <Fact label="Finished">{current.finished ? dateTime(current.finished) : 'Not yet'}</Fact>
                <Fact label="Agent steps">{current.facts.agentSteps}</Fact>
                <Fact label="Approvals given">{current.facts.approvals}</Fact>
                <Fact label="Emails sent">{current.facts.emailsSent}</Fact>
                <Fact label="AI cost">{dollars(current.facts.costCents)}</Fact>
              </dl>
            </Card>

            <Card title="If something looks wrong">
              <div className="flex flex-col gap-2 p-4">
                {open && current.canReply !== false && (
                  <>
                    <Button variant="outline" onClick={() => setReplying(true)} disabled={stopping}>They replied</Button>
                    <p className="pb-1 text-xs text-muted-foreground">
                      Use it when the lead answered by phone, or anywhere else the agents cannot see.
                    </p>
                  </>
                )}
                {open && current.canStop !== false && (
                  <Button variant="outline" onClick={() => void stop(current)} disabled={stopping}>
                    {stopping && <Loader2 className="animate-spin" aria-hidden />}
                    Stop this run
                  </Button>
                )}
                <Button asChild variant="outline">
                  <Link to="/crm/automation/assistant">Tell the assistant what to change</Link>
                </Button>
              </div>
            </Card>
          </aside>
        </div>
      </>
    );
  };

  const content = () => {
    if (!workspaceId) return <PickWorkspace what="this run" />;
    if (notReady) return <NotReady>{error}</NotReady>;
    if (!run) return error ? <LoadFailed error={error} onRetry={() => void reload()} /> : <Placeholder />;
    return loaded(run);
  };

  return (
    <AutomationPage
      title={run?.subject || 'Run'}
      description={run ? `One lead going through “${run.automationName}”.` : 'One lead going through the chain.'}
      actions={(
        <Button asChild variant="outline">
          <Link to="/crm/automation/runs"><ArrowLeft aria-hidden /> All runs</Link>
        </Button>
      )}
    >
      {content()}
      {confirmDialog}
      <RepliedDialog
        run={replying && run ? run : null}
        onClose={() => setReplying(false)}
        onSaved={(next) => { setData(next); setReplying(false); }}
      />
    </AutomationPage>
  );
};

export default AutomationRunPage;
