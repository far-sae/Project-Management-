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
  DropdownMenuSeparator,
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
          className="relative h-9 w-9 shrink-0 inline-flex items-center justify-center"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5 text-muted-foreground" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 px-0.5 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground">
              {unreadCount > 99 ? "99+" : unreadCount}
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
        ) : notifications.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            No notifications yet
          </div>
        ) : (
          notifications.slice(0, 20).map((n) => (
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
