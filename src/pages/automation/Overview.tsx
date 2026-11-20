// Automation overview at /crm/automation: the figures, the chain, what waits for approval and the latest runs.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Loader2, RefreshCw, Workflow } from 'lucide-react';
import { toast } from 'sonner';
import type { Automation, ChainStep, Overview, RunSummary } from '../../../api/_automation/shared/types';
import { useAutomation } from '@/hooks/useAutomation';
import { ago, budgetPercent, dollars, howLong, startsInWords } from '@/lib/automation/format';
import { errorSentence } from '@/services/automation/client';
import { StatStrip } from '@/components/common/StatStrip';
import { StatusPill, type StatusTone } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { ApprovalList } from '@/components/automation/ApprovalReview';
import { AutomationPage } from '@/components/automation/AutomationPage';
import { RunStatusPill } from '@/components/automation/RunStatusPill';
import { Bar, CardSkeleton, LoadFailed, Loading, NotReady, StaleNote } from '@/components/automation/states';
import { useAutomationRead } from '@/components/automation/useAutomationRead';
import { Card, PickWorkspace } from '@/components/signroom/billing/shared';

const CHAIN_TITLE = 'From the first enquiry to the running project';
const LINK = 'rounded-md text-xs font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const CHAIN_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] gap-3 p-4';

const AUTOMATION_STATUS: Record<Automation['status'], { label: string; tone: StatusTone }> = {
  on: { label: 'Running', tone: 'success' },
  paused: { label: 'Paused', tone: 'warning' },
  draft: { label: 'Not turned on yet', tone: 'neutral' },
};

const WHAT_IT_DOES = [
  'Agents pick up each new lead, look into it, qualify it and draft the first email.',
  'Emails and won or lost deals wait for your approval. Nothing is sent before you say so.',
  'When a deal is won, the project is created in this workspace with its tasks.',
];

const STAT_LABELS = ['Automations running', 'Runs this week', 'Waiting for your approval', 'AI budget this month'];

/** The figures across the top. */
const Figures: React.FC<{ stats: Overview['stats'] }> = ({ stats }) => {
  const percent = budgetPercent(stats.spentCents, stats.budgetCents);
  return (
    <StatStrip
      items={[
        {
          label: STAT_LABELS[0],
          value: stats.automationsOn,
          note: stats.automationsPaused > 0 ? `${stats.automationsPaused} paused` : 'None paused',
        },
        {
          label: STAT_LABELS[1],
          value: stats.runsThisWeek,
          note: `${stats.finishedThisWeek} finished, ${stats.stoppedThisWeek} stopped`,
        },
        {
          label: STAT_LABELS[2],
          value: stats.waitingApprovals,
          tone: stats.waitingApprovals > 0 ? 'danger' : 'default',
          note: stats.oldestApproval && stats.waitingApprovals > 0 ? `Oldest: ${howLong(stats.oldestApproval)}` : 'Nothing is waiting',
        },
        {
          label: STAT_LABELS[3],
          value: percent === null ? '—' : `${percent}%`,
          tone: percent !== null && percent >= 100 ? 'danger' : 'default',
          note: percent === null
            ? `${dollars(stats.spentCents)} spent, no limit set`
            : `${dollars(stats.spentCents)} of ${dollars(stats.budgetCents)}`,
        },
      ]}
    />
  );
};

/** One step of the chain: its number, its agent, what it does, when it starts and whether it asks first. */
const ChainCard: React.FC<{ step: ChainStep; last: boolean }> = ({ step, last }) => (
  <li className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3">
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-medium text-muted-foreground">Step {step.n}</span>
      {!last && <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />}
    </div>
    <div className="flex min-w-0 items-center gap-2">
      <span aria-hidden className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-foreground text-[0.6875rem] font-medium text-background">
        {step.agentName.trim().charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0 break-words text-sm font-semibold text-foreground">{step.agentName}</span>
    </div>
    <p className="break-words text-xs text-muted-foreground">{step.does}</p>
    <p className="mt-auto flex flex-wrap gap-x-1 pt-1 text-xs">
      <span className="text-muted-foreground">Starts:</span>
      <span className="text-foreground">{startsInWords(step.starts)}</span>
    </p>
    <StatusPill tone={step.asks ? 'warning' : 'neutral'} dot={false} className="self-start">
      {step.asks ? 'Needs approval' : 'Automatic'}
    </StatusPill>
  </li>
);

const RunRow: React.FC<{ run: RunSummary }> = ({ run }) => (
  <li>
    <Link
      to={`/crm/automation/runs/${run.id}`}
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <span className="min-w-0 flex-1 basis-48">
        <span className="block truncate text-sm font-medium text-foreground">{run.subject}</span>
        <span className="block break-words text-xs text-muted-foreground">{run.result}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <RunStatusPill status={run.status} />
        <span className="text-xs tabular-nums text-muted-foreground">{ago(run.updated)}</span>
      </span>
    </Link>
  </li>
);

/** The same boxes as the loaded page, empty, so nothing moves when the data arrives. */
const Placeholder: React.FC = () => (
  <Loading label="Loading the automation" className="flex flex-col gap-6">
    <StatStrip items={STAT_LABELS.map((label) => ({ label, value: '—', tone: 'muted' as const, note: ' ' }))} />
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex min-h-11 items-center border-b border-border px-4"><Bar className="w-64 max-w-full" /></div>
      <div className={CHAIN_GRID}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex h-40 flex-col gap-2.5 rounded-lg border border-border bg-muted/40 p-3">
            <Bar className="w-12" />
            <Bar className="w-24" />
            <Bar className="w-full" />
            <Bar className="w-2/3" />
          </div>
        ))}
      </div>
    </div>
    <div className="grid gap-6 lg:grid-cols-2">
      <CardSkeleton />
      <CardSkeleton />
    </div>
  </Loading>
);

export const AutomationOverviewPage: React.FC = () => {
  const { client, workspaceId } = useAutomation();
  const { data, error, notReady, loading, reload, setData } = useAutomationRead<Overview>('overview', { nudgeOnLoad: true });
  const [busy, setBusy] = useState(false);

  const owner = data?.role === 'Owner';
  const member = data?.role === 'Member';

  /** A change an owner makes; the server's sentence is shown when it is refused. */
  const change = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
    } catch (e) {
      toast.error(errorSentence(e));
    } finally {
      setBusy(false);
    }
  };

  const setUp = () => change(async () => {
    setData(await client.call<Overview>('setup', {}));
    toast.success('Automation is set up. Turn it on when you are ready.');
  });

  const switchAutomation = (id: string, to: 'turn-on' | 'pause') => change(async () => {
    await client.call<Automation>(`automations/${id}/${to}`, {});
    toast.success(to === 'pause' ? 'Automation paused. New leads start no run.' : 'Automation turned on. New leads start a run.');
    await reload();
  });

  const firstRun = (role: Overview['role']) => (
    <section aria-labelledby="automation-first-run" className="flex flex-col items-center gap-4 rounded-lg border border-border bg-card px-4 py-12 text-center">
      <Workflow className="h-5 w-5 text-muted-foreground" aria-hidden />
      <h2 id="automation-first-run" className="text-sm font-semibold text-foreground">Automation is not set up in this workspace yet</h2>
      <ul aria-label="What automation does" className="flex max-w-lg flex-col gap-1.5 text-sm text-muted-foreground">
        {WHAT_IT_DOES.map((line) => <li key={line}>{line}</li>)}
      </ul>
      {role === 'Owner' ? (
        <>
          <Button onClick={() => void setUp()} disabled={busy}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            Set up automation
          </Button>
          <p className="max-w-md text-xs text-muted-foreground">
            This adds six agents and one automation as a draft. Nothing runs until you turn it on.
          </p>
        </>
      ) : (
        <p className="text-sm text-foreground">A workspace owner or admin sets automation up.</p>
      )}
    </section>
  );

  const chainCard = (overview: Overview) => {
    const { automation, chain } = overview;
    const status = automation ? AUTOMATION_STATUS[automation.status] ?? AUTOMATION_STATUS.draft : null;
    return (
      <Card
        title={CHAIN_TITLE}
        action={automation && status && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <StatusPill tone={status.tone}>{status.label}</StatusPill>
            {owner && (
              automation.status === 'on'
                ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void switchAutomation(automation.id, 'pause')}>Pause</Button>
                : <Button size="sm" disabled={busy} onClick={() => void switchAutomation(automation.id, 'turn-on')}>Turn on</Button>
            )}
            <Link to="/crm/automation/agents" className={LINK}>{owner ? 'Edit the chain' : 'See the agents'}</Link>
          </div>
        )}
      >
        {!automation ? (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <p className="max-w-md text-sm text-muted-foreground">
              No automation yet.{' '}
              {owner
                ? 'Tell the assistant what should happen to a new lead and it builds the chain for you.'
                : 'A workspace owner or admin can build one with the assistant.'}
            </p>
            {owner && (
              <Button asChild variant="outline">
                <Link to="/crm/automation/assistant">Ask the assistant</Link>
              </Button>
            )}
          </div>
        ) : (
          <>
            <p className="px-4 pt-3 text-xs text-muted-foreground">
              Automation: <span className="font-medium text-foreground">{automation.name}</span>
            </p>
            {chain.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                This automation has no steps yet.{owner ? ' Add them under “Edit the chain”, or ask the assistant.' : ''}
              </p>
            ) : (
              <ol className={CHAIN_GRID}>
                {chain.map((step, i) => <ChainCard key={`${step.n}-${step.agentId}`} step={step} last={i === chain.length - 1} />)}
              </ol>
            )}
          </>
        )}
      </Card>
    );
  };

  const content = () => {
    if (!workspaceId) return <PickWorkspace what="its automation" />;
    if (notReady) return <NotReady>{error}</NotReady>;
    if (!data) {
      return error ? <LoadFailed error={error} onRetry={() => void reload({ nudge: true })} /> : <Placeholder />;
    }
    if (!data.setUp) return firstRun(data.role);
    return (
      <>
        {error && <StaleNote error={error} onRetry={() => void reload()} />}
        {!data.enabled && (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border border-border bg-muted/40 px-3 py-2">
            <p role="status" className="min-w-0 text-sm text-foreground">
              Automation is switched off for this workspace. Nothing runs and new leads start no run.
            </p>
            <Link to="/crm/automation/rules" className={LINK}>Open workspace rules</Link>
          </div>
        )}
        <Figures stats={data.stats} />
        {chainCard(data)}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card
            title="Waiting for your approval"
            className="min-w-0 self-start"
            action={<span className="text-xs text-muted-foreground">Nothing leaves the workspace until you say so</span>}
          >
            {data.approvals.length === 0
              ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing is waiting for you.</p>
              : <ApprovalList approvals={data.approvals} onDecided={() => void reload()} />}
          </Card>
          <Card
            title="Latest runs"
            className="min-w-0 self-start"
            action={<Link to="/crm/automation/runs" className={LINK}>All runs</Link>}
          >
            {data.latestRuns.length === 0
              ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">No runs yet. A run starts when a lead is added.</p>
              : <ul className="divide-y divide-border">{data.latestRuns.map((run) => <RunRow key={run.id} run={run} />)}</ul>}
          </Card>
        </div>
      </>
    );
  };

  return (
    <AutomationPage
      title="Automation"
      description="Agents carry a new lead all the way to a running project in this workspace. You step in only where it says “Needs approval”."
      actions={(
        <>
          <Button variant="outline" disabled={!workspaceId || loading} onClick={() => void reload({ nudge: true })}>
            <RefreshCw className={loading && data ? 'motion-safe:animate-spin' : undefined} aria-hidden /> Refresh
          </Button>
          {!member && (
            <>
              <Button asChild variant="outline">
                <Link to="/crm/automation/agents?new=1">New agent</Link>
              </Button>
              <Button asChild>
                <Link to="/crm/automation/assistant">Ask the assistant</Link>
              </Button>
            </>
          )}
        </>
      )}
    >
      {content()}
    </AutomationPage>
  );
};

export default AutomationOverviewPage;
