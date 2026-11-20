import React, { useMemo, useEffect, useLayoutEffect, useState, useRef, useCallback } from 'react';
import {
  MessageSquare,
  Plus,
  CheckCircle2,
  Activity as ActivityIcon,
  ListTree,
  UserPlus,
  Send,
  Loader2,
  Minus,
  Phone,
  Video,
  CalendarPlus,
  Mic,
  Download,
  FileText,
  Paperclip,
  X as XIcon,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MentionTextarea } from '@/components/mentions/MentionTextarea';
import { EmojiPickerButton } from '@/components/ui/emoji-picker';
import { ReactionButton, ReactionChips, groupReactions } from '@/components/messaging/ChatReactions';
import { useChatDock, useChatDockInset } from '@/components/messaging/ChatDock';
import { useCall } from '@/hooks/useCall';
import { isMediaSupported } from '@/services/webrtc/mediaUtils';
import { cn } from '@/lib/utils';
import type { Project } from '@/types';
import { useActivity } from '@/hooks/useActivity';
import { useOrganization } from '@/context/OrganizationContext';
import { useAuth } from '@/context/AuthContext';
import { format, formatDistanceToNow, isSameDay } from 'date-fns';
import {
  subscribeToProjectChat,
  subscribeToProjectChatReactions,
  insertProjectChatMessage,
  notifyProjectChatMentions,
  notifyProjectChatMessageToMembers,
  toggleProjectChatReaction,
  markNotificationsReadByProject,
  type ChatAttachment,
  type ProjectChatMessage,
  type ProjectChatReaction,
} from '@/services/supabase/database';
import { ATTACHMENTS_BUCKET, deleteFile, uploadChatAttachment } from '@/services/supabase/storage';
import { ChatAttachmentList } from '@/components/messaging/ChatAttachmentList';
import { ChatBubble, ProjectChatMessage as ChatMessageRow } from './ProjectChatMessage';
import { ProjectTeamMemberRow } from './ProjectTeamMemberRow';
import { dispatchNotificationsRefresh } from '@/lib/notificationEvents';
import { toast } from 'sonner';
import type { PresencePeer } from '@/hooks/usePresence';
import { buildProjectCallTargets } from '@/services/calling/callTargets';
import { playChatChime } from '@/lib/notificationSound';
import { PresenceStatusInline } from '@/components/presence/PresenceStatusInline';
import { useLastSeen } from '@/hooks/useLastSeen';
import {
  isGenericMemberDisplayName,
  resolveMemberDisplayName,
} from '@/lib/memberIdentity';
import {
  getProjectMemberProfiles,
  type ProjectMemberProfile,
} from '@/services/supabase/projectMemberProfiles';

interface ProjectRightRailProps {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInviteClick?: () => void;
  /** Realtime project presence by userId (from the same channel as the header). */
  presenceByUserId?: Map<string, PresencePeer>;
}

/** How far (rem) one-to-one chats stay from the right edge: past the open window, or past the Chat bar. */
const DOCK_INSET_OPEN = 25.5;
const DOCK_INSET_BAR = 8.5;

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
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

/** Structured chat-message payload posted by the call recorder when a
 *  recording finishes. We sniff the body and render a play/download card
 *  instead of dumping JSON into the message bubble. */
interface CallRecordingChatPayload {
  _kind: 'call_recording';
  url: string;
  fileId?: string;
  fileName?: string;
  durationSec?: number;
  startedAt?: string;
  transcript?: string;
}

function parseCallRecordingBody(body: string): CallRecordingChatPayload | null {
  if (!body || !body.startsWith('{') || !body.includes('"_kind"')) return null;
  try {
    const parsed = JSON.parse(body) as Partial<CallRecordingChatPayload>;
    if (parsed && parsed._kind === 'call_recording' && typeof parsed.url === 'string') {
      return {
        _kind: 'call_recording',
        url: parsed.url,
        fileId: typeof parsed.fileId === 'string' ? parsed.fileId : undefined,
        fileName: typeof parsed.fileName === 'string' ? parsed.fileName : undefined,
        durationSec: typeof parsed.durationSec === 'number' ? parsed.durationSec : undefined,
        startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : undefined,
        transcript: typeof parsed.transcript === 'string' ? parsed.transcript : undefined,
      };
    }
  } catch {
    /* not a structured card — fall back to plain text rendering */
  }
  return null;
}

function formatCallDuration(sec: number | undefined): string {
  if (!sec || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const CallRecordingCard: React.FC<{ payload: CallRecordingChatPayload }> = ({ payload }) => {
  const [showTranscript, setShowTranscript] = React.useState(false);
  const duration = formatCallDuration(payload.durationSec);
  return (
    <div className="min-w-[240px] max-w-[340px] rounded-lg border border-border bg-card p-3 text-sm leading-5 text-foreground">
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-destructive-soft text-destructive-soft-foreground">
          <Mic className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Recorded call</p>
          {duration && (
            <p className="text-xs text-muted-foreground tabular-nums">Duration {duration}</p>
          )}
        </div>
      </div>
      <audio
        controls
        src={payload.url}
        className="w-full h-9"
        preload="none"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <a
          href={payload.url}
          download={payload.fileName || 'call.webm'}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          title="Download audio"
        >
          <Download className="h-3 w-3" />
          Audio
        </a>
        {payload.transcript && payload.transcript.trim() && (
          <button
            type="button"
            onClick={() => setShowTranscript((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            title={showTranscript ? 'Hide transcript' : 'Show transcript'}
          >
            <FileText className="h-3 w-3" />
            {showTranscript ? 'Hide transcript' : 'Show transcript'}
          </button>
        )}
      </div>
      {showTranscript && payload.transcript && (
        <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs text-foreground">
          {payload.transcript}
        </p>
      )}
    </div>
  );
};

export const ProjectRightRail: React.FC<ProjectRightRailProps> = ({
  project,
  open,
  onOpenChange,
  onInviteClick,
  presenceByUserId,
}) => {
  const { user } = useAuth();
  const { actions: callActions, state: callState } = useCall();
  const { organization, isViewer: isViewerOrg } = useOrganization();
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

  const hasOtherMemberToCall = useMemo(
    () =>
      dedupedMembers.some(
        (m) => Boolean(m.userId) && m.userId !== user?.userId,
      ) || (Boolean(project.ownerId) && project.ownerId !== user?.userId),
    [dedupedMembers, user?.userId, project.ownerId],
  );

  // Persisted last_seen for every project member — used to render
  // "Last seen 5 min ago" alongside the presence dot when they're offline.
  const memberUserIds = useMemo(
    () => dedupedMembers.map((m) => m.userId).filter((id): id is string => !!id),
    [dedupedMembers],
  );
  const memberUserIdsKey = useMemo(
    () => [...memberUserIds].sort().join(','),
    [memberUserIds],
  );
  const [projectProfilesByUserId, setProjectProfilesByUserId] = useState<
    Map<string, ProjectMemberProfile>
  >(() => new Map());

  useEffect(() => {
    if (!project.projectId) {
      setProjectProfilesByUserId(new Map());
      return;
    }

    let cancelled = false;
    void getProjectMemberProfiles(project.projectId).then((profiles) => {
      if (cancelled) return;
      setProjectProfilesByUserId(
        new Map(profiles.map((profile) => [profile.userId, profile])),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [project.projectId, memberUserIdsKey]);

  const lastSeenByUserId = useLastSeen(memberUserIds);

  /** @-mentions: project team only (not whole org — avoids stale or unrelated users). */
  const mentionMembers = useMemo(() => {
    const orgById = new Map(
      (organization?.members ?? [])
        .filter((m) => m.userId)
        .map((m) => [m.userId as string, m] as const),
    );
    return dedupedMembers.map((m) => {
      const org = m.userId ? orgById.get(m.userId) : undefined;
      const profile = m.userId ? projectProfilesByUserId.get(m.userId) : undefined;
      const email = profile?.email || m.email || org?.email || '';
      const emailLocal = email.split('@')[0] || '';
      const peer = m.userId ? presenceByUserId?.get(m.userId) : undefined;
      const selfForRow =
        m.userId && user?.userId === m.userId
          ? (user.displayName?.trim() || user.email?.split('@')[0] || '')
          : '';
      const stored = (m.displayName || '').trim();

      const candidates = [
        (profile?.displayName || '').trim(),
        !isGenericMemberDisplayName(stored) ? stored : '',
        (org?.displayName || '').trim(),
        (peer?.displayName || '').trim(),
        selfForRow,
        emailLocal,
      ];
      const displayName = resolveMemberDisplayName(
        m.userId || '',
        email,
        ...candidates,
      );

      return {
        userId: m.userId,
        displayName,
        email,
        photoURL:
          profile?.photoURL ||
          m.photoURL ||
          (org as { photoURL?: string } | undefined)?.photoURL,
      };
    });
  }, [
    dedupedMembers,
    organization?.members,
    projectProfilesByUserId,
    presenceByUserId,
    user?.userId,
    user?.displayName,
    user?.email,
  ]);

  /** Map userId → label from project team (+ org / presence / self enrichment). Skip generic placeholders so chat resolution can fall through to presence/email. */
  const teamDisplayNameByUserId = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of mentionMembers) {
      const n = m.displayName?.trim();
      if (m.userId && n && !isGenericMemberDisplayName(n)) map.set(m.userId, n);
    }
    return map;
  }, [mentionMembers]);

  /** Map userId → email handle, used as a friendlier fallback than the literal "Member". */
  const teamEmailLocalByUserId = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of mentionMembers) {
      const local = (m.email || '').split('@')[0]?.trim();
      if (m.userId && local) map.set(m.userId, local);
    }
    return map;
  }, [mentionMembers]);

  const displayNameForChatUser = useCallback(
    (uid: string, stored: string) => {
      const fromTeam = teamDisplayNameByUserId.get(uid);
      if (fromTeam) return fromTeam;
      const s = (stored || '').trim();
      if (s && !isGenericMemberDisplayName(s)) return s;
      const peer = presenceByUserId?.get(uid);
      const pn = (peer?.displayName || '').trim();
      if (pn && !isGenericMemberDisplayName(pn)) return pn;
      if (user?.userId === uid) {
        const self = (user.displayName || user.email?.split('@')[0] || '').trim();
        if (self && !isGenericMemberDisplayName(self)) return self;
      }
      const fromEmail = teamEmailLocalByUserId.get(uid);
      return resolveMemberDisplayName(uid, fromEmail, s, pn);
    },
    [teamDisplayNameByUserId, teamEmailLocalByUserId, presenceByUserId, user],
  );

  /** Members currently in realtime presence for this project (excludes explicit offline). */
  const chatOnlinePeers = useMemo(() => {
    if (!presenceByUserId?.size) return [];
    const list: PresencePeer[] = [];
    for (const m of dedupedMembers) {
      if (!m.userId) continue;
      const p = presenceByUserId.get(m.userId);
      if (!p || p.availability === 'offline') continue;
      list.push(p);
    }
    return list.sort((a, b) =>
      a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }),
    );
  }, [dedupedMembers, presenceByUserId]);

  const [chatMessages, setChatMessages] = useState<ProjectChatMessage[]>([]);
  const [reactionRows, setReactionRows] = useState<ProjectChatReaction[]>([]);
  const [chatLoading, setChatLoading] = useState(true);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [chatPendingFiles, setChatPendingFiles] = useState<File[]>([]);
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const [reactionMenuForId, setReactionMenuForId] = useState<string | null>(null);
  /** Clicking a teammate opens their chat in the app-wide bottom chat dock
   *  (Teams style): it minimises to a bar instead of vanishing and stays
   *  open across pages. */
  const { openChat } = useChatDock();
  // One-to-one chats sit to the left of the open window, or of the Chat bar.
  useChatDockInset(open ? DOCK_INSET_OPEN : DOCK_INSET_BAR);

  const openDirectMessage = useCallback(
    (m: { userId?: string; displayName?: string; email?: string; photoURL?: string }) => {
      if (!user?.userId) return;
      if (!m.userId || m.userId === user.userId) return;
      openChat({
        userId: m.userId,
        displayName: resolveMemberDisplayName(
          m.userId,
          m.email,
          m.displayName,
        ),
        email: m.email,
        photoURL: m.photoURL,
        organizationId: project.organizationId ?? null,
      });
    },
    [user?.userId, openChat, project.organizationId],
  );
  /** Goes true once we discover the reactions table doesn't exist on this deployment so we
   *  can stop showing the smiley trigger and stop emitting fresh error toasts every click. */
  const [reactionsUnavailable, setReactionsUnavailable] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  /** When true, new messages keep the viewport pinned to the bottom */
  const stickToBottomRef = useRef(true);
  const chatSoundStateRef = useRef<{
    initialized: boolean;
    latestMessageId: string | null;
  }>({ initialized: false, latestMessageId: null });

  /** Persist a per-project "last seen" timestamp so the Chat bar can show an unread count. */
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

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(lastSeenStorageKey);
      setLastSeenAt(raw ? Number(raw) || 0 : 0);
    } catch {
      setLastSeenAt(0);
    }
  }, [lastSeenStorageKey]);

  const unreadCount = useMemo(() => {
    if (open) return 0;
    if (!user) return 0;
    return chatMessages.reduce((acc, m) => {
      if (m.userId === user.userId) return acc;
      return new Date(m.createdAt).getTime() > lastSeenAt ? acc + 1 : acc;
    }, 0);
  }, [chatMessages, lastSeenAt, open, user]);

  const chatRows = useMemo(
    () =>
      chatMessages.map((msg, index) => {
        const createdAt = new Date(msg.createdAt);
        const previous = chatMessages[index - 1];
        const showDay =
          !previous || !isSameDay(new Date(previous.createdAt), createdAt);
        // Same person within 5 minutes → one run (no repeated avatar/name).
        const grouped =
          !showDay &&
          previous?.userId === msg.userId &&
          createdAt.getTime() - new Date(previous.createdAt).getTime() < 5 * 60_000;
        return { msg, createdAt, showDay, grouped };
      }),
    [chatMessages],
  );

  /** messageId → emoji → user ids who reacted */
  const reactionsByMessageId = useMemo(() => groupReactions(reactionRows), [reactionRows]);


  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = gap < 80;
  }, []);

  // Shared, gesture-unlocked audio (see notificationSound) — a fresh
  // AudioContext per message was often muted by the browser.
  const playChatSound = useCallback(() => playChatChime(), []);

  useEffect(() => {
    setChatLoading(true);
    const unsubChat = subscribeToProjectChat(project.projectId, (list) => {
      setChatMessages(list);
      setChatLoading(false);
    });
    const unsubReactions = subscribeToProjectChatReactions(
      project.projectId,
      setReactionRows,
      () => setReactionsUnavailable(true),
    );
    return () => {
      unsubChat();
      unsubReactions();
    };
  }, [project.projectId]);

  /** When the chat opens — or new messages arrive while open — bump the last-seen marker
   *  and clear any unread `project_chat_message` notifications for this project so the
   *  bell doesn't keep showing chats the user has already read. */
  useEffect(() => {
    if (!open) return;
    const now = Date.now();
    setLastSeenAt(now);
    try {
      window.localStorage.setItem(lastSeenStorageKey, String(now));
    } catch {
      /* ignore */
    }
    if (user?.userId && project.projectId) {
      void markNotificationsReadByProject(
        user.userId,
        project.projectId,
        'project_chat_message',
      )
        .then(() => dispatchNotificationsRefresh())
        .catch((e) => {
          // Silent — failing to clear chat notifications is a soft error; the badge
          // will simply stay until the user opens the inbox or clicks the row.
          console.warn('Failed to clear chat notifications:', e);
        });
    }
  }, [open, chatMessages.length, lastSeenStorageKey, user?.userId, project.projectId]);

  /** Pin viewport to bottom when new content arrives (unless user scrolled up to read). */
  useLayoutEffect(() => {
    const el = chatScrollRef.current;
    if (!el || chatLoading) return;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [chatMessages, reactionRows, chatLoading]);

  /** Opening the rail should land on the latest messages */
  useLayoutEffect(() => {
    if (!open) return;
    stickToBottomRef.current = true;
    const el = chatScrollRef.current;
    if (el && !chatLoading) {
      el.scrollTop = el.scrollHeight;
    }
  }, [open, chatLoading]);

  useEffect(() => {
    if (chatLoading) return;
    const latest = chatMessages[chatMessages.length - 1] ?? null;
    const latestMessageId = latest?.messageId ?? null;
    const state = chatSoundStateRef.current;

    if (!state.initialized) {
      chatSoundStateRef.current = { initialized: true, latestMessageId };
      return;
    }

    if (
      latest &&
      latestMessageId &&
      latestMessageId !== state.latestMessageId &&
      latest.userId !== user?.userId
    ) {
      playChatSound();
    }

    chatSoundStateRef.current = { initialized: true, latestMessageId };
  }, [chatLoading, chatMessages, playChatSound, user?.userId]);

  const handleToggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!user || isViewerOrg) return;
      try {
        await toggleProjectChatReaction({
          messageId,
          userId: user.userId,
          emoji,
        });
      } catch (e) {
        const raw = e instanceof Error ? e.message : '';
        const code = (e as { code?: string } | null)?.code ?? '';
        const lower = `${raw} ${code}`.toLowerCase();
        // Translate the common, actionable failure modes into messages the user can fix
        // instead of a raw Postgres error.
        if (
          lower.includes('does not exist') ||
          lower.includes('relation') ||
          code === '42p01' ||
          code === 'pgrst205' // PostgREST: table not found in schema cache
        ) {
          setReactionsUnavailable(true);
          toast.error(
            'Reactions aren’t enabled on this workspace yet. Apply migration 031_project_chat_message_reactions.sql in Supabase.',
          );
          return;
        }
        if (
          lower.includes('row-level security') ||
          lower.includes('permission denied') ||
          code === '42501'
        ) {
          toast.error(
            'You need to be a project member to react. Ask the project owner to add you, then try again.',
          );
          return;
        }
        toast.error(raw || 'Could not update reaction');
      }
    },
    [user, isViewerOrg],
  );

  const handleSendChat = useCallback(async () => {
    const body = chatInput.trim();
    if ((!body && chatPendingFiles.length === 0) || !user) return;
    if (isViewerOrg) {
      toast.error('Viewers have read-only access — cannot post.');
      return;
    }
    stickToBottomRef.current = true;
    setChatSending(true);
    try {
      const senderLabel = displayNameForChatUser(
        user.userId,
        user.displayName || user.email || 'User',
      );
      const attachments: ChatAttachment[] = [];
      const uploadedPaths: string[] = [];
      if (chatPendingFiles.length > 0) {
        const settled = await Promise.allSettled(
          chatPendingFiles.map((f) =>
            uploadChatAttachment(f, {
              kind: 'project',
              projectId: project.projectId,
            }),
          ),
        );
        const failedNames: string[] = [];
        settled.forEach((r, i) => {
          const name = chatPendingFiles[i]?.name ?? `file ${i + 1}`;
          if (r.status === 'fulfilled') {
            const u = r.value;
            uploadedPaths.push(u.storagePath);
            attachments.push({
              fileName: u.fileName,
              fileUrl: u.fileUrl,
              fileType: u.fileType,
              fileSize: u.fileSize,
            });
          } else {
            failedNames.push(name);
          }
        });
        if (failedNames.length > 0) {
          const sample = failedNames.slice(0, 3).join(', ');
          toast.warning(
            `${failedNames.length} attachment(s) failed to upload: ${sample}${failedNames.length > 3 ? '…' : ''}`,
          );
        }
        if (!body && attachments.length === 0) {
          if (chatPendingFiles.length > 0) {
            toast.error(
              failedNames.length === chatPendingFiles.length
                ? 'All uploads failed. Message not sent.'
                : 'Nothing to send.',
            );
          }
          return;
        }
      }
      try {
        await insertProjectChatMessage({
          projectId: project.projectId,
          organizationId: project.organizationId,
          userId: user.userId,
          displayName: senderLabel,
          photoURL: user.photoURL || undefined,
          body,
          taskId: null,
          attachments,
        });
      } catch (insertErr) {
        await Promise.allSettled(
          uploadedPaths.map((p) =>
            deleteFile(ATTACHMENTS_BUCKET, p).catch(() => undefined),
          ),
        );
        throw insertErr;
      }
      const mentionedIds = await notifyProjectChatMentions({
        text: body,
        members: mentionMembers,
        actorUserId: user.userId,
        actorDisplayName: senderLabel,
        projectId: project.projectId,
        projectName: project.name,
      });
      const memberIds = Array.from(
        new Set(
          [project.ownerId, ...dedupedMembers.map((m) => m.userId)]
            .filter((id): id is string => Boolean(id)),
        ),
      );
      void notifyProjectChatMessageToMembers({
        projectId: project.projectId,
        projectName: project.name,
        actorUserId: user.userId,
        actorDisplayName: senderLabel,
        body,
        memberUserIds: memberIds,
        skipUserIds: [user.userId, ...mentionedIds],
      });
      setChatInput('');
      setChatPendingFiles([]);
      if (chatFileInputRef.current) chatFileInputRef.current.value = '';
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send message');
    } finally {
      setChatSending(false);
    }
  }, [
    chatInput,
    chatPendingFiles,
    isViewerOrg,
    user,
    project.projectId,
    project.organizationId,
    project.ownerId,
    project.name,
    mentionMembers,
    dedupedMembers,
    displayNameForChatUser,
  ]);

  const onPickChatFiles = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const filtered = files.filter((f) => {
      if (f.size > 500 * 1024 * 1024) {
        toast.error(`${f.name} is larger than 500 MB`);
        return false;
      }
      return true;
    });
    setChatPendingFiles((prev) => [...prev, ...filtered].slice(0, 5));
    if (e.target) e.target.value = '';
  }, []);

  const removeChatPending = useCallback(
    (idx: number) =>
      setChatPendingFiles((prev) => prev.filter((_, i) => i !== idx)),
    [],
  );

  /** Per-person call buttons follow the same rule as the project call buttons. */
  const canShowCalls = isMediaSupported() && callState.status === 'idle';

  const membersSection = (
    <section className="flex min-h-full flex-col p-2">
      <div className="flex min-h-8 items-center justify-between gap-2 px-2">
        <h3 className="text-xs font-medium text-muted-foreground">
          Members ({dedupedMembers.length})
        </h3>
        {onInviteClick && (
          <Button variant="ghost" size="sm" onClick={onInviteClick}>
            <UserPlus />
            Invite
          </Button>
        )}
      </div>
      <div className="flex flex-col">
        {dedupedMembers.length === 0 && (
          <p className="px-2 py-2 text-sm text-muted-foreground">No members yet</p>
        )}
        {dedupedMembers.map((m) => {
          const profile = m.userId ? projectProfilesByUserId.get(m.userId) : undefined;
          const memberLabel = m.userId
            ? displayNameForChatUser(m.userId, m.displayName)
            : resolveMemberDisplayName('', m.email, m.displayName);
          const memberEmail = profile?.email || m.email;
          const memberPhotoURL = profile?.photoURL || m.photoURL;
          const isSelf = !!user?.userId && m.userId === user.userId;
          return (
            <ProjectTeamMemberRow
              key={m.userId || m.email}
              member={{
                userId: m.userId || undefined,
                displayName: memberLabel,
                email: m.email,
                photoURL: memberPhotoURL,
              }}
              roleLabel={ROLE_LABELS[m.role] || ROLE_LABELS.member}
              isSelf={isSelf}
              peer={m.userId ? presenceByUserId?.get(m.userId) : undefined}
              lastSeenAt={m.userId ? lastSeenByUserId.get(m.userId) ?? null : null}
              callsDisabled={isViewerOrg}
              onMessage={() =>
                openDirectMessage({
                  ...m,
                  displayName: memberLabel,
                  email: memberEmail,
                  photoURL: memberPhotoURL,
                })
              }
            />
          );
        })}
      </div>
      {canShowCalls && hasOtherMemberToCall && (
        <p className="mx-2 mb-1 mt-auto border-t border-border pt-3 text-xs leading-[18px] text-muted-foreground">
          Calling from a person&apos;s row rings only that person. The call buttons at the top
          ring everyone in the project.
        </p>
      )}
    </section>
  );

  const activitySection = (
    <section className="p-3">
      <h3 className="mb-3 text-xs font-medium text-muted-foreground">Activity</h3>
      <div className="space-y-4">
        {projectEvents.length === 0 && (
          <p className="py-2 text-sm text-muted-foreground">No recent activity</p>
        )}
        {projectEvents.map((e) => {
          const Icon = ACTIVITY_ICONS[e.type] || ActivityIcon;
          return (
            <div key={e.activityId} className="flex gap-2">
              <Avatar className="h-7 w-7 shrink-0">
                <AvatarImage src={e.photoURL} alt={e.displayName} />
                <AvatarFallback className="bg-primary-soft text-xs font-semibold text-primary-soft-foreground">
                  {(e.displayName || '?').charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-5">
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
                <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <Icon className="h-3 w-3" />
                  {formatDistanceToNow(new Date(e.createdAt), { addSuffix: true })}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );

  const viewOnlyTitle = 'View-only — calls are disabled for your role.';
  const projectCallTitle = isViewerOrg
    ? viewOnlyTitle
    : hasOtherMemberToCall
      ? 'Rings everyone in this project — to call one person, open their chat from the Team tab'
      : 'No other members to call — invite someone to this project first.';

  const railWidth = 'w-[calc(100vw-1.5rem)] sm:w-[min(23.5rem,calc(100vw-2.5rem))]';

  // Closed: a small bar on the bottom edge of the page, the same shape as a
  // minimised one-to-one chat. It replaces the round button that used to
  // float over the board.
  if (!open) {
    const barLabel = unreadCount > 0
      ? `Open project chat, ${unreadCount} unread`
      : 'Open project chat';
    return (
      <div
        // z-40 sits above the page but below dialogs and popovers (z-50).
        className="pointer-events-none fixed bottom-0 right-3 z-40 sm:right-4"
      >
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          aria-label={barLabel}
          title={`${project.name} · ${dedupedMembers.length} members`}
          className={cn(
            'pointer-events-auto inline-flex h-10 items-center gap-2 rounded-t-lg border border-b-0 border-border bg-card px-3',
            'text-sm font-medium text-foreground transition-colors hover:bg-secondary',
            'shadow-[0_-4px_16px_rgba(0,0,0,0.08)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          )}
        >
          <MessageSquare className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span>Chat</span>
          {unreadCount > 0 && (
            <span
              aria-hidden
              className="min-w-[18px] rounded-full bg-destructive px-[5px] text-center text-xs font-semibold leading-[18px] text-destructive-foreground tabular-nums"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-x-3 bottom-4 z-40 flex flex-col items-end pointer-events-none sm:inset-x-auto sm:right-5"
      role="complementary"
      aria-label="Project chat"
    >
      <aside
        className={cn(
          'pointer-events-auto flex flex-col overflow-hidden rounded-xl border border-border bg-card',
          'shadow-[0_12px_32px_rgba(0,0,0,0.10)]',
          'animate-in fade-in slide-in-from-bottom-3 duration-200 motion-reduce:animate-none',
          railWidth,
          'h-[min(36rem,calc(100svh-2rem))] max-h-[calc(100vh-2rem)]',
        )}
      >
        <div className="flex min-h-14 shrink-0 items-center gap-2.5 border-b border-border pl-3 pr-2">
          <div
            aria-hidden
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white"
            style={{ background: project.coverColor || 'hsl(var(--primary))' }}
          >
            {(project.name || '#').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-[18px] text-foreground">
              {project.name}
            </p>
            <p className="flex items-center gap-1.5 truncate text-xs leading-4 text-muted-foreground">
              <span>{dedupedMembers.length} members</span>
              {chatOnlinePeers.length > 0 && (
                <>
                  <span aria-hidden>·</span>
                  <span className="inline-flex items-center gap-1 text-success-soft-foreground">
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success" />
                    {chatOnlinePeers.length} online
                  </span>
                </>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center">
            {canShowCalls && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground"
                  aria-label="Voice call everyone in this project"
                  disabled={!hasOtherMemberToCall || isViewerOrg}
                  aria-disabled={!hasOtherMemberToCall || isViewerOrg}
                  title={projectCallTitle}
                  onClick={() => {
                    if (isViewerOrg || !hasOtherMemberToCall) return;
                    // "Ring all" — fan out the offer to every other project
                    // member so any of them can pick up. Without this, we'd
                    // only ring the first user in the list (alphabetical
                    // accident, not intent).
                    const targets = buildProjectCallTargets(
                      dedupedMembers,
                      project.ownerId,
                      user?.userId,
                      displayNameForChatUser,
                    );
                    if (targets.length === 0) return;
                    void callActions.startCall(
                      { type: 'project', targetId: project.projectId, label: project.name },
                      'audio',
                      targets,
                    );
                  }}
                >
                  <Phone />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground"
                  aria-label="Video call everyone in this project"
                  disabled={!hasOtherMemberToCall || isViewerOrg}
                  aria-disabled={!hasOtherMemberToCall || isViewerOrg}
                  title={projectCallTitle}
                  onClick={() => {
                    if (isViewerOrg || !hasOtherMemberToCall) return;
                    // Ring every other project member — see audio-call note
                    // above for why we don't pick a single "first" member.
                    const targets = buildProjectCallTargets(
                      dedupedMembers,
                      project.ownerId,
                      user?.userId,
                      displayNameForChatUser,
                    );
                    if (targets.length === 0) return;
                    void callActions.startCall(
                      { type: 'project', targetId: project.projectId, label: project.name },
                      'video',
                      targets,
                    );
                  }}
                >
                  <Video />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground"
                  aria-label="Start meeting"
                  disabled={isViewerOrg}
                  aria-disabled={isViewerOrg}
                  title={
                    isViewerOrg
                      ? viewOnlyTitle
                      : 'Start meeting — join the room now and invite guests with a link'
                  }
                  onClick={() => {
                    if (isViewerOrg) return;
                    // Open the project room without ringing anyone — works
                    // even when there are no other members to call.
                    void callActions.startMeeting(
                      { type: 'project', targetId: project.projectId, label: project.name },
                      'video',
                    );
                  }}
                >
                  <CalendarPlus />
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground"
              onClick={() => onOpenChange(false)}
              aria-label="Minimize project chat"
              title="Minimize"
            >
              <Minus />
            </Button>
          </div>
        </div>

      <Tabs defaultValue="chat" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="grid w-full shrink-0 grid-cols-3 gap-0">
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="members">Team</TabsTrigger>
          <TabsTrigger value="activity">Feed</TabsTrigger>
        </TabsList>

        <TabsContent
          value="chat"
          className="flex-1 flex flex-col min-h-0 mt-0 px-0 data-[state=inactive]:hidden overflow-hidden"
        >
          <div
            ref={chatScrollRef}
            onScroll={handleChatScroll}
            className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 pb-3 pt-1 scroll-smooth"
          >
            {chatLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : chatMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
                <MessageSquare className="mb-2 h-5 w-5 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">No project messages yet</p>
                <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                  Start a conversation, share blockers, or use @name to notify a teammate.
                </p>
              </div>
            ) : (
              <div className="pb-1">
                {chatRows.map(({ msg, createdAt, showDay, grouped }) => {
                  const mine = msg.userId === user?.userId;
                  const authorLabel = mine
                    ? 'You'
                    : displayNameForChatUser(msg.userId, msg.displayName);
                  const reactionsForMsg = reactionsByMessageId[msg.messageId];
                  const callPayload = parseCallRecordingBody(msg.body);
                  const canReact = !reactionsUnavailable && !isViewerOrg;
                  return (
                    <div key={msg.messageId}>
                      {showDay && (
                        <div className="flex items-center gap-3 pb-1 pt-3" role="separator">
                          <span aria-hidden className="h-px flex-1 bg-border" />
                          <span className="text-xs font-medium text-muted-foreground">
                            {messageDayLabel(createdAt)}
                          </span>
                          <span aria-hidden className="h-px flex-1 bg-border" />
                        </div>
                      )}
                      <ChatMessageRow
                        mine={mine}
                        grouped={grouped}
                        authorLabel={authorLabel}
                        photoURL={msg.photoURL}
                        createdAt={createdAt}
                        presence={
                          <PresenceStatusInline
                            peer={presenceByUserId?.get(msg.userId)}
                            lastSeenAt={lastSeenByUserId.get(msg.userId) ?? null}
                            className="gap-1"
                          />
                        }
                        actions={
                          canReact ? (
                            <ReactionButton
                              mine={mine}
                              open={reactionMenuForId === msg.messageId}
                              onOpenChange={(next) => setReactionMenuForId(next ? msg.messageId : null)}
                              onPick={(emoji) => void handleToggleReaction(msg.messageId, emoji)}
                              disabled={!user || isViewerOrg}
                            />
                          ) : undefined
                        }
                        content={
                          callPayload ? (
                            <CallRecordingCard payload={callPayload} />
                          ) : msg.body ? (
                            <ChatBubble text={msg.body} mine={mine} grouped={grouped} />
                          ) : null
                        }
                        footer={
                          <>
                            <ChatAttachmentList attachments={msg.attachments} mine={mine} />
                            <ReactionChips
                              reactions={reactionsForMsg}
                              selfId={user?.userId}
                              mine={mine}
                              onToggle={
                                isViewerOrg
                                  ? undefined
                                  : (emoji) => void handleToggleReaction(msg.messageId, emoji)
                              }
                            />
                          </>
                        }
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="shrink-0 px-2.5 pb-2.5 pt-1">
            {chatPendingFiles.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {chatPendingFiles.map((f, idx) => (
                  <span
                    key={`${f.name}-${idx}`}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs"
                  >
                    <Paperclip className="h-3 w-3" />
                    <span className="max-w-[10rem] truncate">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => removeChatPending(idx)}
                      aria-label={`Remove ${f.name}`}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <XIcon className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {isViewerOrg ? (
              <div className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                You have view-only access to this workspace.
              </div>
            ) : (
            <div className="flex items-end gap-0.5 rounded-[20px] border border-input p-1 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25">
              <input
                ref={chatFileInputRef}
                type="file"
                multiple
                hidden
                onChange={onPickChatFiles}
              />
              <EmojiPickerButton
                value={chatInput}
                onChange={setChatInput}
                disabled={!user || chatSending}
                className="rounded-full"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 rounded-full text-muted-foreground"
                onClick={() => chatFileInputRef.current?.click()}
                disabled={!user || chatSending}
                aria-label="Attach file"
                title="Attach file"
              >
                <Paperclip />
              </Button>
              <div className="min-w-0 flex-1 self-center">
                <MentionTextarea
                  value={chatInput}
                  onChange={setChatInput}
                  members={mentionMembers}
                  excludeUserId={user?.userId}
                  placeholder="Message the team…"
                  title="Type @ to mention someone"
                  rows={1}
                  className="max-h-32 min-h-8 resize-none rounded-md border-0 bg-transparent px-1.5 py-1.5 leading-5 shadow-none [field-sizing:content] focus-visible:ring-0 focus-visible:ring-offset-0"
                  disabled={!user || chatSending}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSendChat();
                    }
                  }}
                />
              </div>
              <Button
                type="button"
                size="icon"
                className="shrink-0 rounded-full"
                disabled={
                  !user || chatSending ||
                  (!chatInput.trim() && chatPendingFiles.length === 0)
                }
                onClick={() => void handleSendChat()}
                aria-label="Send message"
                title="Send (Enter) · Shift+Enter for a new line"
              >
                {chatSending ? <Loader2 className="animate-spin" /> : <Send />}
              </Button>
            </div>
            )}
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
