import { useEffect, useMemo, useState } from 'react';
import { useOrganization } from '@/context/OrganizationContext';
import { subscribeToTimeEntries, type TimeEntry } from '@/services/supabase/timeEntries';
import { buildAttendance, summarizeAttendance } from '@/lib/attendance';
import type { HrPerson } from '../types';

/**
 * Today's clock-in summary, from the same time entries and the same rules as
 * the Attendance tab so the two always agree. Null until the entries arrive.
 *
 * `inScope` limits it to the people in the selected workspace. Anyone with
 * time this week is counted even if they are not in `people`, so the entries
 * are limited too, not only the list of people.
 */
export function useOnClock(people: HrPerson[], inScope?: (userId: string) => boolean) {
  const { organization } = useOrganization();
  const orgId = organization?.organizationId ?? '';
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);

  useEffect(() => {
    if (!orgId) return;
    setEntries(null);
    return subscribeToTimeEntries(orgId, setEntries);
  }, [orgId]);

  return useMemo(() => {
    if (!entries) return null;
    const now = new Date();
    const rows = buildAttendance(
      inScope ? entries.filter((e) => inScope(e.userId)) : entries,
      people.map((p) => ({ userId: p.userId, name: p.displayName })),
      now,
      now,
    );
    return summarizeAttendance(rows);
  }, [entries, people, inScope]);
}
