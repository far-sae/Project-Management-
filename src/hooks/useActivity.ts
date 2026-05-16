// src/hooks/useActivity.ts
import { useCallback, useEffect, useState } from "react";
import { useOrganization } from "@/context/OrganizationContext";
import {
  ActivityEvent, ActivityEventType,
  queryActivity,
} from "@/services/supabase/activityFeed";
import { supabase } from "@/services/supabase/config";
import type { ActivityEvent as LegacyActivityEvent } from "@/types/activity";
import {
  subscribeToActivity,
  subscribeToTaskActivity,
} from "@/services/supabase/database";

export interface UseActivityParams {
  clientId?: string;
  eventTypes?: ActivityEventType[];
  actorId?: string;
  fromDate?: Date;
  toDate?: Date;
}

export interface UseActivityResult {
  events: ActivityEvent[];
  loading: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
}

export interface UseLegacyActivityResult {
  events: LegacyActivityEvent[];
  loading: boolean;
}

// Overloads: new params-object signature returns the cursor-paginated CRM
// activity feed; the legacy (orgId, limit?) signature keeps existing dashboard
// and project-rail callers working until they migrate.
export function useActivity(params: UseActivityParams): UseActivityResult;
export function useActivity(organizationId: string | null, limit?: number): UseLegacyActivityResult;
export function useActivity(
  arg1: UseActivityParams | string | null,
  arg2?: number,
): UseActivityResult | UseLegacyActivityResult {
  if (typeof arg1 === "string" || arg1 === null) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useActivityLegacy(arg1, arg2);
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useActivityFeed(arg1);
}

const useActivityFeed = (params: UseActivityParams): UseActivityResult => {
  const { organization } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);

  const loadFirstPage = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const next = await queryActivity({
      organizationId: orgId,
      clientId: params.clientId,
      eventTypes: params.eventTypes,
      actorId: params.actorId,
      fromDate: params.fromDate,
      toDate: params.toDate,
      limit: 50,
    });
    setEvents(next);
    setHasMore(next.length === 50);
    setLoading(false);
  }, [orgId, params.clientId, params.eventTypes?.join(","), params.actorId, params.fromDate?.toISOString(), params.toDate?.toISOString()]);

  useEffect(() => { loadFirstPage(); }, [loadFirstPage]);

  // Realtime: any insert into the base tables triggers a refetch of the first
  // page. Cheap and avoids merging in delta logic for v1.
  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`activity-${orgId}-${Math.random().toString(36).slice(2, 9)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "client_notes",
        filter: `organization_id=eq.${orgId}` }, loadFirstPage)
      .on("postgres_changes", { event: "*", schema: "public", table: "deals",
        filter: `organization_id=eq.${orgId}` }, loadFirstPage)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "client_tasks",
        filter: `organization_id=eq.${orgId}` }, loadFirstPage)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "form_submissions",
        filter: `organization_id=eq.${orgId}` }, loadFirstPage)
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [orgId, loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (!orgId || !events.length || !hasMore) return;
    const cursor = events[events.length - 1].occurredAt;
    const next = await queryActivity({
      organizationId: orgId,
      clientId: params.clientId,
      eventTypes: params.eventTypes,
      actorId: params.actorId,
      fromDate: params.fromDate,
      toDate: params.toDate,
      beforeCursor: cursor,
      limit: 50,
    });
    setEvents((prev) => [...prev, ...next]);
    setHasMore(next.length === 50);
  }, [orgId, events, hasMore, params.clientId, params.eventTypes?.join(","), params.actorId, params.fromDate?.toISOString(), params.toDate?.toISOString()]);

  return { events, loading, hasMore, loadMore };
};

// ---------------------------------------------------------------------------
// Legacy hooks retained for existing callers (Kanban dashboard, project rail,
// task modal). Slated for migration to the new CRM activity feed.
// ---------------------------------------------------------------------------

const useActivityLegacy = (
  organizationId: string | null,
  limit = 50,
): UseLegacyActivityResult => {
  const [events, setEvents] = useState<LegacyActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!organizationId) {
      setEvents([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = subscribeToActivity(
      organizationId,
      (list) => {
        setEvents(list);
        setLoading(false);
      },
      limit,
    );
    return () => unsub();
  }, [organizationId, limit]);

  return { events, loading };
};

export const useTaskActivity = (
  taskId: string | null,
  organizationId: string | null,
  /** Increment after a local action (e.g. new comment) to refetch without waiting on realtime. */
  refetchNonce: number = 0,
) => {
  const [events, setEvents] = useState<LegacyActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!taskId || !organizationId) {
      setEvents([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = subscribeToTaskActivity(taskId, organizationId, (list) => {
      setEvents(list);
      setLoading(false);
    });
    return () => unsub();
  }, [taskId, organizationId, refetchNonce]);

  return { events, loading };
};

export default useActivity;
