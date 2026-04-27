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

  const railWidth = 'w-[min(22rem,calc(100vw-1.25rem))]';

  if (!open) {
    return (
      <div
        className="fixed bottom-0 right-0 z-[100] flex flex-col items-end pointer-events-none p-0"
        role="complementary"
        aria-label="Project messaging"
      >
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          aria-label="Open project messages and team"
          className={cn(
            'pointer-events-auto relative mb-0 mr-3 sm:mr-5 flex min-h-[3.25rem] items-center gap-3 rounded-t-xl border border-b-0 border-border',
            'bg-gradient-to-b from-card to-muted/30 pl-3 pr-2 text-left shadow-[0_-6px_24px_rgba(0,0,0,0.1)]',
            'transition-colors hover:from-card hover:to-muted/50 dark:shadow-[0_-8px_32px_rgba(0,0,0,0.45)]',
            railWidth,
          )}
        >
        <div className="absolute top-0 left-3 right-3 h-0.5 rounded-b-full bg-primary" />
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary ring-1 ring-primary/20">
            <MessageSquare className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1 py-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Messaging
            </p>
            <p className="truncate text-sm font-semibold text-foreground">{project.name}</p>
            {chatMessages.length > 0 && (
              <p className="truncate text-xs text-muted-foreground">
                {chatMessages[chatMessages.length - 1]?.body?.slice(0, 80) || '—'}
                {String(chatMessages[chatMessages.length - 1]?.body || '').length > 80
                  ? '…'
                  : ''}
              </p>
            )}
          </div>
          <ChevronUp className="h-5 w-5 shrink-0 text-muted-foreground" />
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed bottom-0 right-0 z-[100] flex flex-col items-end pointer-events-none p-0"
      role="complementary"
      aria-label="Project messages"
    >
      <aside
        className={cn(
          'pointer-events-auto mb-0 mr-3 sm:mr-5 flex flex-col overflow-hidden rounded-t-2xl border border-b-0 border-border',
          'bg-gradient-to-b from-card via-card to-background shadow-[0_-8px_40px_rgba(0,0,0,0.12)]',
          'dark:shadow-[0_-12px_40px_rgba(0,0,0,0.5)]',
          railWidth,
          'h-[min(32rem,72svh)] max-h-[calc(100vh-1.5rem)]',
        )}
      >
        <div className="h-1 w-full shrink-0 bg-primary" />
        <div className="flex items-center justify-between gap-2 border-b border-border/80 bg-card/90 px-3 py-2.5 backdrop-blur-sm">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground truncate leading-tight">{project.name}</p>
          <p className="text-[11px] text-muted-foreground">
            {dedupedMembers.length} members · {chatMessages.length} messages
          </p>
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
                          <Avatar className="w-8 h-8 shrink-0 mt-5">
                            <AvatarImage src={msg.photoURL} alt={msg.displayName} />
                            <AvatarFallback className="text-xs bg-primary-soft text-primary-soft-foreground">
                              {(msg.displayName || '?').charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        )}
                        <div className={cn('max-w-[82%]', mine && 'flex flex-col items-end')}>
                          <div
                            className={cn(
                              'mb-1 flex items-center gap-1.5 text-xs text-muted-foreground',
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
                              'rounded-2xl border px-3 py-2 text-sm leading-relaxed shadow-sm whitespace-pre-wrap break-words',
                              mine
                                ? 'rounded-br-md border-primary/25 bg-primary text-primary-foreground'
                                : 'rounded-bl-md border-border bg-muted/50 text-foreground',
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
          <div className="shrink-0 border-t border-border/80 bg-muted/20 p-2.5">
            <div className="rounded-2xl border border-border/60 bg-background/90 p-1.5 shadow-inner focus-within:ring-2 focus-within:ring-primary/25">
              <Textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Write a message… (@name to notify)"
                rows={2}
                className="min-h-[3.25rem] resize-none rounded-xl border-0 bg-transparent px-2.5 py-2 text-sm shadow-none focus-visible:ring-0"
                disabled={!user || chatSending}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSendChat();
                  }
                }}
              />
              <div className="flex items-center justify-between gap-2 px-1 pb-1">
                <p className="text-[11px] text-muted-foreground">
                  Enter to send · Shift+Enter for newline
                </p>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 rounded-full px-3"
                  disabled={!user || !chatInput.trim() || chatSending}
                  onClick={() => void handleSendChat()}
                >
                  {chatSending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5 mr-1.5" />
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
