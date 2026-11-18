import React, { useMemo } from 'react';
import { DatabaseZap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/PageHeader';
import { StatStrip, type StatItem } from '@/components/common/StatStrip';
import { todayYmd, upcomingLeave } from '@/lib/leave';
import type { UseLeave } from '@/hooks/useLeave';
import type { UseEmployeeDocuments } from '@/hooks/useEmployeeDocuments';
import { ExpiringDocumentsBox } from './overview/ExpiringDocumentsBox';
import { HolidaysBox, PendingLeaveBox, WhosOffBox } from './overview/LeaveBoxes';
import { expiringDocuments, onLeaveCount, pendingLeave } from './overview/overviewStats';
import { MilestonesBox, TeamBox } from './overview/TeamBoxes';
import { useOnClock } from './overview/useOnClock';
import type { HrPerson, HrTab } from './types';

export interface HrOverviewTabProps {
  people: HrPerson[];
  leave: UseLeave;
  docs: UseEmployeeDocuments;
  /** Jump to another HR tab (e.g. "Review" on pending leave). */
  onOpenTab: (tab: HrTab) => void;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** HR at a glance: figures on top, then boxes for what needs attention. */
export const HrOverviewTab: React.FC<HrOverviewTabProps> = ({ people, leave, docs, onOpenTab }) => {
  const today = todayYmd();
  const onClock = useOnClock(people);
  const peopleById = useMemo(() => new Map(people.map((p) => [p.userId, p])), [people]);

  // Until the database update has been run there is no leave or document
  // data at all, so everything built on it is left out rather than shown empty.
  const leaveOn = !leave.setupMissing;
  const docsOn = !docs.setupMissing;
  const leaveReady = leaveOn && !leave.loading && !leave.error;
  const docsReady = docsOn && !docs.loading && !docs.error;

  const withProfile = people.filter((p) => p.profile).length;
  const offToday = useMemo(() => onLeaveCount(people, leave.requests, today), [people, leave.requests, today]);
  const offSoon = useMemo(() => upcomingLeave(leave.requests, today, 14).length, [leave.requests, today]);
  const pending = useMemo(() => pendingLeave(leave.requests).length, [leave.requests]);
  const expiring = useMemo(() => expiringDocuments(docs.documents, today), [docs.documents, today]);
  const expired = expiring.filter((e) => e.tone === 'danger').length;

  const waiting: Pick<StatItem, 'value' | 'tone'> = { value: '—', tone: 'muted' };
  const stats: StatItem[] = [
    { label: 'Headcount', value: people.length, note: `${withProfile} with an HR profile` },
    {
      label: 'On the clock now',
      ...(onClock ? { value: onClock.onClock } : waiting),
      note: onClock ? `${onClock.clockedIn} clocked in today` : undefined,
    },
  ];
  if (leaveOn) {
    stats.push(
      {
        label: 'On leave today',
        ...(leaveReady ? { value: offToday } : waiting),
        note: leaveReady ? `${offSoon} off in the next two weeks` : undefined,
      },
      {
        label: 'Pending leave requests',
        ...(leaveReady ? { value: pending } : waiting),
        note: leaveReady ? (pending > 0 ? 'Waiting for a decision' : 'All decided') : undefined,
      },
    );
  }
  if (docsOn) {
    stats.push({
      label: 'Documents expiring soon',
      ...(docsReady ? { value: expiring.length, tone: expiring.length > 0 ? 'danger' : 'default' } : waiting),
      note: docsReady
        ? expired > 0
          ? `${plural(expired, 'has', 'have')} already expired`
          : 'In the next 30 days'
        : undefined,
    });
  }

  const team = (wide: boolean) => <TeamBox people={people} onOpenPeople={() => onOpenTab('people')} wide={wide} />;
  const milestones = <MilestonesBox people={people} today={today} />;
  // With no leave or document boxes the wide column would be empty, so the
  // team breakdown moves into it.
  const mainHasLists = leaveOn || docsOn;

  return (
    <>
      <PageHeader title="HR overview" description="Headcount, attendance, leave and documents at a glance." />

      <StatStrip items={stats} />

      {(!leaveOn || !docsOn) && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-border px-4 py-2.5">
          <p className="flex min-w-0 items-center gap-2 text-sm text-foreground">
            <DatabaseZap className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            Leave and Documents need a one-time database update.
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => onOpenTab('leave')}>
            See how
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-start gap-6">
        {/* Main column */}
        <div className="flex min-w-0 flex-[1_1_480px] flex-col gap-6">
          {leaveOn && (
            <>
              <PendingLeaveBox
                leave={leave}
                peopleById={peopleById}
                today={today}
                onOpenLeave={() => onOpenTab('leave')}
              />
              <WhosOffBox leave={leave} peopleById={peopleById} today={today} />
            </>
          )}
          {docsOn && (
            <ExpiringDocumentsBox
              docs={docs}
              peopleById={peopleById}
              today={today}
              onOpenDocuments={() => onOpenTab('documents')}
            />
          )}
          {!mainHasLists && team(true)}
        </div>

        {/* Side column */}
        <div className="flex w-full min-w-0 shrink-0 flex-col gap-6 xl:w-[24rem]">
          {mainHasLists && team(false)}
          {milestones}
          {leaveOn && <HolidaysBox leave={leave} today={today} />}
        </div>
      </div>
    </>
  );
};

export default HrOverviewTab;
