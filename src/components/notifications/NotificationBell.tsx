import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Loader2 } from "lucide-react";
import { useNotifications } from "@/hooks/useNotifications";
import { useAuth } from "@/context/AuthContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { AppNotification } from "@/types/notification";

const NOTIFICATIONS_KEY = "user_notification_prefs";

type Prefs = {
  email?: boolean;
  push?: boolean;
  taskAssigned?: boolean;
  taskCompleted?: boolean;
  projectUpdates?: boolean;
};

function getNotificationPrefs(): Prefs {
  try {
    const stored = localStorage.getItem(NOTIFICATIONS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Prefs;
      return {
        taskAssigned: parsed.taskAssigned !== false,
        taskCompleted: parsed.taskCompleted !== false,
        projectUpdates: parsed.projectUpdates !== false,
      };
    }
  } catch {
    // ignore
  }
  return { taskAssigned: true, taskCompleted: true, projectUpdates: true };
}

function shouldShowNotification(n: AppNotification, prefs: Prefs): boolean {
  if (n.type === "task_assigned") return prefs.taskAssigned !== false;
  if (n.type === "task_completed") return prefs.taskCompleted !== false;
  return prefs.projectUpdates !== false;
}

export const NotificationBell: React.FC = () => {
  const { user } = useAuth();
  const { notifications, loading, unreadCount, markAsRead } = useNotifications(
    user?.userId ?? null,
  );
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const prefs = useMemo(() => getNotificationPrefs(), [open]);
  const filtered = useMemo(
    () => notifications.filter((n) => shouldShowNotification(n, prefs)),
    [notifications, prefs],
  );

  const handleClick = (n: AppNotification) => {
    if (!n.read) markAsRead(n.notificationId);
    if (n.projectId) navigate(`/project/${n.projectId}`);
    setOpen(false);
  };

  if (!user) return null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="w-5 h-5 text-gray-600" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-medium text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-80 max-h-[360px] overflow-y-auto"
      >
        {loading ? (
          <div className="p-4 text-center">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400 mx-auto" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-500">
            No notifications yet
          </div>
        ) : (
          filtered.map((n) => (
            <DropdownMenuItem
              key={n.notificationId}
              onClick={() => handleClick(n)}
              className={cn(
                "flex flex-col items-start gap-0.5 p-3 cursor-pointer",
                !n.read && "bg-blue-50",
              )}
            >
              <span className="font-medium text-sm text-gray-900">
                {n.title}
              </span>
              <span className="text-xs text-gray-600 line-clamp-2">
                {n.body}
              </span>
              <span className="text-xs text-gray-400 mt-1">
                {formatDistanceToNow(new Date(n.createdAt), {
                  addSuffix: true,
                })}
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default NotificationBell;
