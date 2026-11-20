// Runs at /crm/automation/runs: every lead the agents are working on or have finished with.
import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ListChecks, RefreshCw, Search } from 'lucide-react';
import type { RunStatus, RunSummary } from '../../../api/_automation/shared/types';
import { useAutomation } from '@/hooks/useAutomation';
import {
  RUN_STATUS, RUN_STATUSES, ago, dateTime, filterRuns, plural, statusCounts, type RunFilter,
} from '@/lib/automation/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AutomationPage } from '@/components/automation/AutomationPage';
import { RunStatusPill } from '@/components/automation/RunStatusPill';
import { Bar, LoadFailed, Loading, NotReady, StaleNote } from '@/components/automation/states';
import { useAutomationRead } from '@/components/automation/useAutomationRead';
import { chipClass } from '@/components/signroom/billing/planShared';
import {
  EmptyState, HEAD_ROW, PickWorkspace, ROW, TD, TD_DATE, TH,
} from '@/components/signroom/billing/shared';

/** The server sends at most this many runs in one list. */
const LIST_LIMIT = 100;
const FILTERS: readonly RunFilter[] = ['all', ...RUN_STATUSES];
const COLUMNS = ['Who', 'Automation', 'Status', 'Result', 'Steps', 'Started', 'Last change'];
const TABLE = 'w-full min-w-[56rem] text-sm';
const REGION = 'overflow-x-auto rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const isStatus = (value: string | null): value is RunStatus => RUN_STATUSES.includes(value as RunStatus);

const TableHead: React.FC = () => (
  <thead>
    <tr className={HEAD_ROW}>
      {COLUMNS.map((column) => <th key={column} scope="col" className={TH}>{column}</th>)}
    </tr>
  </thead>
);

export const AutomationRunsPage: React.FC = () => {
  const { workspaceId } = useAutomation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const chosen = params.get('status');
  const status: RunFilter = isStatus(chosen) ? chosen : 'all';
  const [query, setQuery] = useState('');

  // The newest runs of every status give the counts; one status is then asked for by itself, so it is complete.
  const all = useAutomationRead<RunSummary[]>('runs');
  const one = useAutomationRead<RunSummary[]>(status === 'all' ? null : `runs?status=${status}`);

  const counts = useMemo(() => {
    const next = statusCounts(all.data ?? []);
    if (status !== 'all' && one.data) next[status] = Math.max(next[status], one.data.length);
    return next;
  }, [all.data, one.data, status]);

  const rows = useMemo(() => {
    if (!all.data) return [];
    return status !== 'all' && one.data ? filterRuns(one.data, 'all', query) : filterRuns(all.data, status, query);
  }, [all.data, one.data, status, query]);

  const setStatus = (next: RunFilter) => {
    const copy = new URLSearchParams(params);
    if (next === 'all') copy.delete('status'); else copy.set('status', next);
    setParams(copy, { replace: true });
  };
  const filtering = status !== 'all' || Boolean(query.trim());
  const clearFilters = () => { setQuery(''); setStatus('all'); };
  const refresh = () => { void all.reload(); void one.reload(); };
  const loading = all.loading || one.loading;

  const content = () => {
    if (!workspaceId) return <PickWorkspace what="its runs" />;
    if (all.notReady) return <NotReady>{all.error}</NotReady>;
    if (!all.data) {
      return all.error ? <LoadFailed error={all.error} onRetry={refresh} /> : (
        <Loading label="Loading the runs" className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((filter) => <Bar key={filter} className="h-7 w-24 rounded-full" />)}
          </div>
          <Bar className="h-8 w-full max-w-md" />
          <div className={REGION}>
            <table className={TABLE}>
              <TableHead />
              <tbody>
                {Array.from({ length: 6 }, (_, i) => (
                  <tr key={i} className={ROW}>
                    {COLUMNS.map((column) => <td key={column} className={TD}><Bar className="my-1 w-20" /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Loading>
      );
    }
    const stale = all.error || one.error;
    return (
      <>
        {stale && <StaleNote error={stale} onRetry={refresh} />}
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by status">
            {FILTERS.map((filter) => (
              <button key={filter} type="button" className={chipClass(status === filter)} aria-pressed={status === filter} onClick={() => setStatus(filter)}>
                {filter === 'all' ? 'All' : RUN_STATUS[filter].label}{' '}
                <span className="tabular-nums opacity-70">{counts[filter]}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="relative min-w-0 max-w-md flex-1 basis-60">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8"
                placeholder="Search by name" aria-label="Search runs by name"
              />
            </div>
            {filtering && <Button variant="ghost" onClick={clearFilters}>Clear filters</Button>}
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={<ListChecks className="h-5 w-5 text-muted-foreground" aria-hidden />}
            action={filtering ? <Button variant="outline" onClick={clearFilters}>Clear filters</Button> : undefined}
          >
            {filtering ? 'No runs match these filters.' : 'No runs yet. A run starts when a lead is added in this workspace.'}
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-2">
            <div className={REGION} role="region" aria-label="Runs" tabIndex={0}>
              <table className={TABLE}>
                <TableHead />
                <tbody>
                  {rows.map((run) => (
                    <tr
                      key={run.id}
                      className={`${ROW} cursor-pointer hover:bg-muted/40`}
                      onClick={() => navigate(`/crm/automation/runs/${run.id}`)}
                    >
                      <td className={TD}>
                        <Link
                          to={`/crm/automation/runs/${run.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="block max-w-64 truncate rounded-md font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {run.subject}
                        </Link>
                      </td>
                      <td className={`${TD} text-muted-foreground`}><span className="block max-w-48 truncate">{run.automationName}</span></td>
                      <td className={TD}><RunStatusPill status={run.status} /></td>
                      <td className={`${TD} text-muted-foreground`}><span className="block max-w-80 break-words">{run.result}</span></td>
                      <td className={`${TD} whitespace-nowrap tabular-nums text-muted-foreground`}>{run.stepsDone} of {run.stepCount}</td>
                      <td className={TD_DATE}>{dateTime(run.started)}</td>
                      <td className={TD_DATE}>{ago(run.updated)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p role="status" className="text-xs tabular-nums text-muted-foreground">
              {plural(rows.length, 'run', 'runs')}
              {(status !== 'all' && one.data ? one.data : all.data).length >= LIST_LIMIT ? ` · Only the newest ${LIST_LIMIT} are listed.` : ''}
            </p>
          </div>
        )}
      </>
    );
  };

  return (
    <AutomationPage
      title="Runs"
      description="Every lead the agents are working on or have finished with, newest first. Open a run to see what each agent received, decided and did."
      actions={(
        <Button variant="outline" disabled={!workspaceId || loading} onClick={refresh}>
          <RefreshCw className={loading && all.data ? 'motion-safe:animate-spin' : undefined} aria-hidden /> Refresh
        </Button>
      )}
    >
      {content()}
    </AutomationPage>
  );
};

export default AutomationRunsPage;
