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

export const useNotifications = (userId: string | null, limit = 30) => {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchErrorToastShown = useRef(false);
  const [effectiveUserId, setEffectiveUserId] = useState<string | null>(userId);

  /** Tracks notifications the bell has already shown so we only chime on truly new arrivals. */
  const seenNotificationIdsRef = useRef<Set<string>>(new Set());
  /** Skip the chime on the very first sync (so opening the app doesn't blast a sound for old rows). */
  const initializedRef = useRef(false);

  useEffect(() => {
    setEffectiveUserId(userId);
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      const authId = session?.user?.id ?? null;
      setEffectiveUserId(authId ?? userId);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      const authId = session?.user?.id ?? null;
      setEffectiveUserId(authId ?? userId);
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
      setLoading(true);
      unsub = subscribeToUserNotifications(
        uid,
        (data) => {
          // Detect freshly arrived notifications so we can chime on each new one.
          const seen = seenNotificationIdsRef.current;
          if (!initializedRef.current) {
            // First sync: prime the seen set without chiming for already-existing rows.
            for (const n of data) seen.add(n.notificationId);
            initializedRef.current = true;
          } else {
            let hasNew = false;
            for (const n of data) {
              if (!seen.has(n.notificationId)) {
                hasNew = true;
                seen.add(n.notificationId);
              }
            }
            // Only chime when there's at least one truly new row AND it's unread (otherwise
            // we'd ding on bookkeeping refetches like marking-as-read elsewhere).
            if (hasNew && data.some((n) => !n.read)) {
              playNotificationChime();
            }
          }
          setNotifications(data);
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
      // Mirror the chime logic from the realtime subscriber so the safety-net poller and
      // any explicit refresh also play on truly new arrivals.
      const seen = seenNotificationIdsRef.current;
      if (!initializedRef.current) {
        for (const n of data) seen.add(n.notificationId);
        initializedRef.current = true;
      } else {
        let hasNew = false;
        for (const n of data) {
          if (!seen.has(n.notificationId)) {
            hasNew = true;
            seen.add(n.notificationId);
          }
        }
        if (hasNew && data.some((n) => !n.read)) {
          playNotificationChime();
        }
      }
      setNotifications(data);
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
    try {
      await markRead(uid, notificationId);
      // Update local state
      setNotifications((prev) =>
        prev.map((n) =>
          n.notificationId === notificationId ? { ...n, read: true } : n,
        ),
      );
    } catch (error) {
      console.error("Error marking notification as read:", error);
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return {
    notifications,
    loading,
    unreadCount,
    markAsRead,
    refresh: fetchNotifications,
  };
};

export default useNotifications;
