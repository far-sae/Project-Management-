import { supabase } from './config';
import type { LeaveStatus, LeaveType } from '@/lib/leave';

/** Migration that creates the HR leave and document tables. */
export const HR_SETUP_MIGRATION = '179_hr_leave_and_documents.sql';

export interface LeaveRequest {
  id: string;
  organizationId: string;
  userId: string;
  leaveType: LeaveType;
  /** `yyyy-MM-dd` */
  startDate: string;
  /** `yyyy-MM-dd` */
  endDate: string;
  days: number;
  halfDay: boolean;
  reason: string | null;
  status: LeaveStatus;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdBy: string;
  createdAt: Date;
}

export interface LeaveAllowance {
  userId: string;
  annualDays: number;
  sickDays: number;
}

export interface PublicHoliday {
  id: string;
  /** `yyyy-MM-dd` */
  date: string;
  name: string;
}

export const DEFAULT_ANNUAL_DAYS = 20;
export const DEFAULT_SICK_DAYS = 10;

export interface CreateLeaveInput {
  userId: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  halfDay?: boolean;
  reason?: string | null;
  /** Managers can record leave that is already agreed. */
  status?: LeaveStatus;
}

/**
 * True when the database does not have the HR tables yet (the migration has
 * not been run). Callers show a setup notice instead of an error.
 */
export function isHrSetupMissing(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  const msg = e.message ?? '';
  return (
    e.code === '42P01' ||
    e.code === 'PGRST205' ||
    /relation .* does not exist/i.test(msg) ||
    /could not find the table/i.test(msg) ||
    /bucket not found/i.test(msg)
  );
}

const mapRequest = (row: Record<string, unknown>): LeaveRequest => ({
  id: row.id as string,
  organizationId: row.organization_id as string,
  userId: row.user_id as string,
  leaveType: row.leave_type as LeaveType,
  startDate: row.start_date as string,
  endDate: row.end_date as string,
  days: Number(row.days ?? 0),
  halfDay: Boolean(row.half_day),
  reason: (row.reason as string) ?? null,
  status: row.status as LeaveStatus,
  decidedBy: (row.decided_by as string) ?? null,
  decidedAt: row.decided_at ? new Date(row.decided_at as string) : null,
  decisionNote: (row.decision_note as string) ?? null,
  createdBy: row.created_by as string,
  createdAt: new Date(row.created_at as string),
});

export async function listLeaveRequests(organizationId: string): Promise<LeaveRequest[]> {
  const { data, error } = await supabase
    .from('leave_requests')
    .select('*')
    .eq('organization_id', organizationId)
    .order('start_date', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapRequest);
}

export async function createLeaveRequest(
  organizationId: string,
  createdBy: string,
  input: CreateLeaveInput,
): Promise<LeaveRequest> {
  const status = input.status ?? 'pending';
  const decided = status === 'approved' || status === 'rejected';
  const { data, error } = await supabase
    .from('leave_requests')
    .insert({
      organization_id: organizationId,
      user_id: input.userId,
      leave_type: input.leaveType,
      start_date: input.startDate,
      end_date: input.endDate,
      days: input.days,
      half_day: Boolean(input.halfDay),
      reason: input.reason?.trim() || null,
      status,
      decided_by: decided ? createdBy : null,
      decided_at: decided ? new Date().toISOString() : null,
      created_by: createdBy,
    })
    .select('*')
    .single();
  if (error) throw error;
  return mapRequest(data);
}

export async function decideLeaveRequest(
  id: string,
  status: Exclude<LeaveStatus, 'pending'>,
  decidedBy: string,
  note?: string | null,
): Promise<LeaveRequest> {
  const { data, error } = await supabase
    .from('leave_requests')
    .update({
      status,
      decided_by: decidedBy,
      decided_at: new Date().toISOString(),
      decision_note: note?.trim() || null,
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return mapRequest(data);
}

export async function deleteLeaveRequest(id: string): Promise<void> {
  const { error } = await supabase.from('leave_requests').delete().eq('id', id);
  if (error) throw error;
}

export async function listLeaveAllowances(organizationId: string): Promise<LeaveAllowance[]> {
  const { data, error } = await supabase
    .from('leave_allowances')
    .select('user_id, annual_days, sick_days')
    .eq('organization_id', organizationId);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    userId: row.user_id as string,
    annualDays: Number(row.annual_days ?? DEFAULT_ANNUAL_DAYS),
    sickDays: Number(row.sick_days ?? DEFAULT_SICK_DAYS),
  }));
}

export async function upsertLeaveAllowance(
  organizationId: string,
  allowance: LeaveAllowance,
): Promise<void> {
  const { error } = await supabase.from('leave_allowances').upsert(
    {
      organization_id: organizationId,
      user_id: allowance.userId,
      annual_days: allowance.annualDays,
      sick_days: allowance.sickDays,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'organization_id,user_id' },
  );
  if (error) throw error;
}

export async function listPublicHolidays(organizationId: string): Promise<PublicHoliday[]> {
  const { data, error } = await supabase
    .from('public_holidays')
    .select('id, holiday_date, name')
    .eq('organization_id', organizationId)
    .order('holiday_date', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as string,
    date: row.holiday_date as string,
    name: row.name as string,
  }));
}

export async function addPublicHoliday(
  organizationId: string,
  date: string,
  name: string,
): Promise<PublicHoliday> {
  const { data, error } = await supabase
    .from('public_holidays')
    .insert({ organization_id: organizationId, holiday_date: date, name: name.trim() })
    .select('id, holiday_date, name')
    .single();
  if (error) throw error;
  return { id: data.id as string, date: data.holiday_date as string, name: data.name as string };
}

export async function deletePublicHoliday(id: string): Promise<void> {
  const { error } = await supabase.from('public_holidays').delete().eq('id', id);
  if (error) throw error;
}
