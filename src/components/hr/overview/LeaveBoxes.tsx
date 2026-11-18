import React, { useMemo, useState } from 'react';
import { CalendarCheck, CalendarDays, Inbox } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/common/StatusPill';
import { cn } from '@/lib/utils';
import { LEAVE_TYPE_LABEL, upcomingLeave } from '@/lib/leave';
import type { UseLeave } from '@/hooks/useLeave';
import type { LeaveRequest } from '@/services/supabase/leave';
import type { HrPerson } from '../types';
import { formatYmd, formatYmdRange } from './dates';
import { errorText } from './errorText';
import { pendingLeave, upcomingHolidays } from './overviewStats';
import {
  BOX_ROW,
  PersonAvatar,
  SectionBox,
  SectionEmpty,
  SectionLink,
  personName,
  sectionState,
} from './SectionBox';

/** Rows shown before "N more" takes over. */
const PENDING_LIMIT = 8;
/** "Who's off" looks this many days ahead. */
const OFF_WINDOW_DAYS = 14;

const daysLabel = (days: number): string =>
  days === 0.5 ? 'Half day' : `${days} ${days === 1 ? 'day' : 'days'}`;

interface LeaveBoxProps {
  leave: UseLeave;
  peopleById: Map<string, HrPerson>;
  /** Today as `yyyy-MM-dd`. */
  today: string;
}

/** Leave waiting for a decision, with Approve / Reject on each line. */
export const PendingLeaveBox: React.FC<LeaveBoxProps & { onOpenLeave: () => void }> = ({
  leave,
  peopleById,
  today,
  onOpenLeave,
}) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const pending = useMemo(() => pendingLeave(leave.requests), [leave.requests]);
  const thisYear = Number(today.slice(0, 4));

  const decide = async (request: LeaveRequest, status: 'approved' | 'rejected') => {
    const name = personName(peopleById.get(request.userId));
    setBusyId(request.id);
    try {
      await leave.decide(request.id, status);
      toast.success(status === 'approved' ? `Leave approved for ${name}` : `Leave rejected for ${name}`);
    } catch (e) {
      toast.error(errorText(e, 'Could not save the decision.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SectionBox title="Pending leave requests" meta={<SectionLink onClick={onOpenLeave}>Open Leave</SectionLink>}>
      {sectionState(leave) ??
        (pending.length === 0 ? (
          <SectionEmpty icon={Inbox} title="Nothing waiting for a decision." />
        ) : (
          <>
            <ul>
              {pending.slice(0, PENDING_LIMIT).map((r) => {
                const person = peopleById.get(r.userId);
                const name = personName(person);
                const busy = busyId === r.id;
                return (
                  <li key={r.id} className={cn(BOX_ROW, 'flex-wrap gap-y-2')}>
                    <div className="flex min-w-0 flex-1 basis-48 items-center gap-3">
                      <PersonAvatar person={person} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {LEAVE_TYPE_LABEL[r.leaveType]}
                          {' · '}
                          <span className="tabular-nums">{formatYmdRange(r.startDate, r.endDate, thisYear)}</span>
                          {' · '}
                          <span className="tabular-nums">{daysLabel(r.days)}</span>
                        </p>
                      </div>
                    </div>
                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        aria-label={`Approve ${name}'s leave`}
                        onClick={() => void decide(r, 'approved')}
                      >
                        Approve
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground"
                        disabled={busy}
                        aria-label={`Reject ${name}'s leave`}
                        onClick={() => void decide(r, 'rejected')}
                      >
                        Reject
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            {pending.length > PENDING_LIMIT && (
              <div className="border-t border-border/60 px-4 py-2.5">
                <SectionLink onClick={onOpenLeave}>
                  {pending.length - PENDING_LIMIT} more on the Leave tab
                </SectionLink>
              </div>
            )}
          </>
        ))}
    </SectionBox>
  );
};

/** Approved leave running today or starting in the next two weeks. */
export const WhosOffBox: React.FC<LeaveBoxProps> = ({ leave, peopleById, today }) => {
  const off = useMemo(() => upcomingLeave(leave.requests, today, OFF_WINDOW_DAYS), [leave.requests, today]);
  const thisYear = Number(today.slice(0, 4));

  return (
    <SectionBox title="Who's off" meta="Today and the next 14 days">
      {sectionState(leave) ??
        (off.length === 0 ? (
          <SectionEmpty icon={CalendarCheck} title="Nobody is off in the next two weeks." />
        ) : (
          <ul>
            {off.map((r) => {
              const person = peopleById.get(r.userId);
              const offToday = r.startDate <= today && r.endDate >= today;
              return (
                <li key={r.id} className={cn(BOX_ROW, 'flex-wrap gap-y-1')}>
                  <div className="flex min-w-0 flex-1 basis-40 items-center gap-3">
                    <PersonAvatar person={person} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{personName(person)}</p>
                      <p className="truncate text-xs text-muted-foreground">{LEAVE_TYPE_LABEL[r.leaveType]}</p>
                    </div>
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-2">
                    {offToday && <StatusPill tone="info">Today</StatusPill>}
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {formatYmdRange(r.startDate, r.endDate, thisYear)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        ))}
    </SectionBox>
  );
};

/** The next five public holidays. */
export const HolidaysBox: React.FC<Pick<LeaveBoxProps, 'leave' | 'today'>> = ({ leave, today }) => {
  const holidays = useMemo(() => upcomingHolidays(leave.holidays, today), [leave.holidays, today]);
  const thisYear = today.slice(0, 4);

  return (
    <SectionBox title="Upcoming public holidays">
      {sectionState(leave) ??
        (holidays.length === 0 ? (
          <SectionEmpty
            icon={CalendarDays}
            title="No public holidays coming up."
            hint="Add them on the Leave tab."
          />
        ) : (
          <ul>
            {holidays.map((h) => (
              <li key={h.id} className={BOX_ROW}>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{h.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatYmd(h.date, { weekday: true, year: h.date.slice(0, 4) !== thisYear })}
                </span>
              </li>
            ))}
          </ul>
        ))}
    </SectionBox>
  );
};
