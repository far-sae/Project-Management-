import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { AppNotification } from "@/types/notification";
import {
  subscribeToUserNotifications,
  markNotificationRead as markRead,
} from "@/services/supabase/database";

export const useNotifications = (userId: string | null, limit = 30) => {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchErrorToastShown = useRef(false);

  // Subscribe to notifications so the bell updates in real time when new ones are created
  useEffect(() => {
    if (!userId) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    fetchErrorToastShown.current = false;
    setLoading(true);
    const unsub = subscribeToUserNotifications(
      userId,
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
  }, [userId, limit]);

  const fetchNotifications = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const { fetchUserNotifications } = await import("@/services/supabase/database");
      const data = await fetchUserNotifications(userId, limit);
      setNotifications(data);
    } catch (error) {
      console.error("Error fetching notifications:", error);
    } finally {
      setLoading(false);
    }
  }, [userId, limit]);

  const markAsRead = async (notificationId: string) => {
    if (!userId) return;
    try {
      await markRead(userId, notificationId);
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
