import { useState, useEffect, useCallback, useRef } from "react";
import { AppNotification } from "@/types/notification";
import {
  fetchUserNotifications,
  markNotificationRead as markRead,
} from "@/services/supabase/database";

export const useNotifications = (userId: string | null, limit = 30) => {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchedRef = useRef(false);

  const fetchNotifications = useCallback(async () => {
    if (!userId) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const data = await fetchUserNotifications(userId, limit);
      setNotifications(data);
    } catch (error) {
      console.error("Error fetching notifications:", error);
    } finally {
      setLoading(false);
    }
  }, [userId, limit]);

  // Fetch once on mount or when userId changes
  useEffect(() => {
    if (!userId) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    if (!fetchedRef.current) {
      fetchedRef.current = true;
      fetchNotifications();
    }

    // Reset ref when userId changes
    return () => {
      fetchedRef.current = false;
    };
  }, [userId, fetchNotifications]);

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
