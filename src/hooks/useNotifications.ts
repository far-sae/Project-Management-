import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { AppNotification } from "@/types/notification";
import {
  subscribeToUserNotifications,
  markNotificationRead as markRead,
} from "@/services/supabase/database";
import { supabase } from "@/services/supabase/config";

export const useNotifications = (userId: string | null, limit = 30) => {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchErrorToastShown = useRef(false);
  const [effectiveUserId, setEffectiveUserId] = useState<string | null>(userId);

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

  // Subscribe to notifications so the bell updates in real time when new ones are created
  useEffect(() => {
    const uid = effectiveUserId;
    if (!uid) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    fetchErrorToastShown.current = false;
    setLoading(true);
    const unsub = subscribeToUserNotifications(
      uid,
      (data) => {
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

    return () => {
      unsub();
    };
  }, [effectiveUserId, limit]);

  const fetchNotifications = useCallback(async () => {
    const uid = effectiveUserId;
    if (!uid) return;
    setLoading(true);
    try {
      const { fetchUserNotifications } = await import("@/services/supabase/database");
      const data = await fetchUserNotifications(uid, limit);
      setNotifications(data);
    } catch (error) {
      console.error("Error fetching notifications:", error);
    } finally {
      setLoading(false);
    }
  }, [effectiveUserId, limit]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void fetchNotifications();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [fetchNotifications]);

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
