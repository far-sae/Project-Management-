import React, { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Loader2 } from "lucide-react";
import { useNotifications } from "@/hooks/useNotifications";
import { useAuth } from "@/context/AuthContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
  taskUpdated?: boolean;
  taskCompleted?: boolean;
  taskReminder?: boolean;
  commentMention?: boolean;
  commentAdded?: boolean;
  projectInvite?: boolean;
  projectUpdates?: boolean;
  projectChatMessage?: boolean;
};

function getNotificationPrefs(): Prefs {
  try {
    const stored = localStorage.getItem(NOTIFICATIONS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Prefs;
      return {
        taskAssigned: parsed.taskAssigned !== false,
        taskUpdated: parsed.taskUpdated !== false,
        taskCompleted: parsed.taskCompleted !== false,
        taskReminder: parsed.taskReminder !== false,
        commentMention: parsed.commentMention !== false,
        commentAdded: parsed.commentAdded !== false,
        projectInvite: parsed.projectInvite !== false,
        projectUpdates: parsed.projectUpdates !== false,
        projectChatMessage: parsed.projectChatMessage !== false,
      };
    }
  } catch {
    // ignore
  }
  return {
    taskAssigned: true,
    taskUpdated: true,
    taskCompleted: true,
    taskReminder: true,
    commentMention: true,
    commentAdded: true,
    projectInvite: true,
    projectUpdates: true,
    projectChatMessage: true,
  };
}

function shouldShowNotification(n: AppNotification, prefs: Prefs): boolean {
  if (n.type === "task_assigned") return prefs.taskAssigned !== false;
  if (n.type === "task_updated") return prefs.taskUpdated !== false;
  if (n.type === "task_completed") return prefs.taskCompleted !== false;
  if (n.type === "task_reminder") return prefs.taskReminder !== false;
  if (n.type === "comment_mention") return prefs.commentMention !== false;
  if (n.type === "comment_added") return prefs.commentAdded !== false;
  if (n.type === "project_invite") return prefs.projectInvite !== false;
  if (n.type === "project_chat_message")
    return prefs.projectChatMessage !== false;
  return prefs.projectUpdates !== false;
}

export const NotificationBell: React.FC = () => {
  const { user } = useAuth();
  const { notifications, loading, markAsRead } = useNotifications(
    user?.userId ?? null,
    100,
  );
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [prefsVersion, setPrefsVersion] = useState(0);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === NOTIFICATIONS_KEY) setPrefsVersion((v) => v + 1);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const prefs = useMemo(
    () => getNotificationPrefs(),
    [open, prefsVersion],
  );
  const filtered = useMemo(
    () => notifications.filter((n) => shouldShowNotification(n, prefs)),
    [notifications, prefs],
  );
  const unreadFiltered = useMemo(
    () => filtered.filter((n) => !n.read).length,
    [filtered],
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
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 shrink-0 inline-flex items-center justify-center"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5 text-muted-foreground" />
          {unreadFiltered > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 px-0.5 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground">
              {unreadFiltered > 99 ? "99+" : unreadFiltered}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-80 max-h-[360px] overflow-y-auto"
      >
        <DropdownMenuLabel className="text-muted-foreground font-normal text-xs">
          Notifications
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {loading ? (
          <div className="p-4 text-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            No notifications yet
          </div>
        ) : (
          filtered.slice(0, 20).map((n) => (
            <DropdownMenuItem
              key={n.notificationId}
              onClick={() => handleClick(n)}
              className={cn(
                "flex flex-col items-start gap-0.5 p-3 cursor-pointer",
                !n.read && "bg-accent/50",
              )}
            >
              <span className="font-medium text-sm text-foreground">
                {n.title}
              </span>
              <span className="text-xs text-muted-foreground line-clamp-2">
                {n.body}
              </span>
              <span className="text-[11px] text-muted-foreground/80 mt-1">
                {formatDistanceToNow(new Date(n.createdAt), {
                  addSuffix: true,
                })}
              </span>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-primary justify-center font-medium"
          onClick={() => {
            setOpen(false);
            navigate("/inbox");
          }}
        >
          View all in Inbox
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default NotificationBell;
