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
  MessageSquare,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import {
  DateRangeFilter,
  DateRangeValue,
  ALL_TIME,
  inRange,
} from '@/components/common/DateRangeFilter';

import { Sidebar } from '@/components/sidebar/Sidebar';
import { AppHeader } from '@/components/layout/AppHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
    case 'task_created':
      return <CheckCheck className="w-4 h-4" />;
    case 'task_assigned':
      return <UserPlus className="w-4 h-4" />;
    case 'comment_mention':
      return <AtSign className="w-4 h-4" />;
    case 'task_reminder':
      return <AlarmClock className="w-4 h-4" />;
    case 'task_overdue':
      return <AlarmClock className="w-4 h-4" />;
    case 'project_invite':
      return <UserPlus className="w-4 h-4" />;
    case 'project_chat_message':
      return <MessageSquare className="w-4 h-4" />;
    default:
      return <Bell className="w-4 h-4" />;
  }
};

const typeBubbleClasses = (type: AppNotification['type'], unread: boolean): string => {
  if (!unread) return 'bg-secondary text-secondary-foreground';
  switch (type) {
    case 'task_overdue':
      return 'bg-red-500/15 text-red-600 dark:text-red-300 ring-1 ring-red-500/30';
    case 'task_reminder':
      return 'bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/30';
    case 'task_assigned':
      return 'bg-blue-500/15 text-blue-600 dark:text-blue-300 ring-1 ring-blue-500/30';
    case 'comment_mention':
      return 'bg-violet-500/15 text-violet-600 dark:text-violet-300 ring-1 ring-violet-500/30';
    case 'task_completed':
      return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30';
    default:
      return 'bg-primary text-primary-foreground';
  }
};

export const Inbox: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');
  // Filter notifications by their creation timestamp.
  const [dateRange, setDateRange] = useState<DateRangeValue>(ALL_TIME);
  const [snoozes, setSnoozes] = useState<SnoozeMap>(() =>
    readJson<SnoozeMap>(SNOOZE_KEY, {}),
  );
  const [muted, setMuted] = useState<MutedProjectsMap>(() =>
    readJson<MutedProjectsMap>(MUTED_PROJECTS_KEY, {}),
  );
  const { notifications, loading, unreadCount, markAsRead, markAllAsReadLocally, refresh, removeLocal } =
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

  const getVisibleForTab = useCallback(
    (filterTab: FilterTab) => {
      const now = Date.now();
      const q = search.trim().toLowerCase();
      return notifications.filter((n) => {
        const snoozeUntil = snoozes[n.notificationId];
        if (snoozeUntil && snoozeUntil > now) return false;
        if (n.projectId && isMuted(n.projectId)) return false;
        if (filterTab === 'mentions' && !isMention(n)) return false;
        if (filterTab === 'assigned' && !isAssignment(n)) return false;
        if (filterTab === 'unread' && n.read) return false;
        if (q && !`${n.title} ${n.body}`.toLowerCase().includes(q)) return false;
        if (!inRange(new Date(n.createdAt), dateRange)) return false;
        return true;
      });
    },
    [notifications, snoozes, isMuted, search, dateRange],
  );

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
        // Drop from the list immediately; don't wait on the refresh.
        removeLocal(n.notificationId);
        toast.success('Removed');
        refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to remove');
      }
    },
    [user, refresh, removeLocal],
  );

  const handleMarkAllRead = useCallback(async () => {
    if (!user) return;
    // Update locally first so the UI reflects the read state immediately and survives a reload
    // even if the DB write below fails.
    markAllAsReadLocally();
    try {
      await markAllNotificationsRead(user.userId);
      toast.success('All marked as read');
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to mark all');
    }
  }, [user, refresh, markAllAsReadLocally]);

  const counts = useMemo(() => {
    const all = notifications.length;
    const m = notifications.filter(isMention).length;
    const a = notifications.filter(isAssignment).length;
    const u = notifications.filter((n) => !n.read).length;
    return { all, mentions: m, assigned: a, unread: u };
  }, [notifications]);

  return (
    <div className="flex h-screen bg-background pt-12 md:pt-0">
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
          right={null}
        />

        <div className="flex-1 overflow-y-auto">
          <div className="w-full max-w-[1200px] mx-auto px-4 lg:px-6 py-6">
            <Card className="overflow-hidden">
              <CardHeader className="pb-3 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="text-base font-semibold">Notifications</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {unreadCount > 0
                        ? `${unreadCount} unread · stay on top of mentions, assignments and reminders`
                        : "You're all caught up"}
                    </p>
                  </div>
                  {unreadCount > 0 && (
                    <Button variant="outline" size="sm" onClick={handleMarkAllRead} className="shrink-0 w-fit">
                      <CheckCheck className="w-4 h-4 mr-1.5" />
                      Mark all read
                    </Button>
                  )}
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="relative w-full max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    <Input
                      placeholder="Search notifications…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-9 h-9"
                    />
                  </div>
                  <DateRangeFilter value={dateRange} onChange={setDateRange} />
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-4">
                <Tabs value={tab} onValueChange={(v) => setTab(v as FilterTab)}>
                  <TabsList className="w-full justify-start flex-wrap h-auto gap-1 bg-secondary/50 p-1 mb-2">
                    <TabsTrigger value="all" className="text-xs sm:text-sm">
                      All
                      <span className="ml-1.5 tabular-nums text-[10px] text-muted-foreground">{counts.all}</span>
                    </TabsTrigger>
                    <TabsTrigger value="mentions" className="text-xs sm:text-sm">
                      Mentions
                      <span className="ml-1.5 tabular-nums text-[10px] text-muted-foreground">{counts.mentions}</span>
                    </TabsTrigger>
                    <TabsTrigger value="assigned" className="text-xs sm:text-sm">
                      Assigned
                      <span className="ml-1.5 tabular-nums text-[10px] text-muted-foreground">{counts.assigned}</span>
                    </TabsTrigger>
                    <TabsTrigger value="unread" className="text-xs sm:text-sm">
                      Unread
                      <span className="ml-1.5 tabular-nums text-[10px] text-muted-foreground">{counts.unread}</span>
                    </TabsTrigger>
                  </TabsList>
                  {(['all', 'mentions', 'assigned', 'unread'] as const).map((filterTab) => {
                    const items = getVisibleForTab(filterTab);
                    const emptyCopy: Record<FilterTab, { title: string; hint: string }> = {
                      all: {
                        title: "You're all caught up",
                        hint: 'New mentions, assignments, and reminders show up here.',
                      },
                      mentions: {
                        title: 'No mentions yet',
                        hint: 'Use @name in a task comment (matching a teammate) to notify them.',
                      },
                      assigned: {
                        title: 'No assignment notifications',
                        hint: 'When someone assigns you to a task, it will appear here.',
                      },
                      unread: {
                        title: 'No unread notifications',
                        hint: 'Everything in your inbox has been read.',
                      },
                    };
                    return (
                      <TabsContent key={filterTab} value={filterTab} className="mt-0 focus-visible:outline-none">
                        {loading ? (
                          <div className="flex items-center justify-center py-16">
                            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                          </div>
                        ) : items.length === 0 ? (
                          <div className="flex flex-col items-center justify-center text-center py-16 px-4 rounded-lg border border-dashed border-border bg-muted/20">
                            <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center mb-3">
                              <InboxIcon className="w-6 h-6 text-muted-foreground" />
                            </div>
                            <p className="text-sm font-medium text-foreground">
                              {emptyCopy[filterTab].title}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                              {emptyCopy[filterTab].hint}
                            </p>
                          </div>
                        ) : (
                          <ul className="divide-y divide-border rounded-lg border border-border bg-background overflow-hidden">
                            {items.map((n) => (
                              <li
                                key={n.notificationId}
                                role="button"
                                tabIndex={0}
                                className={cn(
                                  'group relative flex gap-3 px-4 py-3 cursor-pointer hover:bg-secondary/40 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                                  !n.read && 'bg-primary/5',
                                )}
                                onClick={() => handleOpen(n)}
                                onKeyDown={(e) => {
                                  if (e.currentTarget !== e.target) return;
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    handleOpen(n);
                                  }
                                }}
                              >
                                <div
                                  className={cn(
                                    'mt-0.5 w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors',
                                    typeBubbleClasses(n.type, !n.read),
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
                    );
                  })}
                </Tabs>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Inbox;
