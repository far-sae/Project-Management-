import { useState, useEffect } from "react";
import { ActivityEvent } from "@/types/activity";
import {
  subscribeToActivity,
  subscribeToTaskActivity,
} from "@/services/supabase/database";

export const useActivity = (organizationId: string | null, limit = 50) => {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
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
) => {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
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
  }, [taskId, organizationId]);

  return { events, loading };
};

export default useActivity;
