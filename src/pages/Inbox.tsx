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

import { AppHeader } from '@/components/layout/AppHeader';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui/tabs';
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
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
import { notificationsInScope } from '@/lib/workspaceScope';

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

const TABS: { id: FilterTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'mentions', label: 'Mentions' },
  { id: 'assigned', label: 'Assigned' },
  { id: 'unread', label: 'Unread' },
];

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

/** Icon bubble: neutral, except unread overdue / reminder items, which keep a quiet tint. */
const typeBubbleClasses = (type: AppNotification['type'], unread: boolean): string => {
  if (!unread) return 'bg-secondary text-muted-foreground';
  switch (type) {
    case 'task_overdue':
      return 'bg-destructive-soft text-destructive-soft-foreground';
    case 'task_reminder':
      return 'bg-warning-soft text-warning-soft-foreground';
    default:
      return 'bg-secondary text-foreground';
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
  const { notifications: allNotifications, loading, unreadCount: totalUnread, markAsRead, markAllAsReadLocally, refresh, removeLocal } =
    useNotifications(user?.userId ?? null, 200);
  // The inbox follows the workspace switcher: only this workspace's projects,
  // plus the notifications that are not about a project at all.
  const { projectIds } = useSelectedWorkspace();
  const notifications = useMemo(
    () => notificationsInScope(allNotifications, projectIds),
    [allNotifications, projectIds],
  );
  // Under "All workspaces" nothing is filtered, so the full count stands.
  const unreadCount = useMemo(
    () => (projectIds ? notifications.filter((n) => !n.read).length : totalUnread),
    [projectIds, notifications, totalUnread],
  );

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
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <AppHeader left={<span className="text-sm font-semibold">Inbox</span>} right={null} />

      <div className="flex-1 overflow-y-auto">
        <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">
          <PageHeader
            title="Inbox"
            description={
              unreadCount > 0
                ? `${unreadCount} unread · stay on top of mentions, assignments and reminders`
                : "You're all caught up"
            }
            actions={
              unreadCount > 0 ? (
                <Button variant="outline" onClick={handleMarkAllRead}>
                  <CheckCheck aria-hidden />
                  Mark all read
                </Button>
              ) : undefined
            }
          />

          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full max-w-xs">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Search notifications"
                  placeholder="Search notifications…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
              <DateRangeFilter value={dateRange} onChange={setDateRange} />
            </div>

            <Tabs value={tab} onValueChange={(v) => setTab(v as FilterTab)}>
              {/* The tab row scrolls sideways rather than wrapping when it is too wide. */}
              <div className="overflow-x-auto">
                <TabsList className="flex w-max min-w-full">
                  {TABS.map((t) => (
                    <TabsTrigger key={t.id} value={t.id}>
                      {t.label}
                      <span className="text-xs font-normal tabular-nums text-muted-foreground">
                        {counts[t.id]}
                      </span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
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
                  <TabsContent key={filterTab} value={filterTab} className="focus-visible:outline-none">
                    {loading ? (
                      <div className="flex items-center justify-center py-16">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : items.length === 0 ? (
                      <div className="flex flex-col items-center gap-1 rounded-lg border border-border px-4 py-12 text-center">
                        <InboxIcon className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
                        <p className="text-sm font-medium text-foreground">
                          {emptyCopy[filterTab].title}
                        </p>
                        <p className="max-w-sm text-xs text-muted-foreground">
                          {emptyCopy[filterTab].hint}
                        </p>
                      </div>
                    ) : (
                      <ul className="overflow-hidden rounded-lg border border-border bg-background">
                        {items.map((n) => (
                          <li
                            key={n.notificationId}
                            role="button"
                            tabIndex={0}
                            className="group relative flex min-h-12 cursor-pointer gap-3 border-b border-border/60 px-4 py-2.5 text-sm outline-none transition-colors last:border-b-0 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
                                'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                                typeBubbleClasses(n.type, !n.read),
                              )}
                            >
                              {typeIcon(n.type)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p
                                  className={cn(
                                    'truncate text-foreground',
                                    n.read ? 'font-normal' : 'font-medium',
                                  )}
                                >
                                  {n.title}
                                </p>
                                {!n.read && (
                                  <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                                )}
                              </div>
                              <p className="line-clamp-2 text-xs text-muted-foreground">
                                {n.body}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {formatDistanceToNow(new Date(n.createdAt), {
                                  addSuffix: true,
                                })}
                              </p>
                            </div>

                            {/* Row actions: shown on hover / keyboard focus, and always on touch screens. */}
                            <div
                              className="flex shrink-0 items-start gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {!n.read && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="w-7 px-0 text-muted-foreground"
                                  onClick={() => markAsRead(n.notificationId)}
                                  title="Mark as read"
                                  aria-label="Mark as read"
                                >
                                  <CheckCheck aria-hidden />
                                </Button>
                              )}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="w-7 px-0 text-muted-foreground"
                                    title="Snooze"
                                    aria-label="Snooze"
                                  >
                                    <AlarmClock aria-hidden />
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
                                className="w-7 px-0 text-muted-foreground hover:text-destructive"
                                onClick={() => handleDelete(n)}
                                title="Delete"
                                aria-label="Delete"
                              >
                                <Trash2 aria-hidden />
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
          </div>
        </div>
      </div>
    </main>
  );
};

export default Inbox;
