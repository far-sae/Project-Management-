import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Loader2 } from "lucide-react";
import { useNotifications } from "@/hooks/useNotifications";
import { useAuth } from "@/context/AuthContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import type { AppNotification } from "@/types/notification";

export const NotificationBell: React.FC = () => {
  const { user } = useAuth();
  const { notifications, loading, unreadCount, markAsRead, refresh } = useNotifications(
    user?.userId ?? null,
    100,
  );
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const handleClick = (n: AppNotification) => {
    if (!n.read) markAsRead(n.notificationId);
    if (n.taskId && n.projectId) {
      navigate(`/project/${n.projectId}?taskId=${encodeURIComponent(n.taskId)}`);
    } else if (n.projectId) {
      navigate(`/project/${n.projectId}`);
    } else {
      navigate("/inbox");
    }
    setOpen(false);
  };

  if (!user) return null;

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void refresh();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative shrink-0 text-muted-foreground"
          aria-label="Notifications"
        >
          <Bell aria-hidden />
          {unreadCount > 0 && (
            <span className="absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive px-[5px] text-xs font-medium leading-none tabular-nums text-destructive-foreground md:-right-1 md:-top-1">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-[360px] w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl p-0"
      >
        <DropdownMenuLabel className="sticky top-0 z-[1] flex h-10 items-center border-b border-border bg-surface-2 px-3 py-0 text-xs font-medium text-muted-foreground">
          Notifications
        </DropdownMenuLabel>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
            <Bell className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium text-foreground">No notifications yet</p>
          </div>
        ) : (
          notifications.slice(0, 20).map((n) => (
            <DropdownMenuItem
              key={n.notificationId}
              onClick={() => handleClick(n)}
              className="flex min-h-12 cursor-pointer items-start gap-2 rounded-none border-b border-border/60 px-3 py-2.5 text-sm focus:bg-surface-2 focus:text-foreground"
            >
              {/* Unread marker; the empty slot keeps read rows aligned. */}
              <span
                aria-hidden
                className={cn(
                  "mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full",
                  n.read ? "bg-transparent" : "bg-primary",
                )}
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  className={cn(
                    "text-foreground",
                    n.read ? "font-normal" : "font-medium",
                  )}
                >
                  {n.title}
                </span>
                <span className="line-clamp-2 text-xs text-muted-foreground">
                  {n.body}
                </span>
                <span className="mt-0.5 text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(n.createdAt), {
                    addSuffix: true,
                  })}
                </span>
              </span>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuItem
          className="h-10 cursor-pointer justify-center rounded-none text-sm font-medium text-foreground focus:bg-surface-2 focus:text-foreground"
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
