import React, { useMemo, useEffect, useState, useRef, useCallback } from 'react';
import {
  MessageSquare,
  Plus,
  CheckCircle2,
  Activity as ActivityIcon,
  ListTree,
  UserPlus,
  Send,
  Loader2,
  Users,
  ChevronUp,
  Minus,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { Project } from '@/types';
import { useActivity } from '@/hooks/useActivity';
import { useOrganization } from '@/context/OrganizationContext';
import { useAuth } from '@/context/AuthContext';
import { format, formatDistanceToNow, isSameDay } from 'date-fns';
import {
  subscribeToProjectChat,
  insertProjectChatMessage,
  notifyProjectChatMentions,
  notifyProjectChatMessageToMembers,
  type ProjectChatMessage,
} from '@/services/supabase/database';
import { toast } from 'sonner';
import type { PresencePeer } from '@/hooks/usePresence';
import { PresenceStatusInline } from '@/components/presence/PresenceStatusInline';

interface ProjectRightRailProps {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInviteClick?: () => void;
  /** Realtime project presence by userId (from the same channel as the header). */
  presenceByUserId?: Map<string, PresencePeer>;
}

const ROLE_BADGES: Record<string, { label: string; className: string }> = {
  owner: {
    label: 'Owner',
    className: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  },
  admin: { label: 'Admin', className: 'bg-info-soft text-info' },
  member: {
    label: 'Member',
    className: 'bg-secondary text-secondary-foreground',
  },
  viewer: { label: 'Viewer', className: 'bg-success-soft text-success' },
};

const ACTIVITY_ICONS: Record<string, React.ElementType> = {
  task_created: Plus,
  task_updated: ListTree,
  task_viewed: ActivityIcon,
  subtask_created: ListTree,
  subtask_done: CheckCircle2,
  comment_added: MessageSquare,
  project_viewed: ActivityIcon,
};

const summarizeActivity = (
  type: string,
  payload?: { subtaskTitle?: string; status?: string; completed?: boolean },
) => {
  switch (type) {
    case 'task_created':
      return 'created the task';
    case 'task_updated':
      if (payload?.status) return `moved to ${payload.status}`;
      return 'updated the task';
    case 'subtask_created':
      return payload?.subtaskTitle
        ? `added subtask "${payload.subtaskTitle}"`
        : 'added a subtask';
    case 'subtask_done':
      return payload?.completed
        ? `completed subtask "${payload?.subtaskTitle ?? ''}"`
        : `reopened subtask "${payload?.subtaskTitle ?? ''}"`;
    case 'comment_added':
      return 'commented';
    case 'task_viewed':
      return 'opened the task';
    case 'project_viewed':
      return 'opened the project';
    default:
      return type.replace(/_/g, ' ');
  }
};

const messageDayLabel = (date: Date) => {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(date, today)) return 'Today';
  if (isSameDay(date, yesterday)) return 'Yesterday';
  return format(date, 'MMM d, yyyy');
};

export const ProjectRightRail: React.FC<ProjectRightRailProps> = ({
  project,
  open,
  onOpenChange,
  onInviteClick,
  presenceByUserId,
}) => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const orgId =
    organization?.organizationId ||
    user?.organizationId ||
    (user ? `local-${user.userId}` : '');
  const { events } = useActivity(orgId || null, 30);

  const projectEvents = useMemo(
    () => events.filter((e) => e.projectId === project.projectId).slice(0, 12),
    [events, project.projectId],
  );

  const dedupedMembers = useMemo(() => {
    const map = new Map<string, (typeof project.members)[number]>();
    const ROLE_ORDER: Record<string, number> = {
      owner: 3,
      admin: 2,
      member: 1,
      viewer: 0,
    };
    for (const m of project.members ?? []) {
      const key = m.userId || m.email;
      if (!key) continue;
      const existing = map.get(key);
      if (
        !existing ||
        (ROLE_ORDER[m.role] ?? 0) > (ROLE_ORDER[existing.role] ?? 0)
      ) {
        map.set(key, m);
      }
    }
    return Array.from(map.values());
  }, [project.members]);

  const mentionMembers = useMemo(
    () =>
      (organization?.members?.length
        ? organization.members
        : dedupedMembers.map((m) => ({
            userId: m.userId,
            displayName: m.displayName,
            email: m.email || '',
          }))
      ).map((m) => ({
        userId: m.userId,
        displayName: m.displayName,
        email: m.email || '',
      })),
    [organization?.members, dedupedMembers],
  );

  const [chatMessages, setChatMessages] = useState<ProjectChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(true);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  /** Persist a per-project "last seen" timestamp so the dock can show an unread badge. */
  const lastSeenStorageKey = `project_chat_last_seen:${project.projectId}`;
  const [lastSeenAt, setLastSeenAt] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;
    try {
      const raw = window.localStorage.getItem(lastSeenStorageKey);
      return raw ? Number(raw) || 0 : 0;
    } catch {
      return 0;
    }
  });

  const unreadCount = useMemo(() => {
    if (open) return 0;
    if (!user) return 0;
    return chatMessages.reduce((acc, m) => {
      if (m.userId === user.userId) return acc;
      return new Date(m.createdAt).getTime() > lastSeenAt ? acc + 1 : acc;
    }, 0);
  }, [chatMessages, lastSeenAt, open, user]);

  const recentSenders = useMemo(() => {
    const seen = new Set<string>();
    const result: { userId: string; displayName: string; photoURL?: string }[] = [];
    for (let i = chatMessages.length - 1; i >= 0 && result.length < 3; i--) {
      const m = chatMessages[i];
      if (!m || !m.userId || seen.has(m.userId)) continue;
      if (user && m.userId === user.userId) continue;
      seen.add(m.userId);
      result.push({
        userId: m.userId,
        displayName: m.displayName || 'User',
        photoURL: m.photoURL,
      });
    }
    return result;
  }, [chatMessages, user]);

  const chatRows = useMemo(
    () =>
      chatMessages.map((msg, index) => {
        const createdAt = new Date(msg.createdAt);
        const previous = chatMessages[index - 1];
        const showDay =
          !previous || !isSameDay(new Date(previous.createdAt), createdAt);
        return { msg, createdAt, showDay };
      }),
    [chatMessages],
  );

  useEffect(() => {
    if (!open) return;
    setChatLoading(true);
    const unsub = subscribeToProjectChat(project.projectId, (list) => {
      setChatMessages(list);
      setChatLoading(false);
    });
    return () => unsub();
  }, [open, project.projectId]);

  /** When the dock opens — or new messages arrive while open — bump the last-seen marker. */
  useEffect(() => {
    if (!open) return;
    const now = Date.now();
    setLastSeenAt(now);
    try {
      window.localStorage.setItem(lastSeenStorageKey, String(now));
    } catch {
      /* ignore */
    }
  }, [open, chatMessages.length, lastSeenStorageKey]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleSendChat = useCallback(async () => {
    const body = chatInput.trim();
    if (!body || !user) return;
    setChatSending(true);
    try {
      await insertProjectChatMessage({
        projectId: project.projectId,
        organizationId: project.organizationId,
        userId: user.userId,
        displayName: user.displayName || user.email || 'User',
        photoURL: user.photoURL || undefined,
        body,
        taskId: null,
      });
      const mentionedIds = await notifyProjectChatMentions({
        text: body,
        members: mentionMembers,
        actorUserId: user.userId,
        actorDisplayName: user.displayName || user.email || 'User',
        projectId: project.projectId,
        projectName: project.name,
      });
      const memberIds = dedupedMembers
        .map((m) => m.userId)
        .filter((id): id is string => Boolean(id));
      void notifyProjectChatMessageToMembers({
        projectId: project.projectId,
        projectName: project.name,
        actorUserId: user.userId,
        actorDisplayName: user.displayName || user.email || 'User',
        body,
        memberUserIds: memberIds,
        skipUserIds: [user.userId, ...mentionedIds],
      });
      setChatInput('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send message');
    } finally {
      setChatSending(false);
    }
  }, [
    chatInput,
    user,
    project.projectId,
    project.organizationId,
    project.name,
    mentionMembers,
    dedupedMembers,
  ]);

  const membersSection = (
    <section className="p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Members ({dedupedMembers.length})
        </h3>
        {onInviteClick && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-primary hover:text-primary"
            onClick={onInviteClick}
          >
            <UserPlus className="w-3 h-3 mr-1" />
            Invite
          </Button>
        )}
      </div>
      <div className="space-y-1">
        {dedupedMembers.length === 0 && (
          <p className="text-sm text-muted-foreground py-2">No members yet</p>
        )}
        {dedupedMembers.map((m) => {
          const role = ROLE_BADGES[m.role] || ROLE_BADGES.member;
          return (
            <div
              key={m.userId || m.email}
              className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-secondary"
            >
              <Avatar className="w-9 h-9">
                <AvatarImage src={m.photoURL} alt={m.displayName} />
                <AvatarFallback className="bg-primary-soft text-primary-soft-foreground text-xs">
                  {m.displayName.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-foreground truncate">
                    {m.displayName}
                  </p>
                  <PresenceStatusInline
                    peer={m.userId ? presenceByUserId?.get(m.userId) : undefined}
                  />
                </div>
                <p className="text-xs text-muted-foreground truncate">{m.email}</p>
              </div>
              <span
                className={cn(
                  'text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full',
                  role.className,
                )}
              >
                {role.label}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );

  const activitySection = (
    <section className="p-4">
      <h3 className="text-sm font-semibold text-muted-foreground mb-3">
        Activity
      </h3>
      <div className="space-y-4">
        {projectEvents.length === 0 && (
          <p className="text-sm text-muted-foreground py-2">No recent activity</p>
        )}
        {projectEvents.map((e) => {
          const Icon = ACTIVITY_ICONS[e.type] || ActivityIcon;
          return (
            <div key={e.activityId} className="flex gap-2">
              <Avatar className="w-8 h-8 shrink-0">
                <AvatarImage src={e.photoURL} alt={e.displayName} />
                <AvatarFallback className="bg-secondary text-foreground text-[10px]">
                  {(e.displayName || '?').charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm leading-relaxed">
                  <span className="font-medium text-foreground">{e.displayName}</span>{' '}
                  <span className="text-muted-foreground">
                    {summarizeActivity(e.type, e.payload as any)}
                  </span>
                  {e.taskTitle && (
                    <>
                      {' '}
                      <span className="text-foreground">{e.taskTitle}</span>
                    </>
                  )}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                  <Icon className="w-3 h-3" />
                  {formatDistanceToNow(new Date(e.createdAt), { addSuffix: true })}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );

  const railWidth = 'w-[calc(100vw-1.5rem)] sm:w-[min(23rem,calc(100vw-2.5rem))]';
  const lastMessage = chatMessages[chatMessages.length - 1];
  const lastMessagePreview = lastMessage
    ? `${lastMessage.userId === user?.userId ? 'You' : lastMessage.displayName?.split(' ')[0] || ''}${
        lastMessage.userId === user?.userId || !lastMessage.displayName ? '' : ':'
      } ${lastMessage.body || ''}`
    : null;

  if (!open) {
    return (
      <div
        className="fixed inset-x-3 bottom-4 z-[100] flex flex-col items-end pointer-events-none sm:inset-x-auto sm:right-5"
        role="complementary"
        aria-label="Project messaging"
      >
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          aria-label="Open project messages and team"
          className={cn(
            'pointer-events-auto group relative flex min-h-[3.75rem] items-center gap-3',
            'rounded-lg border border-border/70 bg-card/95 pl-3 pr-3 text-left backdrop-blur-xl',
            'shadow-[0_16px_46px_rgba(0,0,0,0.24)] transition-all duration-150',
            'hover:-translate-y-0.5 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
            railWidth,
          )}
        >
          <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
            <MessageSquare className="h-[18px] w-[18px]" />
            {unreadCount > 0 && (
              <span
                className={cn(
                  'absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full',
                  'bg-destructive text-destructive-foreground text-[10px] font-semibold leading-[18px] text-center',
                  'ring-2 ring-card shadow-sm',
                )}
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1 py-2">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-[13px] font-semibold text-foreground leading-tight">
                {project.name}
              </p>
              {unreadCount > 0 && (
                <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-primary animate-pulse" />
              )}
            </div>
            {lastMessagePreview ? (
              <p className="truncate text-[11.5px] text-muted-foreground mt-0.5">
                {lastMessagePreview.slice(0, 80)}
                {lastMessagePreview.length > 80 ? '…' : ''}
              </p>
            ) : (
              <p className="truncate text-[11.5px] text-muted-foreground mt-0.5">
                {dedupedMembers.length} members · Start the conversation
              </p>
            )}
          </div>
          {recentSenders.length > 0 ? (
            <div className="flex -space-x-1.5 shrink-0 mr-1">
              {recentSenders.map((s) => (
                <Avatar key={s.userId} className="w-6 h-6 ring-2 ring-card">
                  <AvatarImage src={s.photoURL} alt={s.displayName} />
                  <AvatarFallback className="text-[10px] bg-primary-soft text-primary-soft-foreground">
                    {(s.displayName || '?').charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              ))}
            </div>
          ) : null}
          <ChevronUp
            className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5"
          />
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-x-3 bottom-4 z-[100] flex flex-col items-end pointer-events-none sm:inset-x-auto sm:right-5"
      role="complementary"
      aria-label="Project messages"
    >
      <aside
        className={cn(
          'pointer-events-auto flex flex-col overflow-hidden rounded-lg border border-border/70',
          'bg-card/95 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl',
          railWidth,
          'h-[min(34rem,calc(100svh-2rem))] max-h-[calc(100vh-2rem)]',
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
              <MessageSquare className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate leading-tight">
                {project.name}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {dedupedMembers.length} members · {chatMessages.length} messages
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
            onClick={() => onOpenChange(false)}
            aria-label="Minimize project messages"
          >
            <Minus className="h-5 w-5" />
          </Button>
        </div>

      <Tabs defaultValue="chat" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="shrink-0 mx-2 mt-2 grid h-10 grid-cols-3 gap-0.5 rounded-lg border border-border/50 bg-muted/40 p-0.5">
          <TabsTrigger
            value="chat"
            className="text-xs sm:text-sm gap-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm"
          >
            <MessageSquare className="h-3.5 w-3.5 shrink-0" />
            Chat
          </TabsTrigger>
          <TabsTrigger
            value="members"
            className="text-xs sm:text-sm gap-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm"
          >
            <Users className="h-3.5 w-3.5 shrink-0" />
            Team
          </TabsTrigger>
          <TabsTrigger
            value="activity"
            className="text-xs sm:text-sm gap-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm"
          >
            <ActivityIcon className="h-3.5 w-3.5 shrink-0" />
            Feed
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="chat"
          className="flex-1 flex flex-col min-h-0 mt-2 px-0 data-[state=inactive]:hidden overflow-hidden"
        >
          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-3">
            {chatLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : chatMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center py-12 px-4">
                <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-3">
                  <MessageSquare className="w-6 h-6" />
                </div>
                <p className="text-sm font-medium text-foreground">No project messages yet</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  Start a conversation, share blockers, or use @name to notify a teammate.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {chatRows.map(({ msg, createdAt, showDay }) => {
                  const mine = msg.userId === user?.userId;
                  return (
                    <div key={msg.messageId}>
                      {showDay && (
                        <div className="sticky top-2 z-10 flex justify-center py-2">
                          <span className="rounded-full border border-border bg-card/95 px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur">
                            {messageDayLabel(createdAt)}
                          </span>
                        </div>
                      )}
                      <div className={cn('flex gap-2', mine && 'justify-end')}>
                        {!mine && (
                          <Avatar className="w-7 h-7 shrink-0 mt-5">
                            <AvatarImage src={msg.photoURL} alt={msg.displayName} />
                            <AvatarFallback className="text-[11px] bg-primary-soft text-primary-soft-foreground">
                              {(msg.displayName || '?').charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        )}
                        <div className={cn('max-w-[78%] min-w-0', mine && 'flex flex-col items-end')}>
                          <div
                            className={cn(
                              'mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground',
                              mine && 'justify-end',
                            )}
                          >
                            <span className="font-medium text-foreground">
                              {mine ? 'You' : msg.displayName}
                            </span>
                            {!mine && (
                              <PresenceStatusInline
                                peer={presenceByUserId?.get(msg.userId)}
                                className="gap-1"
                              />
                            )}
                            <span>{format(createdAt, 'p')}</span>
                          </div>
                          <div
                            className={cn(
                              'rounded-lg px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words',
                              mine
                                ? 'rounded-br-sm bg-primary text-primary-foreground shadow-sm'
                                : 'rounded-bl-sm bg-muted text-foreground border border-border/60',
                            )}
                          >
                            {msg.body}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          <div className="shrink-0 border-t border-border/70 bg-card/80 p-2.5">
            <div className="rounded-lg border border-border/60 bg-background/90 p-1.5 transition-shadow focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/20">
              <Textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Write a message… (@name to notify)"
                rows={2}
                className="min-h-[3rem] resize-none rounded-md border-0 bg-transparent px-2.5 py-1.5 text-[13px] leading-relaxed shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/70"
                disabled={!user || chatSending}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSendChat();
                  }
                }}
              />
              <div className="flex items-center justify-between gap-2 px-1.5 pb-0.5">
                <p className="text-[10.5px] text-muted-foreground">
                  Enter to send · Shift+Enter for newline
                </p>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 rounded-md px-3 text-xs"
                  disabled={!user || !chatInput.trim() || chatSending}
                  onClick={() => void handleSendChat()}
                >
                  {chatSending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <>
                      <Send className="w-3 h-3 mr-1" />
                      Send
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent
          value="members"
          className="flex-1 min-h-0 mt-0 overflow-y-auto data-[state=inactive]:hidden"
        >
          {membersSection}
        </TabsContent>

        <TabsContent
          value="activity"
          className="flex-1 min-h-0 mt-0 overflow-y-auto data-[state=inactive]:hidden"
        >
          {activitySection}
        </TabsContent>
      </Tabs>
    </aside>
    </div>
  );
};

export default ProjectRightRail;
