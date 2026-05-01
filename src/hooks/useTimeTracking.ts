import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOrganization } from "@/context/OrganizationContext";
import {
  ClockInInput,
  TimeEntry,
  UpdateTimeEntryInput,
  clockIn as clockInSvc,
  clockOut as clockOutSvc,
  deleteTimeEntry as deleteEntrySvc,
  getOpenEntryForUser,
  subscribeToTimeEntries,
  updateTimeEntry as updateEntrySvc,
} from "@/services/supabase/timeEntries";

const effectiveOrgId = (
  orgIdFromCtx: string | null,
  userId: string | undefined,
): string | null => {
  if (orgIdFromCtx) return orgIdFromCtx;
  if (userId) return `local-${userId}`;
  return null;
};

export const useTimeTracking = () => {
  const { user } = useAuth();
  const { organization, isOwner, isAdmin } = useOrganization();

  const orgId = effectiveOrgId(
    organization?.organizationId ?? user?.organizationId ?? null,
    user?.userId,
  );

  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [openEntry, setOpenEntry] = useState<TimeEntry | null>(null);
  const [loading, setLoading] = useState(true);

  // Subscribe to entries (everyone gets their own; owner+admin sees all by RLS)
  useEffect(() => {
    if (!orgId) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = subscribeToTimeEntries(orgId, (next) => {
      setEntries(next);
      setLoading(false);
      // Recompute the user's open entry from the fresh list
      if (user?.userId) {
        const open =
          next.find(
            (e) => e.userId === user.userId && !e.clockedOutAt,
          ) ?? null;
        setOpenEntry(open);
      }
    });
    return unsub;
  }, [orgId, user?.userId]);

  // Backstop: when the realtime stream is filtered (members only see their own
  // rows), make sure we still have the open entry.
  useEffect(() => {
    if (!orgId || !user?.userId) return;
    if (openEntry) return;
    let cancelled = false;
    getOpenEntryForUser(orgId, user.userId).then((entry) => {
      if (!cancelled && entry) setOpenEntry(entry);
    });
    return () => {
      cancelled = true;
    };
  }, [orgId, user?.userId, openEntry]);

  const clockIn = useCallback(
    async (input: ClockInInput = {}) => {
      if (!orgId || !user) return null;
      const entry = await clockInSvc(
        orgId,
        user.userId,
        user.displayName,
        input,
      );
      setOpenEntry(entry);
      return entry;
    },
    [orgId, user],
  );

  const clockOut = useCallback(
    async (notes?: string | null) => {
      if (!orgId || !openEntry) return null;
      const updated = await clockOutSvc(orgId, openEntry.entryId, notes);
      setOpenEntry(null);
      return updated;
    },
    [orgId, openEntry],
  );

  const updateEntry = useCallback(
    async (entryId: string, input: UpdateTimeEntryInput) => {
      if (!orgId) return null;
      // Server RLS enforces owner-only; we surface a friendly error if not.
      if (!isOwner) {
        throw new Error("Only the organization owner can edit time entries.");
      }
      return updateEntrySvc(orgId, entryId, input, user?.userId);
    },
    [orgId, isOwner, user?.userId],
  );

  const deleteEntry = useCallback(
    async (entryId: string) => {
      if (!orgId) return;
      if (!isOwner) {
        throw new Error("Only the organization owner can delete time entries.");
      }
      await deleteEntrySvc(orgId, entryId);
    },
    [orgId, isOwner],
  );

  const ownEntries = useMemo(
    () => entries.filter((e) => e.userId === user?.userId),
    [entries, user?.userId],
  );

  return {
    organizationId: orgId,
    loading,
    entries,
    ownEntries,
    openEntry,
    clockIn,
    clockOut,
    updateEntry,
    deleteEntry,
    isOwner,
    isAdmin,
    canViewAll: isAdmin || isOwner,
  };
};
