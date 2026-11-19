import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';
import { ArrowRight, CalendarCheck, FolderCheck, Layers, Loader2, Plus, Waypoints } from 'lucide-react';
import {
  useCrmActivities, useCrmCompanies, useCrmContacts, useCrmDeals, useCrmDealStages, useCrmTasks,
} from '@/hooks/useCrmHub';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/PageHeader';
import { StatStrip, type StatItem } from '@/components/common/StatStrip';
import { StatusPill } from '@/components/common/StatusPill';
import { SectionBox, SectionEmpty } from '@/components/hr/overview/SectionBox';
import { useCrmCurrency } from '@/context/CrmCurrencyContext';
import { leadName } from '@/lib/crmFlow';
import {
  flowCounts, followUpsDue, handoffQueue, lostReasonCounts, pipelineStats, stageBreakdown,
} from '@/lib/crmDashboard';
import { cn } from '@/lib/utils';
import type { ActivityType } from '@/types/crmHub';

/** Rows shown in a list before "N more" takes over. */
const LIST_LIMIT = 8;
/** "Follow-ups due" looks this many days ahead. */
const FOLLOW_UP_DAYS = 7;

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';

/** One line in a box's list. */
const ROW = 'flex min-h-12 items-center gap-3 px-4 py-2 text-[0.8125rem]';
const ROW_LINK = cn(ROW, FOCUS, 'transition-colors hover:bg-surface-2');
const ROW_ITEM = 'border-b border-border/60 last:border-0';

/** Small link on the right of a box's title row. */
const META_LINK = cn(
  FOCUS,
  '-m-1 rounded p-1 text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline',
);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const ACTIVITY_LABEL: Record<ActivityType, string> = {
  note: 'Note',
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  task_completed: 'Follow-up completed',
  contact_created: 'Lead added',
  company_created: 'Company added',
  deal_created: 'Deal added',
  deal_updated: 'Deal updated',
  deal_stage_changed: 'Deal moved',
  deal_won: 'Deal won',
  deal_lost: 'Deal lost',
};

/** Thin bar showing a share between 0 and 1. */
const ShareBar: React.FC<{ share: number; className?: string }> = ({ share, className }) => (
  <div aria-hidden className={cn('h-1 overflow-hidden rounded-full bg-foreground/10', className)}>
    <div
      className="h-full rounded-full bg-foreground/70"
      style={{ width: `${Math.round(Math.min(1, Math.max(0, share)) * 100)}%` }}
    />
  </div>
);

/** "3 more" line at the bottom of a list that was cut short. */
const MoreLink: React.FC<{ count: number; to: string }> = ({ count, to }) =>
  count > 0 ? (
    <div className="border-t border-border/60 px-4 py-2">
      <Link to={to} className={META_LINK}>
        {count} more
      </Link>
    </div>
  ) : null;

export const CrmDashboardPage: React.FC = () => {
  const contactsList = useCrmContacts();
  const companiesList = useCrmCompanies();
  const dealsList = useCrmDeals();
  const stagesList = useCrmDealStages();
  const tasksList = useCrmTasks();
  const activitiesList = useCrmActivities(LIST_LIMIT);
  const { format: money } = useCrmCurrency();

  const contacts = contactsList.items;
  const companies = companiesList.items;
  const deals = dealsList.items;
  const stages = stagesList.items;
  const tasks = tasksList.items;
  const activities = activitiesList.items;

  const loading = dealsList.loading || stagesList.loading;

  const stagesById = useMemo(() => new Map(stages.map((s) => [s.id, s])), [stages]);
  const contactsById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const companiesById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  const dealsById = useMemo(() => new Map(deals.map((d) => [d.id, d])), [deals]);

  const stats = useMemo(() => pipelineStats(deals, stagesById, new Date()), [deals, stagesById]);
  const flow = useMemo(() => flowCounts(contacts, deals), [contacts, deals]);
  const waiting = useMemo(() => handoffQueue(deals), [deals]);
  const stageRows = useMemo(() => stageBreakdown(deals, stages), [deals, stages]);
  const lostReasons = useMemo(() => lostReasonCounts(deals), [deals]);
  const followUps = useMemo(
    () => followUpsDue(tasks, new Date(), FOLLOW_UP_DAYS, LIST_LIMIT),
    [tasks],
  );
  const recent = useMemo(
    () => [...activities].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, LIST_LIMIT),
    [activities],
  );

  if (loading) {
    return (
      <main className="flex flex-1 items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />
      </main>
    );
  }

  const sources = [dealsList, stagesList, contactsList, companiesList, tasksList, activitiesList];
  const loadError = sources.find((s) => s.error)?.error ?? null;
  const retry = () => sources.filter((s) => s.error).forEach((s) => void s.refresh());

  const statItems: StatItem[] = [
    {
      label: 'Open pipeline',
      value: money(stats.openValue),
      note: plural(stats.openCount, 'open deal', 'open deals'),
    },
    {
      label: 'Forecast',
      value: money(stats.forecast),
      note: 'Weighted by chance of winning',
    },
    {
      label: 'Won this month',
      value: money(stats.wonThisMonthValue),
      note: plural(stats.wonThisMonthCount, 'deal', 'deals'),
      tone: stats.wonThisMonthCount > 0 ? 'success' : 'default',
    },
    {
      label: 'Win rate',
      value: stats.winRate === null ? '—' : `${stats.winRate}%`,
      note: stats.winRate === null ? 'No deals closed yet' : `${stats.wonCount} won, ${stats.lostCount} lost`,
      tone: stats.winRate === null ? 'muted' : 'default',
    },
    {
      label: 'Leads',
      value: flow.leads,
      note: 'Not yet converted to a deal',
    },
  ];

  const flowSteps = [
    { label: 'Leads', count: flow.leads, hint: 'Qualify, then convert', to: '/crm/contacts' },
    { label: 'Open deals', count: flow.openDeals, hint: `${money(stats.openValue)} in the pipeline`, to: '/crm/deals' },
    {
      label: 'Won',
      count: flow.won,
      hint: waiting.length > 0 ? `${waiting.length} waiting for hand-off` : 'All handed off',
      to: '/crm/deals',
    },
    { label: 'In delivery', count: flow.inDelivery, hint: 'Handed off to a project', to: '/dashboard' },
  ];

  /** "Company · Lead" for a deal or follow-up, whichever of the two it has. */
  const whoLine = (companyId: string | null, contactId: string | null): string => {
    const company = companyId ? companiesById.get(companyId) : undefined;
    const contact = contactId ? contactsById.get(contactId) : undefined;
    return [company?.name, contact ? leadName(contact) : undefined].filter(Boolean).join(' · ');
  };

  const topLostCount = lostReasons[0]?.count ?? 0;

  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-background">
      <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">
        <PageHeader
          title="CRM"
          description="Leads, deals and hand-offs into delivery at a glance."
          actions={
            <>
              <Button asChild variant="outline">
                <Link to="/crm/deals">View pipeline</Link>
              </Button>
              <Button asChild>
                <Link to="/crm/contacts">
                  <Plus aria-hidden />
                  New lead
                </Link>
              </Button>
            </>
          }
        />

        {loadError && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-destructive/30 bg-destructive-soft px-4 py-2.5"
          >
            <p className="min-w-0 text-sm text-destructive-soft-foreground">
              Some figures could not be loaded: {loadError}
            </p>
            <Button type="button" size="sm" variant="outline" onClick={retry}>
              Retry
            </Button>
          </div>
        )}

        <StatStrip items={statItems} />

        {/* Flow: lead → deal → won → delivery */}
        <nav aria-label="CRM flow">
          <ol className="flex flex-col gap-2 md:flex-row md:items-stretch">
            {flowSteps.map((step, i) => (
              <React.Fragment key={step.label}>
                {i > 0 && (
                  <li aria-hidden className="flex shrink-0 items-center justify-center text-muted-foreground">
                    <ArrowRight className="h-4 w-4 rotate-90 md:rotate-0" />
                  </li>
                )}
                <li className="min-w-0 md:flex-1">
                  <Link
                    to={step.to}
                    className={cn(
                      FOCUS,
                      'flex h-full flex-col gap-0.5 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-surface-2',
                    )}
                  >
                    <span className="truncate text-xs font-medium text-muted-foreground">{step.label}</span>
                    <span className="text-sm font-semibold tabular-nums text-foreground">{step.count}</span>
                    <span className="truncate text-xs tabular-nums text-muted-foreground" title={step.hint}>
                      {step.hint}
                    </span>
                  </Link>
                </li>
              </React.Fragment>
            ))}
          </ol>
        </nav>

        <SectionBox
          title="Waiting for hand-off"
          meta={waiting.length > 0 ? `${plural(waiting.length, 'won deal', 'won deals')} without a project` : undefined}
        >
          {waiting.length === 0 ? (
            <SectionEmpty icon={FolderCheck} title="Every won deal has a project." />
          ) : (
            <>
              <ul>
                {waiting.slice(0, LIST_LIMIT).map((deal) => {
                  const who = whoLine(deal.companyId, deal.contactId);
                  const wonOn = format(deal.closedAt ?? deal.updatedAt, 'd MMM yyyy');
                  return (
                    <li key={deal.id} className={ROW_ITEM}>
                      <Link to={`/crm/deals/${deal.id}`} className={cn(ROW_LINK, 'flex-wrap gap-y-1')}>
                        <span className="min-w-0 flex-1 basis-48">
                          <span className="block truncate text-sm font-medium text-foreground">{deal.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {who ? `${who} · ` : ''}Won {wonOn}
                          </span>
                        </span>
                        <span className="tabular-nums text-foreground">{money(deal.value)}</span>
                        <StatusPill tone="warning">Needs a project</StatusPill>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <MoreLink count={waiting.length - LIST_LIMIT} to="/crm/deals" />
            </>
          )}
        </SectionBox>

        <SectionBox
          title="Pipeline by stage"
          meta={
            <Link to="/crm/deals" className={META_LINK}>
              View pipeline
            </Link>
          }
        >
          {stageRows.length === 0 ? (
            <SectionEmpty icon={Layers} title="No stages yet." hint="Add pipeline stages in CRM settings." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-[0.8125rem]">
                <thead>
                  <tr className="h-10 border-b border-border bg-surface-2 text-left text-xs text-muted-foreground">
                    <th scope="col" className="px-4 font-medium">Stage</th>
                    <th scope="col" className="px-4 text-right font-medium">Chance</th>
                    <th scope="col" className="px-4 text-right font-medium">Deals</th>
                    <th scope="col" className="px-4 text-right font-medium">Value</th>
                    <th scope="col" className="px-4 text-right font-medium">Weighted</th>
                    <th scope="col" className="w-48 px-4 font-medium">Share of open value</th>
                  </tr>
                </thead>
                <tbody>
                  {stageRows.map((row) => (
                    <tr
                      key={row.stageId}
                      className="h-12 border-b border-border/60 transition-colors last:border-0 hover:bg-surface-2"
                    >
                      <th scope="row" className="px-4 text-left font-medium text-foreground">{row.name}</th>
                      <td className="px-4 text-right tabular-nums text-muted-foreground">{row.probability}%</td>
                      <td className="px-4 text-right tabular-nums">{row.count}</td>
                      <td className="px-4 text-right tabular-nums">{money(row.value)}</td>
                      <td className="px-4 text-right tabular-nums text-muted-foreground">{money(row.weighted)}</td>
                      <td className="px-4">
                        <div className="flex items-center gap-2">
                          <ShareBar share={row.share} className="min-w-0 flex-1" />
                          <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                            {Math.round(row.share * 100)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionBox>

        <div className="grid gap-6 lg:grid-cols-2">
          <SectionBox
            title="Follow-ups due"
            meta={
              <span className="flex items-center gap-3">
                {followUps.overdue > 0 && (
                  <span className="font-medium tabular-nums text-destructive">{followUps.overdue} overdue</span>
                )}
                <Link to="/crm/tasks" className={META_LINK}>
                  Open follow-ups
                </Link>
              </span>
            }
          >
            {followUps.items.length === 0 ? (
              <SectionEmpty
                icon={CalendarCheck}
                title="No follow-ups due."
                hint={`Nothing overdue or due in the next ${FOLLOW_UP_DAYS} days.`}
              />
            ) : (
              <>
                <ul>
                  {followUps.items.map(({ task, overdue }) => {
                    const about =
                      (task.dealId ? dealsById.get(task.dealId)?.name : undefined) ||
                      whoLine(task.companyId, task.contactId);
                    return (
                      <li key={task.id} className={ROW_ITEM}>
                        <Link to="/crm/tasks" className={ROW_LINK}>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-foreground">{task.title}</span>
                            {about && <span className="block truncate text-xs text-muted-foreground">{about}</span>}
                          </span>
                          {task.dueDate && (
                            <span
                              className={cn(
                                'shrink-0 text-xs tabular-nums',
                                overdue ? 'font-medium text-destructive' : 'text-muted-foreground',
                              )}
                              title={format(task.dueDate, 'd MMM yyyy, HH:mm')}
                            >
                              {format(task.dueDate, 'EEE d MMM')}
                            </span>
                          )}
                          {overdue && <StatusPill tone="danger">Overdue</StatusPill>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                <MoreLink count={followUps.total - followUps.items.length} to="/crm/tasks" />
              </>
            )}
          </SectionBox>

          <SectionBox
            title="Recent activity"
            meta={
              <Link to="/crm/activity" className={META_LINK}>
                View all
              </Link>
            }
          >
            {recent.length === 0 ? (
              <SectionEmpty icon={Waypoints} title="No activity yet." />
            ) : (
              <ul>
                {recent.map((activity) => {
                  const label = ACTIVITY_LABEL[activity.type] ?? activity.type.replace(/_/g, ' ');
                  const text = activity.description?.trim();
                  return (
                    <li key={activity.id} className={cn(ROW, ROW_ITEM)}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-foreground" title={text || undefined}>
                          {text || label}
                        </span>
                        {text && <span className="block truncate text-xs text-muted-foreground">{label}</span>}
                      </span>
                      <time
                        dateTime={activity.createdAt.toISOString()}
                        title={format(activity.createdAt, 'd MMM yyyy, HH:mm')}
                        className="shrink-0 text-xs tabular-nums text-muted-foreground"
                      >
                        {formatDistanceToNow(activity.createdAt, { addSuffix: true })}
                      </time>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionBox>
        </div>

        {lostReasons.length > 0 && (
          <SectionBox title="Why deals are lost" meta={plural(stats.lostCount, 'lost deal', 'lost deals')}>
            <ul>
              {lostReasons.map(({ reason, count }) => (
                <li key={reason} className={cn(ROW, ROW_ITEM)}>
                  <span className="min-w-0 flex-1 truncate text-foreground" title={reason}>
                    {reason}
                  </span>
                  <ShareBar share={topLostCount > 0 ? count / topLostCount : 0} className="w-24 shrink-0" />
                  <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground">{count}</span>
                </li>
              ))}
            </ul>
          </SectionBox>
        )}
      </div>
    </main>
  );
};

export default CrmDashboardPage;
