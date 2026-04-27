import React, { useMemo, useEffect, useState, useRef, useCallback } from 'react';
import {
  PanelRightClose,
  PanelRightOpen,
  MessageSquare,
  Plus,
  CheckCircle2,
  Activity as ActivityIcon,
  ListTree,
  UserPlus,
  Send,
  Loader2,
  Users,
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
import { formatDistanceToNow } from 'date-fns';
import {
  subscribeToProjectChat,
  insertProjectChatMessage,
  notifyProjectChatMentions,
  notifyProjectChatMessageToMembers,
  type ProjectChatMessage,
} from '@/services/supabase/database';
import { toast } from 'sonner';

interface ProjectRightRailProps {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInviteClick?: () => void;
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

export const ProjectRightRail: React.FC<ProjectRightRailProps> = ({
  project,
  open,
  onOpenChange,
  onInviteClick,
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
          <p className="text-xs text-muted-foreground py-2">No members yet</p>
        )}
        {dedupedMembers.map((m) => {
          const role = ROLE_BADGES[m.role] || ROLE_BADGES.member;
          return (
            <div
              key={m.userId || m.email}
              className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-secondary"
            >
              <Avatar className="w-7 h-7">
                <AvatarImage src={m.photoURL} alt={m.displayName} />
                <AvatarFallback className="bg-primary-soft text-primary-soft-foreground text-xs">
                  {m.displayName.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {m.displayName}
                </p>
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
    <section className="p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        Activity
      </h3>
      <div className="space-y-3">
        {projectEvents.length === 0 && (
          <p className="text-xs text-muted-foreground py-2">No recent activity</p>
        )}
        {projectEvents.map((e) => {
          const Icon = ACTIVITY_ICONS[e.type] || ActivityIcon;
          return (
            <div key={e.activityId} className="flex gap-2">
              <Avatar className="w-6 h-6 shrink-0">
                <AvatarImage src={e.photoURL} alt={e.displayName} />
                <AvatarFallback className="bg-secondary text-foreground text-[10px]">
                  {(e.displayName || '?').charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-xs leading-relaxed">
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

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        aria-label="Open project rail"
        className="absolute right-3 top-3 z-20 rounded-md border border-border bg-card p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary shadow-sm"
      >
        <PanelRightOpen className="w-4 h-4" />
      </button>
    );
  }

  return (
    <aside className="w-72 shrink-0 border-l border-border bg-card flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b border-border shrink-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Project
        </p>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground"
          onClick={() => onOpenChange(false)}
          aria-label="Hide project rail"
        >
          <PanelRightClose className="w-4 h-4" />
        </Button>
      </div>

      <Tabs defaultValue="chat" className="flex-1 flex flex-col min-h-0">
        <TabsList className="shrink-0 mx-2 mt-2 h-9 grid grid-cols-3 gap-0.5 p-1 rounded-lg">
          <TabsTrigger value="chat" className="text-[11px] px-1.5 gap-1">
            <MessageSquare className="w-3.5 h-3.5" />
            Chat
          </TabsTrigger>
          <TabsTrigger value="members" className="text-[11px] px-1.5 gap-1">
            <Users className="w-3.5 h-3.5" />
            Team
          </TabsTrigger>
          <TabsTrigger value="activity" className="text-[11px] px-1.5 gap-1">
            <ActivityIcon className="w-3.5 h-3.5" />
            Feed
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="chat"
          className="flex-1 flex flex-col min-h-0 mt-2 px-0 data-[state=inactive]:hidden overflow-hidden"
        >
          <div className="flex-1 min-h-0 overflow-y-auto px-3 space-y-3 pb-2">
            {chatLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : chatMessages.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8 px-2">
                Start a conversation about this project. Use @name to notify teammates.
              </p>
            ) : (
              chatMessages.map((msg) => (
                <div key={msg.messageId} className="flex gap-2">
                  <Avatar className="w-7 h-7 shrink-0">
                    <AvatarImage src={msg.photoURL} alt={msg.displayName} />
                    <AvatarFallback className="text-[10px] bg-primary-soft text-primary-soft-foreground">
                      {(msg.displayName || '?').charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-xs font-medium text-foreground">
                        {msg.displayName}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {formatDistanceToNow(new Date(msg.createdAt), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                    <p className="text-xs text-foreground mt-0.5 whitespace-pre-wrap break-words">
                      {msg.body}
                    </p>
                  </div>
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>
          <div className="shrink-0 border-t border-border p-2 space-y-2 bg-card">
            <Textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Message the project… (@name to notify)"
              rows={2}
              className="min-h-[3rem] text-xs resize-none"
              disabled={!user || chatSending}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSendChat();
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              className="w-full"
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
  );
};

export default ProjectRightRail;
