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
  Users,
  ChevronUp,
  Minus,
  Smile,
  Phone,
  Video,
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DirectMessageDock, type DirectMessageRecipient } from '@/components/messaging/DirectMessageDock';
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
import { deleteFile, uploadChatAttachment } from '@/services/supabase/storage';
import { ChatAttachmentList } from '@/components/messaging/ChatAttachmentList';
import { dispatchNotificationsRefresh } from '@/lib/notificationEvents';
import { toast } from 'sonner';
import type { PresencePeer } from '@/hooks/usePresence';
import { PresenceAvatars } from '@/components/presence/PresenceAvatars';
import { PresenceStatusInline } from '@/components/presence/PresenceStatusInline';

interface ProjectRightRailProps {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInviteClick?: () => void;
  /** Realtime project presence by userId (from the same channel as the header). */
  presenceByUserId?: Map<string, PresencePeer>;
}

/** WhatsApp-style quick reactions on project chat bubbles */
const CHAT_QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

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

/** Invite / legacy project JSON sometimes stores role words or "Member" instead of a person's name. */
const GENERIC_MEMBER_DISPLAY = new Set(['', 'owner', 'member', 'user', 'unknown']);
function isGenericMemberDisplayName(name: string): boolean {
  return GENERIC_MEMBER_DISPLAY.has(name.trim().toLowerCase());
}

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

const CallRecordingCard: React.FC<{
  payload: CallRecordingChatPayload;
  mine: boolean;
}> = ({ payload, mine }) => {
  const [showTranscript, setShowTranscript] = React.useState(false);
  const duration = formatCallDuration(payload.durationSec);
  return (
    <div
      className={cn(
        'rounded-lg p-3 text-[13px] leading-relaxed border min-w-[240px] max-w-[340px]',
        mine
          ? 'rounded-br-sm bg-primary/10 border-primary/30 text-foreground'
          : 'rounded-bl-sm bg-muted text-foreground border-border/60',
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-red-500/15 text-red-500">
          <Mic className="w-3.5 h-3.5" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-foreground">Recorded call</p>
          {duration && (
            <p className="text-[11px] text-muted-foreground">Duration {duration}</p>
          )}
        </div>
      </div>
      <audio
        controls
        src={payload.url}
        className="w-full h-9"
        preload="none"
      />
      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        <a
          href={payload.url}
          download={payload.fileName || 'call.webm'}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          title="Download audio"
        >
          <Download className="w-3 h-3" />
          Audio
        </a>
        {payload.transcript && payload.transcript.trim() && (
          <button
            type="button"
            onClick={() => setShowTranscript((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            title={showTranscript ? 'Hide transcript' : 'Show transcript'}
          >
            <FileText className="w-3 h-3" />
            {showTranscript ? 'Hide transcript' : 'Show transcript'}
          </button>
        )}
      </div>
      {showTranscript && payload.transcript && (
        <p className="mt-2 max-h-40 overflow-y-auto rounded-md bg-background/60 border border-border/60 px-2 py-1.5 text-[12px] whitespace-pre-wrap text-foreground/90">
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
      ),
    [dedupedMembers, user?.userId],
  );

  /** @-mentions: project team only (not whole org — avoids stale or unrelated users). */
  const mentionMembers = useMemo(() => {
    const orgById = new Map(
      (organization?.members ?? [])
        .filter((m) => m.userId)
        .map((m) => [m.userId as string, m] as const),
    );
    return dedupedMembers.map((m) => {
      const org = m.userId ? orgById.get(m.userId) : undefined;
      const email = m.email || org?.email || '';
      const emailLocal = email.split('@')[0] || '';
      const peer = m.userId ? presenceByUserId?.get(m.userId) : undefined;
      const selfForRow =
        m.userId && user?.userId === m.userId
          ? (user.displayName?.trim() || user.email?.split('@')[0] || '')
          : '';
      const stored = (m.displayName || '').trim();

      const candidates = [
        !isGenericMemberDisplayName(stored) ? stored : '',
        (org?.displayName || '').trim(),
        (peer?.displayName || '').trim(),
        selfForRow,
        emailLocal,
      ];
      const displayName =
        candidates.find((c) => c && !isGenericMemberDisplayName(c)) || emailLocal || 'Member';

      return {
        userId: m.userId,
        displayName,
        email,
        photoURL: m.photoURL ?? (org as { photoURL?: string } | undefined)?.photoURL,
      };
    });
  }, [
    dedupedMembers,
    organization?.members,
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
      if (fromEmail) return fromEmail;
      return 'Member';
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
  /** When a teammate's row in the Team tab is clicked, this recipient drives the
   *  bottom-left DirectMessageDock. Null = no DM open. */
  const [dmRecipient, setDmRecipient] = useState<DirectMessageRecipient | null>(null);

  const openDirectMessage = useCallback(
    (m: { userId?: string; displayName?: string; email?: string; photoURL?: string }) => {
      if (!user?.userId) return;
      if (!m.userId || m.userId === user.userId) return;
      setDmRecipient({
        userId: m.userId,
        displayName: m.displayName || m.email || 'Member',
        email: m.email,
        photoURL: m.photoURL,
      });
    },
    [user?.userId],
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
        displayName: displayNameForChatUser(m.userId, m.displayName),
        photoURL: m.photoURL,
      });
    }
    return result;
  }, [chatMessages, user, displayNameForChatUser]);

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

  /** messageId → emoji → user ids who reacted */
  const reactionsByMessageId = useMemo(() => {
    const out: Record<string, Record<string, string[]>> = {};
    for (const r of reactionRows) {
      if (!out[r.messageId]) out[r.messageId] = {};
      const bucket = out[r.messageId][r.emoji];
      if (bucket) bucket.push(r.userId);
      else out[r.messageId][r.emoji] = [r.userId];
    }
    return out;
  }, [reactionRows]);

  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = gap < 80;
  }, []);

  const playChatSound = useCallback(() => {
    try {
      const AudioContextCtor =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioContextCtor) return;
      const ctx = new AudioContextCtor();
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.6, ctx.currentTime);
      master.connect(ctx.destination);

      // Microsoft Teams-style two-note chime: short higher note → fuller lower note,
      // with a subtle overtone for bell-like timbre.
      const playNote = (
        startOffset: number,
        freq: number,
        duration: number,
        peak: number,
      ) => {
        const start = ctx.currentTime + startOffset;
        const stop = start + duration;

        const osc = ctx.createOscillator();
        const overtone = ctx.createOscillator();
        const noteGain = ctx.createGain();

        osc.type = 'sine';
        overtone.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);
        // Octave + fifth-ish overtone, quieter, gives the chime its "ting".
        overtone.frequency.setValueAtTime(freq * 2.01, start);

        noteGain.gain.setValueAtTime(0.0001, start);
        noteGain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
        noteGain.gain.exponentialRampToValueAtTime(0.0001, stop);

        const overtoneGain = ctx.createGain();
        overtoneGain.gain.setValueAtTime(0.0001, start);
        overtoneGain.gain.exponentialRampToValueAtTime(peak * 0.35, start + 0.03);
        overtoneGain.gain.exponentialRampToValueAtTime(0.0001, stop);

        osc.connect(noteGain);
        overtone.connect(overtoneGain);
        noteGain.connect(master);
        overtoneGain.connect(master);

        osc.start(start);
        overtone.start(start);
        osc.stop(stop + 0.02);
        overtone.stop(stop + 0.02);
      };

      // Note 1: bright, short (~A5, 880Hz)
      playNote(0, 880, 0.18, 0.18);
      // Note 2: warmer, longer, slightly overlapping (~D5, 587Hz)
      playNote(0.11, 587.33, 0.42, 0.22);

      window.setTimeout(() => void ctx.close().catch(() => {}), 800);
    } catch {
      /* Browsers can block audio until the user has interacted with the page. */
    }
  }, []);

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

  /** When the dock opens — or new messages arrive while open — bump the last-seen marker
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
      let attachments: ChatAttachment[] = [];
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
            deleteFile('attachments', p).catch(() => undefined),
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
      if (f.size > 25 * 1024 * 1024) {
        toast.error(`${f.name} is larger than 25 MB`);
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
          const memberLabel = m.userId
            ? displayNameForChatUser(m.userId, m.displayName)
            : (m.displayName || m.email || 'Member');
          const isSelf = !!user?.userId && m.userId === user.userId;
          const canDm = !!m.userId && !isSelf;
          return (
            <button
              type="button"
              key={m.userId || m.email}
              onClick={canDm ? () => openDirectMessage({ ...m, displayName: memberLabel }) : undefined}
              disabled={!canDm}
              title={canDm ? `Message ${memberLabel}` : undefined}
              className={cn(
                'flex w-full items-center gap-2 p-1.5 rounded-lg text-left',
                canDm
                  ? 'hover:bg-secondary cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  : 'cursor-default',
              )}
            >
              <Avatar className="w-9 h-9">
                <AvatarImage src={m.photoURL} alt={memberLabel} />
                <AvatarFallback className="bg-primary-soft text-primary-soft-foreground text-xs">
                  {memberLabel.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-foreground truncate">
                    {memberLabel}
                    {isSelf && (
                      <span className="ml-1 text-[10px] text-muted-foreground font-normal">
                        (you)
                      </span>
                    )}
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
            </button>
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

  if (!open) {
    return (
      <div
        // Mobile: anchor to the bottom-right corner only — full-width pill
        // would obscure the underlying kanban / task cards. Desktop keeps
        // the wider card.
        // z-40 sits ABOVE normal page content but BELOW any modal layer
        // (Dialog / AlertDialog / Popover / Select all use z-50). That way
        // opening a task or settings dialog cleanly covers the dock without
        // needing to bump the dialog z-index — which in turn would hide
        // popovers (Status / Priority / Assign / Date) inside the dialog.
        className="fixed bottom-4 right-3 z-40 flex flex-col items-end pointer-events-none sm:right-5"
        role="complementary"
        aria-label="Project messaging"
      >
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          aria-label="Open project messages and team"
          className={cn(
            'pointer-events-auto group relative inline-flex items-center justify-center backdrop-blur-xl',
            // Mobile: compact 3rem circular FAB — icon + unread badge only.
            'h-12 w-12 rounded-full border border-border/70 bg-card/95',
            'shadow-[0_12px_36px_rgba(0,0,0,0.32)] transition-all duration-150',
            'hover:-translate-y-0.5 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
            // Desktop (>= sm): full pill with project name, member count and
            // recent senders, just like before.
            'sm:h-auto sm:w-[min(23rem,calc(100vw-2.5rem))] sm:rounded-lg sm:gap-3 sm:pl-3 sm:pr-3 sm:min-h-[3.75rem] sm:justify-start sm:text-left sm:shadow-[0_16px_46px_rgba(0,0,0,0.24)]',
            'sm:flex',
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
          {/* Project name + member count: hidden on mobile FAB. */}
          <div className="hidden sm:block min-w-0 flex-1 py-2">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-[13px] font-semibold text-foreground leading-tight">
                {project.name}
              </p>
              {unreadCount > 0 && (
                <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-primary animate-pulse" />
              )}
            </div>
            <p className="truncate text-[11.5px] text-muted-foreground mt-0.5">
              {dedupedMembers.length} members
              {chatMessages.length > 0 ? ' · Open chat' : ' · Start the conversation'}
            </p>
          </div>
          {/* Recent senders: hidden on mobile FAB. */}
          {recentSenders.length > 0 ? (
            <div className="hidden sm:flex -space-x-1.5 shrink-0 mr-1">
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
            className="hidden sm:block h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5"
          />
        </button>
        <DirectMessageDock
          recipient={dmRecipient}
          organizationId={project.organizationId}
          onClose={() => setDmRecipient(null)}
        />
      </div>
    );
  }

  return (
    <div
      className="fixed inset-x-3 bottom-4 z-40 flex flex-col items-end pointer-events-none sm:inset-x-auto sm:right-5"
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
          <div className="flex items-center gap-1 shrink-0">
            {isMediaSupported() && callState.status === 'idle' && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full text-muted-foreground hover:text-emerald-600"
                  aria-label="Start audio call"
                  disabled={!hasOtherMemberToCall || isViewerOrg}
                  aria-disabled={!hasOtherMemberToCall || isViewerOrg}
                  title={
                    isViewerOrg
                      ? 'View-only — calls are disabled for your role.'
                      : hasOtherMemberToCall
                        ? undefined
                        : 'No other members to call — invite someone to this project first.'
                  }
                  onClick={() => {
                    if (isViewerOrg || !hasOtherMemberToCall) return;
                    const firstOther = dedupedMembers.find(
                      (m) => m.userId && m.userId !== user?.userId,
                    );
                    if (!firstOther?.userId) return;
                    void callActions.startCall(
                      { type: 'project', targetId: project.projectId, label: project.name },
                      'audio',
                      { userId: firstOther.userId, displayName: displayNameForChatUser(firstOther.userId, firstOther.displayName), photoURL: firstOther.photoURL },
                    );
                  }}
                >
                  <Phone className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full text-muted-foreground hover:text-primary"
                  aria-label="Start video call"
                  disabled={!hasOtherMemberToCall || isViewerOrg}
                  aria-disabled={!hasOtherMemberToCall || isViewerOrg}
                  title={
                    isViewerOrg
                      ? 'View-only — calls are disabled for your role.'
                      : hasOtherMemberToCall
                        ? undefined
                        : 'No other members to call — invite someone to this project first.'
                  }
                  onClick={() => {
                    if (isViewerOrg || !hasOtherMemberToCall) return;
                    const firstOther = dedupedMembers.find(
                      (m) => m.userId && m.userId !== user?.userId,
                    );
                    if (!firstOther?.userId) return;
                    void callActions.startCall(
                      { type: 'project', targetId: project.projectId, label: project.name },
                      'video',
                      { userId: firstOther.userId, displayName: displayNameForChatUser(firstOther.userId, firstOther.displayName), photoURL: firstOther.photoURL },
                    );
                  }}
                >
                  <Video className="h-4 w-4" />
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
              onClick={() => onOpenChange(false)}
              aria-label="Minimize project messages"
            >
              <Minus className="h-5 w-5" />
            </Button>
          </div>
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
          <div
            ref={chatScrollRef}
            onScroll={handleChatScroll}
            className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 pb-3 scroll-smooth"
          >
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
                  const authorLabel = mine
                    ? 'You'
                    : displayNameForChatUser(msg.userId, msg.displayName);
                  const reactionsForMsg = reactionsByMessageId[msg.messageId];
                  return (
                    <div key={msg.messageId}>
                      {showDay && (
                        <div className="sticky top-2 z-10 flex justify-center py-2">
                          <span className="rounded-full border border-border bg-card/95 px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur">
                            {messageDayLabel(createdAt)}
                          </span>
                        </div>
                      )}
                      <div className={cn('flex gap-2 group/msg', mine && 'justify-end')}>
                        {!mine && (
                          <Avatar className="w-7 h-7 shrink-0 mt-5">
                            <AvatarImage src={msg.photoURL} alt={authorLabel} />
                            <AvatarFallback className="text-[11px] bg-primary-soft text-primary-soft-foreground">
                              {(authorLabel || '?').charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        )}
                        <div className={cn('max-w-[78%] min-w-0', mine && 'flex flex-col items-end')}>
                          <div
                            className={cn(
                              'mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground flex-wrap',
                              mine && 'justify-end',
                            )}
                          >
                            <span className="font-medium text-foreground">{authorLabel}</span>
                            {!mine && (
                              <PresenceStatusInline
                                peer={presenceByUserId?.get(msg.userId)}
                                className="gap-1"
                              />
                            )}
                            <span>{format(createdAt, 'p')}</span>
                            <Popover
                              modal={false}
                              open={reactionMenuForId === msg.messageId}
                              onOpenChange={(next) =>
                                setReactionMenuForId(next ? msg.messageId : null)
                              }
                            >
                              <PopoverTrigger asChild>
                                <button
                                  type="button"
                                  hidden={reactionsUnavailable || isViewerOrg}
                                  className={cn(
                                    'rounded-md p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted/90',
                                    'opacity-70 group-hover/msg:opacity-100 focus:opacity-100 transition-opacity',
                                    (reactionsUnavailable || isViewerOrg) && 'hidden',
                                  )}
                                  aria-label="Add reaction"
                                  disabled={isViewerOrg}
                                >
                                  <Smile className="w-3.5 h-3.5" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent
                                side="top"
                                align={mine ? 'end' : 'start'}
                                sideOffset={6}
                                className="w-auto p-2 flex flex-wrap gap-0.5 max-w-[240px]"
                                onOpenAutoFocus={(e) => e.preventDefault()}
                              >
                                <div className="flex flex-wrap gap-0.5 justify-center">
                                  {CHAT_QUICK_REACTIONS.map((emoji) => (
                                    <button
                                      key={emoji}
                                      type="button"
                                      className="text-[22px] leading-none hover:bg-muted rounded-md p-1.5 min-w-[2.25rem]"
                                      onPointerDown={(e) => e.preventDefault()}
                                      onClick={() => {
                                        void handleToggleReaction(msg.messageId, emoji);
                                        setReactionMenuForId(null);
                                      }}
                                    >
                                      {emoji}
                                    </button>
                                  ))}
                                </div>
                                <div className="w-full border-t border-border pt-2 mt-1 flex justify-center">
                                  <EmojiPickerButton
                                    value=""
                                    onChange={() => {}}
                                    nested
                                    onPickEmoji={(emoji) => {
                                      void handleToggleReaction(msg.messageId, emoji);
                                      setReactionMenuForId(null);
                                    }}
                                    disabled={!user || isViewerOrg}
                                  />
                                </div>
                              </PopoverContent>
                            </Popover>
                          </div>
                          {(() => {
                            const callPayload = parseCallRecordingBody(msg.body);
                            if (callPayload) {
                              return (
                                <CallRecordingCard payload={callPayload} mine={mine} />
                              );
                            }
                            return msg.body ? (
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
                            ) : null;
                          })()}
                          <ChatAttachmentList attachments={msg.attachments} mine={mine} />
                          {reactionsForMsg && Object.keys(reactionsForMsg).length > 0 && (
                            <div
                              className={cn(
                                'flex flex-wrap gap-1 mt-1.5 max-w-full',
                                mine && 'justify-end',
                              )}
                            >
                              {Object.entries(reactionsForMsg).map(([emoji, userIds]) =>
                                isViewerOrg ? (
                                  <span
                                    key={emoji}
                                    className={cn(
                                      'inline-flex items-center gap-0.5 rounded-full border border-border/70 px-1.5 py-0.5 text-[11px]',
                                      'bg-background/90 shadow-sm cursor-default',
                                      userIds.includes(user?.userId ?? '') &&
                                        'border-primary/50 bg-primary/15',
                                    )}
                                    title={`${userIds.length} reaction${userIds.length === 1 ? '' : 's'}`}
                                  >
                                    <span className="leading-none">{emoji}</span>
                                    <span className="tabular-nums text-muted-foreground">
                                      {userIds.length}
                                    </span>
                                  </span>
                                ) : (
                                  <button
                                    key={emoji}
                                    type="button"
                                    className={cn(
                                      'inline-flex items-center gap-0.5 rounded-full border border-border/70 px-1.5 py-0.5 text-[11px]',
                                      'bg-background/90 hover:bg-muted/90 shadow-sm',
                                      userIds.includes(user?.userId ?? '') &&
                                        'border-primary/50 bg-primary/15',
                                    )}
                                    onClick={() => void handleToggleReaction(msg.messageId, emoji)}
                                    title={`${userIds.length} reaction${userIds.length === 1 ? '' : 's'}`}
                                  >
                                    <span className="leading-none">{emoji}</span>
                                    <span className="tabular-nums text-muted-foreground">
                                      {userIds.length}
                                    </span>
                                  </button>
                                ),
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="shrink-0 border-t border-border/70 bg-card/80 p-2.5 pt-2">
            {chatOnlinePeers.length > 0 ? (
              <div className="flex items-center gap-2 min-h-0 mb-2 px-0.5">
                <span className="text-[10px] font-medium text-muted-foreground shrink-0">
                  Online now
                </span>
                <div className="min-w-0 flex-1 flex justify-end overflow-hidden">
                  <PresenceAvatars
                    peers={chatOnlinePeers}
                    max={8}
                    size={24}
                    showLabels
                    className="max-w-full"
                  />
                </div>
              </div>
            ) : null}
            {chatPendingFiles.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {chatPendingFiles.map((f, idx) => (
                  <span
                    key={`${f.name}-${idx}`}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[11px]"
                  >
                    <Paperclip className="w-3 h-3" />
                    <span className="max-w-[10rem] truncate">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => removeChatPending(idx)}
                      aria-label={`Remove ${f.name}`}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <XIcon className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {isViewerOrg ? (
              <div className="rounded-lg border border-dashed border-border/60 bg-background/40 p-3 text-center text-[12px] text-muted-foreground">
                You have view-only access to this workspace.
              </div>
            ) : (
            <div className="rounded-lg border border-border/60 bg-background/90 p-1.5 transition-shadow focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/20">
              <MentionTextarea
                value={chatInput}
                onChange={setChatInput}
                members={mentionMembers}
                excludeUserId={user?.userId}
                placeholder="Write a message… (@ to mention someone)"
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
                <div className="flex items-center gap-1 min-w-0">
                  <EmojiPickerButton
                    value={chatInput}
                    onChange={setChatInput}
                    disabled={!user || chatSending}
                  />
                  <input
                    ref={chatFileInputRef}
                    type="file"
                    multiple
                    hidden
                    onChange={onPickChatFiles}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={() => chatFileInputRef.current?.click()}
                    disabled={!user || chatSending}
                    aria-label="Attach file"
                    title="Attach file"
                  >
                    <Paperclip className="w-3.5 h-3.5" />
                  </Button>
                  <p className="text-[10.5px] text-muted-foreground truncate">
                    Enter to send · Shift+Enter for newline
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 rounded-md px-3 text-xs"
                  disabled={
                    !user || chatSending ||
                    (!chatInput.trim() && chatPendingFiles.length === 0)
                  }
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
    <DirectMessageDock
      recipient={dmRecipient}
      organizationId={project.organizationId}
      onClose={() => setDmRecipient(null)}
    />
    </div>
  );
};

export default ProjectRightRail;
