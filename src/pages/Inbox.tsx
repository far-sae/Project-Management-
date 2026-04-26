import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Inbox as InboxIcon,
  CheckCheck,
  Loader2,
  Bell,
  AtSign,
  UserPlus,
  Trash2,
  AlarmClock,
  Search,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

import { Sidebar } from '@/components/sidebar/Sidebar';
import { AppHeader } from '@/components/layout/AppHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui/tabs';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/context/AuthContext';
import { useNotifications } from '@/hooks/useNotifications';
import {
  markAllNotificationsRead,
  deleteNotification as deleteNotificationApi,
} from '@/services/supabase/database';
import type { AppNotification } from '@/types/notification';
import { cn } from '@/lib/utils';

const SNOOZE_KEY = 'inbox_snooze_v1';
const MUTED_PROJECTS_KEY = 'inbox_muted_projects_v1';

interface SnoozeMap {
  [notificationId: string]: number;
}

interface MutedProjectsMap {
  [userIdAndProjectId: string]: boolean;
}

const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const writeJson = (key: string, value: unknown) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
};

const SNOOZE_OPTIONS: { id: string; label: string; ms: number }[] = [
  { id: '1h', label: 'Snooze 1h', ms: 60 * 60 * 1000 },
  { id: '4h', label: 'Snooze 4h', ms: 4 * 60 * 60 * 1000 },
  { id: 'tomorrow', label: 'Until tomorrow', ms: 24 * 60 * 60 * 1000 },
  { id: 'week', label: 'Snooze 1w', ms: 7 * 24 * 60 * 60 * 1000 },
];

type FilterTab = 'all' | 'mentions' | 'assigned' | 'unread';

const isMention = (n: AppNotification) => n.type === 'comment_mention';
const isAssignment = (n: AppNotification) => n.type === 'task_assigned';

const typeIcon = (type: AppNotification['type']) => {
  switch (type) {
    case 'task_assigned':
      return <UserPlus className="w-4 h-4" />;
    case 'comment_mention':
      return <AtSign className="w-4 h-4" />;
    case 'task_reminder':
      return <AlarmClock className="w-4 h-4" />;
    case 'project_invite':
      return <UserPlus className="w-4 h-4" />;
    default:
      return <Bell className="w-4 h-4" />;
  }
};

export const Inbox: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');
  const [snoozes, setSnoozes] = useState<SnoozeMap>(() =>
    readJson<SnoozeMap>(SNOOZE_KEY, {}),
  );
  const [muted, setMuted] = useState<MutedProjectsMap>(() =>
    readJson<MutedProjectsMap>(MUTED_PROJECTS_KEY, {}),
  );
  const { notifications, loading, unreadCount, markAsRead, refresh } =
    useNotifications(user?.userId ?? null, 200);

  // Persist on change
  useEffect(() => writeJson(SNOOZE_KEY, snoozes), [snoozes]);
  useEffect(() => writeJson(MUTED_PROJECTS_KEY, muted), [muted]);

  const muteKey = useCallback(
    (projectId?: string) =>
      user && projectId ? `${user.userId}:${projectId}` : '',
    [user],
  );

  const isMuted = useCallback(
    (projectId?: string) => {
      const key = muteKey(projectId);
      return key ? !!muted[key] : false;
    },
    [muted, muteKey],
  );

  const toggleMute = useCallback(
    (projectId: string) => {
      const key = muteKey(projectId);
      if (!key) return;
      setMuted((prev) => {
        const next = { ...prev };
        if (next[key]) delete next[key];
        else next[key] = true;
        return next;
      });
    },
    [muteKey],
  );

  // Filter + search
  const visible = useMemo(() => {
    const now = Date.now();
    const q = search.trim().toLowerCase();
    return notifications.filter((n) => {
      // Snoozed?
      const snoozeUntil = snoozes[n.notificationId];
      if (snoozeUntil && snoozeUntil > now) return false;
      // Muted project?
      if (n.projectId && isMuted(n.projectId)) return false;
      // Tab
      if (tab === 'mentions' && !isMention(n)) return false;
      if (tab === 'assigned' && !isAssignment(n)) return false;
      if (tab === 'unread' && n.read) return false;
      // Search
      if (q && !`${n.title} ${n.body}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [notifications, snoozes, isMuted, tab, search]);

  const handleOpen = useCallback(
    (n: AppNotification) => {
      if (!n.read) markAsRead(n.notificationId);
      if (n.taskId && n.projectId) {
        navigate(`/project/${n.projectId}?taskId=${n.taskId}`);
      } else if (n.projectId) {
        navigate(`/project/${n.projectId}`);
      } else {
        toast.info('This notification has no linked project or task to open.');
      }
    },
    [markAsRead, navigate],
  );

  const handleSnooze = useCallback((n: AppNotification, ms: number) => {
    setSnoozes((prev) => ({ ...prev, [n.notificationId]: Date.now() + ms }));
    toast.success('Snoozed');
  }, []);

  const handleDelete = useCallback(
    async (n: AppNotification) => {
      if (!user) return;
      try {
        await deleteNotificationApi(user.userId, n.notificationId);
        toast.success('Removed');
        refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to remove');
      }
    },
    [user, refresh],
  );

  const handleMarkAllRead = useCallback(async () => {
    if (!user) return;
    try {
      await markAllNotificationsRead(user.userId);
      toast.success('All marked as read');
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to mark all');
    }
  }, [user, refresh]);

  const counts = useMemo(() => {
    const all = notifications.length;
    const m = notifications.filter(isMention).length;
    const a = notifications.filter(isAssignment).length;
    const u = notifications.filter((n) => !n.read).length;
    return { all, mentions: m, assigned: a, unread: u };
  }, [notifications]);

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <AppHeader
          left={
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbPage className="flex items-center gap-2">
                    <InboxIcon className="w-4 h-4" />
                    Inbox
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          }
          right={
            unreadCount > 0 ? (
              <Button variant="ghost" size="sm" onClick={handleMarkAllRead}>
                <CheckCheck className="w-4 h-4 mr-1.5" />
                Mark all read
              </Button>
            ) : null
          }
        />

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 lg:px-6 py-6 space-y-4">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search notifications…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>
            </div>

            <Tabs value={tab} onValueChange={(v) => setTab(v as FilterTab)}>
              <TabsList>
                <TabsTrigger value="all">
                  All
                  <span className="ml-1.5 text-[10px] text-muted-foreground">{counts.all}</span>
                </TabsTrigger>
                <TabsTrigger value="mentions">
                  Mentions
                  <span className="ml-1.5 text-[10px] text-muted-foreground">{counts.mentions}</span>
                </TabsTrigger>
                <TabsTrigger value="assigned">
                  Assigned
                  <span className="ml-1.5 text-[10px] text-muted-foreground">{counts.assigned}</span>
                </TabsTrigger>
                <TabsTrigger value="unread">
                  Unread
                  <span className="ml-1.5 text-[10px] text-muted-foreground">{counts.unread}</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value={tab} className="mt-4">
                {loading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : visible.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-center py-16 px-4 rounded-xl border-2 border-dashed border-border">
                    <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center mb-3">
                      <InboxIcon className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium text-foreground">
                      You're all caught up
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      New mentions, assignments, and reminders show up here.
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border bg-card overflow-hidden">
                    {visible.map((n) => (
                      <li
                        key={n.notificationId}
                        className={cn(
                          'group relative flex gap-3 px-4 py-3 cursor-pointer hover:bg-secondary/40 transition-colors',
                          !n.read && 'bg-primary/5',
                        )}
                        onClick={() => handleOpen(n)}
                      >
                        <div
                          className={cn(
                            'mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0',
                            !n.read
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-secondary text-secondary-foreground',
                          )}
                        >
                          {typeIcon(n.type)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium text-foreground truncate">
                              {n.title}
                            </p>
                            {!n.read && (
                              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {n.body}
                          </p>
                          <p className="text-[11px] text-muted-foreground mt-1">
                            {formatDistanceToNow(new Date(n.createdAt), {
                              addSuffix: true,
                            })}
                          </p>
                        </div>

                        <div
                          className="opacity-0 group-hover:opacity-100 transition-opacity flex items-start gap-1 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {!n.read && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => markAsRead(n.notificationId)}
                              title="Mark as read"
                            >
                              <CheckCheck className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                title="Snooze"
                              >
                                <AlarmClock className="w-3.5 h-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {SNOOZE_OPTIONS.map((opt) => (
                                <DropdownMenuItem
                                  key={opt.id}
                                  onClick={() => handleSnooze(n, opt.ms)}
                                >
                                  {opt.label}
                                </DropdownMenuItem>
                              ))}
                              {n.projectId && (
                                <DropdownMenuItem
                                  onClick={() => toggleMute(n.projectId!)}
                                >
                                  {isMuted(n.projectId)
                                    ? 'Unmute project'
                                    : 'Mute project'}
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                            onClick={() => handleDelete(n)}
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Inbox;
