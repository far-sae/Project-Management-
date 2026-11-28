import type { EmployeeProfile } from '@/services/supabase/employees';

/** One person in the organization, as the HR tabs see them. */
export interface HrPerson {
  userId: string;
  displayName: string;
  email: string;
  photoURL?: string;
  /** Organization role: owner | admin | member | viewer. */
  role?: string;
  /** HR profile, when one has been filled in. */
  profile: EmployeeProfile | null;
}

export const HR_TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'people', label: 'People' },
  { value: 'attendance', label: 'Attendance' },
  { value: 'leave', label: 'Leave' },
  { value: 'time-tracking', label: 'Time tracking' },
  { value: 'payroll', label: 'Payroll' },
  { value: 'expenses', label: 'Expenses' },
  { value: 'income', label: 'Income' },
  { value: 'documents', label: 'Documents' },
] as const;

export type HrTab = (typeof HR_TABS)[number]['value'];

export const isHrTab = (value: string | null): value is HrTab =>
  HR_TABS.some((t) => t.value === value);
