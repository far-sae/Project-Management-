import React, { useMemo } from 'react';
import { PartyPopper, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HrPerson } from '../types';
import {
  departmentBreakdown,
  milestoneLabel,
  statusBreakdown,
  teamMilestones,
  type CountRow,
} from './overviewStats';
import { BOX_ROW, PersonAvatar, SectionBox, SectionEmpty, SectionLink, personName } from './SectionBox';

/** A titled list of label + number lines, each with a thin bar. */
const Breakdown: React.FC<{ title: string; rows: CountRow[]; total: number }> = ({ title, rows, total }) => (
  <div className="min-w-0 px-4 py-3">
    <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
    <ul className="mt-2 flex flex-col gap-2.5">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-foreground">{row.label}</span>
            <span className="shrink-0 font-medium tabular-nums text-foreground">{row.count}</span>
          </div>
          <div aria-hidden className="mt-1.5 h-1 overflow-hidden rounded-full bg-foreground/10">
            <div
              className="h-full rounded-full bg-foreground/70"
              style={{ width: total > 0 ? `${(row.count / total) * 100}%` : 0 }}
            />
          </div>
        </li>
      ))}
    </ul>
  </div>
);

/** Headcount by HR status and by department. */
export const TeamBox: React.FC<{
  people: HrPerson[];
  onOpenPeople: () => void;
  /** Put the two lists side by side (when the box sits in the wide column). */
  wide?: boolean;
}> = ({ people, onOpenPeople, wide = false }) => {
  const byStatus = useMemo(() => statusBreakdown(people), [people]);
  const byDepartment = useMemo(() => departmentBreakdown(people), [people]);

  return (
    <SectionBox title="Team" meta={<SectionLink onClick={onOpenPeople}>Open People</SectionLink>}>
      {people.length === 0 ? (
        <SectionEmpty
          icon={Users}
          title="No team members yet."
          hint="People show up here once they join your organization."
        />
      ) : (
        <div
          className={cn(
            'grid divide-y divide-border/60',
            wide && 'sm:grid-cols-2 sm:divide-x sm:divide-y-0',
          )}
        >
          <Breakdown title="By status" rows={byStatus} total={people.length} />
          <Breakdown title="By department" rows={byDepartment} total={people.length} />
        </div>
      )}
    </SectionBox>
  );
};

/** People who joined in the last 30 days or have a work anniversary coming. */
export const MilestonesBox: React.FC<{ people: HrPerson[]; today: string }> = ({ people, today }) => {
  const milestones = useMemo(() => teamMilestones(people, today), [people, today]);
  const peopleById = useMemo(() => new Map(people.map((p) => [p.userId, p])), [people]);

  return (
    <SectionBox title="Starters and anniversaries" meta="30 days either side">
      {milestones.length === 0 ? (
        <SectionEmpty
          icon={PartyPopper}
          title="No new starters or anniversaries this month."
          hint="Hire dates come from each person's HR profile."
        />
      ) : (
        <ul>
          {milestones.map((m) => {
            const person = peopleById.get(m.userId);
            return (
              <li key={`${m.userId}-${m.kind}`} className={BOX_ROW}>
                <PersonAvatar person={person} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {personName(person)}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{milestoneLabel(m)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </SectionBox>
  );
};
