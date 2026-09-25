import { useEffect, useState } from "react";
import {
  fetchLastSeenForUsers,
  subscribeToLastSeen,
} from "@/services/supabase/lastSeen";

/**
 * Resolve `last_seen_at` for a set of user ids, kept fresh via realtime.
 * Returns a `Map<userId, Date | null>`. Users without a `user_profiles` row
 * (or with a NULL last_seen_at) are simply absent from the map — render
 * "Offline" in that case.
 */
export const useLastSeen = (
  userIds: string[],
): Map<string, Date | null> => {
  // Stable key for the effect dep — joining sorted ids avoids re-subscribing
  // every render when the parent rebuilds the array identity-only.
  const key = [...userIds].sort().join(",");
  const [map, setMap] = useState<Map<string, Date | null>>(new Map());

  useEffect(() => {
    if (!key) {
      setMap(new Map());
      return;
    }
    const ids = key.split(",").filter(Boolean);
    let cancelled = false;
    void fetchLastSeenForUsers(ids).then((m) => {
      if (!cancelled) setMap(m);
    });
    const unsub = subscribeToLastSeen(ids, (m) => {
      if (!cancelled) setMap(m);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [key]);

  return map;
};
