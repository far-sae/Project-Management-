import React, { useMemo, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/common/PageHeader';
import { StatStrip } from '@/components/common/StatStrip';
import { todayYmd } from '@/lib/leave';
import type { UseLeave } from '@/hooks/useLeave';
import { HrSetupNotice } from './HrSetupNotice';
import type { HrPerson } from './types';
import { AddHolidayDialog } from './leave/AddHolidayDialog';
import { AddLeaveDialog } from './leave/AddLeaveDialog';
import { HolidayList } from './leave/HolidayList';
import { LeaveBalancesTable } from './leave/LeaveBalancesTable';
import { LeaveRequestsTable } from './leave/LeaveRequestsTable';
import { YearSelect } from './leave/YearSelect';
import { leaveFigures, leaveYears } from './leave/leaveView';

export interface HrLeaveTabProps {
  people: HrPerson[];
  leave: UseLeave;
}

type Section = 'requests' | 'balances' | 'holidays';

const DESCRIPTION = 'Time off requests, yearly balances and public holidays.';

/** Count shown after a section name in the tab strip. */
const TabCount: React.FC<{ value: number }> = ({ value }) => (
  <span className="text-xs tabular-nums text-muted-foreground">{value}</span>
);

/**
 * HR › Leave. Only the workspace owner opens HR for now, so the owner records
 * leave for everyone, decides requests, sets allowances and keeps the list of
 * public holidays.
 */
export const HrLeaveTab: React.FC<HrLeaveTabProps> = ({ people, leave }) => {
  const today = todayYmd();
  const currentYear = Number(today.slice(0, 4));

  const [section, setSection] = useState<Section>('requests');
  const [year, setYear] = useState(currentYear);
  const [addingLeave, setAddingLeave] = useState(false);
  const [addingHoliday, setAddingHoliday] = useState(false);

  const { requests, holidays } = leave;
  const figures = useMemo(() => leaveFigures(requests, holidays, today), [requests, holidays, today]);
  const years = useMemo(() => {
    const list = leaveYears(requests, holidays, currentYear);
    return list.includes(year) ? list : [...list, year].sort((a, b) => b - a);
  }, [requests, holidays, currentYear, year]);
  const yearHolidays = useMemo(
    () => holidays.filter((h) => h.date.startsWith(`${year}-`)).sort((a, b) => a.date.localeCompare(b.date)),
    [holidays, year],
  );

  if (leave.setupMissing) {
    return (
      <>
        <PageHeader title="Leave" description={DESCRIPTION} />
        <HrSetupNotice feature="Leave" onRetry={() => void leave.refresh()} />
      </>
    );
  }

  // Nothing can be trusted (or checked for clashes) until leave has loaded.
  const ready = !leave.loading && !leave.error;

  return (
    <>
      <PageHeader
        title="Leave"
        description={DESCRIPTION}
        actions={
          <>
            <Button variant="outline" disabled={!ready} onClick={() => setAddingHoliday(true)}>
              Add holiday
            </Button>
            <Button disabled={!ready} onClick={() => setAddingLeave(true)}>
              <Plus aria-hidden />
              Add leave
            </Button>
          </>
        }
      />

      {leave.loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading leave" />
        </div>
      ) : leave.error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-destructive/30 bg-destructive-soft px-4 py-2.5 text-sm text-destructive-soft-foreground"
        >
          <span className="min-w-0">{leave.error}</span>
          <Button variant="outline" size="sm" onClick={() => void leave.refresh()}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          <StatStrip
            items={[
              { label: 'Pending requests', value: figures.pending },
              { label: 'On leave today', value: figures.onLeaveToday },
              { label: 'Off in the next 14 days', value: figures.offNext14Days },
              { label: 'Public holidays this year', value: figures.holidaysThisYear },
            ]}
          />

          <Tabs value={section} onValueChange={(v) => setSection(v as Section)}>
            <div className="overflow-x-auto overflow-y-hidden">
              <TabsList className="flex w-max min-w-full">
                <TabsTrigger value="requests">
                  Requests
                  <TabCount value={requests.length} />
                </TabsTrigger>
                <TabsTrigger value="balances">
                  Balances
                  <TabCount value={people.length} />
                </TabsTrigger>
                <TabsTrigger value="holidays">
                  Public holidays
                  <TabCount value={yearHolidays.length} />
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="requests">
              <LeaveRequestsTable people={people} leave={leave} />
            </TabsContent>

            <TabsContent value="balances" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <YearSelect year={year} years={years} onChange={setYear} />
                <p className="text-xs text-muted-foreground">Leave counts in the year it starts.</p>
              </div>
              <LeaveBalancesTable people={people} leave={leave} year={year} />
            </TabsContent>

            <TabsContent value="holidays" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <YearSelect year={year} years={years} onChange={setYear} />
                <p className="text-xs text-muted-foreground">Public holidays are not counted as leave days.</p>
              </div>
              <HolidayList
                holidays={yearHolidays}
                year={year}
                today={today}
                leave={leave}
                onAdd={() => setAddingHoliday(true)}
              />
            </TabsContent>
          </Tabs>
        </>
      )}

      <AddLeaveDialog open={addingLeave} onOpenChange={setAddingLeave} people={people} leave={leave} />
      <AddHolidayDialog
        open={addingHoliday}
        onOpenChange={setAddingHoliday}
        leave={leave}
        // Show the new holiday when the list is what is being looked at.
        onAdded={(date) => section === 'holidays' && setYear(Number(date.slice(0, 4)))}
      />
    </>
  );
};

export default HrLeaveTab;
