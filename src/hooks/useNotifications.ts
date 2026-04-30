import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { AppNotification } from "@/types/notification";
import {
  subscribeToUserNotifications,
  markNotificationRead as markRead,
} from "@/services/supabase/database";
import { supabase } from "@/services/supabase/config";
import { onNotificationsRefresh } from "@/lib/notificationEvents";
import { playNotificationChime } from "@/lib/notificationSound";

/** localStorage key for the per-user "locally read" set. Defensive layer so the bell never
 *  re-surfaces a notification the user already opened, even if the Supabase UPDATE failed
 *  (e.g. transient network hiccup or RLS role mismatch) and the row is still `read=false`. */
const localReadKey = (uid: string) => `notifications_locally_read:${uid}`;

const readLocalReadIds = (uid: string): Set<string> => {
  try {
    const raw = window.localStorage.getItem(localReadKey(uid));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return new Set(parsed.filter((v) => typeof v === "string"));
    return new Set();
  } catch {
    return new Set();
  }
};

const writeLocalReadIds = (uid: string, ids: Set<string>) => {
  try {
    // Cap to the most recent 500 IDs so this never grows unboundedly.
    const arr = Array.from(ids).slice(-500);
    window.localStorage.setItem(localReadKey(uid), JSON.stringify(arr));
  } catch {
    /* storage full or disabled; nothing actionable */
  }
};

const applyLocalRead = (
  list: AppNotification[],
  localRead: Set<string>,
): AppNotification[] => {
  if (localRead.size === 0) return list;
  let mutated = false;
  const next = list.map((n) => {
    if (!n.read && localRead.has(n.notificationId)) {
      mutated = true;
      return { ...n, read: true };
    }
    return n;
  });
  return mutated ? next : list;
};

export const useNotifications = (userId: string | null, limit = 30) => {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchErrorToastShown = useRef(false);
  const [effectiveUserId, setEffectiveUserId] = useState<string | null>(userId);

  /** Tracks notifications the bell has already shown so we only chime on truly new arrivals. */
  const seenNotificationIdsRef = useRef<Set<string>>(new Set());
  /** Skip the chime on the very first sync (so opening the app doesn't blast a sound for old rows). */
  const initializedRef = useRef(false);
  /** Mirror of the locally-read IDs for the current user. Hydrated from localStorage on user change. */
  const localReadIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setEffectiveUserId((prev) => (prev === userId ? prev : userId));
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    const resolve = (id: string | null) =>
      setEffectiveUserId((prev) => (prev === id ? prev : id));

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      resolve(session?.user?.id ?? userId);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (cancelled) return;
      resolve(session?.user?.id ?? userId);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [userId]);

  // Subscribe only after Supabase session matches the user id — avoids REST calls as anon before JWT binds.
  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | undefined;

    const start = async () => {
      const uid = effectiveUserId;
      if (!uid) {
        setNotifications([]);
        setLoading(false);
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!session?.user?.id || session.user.id !== uid) {
        setNotifications([]);
        setLoading(false);
        return;
      }

      fetchErrorToastShown.current = false;
      seenNotificationIdsRef.current = new Set();
      initializedRef.current = false;
      localReadIdsRef.current = readLocalReadIds(uid);
      setLoading(true);
      unsub = subscribeToUserNotifications(
        uid,
        (data) => {
          // Apply the locally-known read set so notifications the user already opened in a
          // previous session don't re-surface as unread when the DB row is still read=false.
          const merged = applyLocalRead(data, localReadIdsRef.current);
          // Detect freshly arrived notifications so we can chime on each new one.
          const seen = seenNotificationIdsRef.current;
          if (!initializedRef.current) {
            // First sync: prime the seen set without chiming for already-existing rows.
            for (const n of merged) seen.add(n.notificationId);
            initializedRef.current = true;
          } else {
            let hasNew = false;
            for (const n of merged) {
              if (!seen.has(n.notificationId)) {
                hasNew = true;
                seen.add(n.notificationId);
              }
            }
            // Only chime when there's at least one truly new row AND it's unread (otherwise
            // we'd ding on bookkeeping refetches like marking-as-read elsewhere).
            if (hasNew && merged.some((n) => !n.read)) {
              playNotificationChime();
            }
          }
          setNotifications(merged);
          setLoading(false);
        },
        limit,
        (message) => {
          if (!fetchErrorToastShown.current) {
            fetchErrorToastShown.current = true;
            toast.error(
              `Could not load notifications. Check your connection or database policies. (${message})`,
            );
          }
        },
      );
    };

    void start();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [effectiveUserId, limit]);

  const fetchNotifications = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    const uid = effectiveUserId;
    if (!uid) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user?.id || session.user.id !== uid) return;
    if (!silent) setLoading(true);
    try {
      const { fetchUserNotifications } = await import("@/services/supabase/database");
      const data = await fetchUserNotifications(uid, limit);
      const merged = applyLocalRead(data, localReadIdsRef.current);
      // Mirror the chime logic from the realtime subscriber so the safety-net poller and
      // any explicit refresh also play on truly new arrivals.
      const seen = seenNotificationIdsRef.current;
      if (!initializedRef.current) {
        for (const n of merged) seen.add(n.notificationId);
        initializedRef.current = true;
      } else {
        let hasNew = false;
        for (const n of merged) {
          if (!seen.has(n.notificationId)) {
            hasNew = true;
            seen.add(n.notificationId);
          }
        }
        if (hasNew && merged.some((n) => !n.read)) {
          playNotificationChime();
        }
      }
      setNotifications(merged);
    } catch (error) {
      console.error("Error fetching notifications:", error);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [effectiveUserId, limit]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void fetchNotifications({ silent: true });
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [fetchNotifications]);

  // Refetch when any code path inserts a row (Real-time may be off for `notifications` in some projects).
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const off = onNotificationsRefresh(() => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        void fetchNotifications();
      }, 150);
    });
    return () => {
      off();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchNotifications]);

  /**
   * Safety-net poller. Postgres realtime delivers a new-notification event the instant a row
   * is inserted — but only when the `notifications` table is part of the `supabase_realtime`
   * publication. Many deployments forget that step (or have it disabled), and the bell then
   * looks "broken" because cross-user notifications only arrive when the tab regains focus.
   * Polling every 25s (only while the tab is visible) guarantees the bell stays close to
   * real-time without hammering the DB.
   */
  useEffect(() => {
    if (!effectiveUserId) return;
    const POLL_MS = 25_000;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void fetchNotifications({ silent: true });
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [effectiveUserId, fetchNotifications]);

  const markAsRead = async (notificationId: string) => {
    const uid = effectiveUserId;
    if (!uid) return;
    // Optimistic local update + persistent localStorage fallback. The DB write happens in the
    // background; if it fails (transient network, RLS policy mismatch), the locally-read set
    // still survives a reload so the user doesn't see the same notification re-surface as unread.
    localReadIdsRef.current.add(notificationId);
    writeLocalReadIds(uid, localReadIdsRef.current);
    setNotifications((prev) =>
      prev.map((n) =>
        n.notificationId === notificationId ? { ...n, read: true } : n,
      ),
    );
    try {
      await markRead(uid, notificationId);
    } catch (error) {
      console.error("Error marking notification as read:", error);
    }
  };

  const markAllAsReadLocally = useCallback(() => {
    const uid = effectiveUserId;
    if (!uid) return;
    for (const n of notifications) {
      if (!n.read) localReadIdsRef.current.add(n.notificationId);
    }
    writeLocalReadIds(uid, localReadIdsRef.current);
    setNotifications((prev) => prev.map((n) => (n.read ? n : { ...n, read: true })));
  }, [effectiveUserId, notifications]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return {
    notifications,
    loading,
    unreadCount,
    markAsRead,
    markAllAsReadLocally,
    refresh: fetchNotifications,
  };
};

export default useNotifications;
