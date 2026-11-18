import { countLeaveDays, findOverlap, leaveBalance, type LeaveLike, type LeaveType } from '@/lib/leave';
import type { CreateLeaveInput, LeaveAllowance } from '@/services/supabase/leave';

/** What the "Add leave" dialog holds while it is being filled in. */
export interface LeaveFormValues {
  userId: string;
  leaveType: LeaveType;
  /** `yyyy-MM-dd`, or empty while the field is cleared. */
  startDate: string;
  /** `yyyy-MM-dd`, or empty while the field is cleared. */
  endDate: string;
  halfDay: boolean;
  reason: string;
  /** On: saved as approved. Off: saved as a pending request. */
  approveNow: boolean;
}

/** One day of annual leave today, approved straight away. */
export function blankLeaveForm(today: string, userId = ''): LeaveFormValues {
  return {
    userId,
    leaveType: 'annual',
    startDate: today,
    endDate: today,
    halfDay: false,
    reason: '',
    approveNow: true,
  };
}

/**
 * Apply a change and keep the form consistent: the end date follows the start
 * date until it has been set to something later, it is never before the start
 * date, and a half day is only possible for a single day.
 */
export function updateLeaveForm(form: LeaveFormValues, patch: Partial<LeaveFormValues>): LeaveFormValues {
  const next = { ...form, ...patch };
  if (patch.startDate !== undefined && form.endDate === form.startDate) next.endDate = next.startDate;
  if (next.startDate && next.endDate && next.endDate < next.startDate) next.endDate = next.startDate;
  if (next.startDate !== next.endDate) next.halfDay = false;
  return next;
}

export type LeaveFormProblem = 'incomplete' | 'clash' | 'no-working-days';

export interface LeaveFormCheck<T extends LeaveLike = LeaveLike> {
  /** Working days this leave uses. */
  days: number;
  /** Leave the same person already has on these dates. */
  clash: T | undefined;
  /** Allowance left once this leave is taken; null for leave without an allowance. */
  remainingAfter: number | null;
  /** Why the form cannot be saved yet, if it cannot. */
  problem: LeaveFormProblem | null;
}

/** Work out the day count, the balance and whether the form can be saved. */
export function checkLeaveForm<T extends LeaveLike>(
  form: LeaveFormValues,
  context: { requests: T[]; holidayDates: string[]; allowance: LeaveAllowance },
): LeaveFormCheck<T> {
  if (!form.userId || !form.startDate || !form.endDate) {
    return { days: 0, clash: undefined, remainingAfter: null, problem: 'incomplete' };
  }
  const days = countLeaveDays(form.startDate, form.endDate, context.holidayDates, form.halfDay);
  const clash = findOverlap(context.requests, form.userId, form.startDate, form.endDate);

  let remainingAfter: number | null = null;
  if (form.leaveType === 'annual' || form.leaveType === 'sick') {
    const entitled = form.leaveType === 'annual' ? context.allowance.annualDays : context.allowance.sickDays;
    const year = Number(form.startDate.slice(0, 4));
    remainingAfter = leaveBalance(context.requests, form.userId, form.leaveType, year, entitled).remaining - days;
  }

  const problem: LeaveFormProblem | null = clash ? 'clash' : days === 0 ? 'no-working-days' : null;
  return { days, clash, remainingAfter, problem };
}

/** What gets saved for a form that passed `checkLeaveForm`. */
export function toCreateLeaveInput(form: LeaveFormValues, days: number): CreateLeaveInput {
  return {
    userId: form.userId,
    leaveType: form.leaveType,
    startDate: form.startDate,
    endDate: form.endDate,
    days,
    halfDay: form.halfDay,
    reason: form.reason.trim() || null,
    status: form.approveNow ? 'approved' : 'pending',
  };
}
