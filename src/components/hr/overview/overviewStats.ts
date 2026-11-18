import { addDaysYmd, leaveOnDate, type LeaveLike } from '@/lib/leave';
import type { EmployeeStatus } from '@/services/supabase/employees';
import type { EmployeeDocument } from '@/services/supabase/hrDocuments';
import type { PublicHoliday } from '@/services/supabase/leave';
import { documentExpiry, EXPIRY_WARNING_DAYS, type DocumentExpiry } from '../documents/documentHelpers';
import type { HrPerson } from '../types';
import { dateToYmd, daysBetweenYmd, formatYmd } from './dates';

/** One line of a breakdown: a label and how many people it covers. */
export interface CountRow {
  key: string;
  label: string;
  count: number;
}

const STATUS_ROWS: { key: EmployeeStatus | 'none'; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'onboarding', label: 'Onboarding' },
  { key: 'terminated', label: 'Terminated' },
  { key: 'none', label: 'No profile' },
];

/** People by HR status. Always the same four rows, in the same order. */
export function statusBreakdown(people: HrPerson[]): CountRow[] {
  return STATUS_ROWS.map(({ key, label }) => ({
    key,
    label,
    count: people.filter((p) => (p.profile ? p.profile.status : 'none') === key).length,
  }));
}

/**
 * People by department, biggest first. Only the `top` departments get their
 * own row; the rest share "Other departments". People with no department
 * (or no HR profile) come last.
 */
export function departmentBreakdown(people: HrPerson[], top = 5): CountRow[] {
  const groups = new Map<string, CountRow>();
  let none = 0;
  for (const p of people) {
    const label = p.profile?.department?.trim() ?? '';
    if (!label) {
      none += 1;
      continue;
    }
    const key = label.toLowerCase();
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { key, label, count: 1 });
  }

  const sorted = [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const rows = sorted.slice(0, top);
  const rest = sorted.slice(top).reduce((sum, r) => sum + r.count, 0);
  if (rest > 0) rows.push({ key: 'other', label: 'Other departments', count: rest });
  if (none > 0) rows.push({ key: 'none', label: 'No department', count: none });
  return rows;
}

export type MilestoneKind = 'joined' | 'starting' | 'anniversary';

export interface TeamMilestone {
  userId: string;
  kind: MilestoneKind;
  /** The day it happened or will happen, `yyyy-MM-dd`. */
  date: string;
  /** Years with the company on that day (0 for starters). */
  years: number;
  /** Days from today; negative when in the past. */
  daysAway: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** The anniversary of a hire date in `year`; 29 February moves to the 28th. */
function anniversaryIn(year: number, hireYmd: string): string {
  const [, m, d] = hireYmd.split('-').map(Number);
  const day = m === 2 && d === 29 && !isLeapYear(year) ? 28 : d;
  return `${year}-${pad(m)}-${pad(day)}`;
}

/**
 * New starters and work anniversaries around today: anyone who joined in the
 * last `windowDays` days, is due to start in the next `windowDays`, or
 * reaches a whole number of years in that time. People who have left are
 * skipped. Nearest date first.
 */
export function teamMilestones(people: HrPerson[], today: string, windowDays = 30): TeamMilestone[] {
  const from = addDaysYmd(today, -windowDays);
  const until = addDaysYmd(today, windowDays);
  const thisYear = Number(today.slice(0, 4));
  const found: (TeamMilestone & { name: string })[] = [];

  for (const p of people) {
    if (!p.profile || p.profile.status === 'terminated') continue;
    const hired = dateToYmd(p.profile.hireDate);
    if (!hired) continue;
    const base = { userId: p.userId, name: p.displayName };

    if (hired >= from && hired <= today) {
      found.push({ ...base, kind: 'joined', date: hired, years: 0, daysAway: daysBetweenYmd(today, hired) });
      continue;
    }
    if (hired > today) {
      if (hired <= until) {
        found.push({ ...base, kind: 'starting', date: hired, years: 0, daysAway: daysBetweenYmd(today, hired) });
      }
      continue;
    }
    const hireYear = Number(hired.slice(0, 4));
    for (const year of [thisYear, thisYear + 1]) {
      const date = anniversaryIn(year, hired);
      if (date >= today && date <= until && year > hireYear) {
        found.push({
          ...base,
          kind: 'anniversary',
          date,
          years: year - hireYear,
          daysAway: daysBetweenYmd(today, date),
        });
        break;
      }
    }
  }

  return found
    .sort((a, b) => Math.abs(a.daysAway) - Math.abs(b.daysAway) || a.name.localeCompare(b.name))
    .map(({ name: _name, ...milestone }) => milestone);
}

/** "Joined 12 Nov", "Starts 1 Dec", "3 years on 2 Dec". */
export function milestoneLabel(m: TeamMilestone): string {
  const today = m.daysAway === 0;
  if (m.kind === 'joined') return today ? 'Joined today' : `Joined ${formatYmd(m.date)}`;
  if (m.kind === 'starting') return `Starts ${formatYmd(m.date)}`;
  const years = `${m.years} ${m.years === 1 ? 'year' : 'years'}`;
  return today ? `${years} today` : `${years} on ${formatYmd(m.date)}`;
}

export interface ExpiringDocument extends DocumentExpiry {
  doc: EmployeeDocument;
}

/** Documents that have expired or expire within `windowDays`, soonest first. */
export function expiringDocuments(
  documents: EmployeeDocument[],
  today: string,
  windowDays = EXPIRY_WARNING_DAYS,
): ExpiringDocument[] {
  const found: ExpiringDocument[] = [];
  for (const doc of documents) {
    const expiry = documentExpiry(doc.expiresOn, today, windowDays);
    if (expiry) found.push({ doc, ...expiry });
  }
  return found.sort((a, b) => a.daysLeft - b.daysLeft || a.doc.title.localeCompare(b.doc.title));
}

/** How many of these people are on approved leave on `date`. */
export function onLeaveCount(people: HrPerson[], requests: LeaveLike[], date: string): number {
  return people.filter((p) => leaveOnDate(requests, p.userId, date)).length;
}

/** Requests nobody has decided yet, earliest start first. */
export function pendingLeave<T extends LeaveLike>(requests: T[]): T[] {
  return requests
    .filter((r) => r.status === 'pending')
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
}

/** The next public holidays from today on. */
export function upcomingHolidays(holidays: PublicHoliday[], today: string, limit = 5): PublicHoliday[] {
  return holidays
    .filter((h) => h.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limit);
}
