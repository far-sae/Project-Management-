import { useEffect, useState } from "react";
import { fetchLastSeenForUsers } from "@/services/supabase/lastSeen";

/** How often to refresh teammates' last seen while a panel is open. */
export const LAST_SEEN_REFRESH_MS = 45_000;

/**
 * Resolve `last_seen_at` for a set of user ids. Returns a
 * `Map<userId, Date | null>`; people we can't see are absent (render
 * "Offline").
 *
 * Refreshes on an interval and when the tab regains focus. (A realtime
 * subscription on user_profiles can't work: profiles are private, so
 * other people's updates are never delivered.)
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
    const load = () => {
      void fetchLastSeenForUsers(ids).then((m) => {
        if (!cancelled) setMap(m);
      });
    };
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, LAST_SEEN_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [key]);

  return map;
};
