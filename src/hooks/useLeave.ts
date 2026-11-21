import { publicMessage } from '@/lib/publicError';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import {
  addPublicHoliday,
  createLeaveRequest,
  decideLeaveRequest,
  deleteLeaveRequest,
  deletePublicHoliday,
  isHrSetupMissing,
  listLeaveAllowances,
  listLeaveRequests,
  listPublicHolidays,
  upsertLeaveAllowance,
  DEFAULT_ANNUAL_DAYS,
  DEFAULT_SICK_DAYS,
  type CreateLeaveInput,
  type LeaveAllowance,
  type LeaveRequest,
  type PublicHoliday,
} from '@/services/supabase/leave';
import type { LeaveStatus } from '@/lib/leave';

/**
 * Leave requests, yearly allowances and public holidays for the current
 * organization. `setupMissing` is true until migration 179 has been run;
 * nothing is loaded and every write is refused in that state.
 */
export function useLeave() {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const userId = user?.userId ?? null;

  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [allowances, setAllowances] = useState<LeaveAllowance[]>([]);
  const [holidays, setHolidays] = useState<PublicHoliday[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupMissing, setSetupMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!orgId || orgId.startsWith('local-')) {
      setRequests([]);
      setAllowances([]);
      setHolidays([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [r, a, h] = await Promise.all([
        listLeaveRequests(orgId),
        listLeaveAllowances(orgId),
        listPublicHolidays(orgId),
      ]);
      setRequests(r);
      setAllowances(a);
      setHolidays(h);
      setSetupMissing(false);
      setError(null);
    } catch (e) {
      if (isHrSetupMissing(e)) {
        setSetupMissing(true);
        setError(null);
      } else {
        setError(publicMessage(e, 'Could not load leave.'));
      }
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const allowanceFor = useCallback(
    (forUserId: string): LeaveAllowance =>
      allowances.find((a) => a.userId === forUserId) ?? {
        userId: forUserId,
        annualDays: DEFAULT_ANNUAL_DAYS,
        sickDays: DEFAULT_SICK_DAYS,
      },
    [allowances],
  );

  const holidayDates = useMemo(() => holidays.map((h) => h.date), [holidays]);

  const create = useCallback(
    async (input: CreateLeaveInput) => {
      if (!orgId || !userId) throw new Error('No organization');
      const created = await createLeaveRequest(orgId, userId, input);
      setRequests((prev) => [created, ...prev]);
      return created;
    },
    [orgId, userId],
  );

  const decide = useCallback(
    async (id: string, status: Exclude<LeaveStatus, 'pending'>, note?: string | null) => {
      if (!userId) throw new Error('Not signed in');
      const updated = await decideLeaveRequest(id, status, userId, note);
      setRequests((prev) => prev.map((r) => (r.id === id ? updated : r)));
      return updated;
    },
    [userId],
  );

  const remove = useCallback(async (id: string) => {
    await deleteLeaveRequest(id);
    setRequests((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const saveAllowance = useCallback(
    async (allowance: LeaveAllowance) => {
      if (!orgId) throw new Error('No organization');
      await upsertLeaveAllowance(orgId, allowance);
      setAllowances((prev) => [...prev.filter((a) => a.userId !== allowance.userId), allowance]);
    },
    [orgId],
  );

  const addHoliday = useCallback(
    async (date: string, name: string) => {
      if (!orgId) throw new Error('No organization');
      const created = await addPublicHoliday(orgId, date, name);
      setHolidays((prev) => [...prev, created].sort((a, b) => a.date.localeCompare(b.date)));
      return created;
    },
    [orgId],
  );

  const removeHoliday = useCallback(async (id: string) => {
    await deletePublicHoliday(id);
    setHolidays((prev) => prev.filter((h) => h.id !== id));
  }, []);

  return {
    requests,
    allowances,
    holidays,
    holidayDates,
    allowanceFor,
    loading,
    setupMissing,
    error,
    refresh,
    create,
    decide,
    remove,
    saveAllowance,
    addHoliday,
    removeHoliday,
  };
}

export type UseLeave = ReturnType<typeof useLeave>;
