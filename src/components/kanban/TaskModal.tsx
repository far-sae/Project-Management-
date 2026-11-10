import React, { useState, useEffect, useRef, useCallback, useMemo, useId } from 'react';
import {
  Task, TaskPriority, KanbanColumn, DEFAULT_COLUMNS, PRIORITY_COLORS,
  CreateTaskInput, TaskAssignee, Project, TaskComment,
} from '@/types';
import {
  Dialog, DialogClose, DialogContent, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Trash2, Loader2, Sparkles, Wand2, MessageSquare, ListTree, Paperclip, X, Check,
  Activity, Clock, Lock, MoreHorizontal, Bell, Mail, Link2, AlertTriangle, KeyRound,
  Video, FolderInput, ChevronRight, Plus, Receipt, ExternalLink,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { supabase } from '@/services/supabase';
import {
  isAIEnabled, expandDescription, refineDescription,
  suggestPriorityAndDueDate, generateTitle, AIError, SmartSuggestionResponse,
  summarizeCommentThread, type CommentSummary,
} from '@/services/ai';
import {
  hashLockPin,
  isTaskLockUnlockedInSession,
  setTaskLockUnlockedInSession,
  clearTaskLockUnlockedInSession,
} from '@/lib/taskLockPin';
import {
  addCommentWithGlobalSync,
  deleteComment,
  deleteCommentDraft,
  getCommentDraft,
  getTaskComments,
  markNotificationsReadByTask,
  notifyTaskCommentMentions,
  subscribeToComments,
  upsertCommentDraft,
  verifyTaskLockPin,
} from '@/services/supabase/database';
import { dispatchNotificationsRefresh } from '@/lib/notificationEvents';
import { useCall } from '@/hooks/useCall';
import { isMediaSupported } from '@/services/webrtc/mediaUtils';
import { markOnboardingAi } from '@/components/onboarding/OnboardingChecklist';
import { useTaskActivity } from '@/hooks/useActivity';
import { uploadCommentAttachment } from '@/services/supabase/storage';
import { SubtaskDecompositionModal } from './SubtaskDecompositionModal';
import { MoveTaskDialogWithProjects } from './MoveTaskDialog';
import { NotifyModal } from './NotifyModal';
import { DayPickerPopover } from './DayPickerPopover';
import { AssigneePicker } from './AssigneePicker';
import { EmojiPickerButton } from '@/components/ui/emoji-picker';
import { MentionTextarea } from '@/components/mentions/MentionTextarea';
import { cn, formatDistanceSafe, truncateFileName } from '@/lib/utils';
import AttachmentPreview from '../ui/AttachmentPreview';
import { TaskExpensesPanel } from '@/components/expenses/TaskExpensesPanel';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import type { PresencePeer } from '@/hooks/usePresence';
import { MeetingProperty } from './task-modal/MeetingProperty';
import {
  ActivityList, CommentSummaryCard, ListSkeleton, PresenceAvatars, PropertyRow, TypingIndicator, useNow,
} from './task-modal/parts';
import { DEFAULT_MEETING_DURATION, getJoinDisabledReason, toMeetingDate } from './task-modal/meeting';
import { FOCUS_RING, GHOST_FIELD, PRESS, SECTION_LABEL } from './task-modal/styles';

interface Subtask {
  id: string;
  title: string;
  completed: boolean;
}

interface TaskModalProps {
  open: boolean;
  onClose: () => void;
  task?: Task | null;
  projectId: string;
  projectName?: string;
  project?: Project | null;
  onSave: (input: CreateTaskInput | Partial<Task>) => Promise<void>;
  onDelete?: (taskId: string) => Promise<void>;
  onCreateSubtasks?: (subtasks: CreateTaskInput[]) => Promise<void>;
  initialStatus?: string;
  columns?: KanbanColumn[];
  /** Peers currently focused on this task (excluding self). */
  peersOnTask?: PresencePeer[];
  /** Broadcast that the user is typing in `taskId`'s comment box. */
  broadcastTyping?: (taskId: string) => void;
  /** Returns peers currently typing on `taskId`. */
  typingPeers?: (taskId: string) => PresencePeer[];
}

export const TaskModal: React.FC<TaskModalProps> = ({
  open, onClose, task, projectId, projectName, project,
  onSave, onDelete, onCreateSubtasks: _onCreateSubtasks,
  initialStatus = 'undefined', columns = DEFAULT_COLUMNS,
  peersOnTask = [],
  broadcastTyping,
  typingPeers,
}) => {
  const { user } = useAuth();
  const { organization, isAdmin, isViewer } = useOrganization();
  const { actions: callActions, state: callState } = useCall();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<string>(initialStatus);
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [urgent, setUrgent] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [lockPinNew, setLockPinNew] = useState('');
  const [lockPinConfirm, setLockPinConfirm] = useState('');
  const [pinUnlockedSession, setPinUnlockedSession] = useState(false);
  const [showUnlockGate, setShowUnlockGate] = useState(false);
  const [unlockAttempt, setUnlockAttempt] = useState('');
  const [initialComment, setInitialComment] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');

  // TaskCalendar meeting — independent of the due date. Null = no meeting.
  const [meetingStartsAt, setMeetingStartsAt] = useState<Date | null>(null);
  const [meetingDurationMinutes, setMeetingDurationMinutes] = useState<number | null>(null);

  const [aiLoading, setAiLoading] = useState<{ description?: boolean; suggestions?: boolean }>({});
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<SmartSuggestionResponse | null>(null);
  const [showAISuggestion, setShowAISuggestion] = useState(false);

  const [activeTab, setActiveTab] = useState<'comments' | 'activity' | 'expenses'>('comments');
  const [newComment, setNewComment] = useState('');
  const [commentAttachmentFiles, setCommentAttachmentFiles] = useState<File[]>([]);
  const [commentTimeSpentMinutes, setCommentTimeSpentMinutes] = useState<number | ''>('');
  const [showTimeSpent, setShowTimeSpent] = useState(false);
  const [commentLoading, setCommentLoading] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const [taskComments, setTaskComments] = useState<TaskComment[]>([]);
  /** False until the first realtime snapshot arrives — drives the skeleton. */
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [commentSummary, setCommentSummary] = useState<CommentSummary | null>(null);
  const [commentSummaryLoading, setCommentSummaryLoading] = useState(false);
  const [commentSummaryError, setCommentSummaryError] = useState<string | null>(null);
  const [commentSummaryOpen, setCommentSummaryOpen] = useState(false);
  const commentFileInputRef = useRef<HTMLInputElement>(null);
  const descriptionTextareaRef = useRef<HTMLTextAreaElement>(null);
  const commentComposerRef = useRef<HTMLDivElement>(null);
  const commentTypingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // Auto-save: compare current field snapshot against last persisted snapshot
  // to skip no-op writes (initial load, parent re-renders, realtime echoes).
  const autoSaveSnapshotRef = useRef<string | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveInFlightRef = useRef<boolean>(false);
  // Comment draft (server-side, per user/task) — debounce writes while typing.
  const commentDraftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commentDraftLoadedRef = useRef<boolean>(false);

  const MAX_FILE_SIZE = 500 * 1024 * 1024;

  const isEditing = !!task;
  /** Task without PIN: owner / admin / creator may edit without entering PIN. */
  const canOverrideTaskLock = useMemo(() => {
    if (!user) return false;
    if (project?.ownerId === user.userId) return true;
    if (task?.createdBy === user.userId) return true;
    return isAdmin;
  }, [user, project?.ownerId, task?.createdBy, isAdmin]);

  /**
   * Lock + PIN is an admin/owner-only control, both on create and on edit.
   * Members (even if they created the task) and viewers cannot set, change,
   * or clear a task lock — they can still be assigned to a locked task,
   * unlock by PIN, etc., but only org owner/admin gets to manage the lock
   * itself.
   */
  const canManageLockAndPin = isAdmin;

  const hasLockPin = Boolean(task?.hasLockPin);
  const lockedWithPin = Boolean(isEditing && task?.isLocked && hasLockPin);
  /**
   * PIN vs no-PIN lock: with PIN, only session unlock allows edit; without PIN,
   * owner/admin/creator may edit (see canOverrideTaskLock).
   * Member gate: org admin / project owner can edit any task; others only creator or assignee.
   */
  const isAssignedToTask = Boolean(
    user && task?.assignees?.some((a) => a.userId === user.userId),
  );
  const memberLockedTask = Boolean(
    isEditing &&
      task &&
      !isAdmin &&
      project?.ownerId !== user?.userId &&
      task.createdBy !== user?.userId &&
      !isAssignedToTask,
  );

  /** PIN / no-PIN lock only (not member role or viewer). */
  const lockReadOnly = Boolean(
    isEditing &&
      task?.isLocked &&
      (lockedWithPin ? !pinUnlockedSession : !canOverrideTaskLock),
  );
  /** Role / assignment restrictions (excludes lock mechanics). */
  const permissionReadOnly = Boolean(memberLockedTask || isViewer);
  const readOnlyTask = Boolean(lockReadOnly || permissionReadOnly);

  /** Until PIN is entered, hide title, description, comments, activity. Strictly enforced —
   *  owners can rotate or remove the PIN, but cannot peek without entering it. */
  const mustUnlockToView = useMemo(
    () =>
      Boolean(
        isEditing &&
          task?.isLocked &&
          hasLockPin &&
          !pinUnlockedSession,
      ),
    [
      isEditing,
      task?.isLocked,
      task?.taskId,
      hasLockPin,
      pinUnlockedSession,
    ],
  );

  const [activityRefetchNonce, setActivityRefetchNonce] = useState(0);

  const aiEnabled = isAIEnabled();
  const orgId = organization?.organizationId || user?.organizationId || (user ? `local-${user.userId}` : '');
  const { events: taskActivityEvents, loading: taskActivityLoading } = useTaskActivity(
    open && task?.taskId && !mustUnlockToView ? task.taskId : null,
    orgId || null,
    activityRefetchNonce,
  );

  const [showDecomposition, setShowDecomposition] = useState(false);
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showMoveTask, setShowMoveTask] = useState(false);
  const [projectAssignableMembers, setProjectAssignableMembers] = useState<Array<{
    userId: string;
    displayName: string;
    email: string;
    photoURL: string;
  }>>([]);

  // Reset state when opening the modal or switching tasks — not on every parent refetch of the same task (avoids wiping drafts after tab switch).
  useEffect(() => {
    if (!open) return;
    if (task) {
      // Guard against null — a task with no description would otherwise set
      // `description` to null and crash render-time `description.trim()` calls.
      setTitle(task.title ?? '');
      setDescription(task.description ?? '');
      setStatus(task.status);
      setPriority(task.priority);
      setDueDate(task.dueDate ? new Date(task.dueDate) : null);
      setAssignees(task.assignees || []);
      setUrgent(!!task.urgent);
      setIsLocked(!!task.isLocked);
      setTags(task.tags || []);
      setSubtasks(task.subtasks?.length ? task.subtasks : []);
      const seededMeeting = toMeetingDate(task.meetingStartsAt);
      setMeetingStartsAt(seededMeeting);
      setMeetingDurationMinutes(
        seededMeeting ? task.meetingDurationMinutes ?? DEFAULT_MEETING_DURATION : null,
      );
    } else {
      setTitle('');
      setDescription('');
      setStatus(initialStatus);
      setPriority('medium');
      setDueDate(null);
      setAssignees([]);
      setUrgent(false);
      setIsLocked(false);
      setInitialComment('');
      setTags([]);
      setSubtasks([]);
      setMeetingStartsAt(null);
      setMeetingDurationMinutes(null);
    }
    setAiError(null);
    setSaveError(null);
    setLastSavedAt(null);
    setAutoSaveStatus('idle');
    // Reset auto-save baseline so the just-loaded fields don't look like edits.
    autoSaveSnapshotRef.current = null;
    autoSaveInFlightRef.current = false;
    commentDraftLoadedRef.current = false;
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    if (commentDraftTimerRef.current) {
      clearTimeout(commentDraftTimerRef.current);
      commentDraftTimerRef.current = null;
    }
  }, [open, task?.taskId, initialStatus]);

  useEffect(() => {
    if (!task?.taskId) {
      setPinUnlockedSession(false);
      return;
    }
    setPinUnlockedSession(isTaskLockUnlockedInSession(task.taskId));
  }, [task?.taskId, open]);

  useEffect(() => {
    setLockPinNew('');
    setLockPinConfirm('');
    setUnlockAttempt('');
    setShowUnlockGate(false);
  }, [task?.taskId, open]);

  /**
   * Match project PIN (`ProjectView`): session unlock ends when this editor surface closes,
   * the task changes, or the component unmounts (e.g. Kanban `key` swap on close). Cleanup
   * always runs with the correct `taskId` from the last opened PIN-locked task.
   */
  useEffect(() => {
    if (!open || !task?.taskId || !task.isLocked || !task.hasLockPin) {
      return;
    }
    const tid = task.taskId;
    return () => {
      clearTaskLockUnlockedInSession(tid);
      setPinUnlockedSession(false);
    };
  }, [open, task?.taskId, task?.isLocked, task?.hasLockPin]);

  useEffect(() => {
    if (!open || !task?.taskId || !orgId || mustUnlockToView) {
      setTaskComments([]);
      setCommentsLoaded(false);
      return;
    }
    setCommentsLoaded(false);
    const unsub = subscribeToComments(task.taskId, orgId, (next) => {
      setTaskComments(next);
      setCommentsLoaded(true);
    });
    return () => unsub();
  }, [open, task?.taskId, orgId, mustUnlockToView]);

  // Opening a task should clear any unread notifications tied to it (mentions, assignments,
  // due-soon, etc.) so the bell doesn't keep surfacing notifications the user already opened.
  useEffect(() => {
    if (!open || !task?.taskId || !user?.userId || mustUnlockToView) return;
    void markNotificationsReadByTask(user.userId, task.taskId)
      .then(() => dispatchNotificationsRefresh())
      .catch((e) => console.warn('Failed to clear task notifications:', e));
  }, [open, task?.taskId, user?.userId, mustUnlockToView]);

  useEffect(() => {
    if (!open) {
      setAiError(null);
      setAiSuggestion(null);
      setShowAISuggestion(false);
      setAiLoading({});
      setActiveTab('comments');
      setShowTimeSpent(false);
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (commentTypingDebounceRef.current) {
        clearTimeout(commentTypingDebounceRef.current);
        commentTypingDebounceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (commentTypingDebounceRef.current) {
      clearTimeout(commentTypingDebounceRef.current);
      commentTypingDebounceRef.current = null;
    }
  }, [task?.taskId, open]);

  // ── Auto-save (existing task fields) ───────────────────────
  // Debounced background save of title/description/subtasks/priority/dueDate/
  // assignees/tags/urgent so closing the modal doesn't lose typed text.
  // Lock state and PIN are intentionally excluded — those need explicit intent.
  useEffect(() => {
    if (!open) return;
    if (!isEditing || !task?.taskId || !user) return;
    if (readOnlyTask || mustUnlockToView || loading) return;
    // Title is required by the DB — never auto-save an empty title.
    if (!title.trim()) return;

    const snapshot = JSON.stringify({
      title: title.trim(),
      description,
      priority,
      dueDate: dueDate ? dueDate.toISOString() : null,
      assignees: assignees.map((a) => a.userId).sort(),
      tags: [...tags].sort(),
      urgent,
      subtasks: subtasks.map((s) => ({ id: s.id, title: s.title, completed: s.completed })),
      meetingStartsAt: meetingStartsAt ? meetingStartsAt.toISOString() : null,
      meetingDurationMinutes: meetingStartsAt ? meetingDurationMinutes : null,
    });

    // First snapshot after (re)open: establish baseline, don't save.
    if (autoSaveSnapshotRef.current === null) {
      autoSaveSnapshotRef.current = snapshot;
      return;
    }
    if (autoSaveSnapshotRef.current === snapshot) return;

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = setTimeout(async () => {
      autoSaveTimerRef.current = null;
      if (autoSaveInFlightRef.current) return;
      autoSaveInFlightRef.current = true;
      setAutoSaveStatus('saving');
      try {
        await onSave({
          title: title.trim(),
          description,
          priority,
          dueDate: dueDate ?? null,
          assignees,
          tags,
          urgent,
          subtasks,
          meetingStartsAt: meetingStartsAt ?? null,
          meetingDurationMinutes: meetingStartsAt
            ? meetingDurationMinutes ?? DEFAULT_MEETING_DURATION
            : null,
        } as Partial<Task>);
        autoSaveSnapshotRef.current = snapshot;
        setLastSavedAt(new Date());
        setAutoSaveStatus('saved');
      } catch (err) {
        // Keep snapshot unchanged so the next edit retries the save.
        setAutoSaveStatus('error');
        console.warn('Task auto-save failed:', err);
      } finally {
        autoSaveInFlightRef.current = false;
      }
    }, 900);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [
    open, isEditing, task?.taskId, user, readOnlyTask, mustUnlockToView, loading,
    title, description, priority, dueDate, assignees, tags, urgent, subtasks,
    meetingStartsAt, meetingDurationMinutes,
    onSave,
  ]);

  // ── Comment draft: load on open ────────────────────────────
  useEffect(() => {
    if (!open || !task?.taskId || !user?.userId || !orgId || mustUnlockToView) {
      commentDraftLoadedRef.current = false;
      return;
    }
    let cancelled = false;
    void getCommentDraft(task.taskId, user.userId, orgId)
      .then((draft) => {
        if (cancelled) return;
        // Don't overwrite text the user has already typed since the modal opened.
        setNewComment((current) => (current ? current : draft));
        commentDraftLoadedRef.current = true;
      })
      .catch(() => {
        commentDraftLoadedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [open, task?.taskId, user?.userId, orgId, mustUnlockToView]);

  // ── Comment draft: save on change (debounced) ──────────────
  useEffect(() => {
    if (!open || !task?.taskId || !user?.userId || !orgId || mustUnlockToView) return;
    // Wait until the initial load completes so we don't immediately overwrite
    // a server draft with an empty string before it's been read.
    if (!commentDraftLoadedRef.current) return;

    if (commentDraftTimerRef.current) {
      clearTimeout(commentDraftTimerRef.current);
    }
    const taskId = task.taskId;
    const userId = user.userId;
    const orgIdSnapshot = orgId;
    const content = newComment;
    commentDraftTimerRef.current = setTimeout(() => {
      commentDraftTimerRef.current = null;
      void upsertCommentDraft(taskId, userId, orgIdSnapshot, content);
    }, 600);

    return () => {
      if (commentDraftTimerRef.current) {
        clearTimeout(commentDraftTimerRef.current);
        commentDraftTimerRef.current = null;
      }
    };
  }, [newComment, open, task?.taskId, user?.userId, orgId, mustUnlockToView]);

  const scheduleCommentTypingBroadcast = useCallback(
    (taskId: string) => {
      if (!broadcastTyping) return;
      if (commentTypingDebounceRef.current) {
        clearTimeout(commentTypingDebounceRef.current);
      }
      commentTypingDebounceRef.current = setTimeout(() => {
        commentTypingDebounceRef.current = null;
        broadcastTyping(taskId);
      }, 700);
    },
    [broadcastTyping],
  );

  // Auto-grow description textarea
  useEffect(() => {
    const el = descriptionTextareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 96)}px`;
  }, [description]);

  // Load assignable members
  useEffect(() => {
    // Legacy invite/migration code paths sometimes stored a literal role
    // word ("Member", "Owner", "User", …) in `displayName` instead of an
    // actual name. Treat those as missing so we fall through to the email
    // local part or the user's real profile name.
    const isGenericName = (name?: string | null) => {
      if (!name) return true;
      const n = name.trim().toLowerCase();
      return (
        n === '' ||
        n === 'owner' ||
        n === 'admin' ||
        n === 'member' ||
        n === 'user' ||
        n === 'unknown' ||
        n === 'you'
      );
    };
    /** Pick the first non-generic, non-empty candidate. */
    const pickName = (...candidates: Array<string | null | undefined>) =>
      candidates.find((c) => c && !isGenericName(c)) || '';

    // Members + viewers can't read other users' rows in `user_profiles` due
    // to RLS, so the Supabase query below comes back empty for the owner
    // and other admins — leaving us with the literal "Member" placeholder
    // stored on the project's members JSON. The OrganizationContext is
    // already loaded with the org's authoritative `ownerName`, member
    // displayNames, and emails (those tables are readable to all org
    // members), so we use it as the most reliable name source.
    const orgInfoByUserId = new Map<
      string,
      { displayName?: string; email?: string; photoURL?: string }
    >();
    if (organization?.ownerId) {
      orgInfoByUserId.set(organization.ownerId, {
        displayName: organization.ownerName,
        email: organization.ownerEmail,
      });
    }
    for (const m of organization?.members ?? []) {
      if (!m.userId) continue;
      orgInfoByUserId.set(m.userId, {
        displayName: m.displayName,
        email: m.email,
        photoURL: m.photoURL,
      });
    }

    const loadAssignableMembers = async () => {
      if (!open || !projectId) {
        setProjectAssignableMembers([]);
        return;
      }
      try {
        const { data: projectRow } = await supabase
          .from('projects')
          .select('owner_id, members')
          .eq('project_id', projectId)
          .maybeSingle();

        const ownerId = projectRow?.owner_id || project?.ownerId || null;
        const membersFromProject = (projectRow?.members || []) as Array<{
          userId?: string; user_id?: string; email?: string; displayName?: string;
          display_name?: string; photoURL?: string; photo_url?: string;
        }>;

        const memberMap = new Map<string, { userId: string; displayName: string; email: string; photoURL: string }>();

        if (ownerId) {
          const { data: ownerProfile } = await supabase
            .from('user_profiles')
            .select('id, email, display_name, photo_url')
            .eq('id', ownerId)
            .maybeSingle();

          const orgOwnerInfo = orgInfoByUserId.get(ownerId);
          const ownerEmail =
            ownerProfile?.email ||
            orgOwnerInfo?.email ||
            (ownerId === user?.userId ? user?.email || '' : '');
          const ownerEmailLocal = ownerEmail.split('@')[0] || '';
          const ownerName =
            pickName(
              ownerProfile?.display_name,
              orgOwnerInfo?.displayName,
              ownerId === user?.userId ? user?.displayName : null,
            ) ||
            ownerEmailLocal ||
            ownerEmail ||
            'Member';

          memberMap.set(ownerId, {
            userId: ownerId,
            displayName: ownerName,
            email: ownerEmail,
            photoURL:
              ownerProfile?.photo_url ||
              orgOwnerInfo?.photoURL ||
              (ownerId === user?.userId ? user?.photoURL || '' : ''),
          });
        }

        const memberIds = [...new Set(membersFromProject.map((m) => m.userId || m.user_id).filter(Boolean))] as string[];
        if (memberIds.length > 0) {
          const { data: profiles } = await supabase
            .from('user_profiles')
            .select('id, email, display_name, photo_url')
            .in('id', memberIds);
          const profileMap = new Map((profiles || []).map((p) => [p.id, p]));
          for (const m of membersFromProject) {
            const uid = m.userId || m.user_id;
            if (!uid) continue;
            const profile = profileMap.get(uid);
            const orgInfo = orgInfoByUserId.get(uid);
            const email = profile?.email || orgInfo?.email || m.email || '';
            const emailLocal = email.split('@')[0] || '';
            const resolvedName =
              pickName(
                profile?.display_name,
                orgInfo?.displayName,
                m.displayName,
                m.display_name,
              ) ||
              emailLocal ||
              email ||
              'Member';
            memberMap.set(uid, {
              userId: uid,
              displayName: resolvedName,
              email,
              photoURL:
                profile?.photo_url ||
                orgInfo?.photoURL ||
                m.photoURL ||
                m.photo_url ||
                '',
            });
          }
        }

        if (user?.userId && !memberMap.has(user.userId)) {
          memberMap.set(user.userId, {
            userId: user.userId,
            displayName: user.displayName || user.email || 'You',
            email: user.email || '',
            photoURL: user.photoURL || '',
          });
        }

        setProjectAssignableMembers(Array.from(memberMap.values()));
      } catch (err) {
        console.error('Failed to load assignable members:', err);
        setProjectAssignableMembers(
          user
            ? [{
                userId: user.userId,
                displayName: user.displayName || user.email || 'You',
                email: user.email || '',
                photoURL: user.photoURL || '',
              }]
            : [],
        );
      }
    };
    loadAssignableMembers();
    // organization fields are added so members + owner names refresh once
    // the org context resolves (RLS hides other users' user_profiles rows
    // from non-admins, so the org-context payload is the authoritative
    // name source for owner / admin / fellow members).
  }, [
    open,
    projectId,
    project?.ownerId,
    user?.userId,
    user?.email,
    user?.displayName,
    user?.photoURL,
    organization?.ownerId,
    organization?.ownerName,
    organization?.ownerEmail,
    organization?.members,
  ]);

  // ── AI Handlers ────────────────────────────────────────────
  const handleExpandDescription = async () => {
    if (!title.trim() || !user) return;
    setAiLoading((p) => ({ ...p, description: true }));
    setAiError(null);
    try {
      const result = await expandDescription(user.userId, { title, projectContext: projectName });
      setDescription(result.description ?? '');
      markOnboardingAi();
    } catch (error) {
      setAiError((error as AIError).message);
    } finally {
      setAiLoading((p) => ({ ...p, description: false }));
    }
  };

  const handleRefineDescription = async () => {
    if (!title.trim() || !description.trim() || !user) return;
    setAiLoading((p) => ({ ...p, description: true }));
    setAiError(null);
    try {
      const result = await refineDescription(user.userId, { title, description, projectContext: projectName });
      setDescription(result.description ?? '');
      markOnboardingAi();
    } catch (error) {
      setAiError((error as AIError).message);
    } finally {
      setAiLoading((p) => ({ ...p, description: false }));
    }
  };

  const handleGetSmartSuggestions = async () => {
    if (!title.trim() || !user) return;
    setAiLoading((p) => ({ ...p, suggestions: true }));
    setAiError(null);
    try {
      const result = await suggestPriorityAndDueDate(user.userId, { title, description });
      setAiSuggestion(result);
      setShowAISuggestion(true);
      markOnboardingAi();
    } catch (error) {
      setAiError((error as AIError).message);
    } finally {
      setAiLoading((p) => ({ ...p, suggestions: false }));
    }
  };

  const handleGenerateTitleFromDescription = async () => {
    if (!description.trim() || description.trim().length < 10 || !user) return;
    setAiLoading((p) => ({ ...p, description: true }));
    setAiError(null);
    try {
      const result = await generateTitle(user.userId, {
        description: description.trim(),
        projectContext: projectName,
      });
      setTitle(result.title ?? '');
      markOnboardingAi();
      toast.success('Title updated from description');
    } catch (error) {
      setAiError((error as AIError).message);
    } finally {
      setAiLoading((p) => ({ ...p, description: false }));
    }
  };

  const handleApplySuggestions = () => {
    if (!aiSuggestion) return;
    setPriority(aiSuggestion.priority);
    if (aiSuggestion.dueDate) setDueDate(new Date(aiSuggestion.dueDate));
    setShowAISuggestion(false);
  };

  // ── Comment summarizer (AI) ────────────────────────────────
  const handleSummarizeComments = useCallback(async () => {
    if (!user || !task || taskComments.length === 0) return;
    setCommentSummaryLoading(true);
    setCommentSummaryError(null);
    setCommentSummaryOpen(true);
    try {
      const snippets = [...taskComments]
        .reverse()
        .map((c) => ({
          author: c.displayName || 'User',
          at: c.createdAt
            ? (c.createdAt instanceof Date
                ? c.createdAt.toISOString()
                : String(c.createdAt))
            : '',
          text: (c.text || '').trim() || '(attachment / time logged)',
        }));
      const result = await summarizeCommentThread(user.userId, task.title, snippets);
      setCommentSummary(result);
    } catch (err) {
      const aiErr = err as AIError;
      setCommentSummaryError(aiErr.message || 'Could not summarize the thread.');
    } finally {
      setCommentSummaryLoading(false);
    }
  }, [user, task, taskComments]);

  // Reset the cached summary whenever the comment count or task changes.
  useEffect(() => {
    setCommentSummary(null);
    setCommentSummaryError(null);
    setCommentSummaryOpen(false);
  }, [task?.taskId, taskComments.length]);

  // ── Comment handler ────────────────────────────────────────
  const handleAddComment = useCallback(async () => {
    if (readOnlyTask) return;
    if ((!newComment.trim() && commentAttachmentFiles.length === 0) || !task || !user) return;
    setCommentLoading(true);
    const toastId = toast.loading('Posting comment...');
    try {
      const attachments: { fileId: string; fileName: string; fileUrl: string; fileType: string }[] = [];
      for (const file of commentAttachmentFiles) {
        try {
          if (file.size > MAX_FILE_SIZE) {
            toast.error(`${file.name} exceeds 500MB limit`);
            continue;
          }
          const uploaded = await uploadCommentAttachment(file, task.taskId, orgId, {
            projectId,
            userId: user.userId,
            userName: user.displayName || 'Unknown',
          });
          attachments.push(uploaded);
        } catch {
          toast.error(`Upload failed: ${file.name}`);
        }
      }

      const timeSpent = typeof commentTimeSpentMinutes === 'number' ? commentTimeSpentMinutes : undefined;

      const visibleToUserIds = Array.from(
        new Set([
          user.userId,
          ...projectAssignableMembers.map((m) => m.userId).filter(Boolean),
        ]),
      );

      const commentBody = newComment.trim() || '';
      await addCommentWithGlobalSync(
        task.taskId, projectId, projectName || '', task.title,
        user.userId, user.displayName || 'Unknown', user.photoURL || '',
        commentBody, visibleToUserIds, orgId,
        attachments.length > 0 ? attachments : undefined, timeSpent,
      );

      if (commentBody) {
        void notifyTaskCommentMentions({
          text: commentBody,
          members: projectAssignableMembers.map((m) => ({
            userId: m.userId,
            displayName: m.displayName,
            email: m.email,
          })),
          actorUserId: user.userId,
          actorDisplayName: user.displayName || 'Unknown',
          taskId: task.taskId,
          projectId,
          projectName: projectName || '',
          taskTitle: task.title,
        });
      }

      setNewComment('');
      setCommentAttachmentFiles([]);
      setCommentTimeSpentMinutes('');
      setShowTimeSpent(false);
      setActivityRefetchNonce((n) => n + 1);
      // Clear the saved draft now that the comment is persisted.
      void deleteCommentDraft(task.taskId, user.userId, orgId);
      toast.success('Comment posted', { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add comment', { id: toastId });
    } finally {
      setCommentLoading(false);
    }
  }, [newComment, commentAttachmentFiles, commentTimeSpentMinutes, task, user, orgId, projectId, projectName, projectAssignableMembers]);

  const handleDeleteComment = useCallback(
    async (commentId: string) => {
      if (readOnlyTask || !task || !user || !orgId) return;
      setDeletingCommentId(commentId);
      setTaskComments((prev) => prev.filter((c) => c.commentId !== commentId));
      const toastId = toast.loading('Deleting comment...');
      try {
        await deleteComment(commentId);
        setActivityRefetchNonce((n) => n + 1);
        toast.success('Comment deleted', { id: toastId });
      } catch (error) {
        try {
          const fresh = await getTaskComments(task.taskId, orgId);
          setTaskComments(fresh);
        } catch {
          /* keep optimistic list if refetch fails */
        }
        toast.error(error instanceof Error ? error.message : 'Failed to delete comment', {
          id: toastId,
        });
      } finally {
        setDeletingCommentId(null);
      }
    },
    [readOnlyTask, task, user, orgId],
  );

  // ── Subtask helpers ────────────────────────────────────────
  const addSubtask = () => {
    if (!newSubtaskTitle.trim()) return;
    setSubtasks([...subtasks, { id: crypto.randomUUID(), title: newSubtaskTitle.trim(), completed: false }]);
    setNewSubtaskTitle('');
  };

  const toggleSubtask = (id: string) =>
    setSubtasks(subtasks.map((s) => (s.id === id ? { ...s, completed: !s.completed } : s)));

  const removeSubtask = (id: string) =>
    setSubtasks(subtasks.filter((s) => s.id !== id));

  const subtaskProgress = useMemo(() => {
    if (subtasks.length === 0) return null;
    const done = subtasks.filter((s) => s.completed).length;
    return { done, total: subtasks.length, pct: Math.round((done / subtasks.length) * 100) };
  }, [subtasks]);

  // ── Save / delete ──────────────────────────────────────────
  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (readOnlyTask) {
      toast.error('This task is locked. You can view it but not edit.');
      return;
    }
    if (!title.trim() || !user) return;
    setSaveError(null);
    setLoading(true);
    try {
      // Lock state on save:
      //   - Only org owner/admin may set, change, or clear the lock.
      //   - For everyone else, ignore whatever the (disabled) checkbox says
      //     and preserve the task's current lock state on edit. On create,
      //     non-admins can never produce a locked task.
      const isLockedForSave = canManageLockAndPin
        ? isLocked
        : isEditing
          ? !!task?.isLocked
          : false;

      let lockPinHashPayload: string | null | undefined = undefined;
      let createdTaskId: string | undefined;
      const creatorControlsLock = canManageLockAndPin;

      if (!isLockedForSave) {
        lockPinHashPayload = null;
        if (isEditing && task?.taskId) clearTaskLockUnlockedInSession(task.taskId);
      } else if (creatorControlsLock) {
        if (isEditing && lockPinNew.trim()) {
          if (lockPinNew !== lockPinConfirm) {
            toast.error('PIN and confirmation do not match');
            setLoading(false);
            return;
          }
          lockPinHashPayload = await hashLockPin(lockPinNew, task!.taskId);
        } else if (!isEditing && lockPinNew.trim()) {
          if (lockPinNew !== lockPinConfirm) {
            toast.error('PIN and confirmation do not match');
            setLoading(false);
            return;
          }
          createdTaskId = crypto.randomUUID();
          lockPinHashPayload = await hashLockPin(lockPinNew, createdTaskId);
        }
      }

      const basePayload = {
        title,
        description,
        status,
        priority,
        dueDate: dueDate ?? null,
        // Always send arrays when editing so clearing assignees/tags/subtasks persists in the DB.
        assignees: isEditing ? assignees : assignees.length > 0 ? assignees : undefined,
        tags: isEditing ? tags : tags.length > 0 ? tags : undefined,
        subtasks: isEditing ? subtasks : subtasks.length > 0 ? subtasks : undefined,
        urgent,
        // Meeting is independent of dueDate; null clears it.
        meetingStartsAt: meetingStartsAt ?? null,
        meetingDurationMinutes: meetingStartsAt
          ? meetingDurationMinutes ?? DEFAULT_MEETING_DURATION
          : null,
        isLocked: isLockedForSave,
        ...(lockPinHashPayload !== undefined
          ? { lockPinHash: lockPinHashPayload }
          : {}),
      };

      if (isEditing) {
        const updatePayload = { ...basePayload } as Partial<Task> & {
          activityBy?: { userId: string; displayName: string; photoURL?: string };
          assigneeChangedBy?: { userId: string; displayName: string };
        };
        if (subtasks.length > 0 || (task?.subtasks?.length ?? 0) > 0) {
          updatePayload.activityBy = {
            userId: user.userId,
            displayName: user.displayName || 'User',
            photoURL: user.photoURL || '',
          };
        }
        if (assignees.length > 0) {
          updatePayload.assigneeChangedBy = {
            userId: user.userId,
            displayName: user.displayName || 'User',
          };
        }
        await onSave(updatePayload);
        setLastSavedAt(new Date());
        toast.success('Task updated');
      } else {
        await onSave({
          ...(createdTaskId ? { taskId: createdTaskId } : {}),
          projectId,
          ...basePayload,
          projectName,
          createdByDisplayName: user?.displayName,
          createdByPhotoURL: user?.photoURL,
          _initialComment: initialComment.trim() || undefined,
        } as CreateTaskInput & { _initialComment?: string });
        toast.success('Task created');
      }
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save task';
      setSaveError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!task || !onDelete) return;
    setLoading(true);
    const toastId = toast.loading('Deleting task...');
    try {
      await onDelete(task.taskId);
      toast.success('Task deleted', { id: toastId });
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete task', { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  const formatTimeLogged = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  };

  const copyTaskUrl = async () => {
    if (!task) return;
    try {
      const url = `${window.location.origin}/project/${projectId}?taskId=${task.taskId}`;
      await navigator.clipboard.writeText(url);
      toast.success('Task URL copied');
    } catch {
      toast.error('Unable to copy task URL');
    }
  };

  const verifyUnlockPin = async () => {
    if (!task?.taskId || !task.hasLockPin) return;
    const ok = await verifyTaskLockPin(task.taskId, unlockAttempt);
    if (ok) {
      setTaskLockUnlockedInSession(task.taskId);
      setPinUnlockedSession(true);
      setShowUnlockGate(false);
      setUnlockAttempt('');
      toast.success('Unlocked — you can edit this task');
    } else {
      toast.error('Incorrect PIN');
    }
  };

  // ── Meeting / call ─────────────────────────────────────────
  // Ticks the meeting status chip and the "Saved x ago" hint while open.
  const now = useNow(30_000, open);

  const joinDisabledReason = getJoinDisabledReason({
    isSaved: Boolean(isEditing && task?.taskId),
    inCall: callState.status !== 'idle',
    isViewer,
    mediaSupported: isMediaSupported(),
  });

  const handleJoinMeeting = () => {
    if (!task?.taskId || joinDisabledReason) return;
    void callActions.startMeeting(
      {
        type: 'project',
        targetId: projectId,
        label: title.trim() || task.title,
        taskId: task.taskId,
      },
      'video',
    );
    onClose();
  };

  const handleMeetingChange = (startsAt: Date | null, duration: number | null) => {
    setMeetingStartsAt(startsAt);
    setMeetingDurationMinutes(startsAt ? duration ?? DEFAULT_MEETING_DURATION : null);
  };

  // ── Derived view data ──────────────────────────────────────
  const currentColumn = columns.find((c) => c.id === status);
  const columnTitle = currentColumn?.title ?? 'No column';
  const modKey =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)
      ? '⌘'
      : 'Ctrl';

  /** Files from the task itself plus everything attached in comments. */
  const allAttachments = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{ fileId: string; fileName: string; fileUrl: string; fileType?: string }> = [];
    const push = (a: { fileId: string; fileName: string; fileUrl: string; fileType?: string }) => {
      const key = a.fileId || a.fileUrl;
      if (!key || seen.has(key)) return;
      seen.add(key);
      list.push(a);
    };
    for (const a of task?.attachments ?? []) push(a);
    for (const c of taskComments) for (const a of c.attachments ?? []) push(a);
    return list;
  }, [task?.attachments, taskComments]);

  const commentCount = taskComments.length;

  // ── Keyboard ───────────────────────────────────────────────
  const contentRef = useRef<HTMLDivElement>(null);

  /** Cmd/Ctrl+Enter: post the comment when typing in the composer, otherwise save. */
  const handleDialogKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.nativeEvent.isComposing) return;
    const target = e.target as Node;
    // Nested dialogs are portaled: React bubbles their events here, the DOM doesn't.
    if (!contentRef.current?.contains(target) || mustUnlockToView) return;
    e.preventDefault();
    if (commentComposerRef.current?.contains(target)) {
      if (!readOnlyTask && !commentLoading) void handleAddComment();
      return;
    }
    if (title.trim() && !readOnlyTask && !loading) void handleSubmit();
  };

  /** Esc closes an open @mention list first (it is not a Radix layer). */
  const handleEscapeKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t?.tagName === 'TEXTAREA' && t.parentElement?.querySelector('[role="listbox"]')) {
      e.preventDefault();
    }
  };

  // ── Footer hint ────────────────────────────────────────────
  const footerHint = (() => {
    if (readOnlyTask) {
      return <span>View only — you can read this task but not change it.</span>;
    }
    if (!title.trim()) {
      return <span>Add a title to {isEditing ? 'save' : 'create the task'}.</span>;
    }
    if (isEditing) {
      if (autoSaveStatus === 'saving') {
        return (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            Saving…
          </span>
        );
      }
      if (autoSaveStatus === 'error') {
        return <span className="text-destructive">Auto-save failed — use Save changes.</span>;
      }
      if (lastSavedAt) {
        const ago = now.getTime() - lastSavedAt.getTime();
        return (
          <span className="inline-flex items-center gap-1.5 tabular-nums" title={lastSavedAt.toLocaleString()}>
            <Check className="h-3 w-3 text-success" aria-hidden />
            {ago < 45_000 ? 'Saved just now' : `Saved ${formatDistanceSafe(lastSavedAt)}`}
          </span>
        );
      }
      return <span>Changes save automatically.</span>;
    }
    return (
      <span>
        <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-sans text-[10px] font-medium">{modKey}</kbd>
        <span className="mx-0.5">+</span>
        <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-sans text-[10px] font-medium">Enter</kbd>{' '}
        to create
      </span>
    );
  })();

  const headerIconButton = cn(
    'h-10 w-10 min-h-0 min-w-0 md:h-8 md:w-8 md:min-h-0 md:min-w-0 text-muted-foreground hover:text-foreground',
    PRESS,
  );
  const uid = useId();
  const ids = {
    title: `${uid}-title`,
    description: `${uid}-description`,
    subtaskInput: `${uid}-subtaskInput`,
    firstComment: `${uid}-firstComment`,
    status: `${uid}-status`,
    priority: `${uid}-priority`,
    due: `${uid}-due`,
    assignees: `${uid}-assignees`,
    tags: `${uid}-tags`,
    urgent: `${uid}-urgent`,
    lock: `${uid}-lock`,
    pinNew: `${uid}-pinNew`,
    pinConfirm: `${uid}-pinConfirm`,
    unlockPin: `${uid}-unlockPin`,
    unlockPin2: `${uid}-unlockPin2`,
    subtasksHeading: `${uid}-subtasks-heading`,
    attachmentsHeading: `${uid}-attachments-heading`,
    timeSpent: `${uid}-time-spent`,
    lockHint: `${uid}-lock-hint`,
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        ref={contentRef}
        aria-describedby={undefined}
        onEscapeKeyDown={handleEscapeKeyDown}
        onKeyDown={handleDialogKeyDown}
        className={cn(
          'flex flex-col gap-0 overflow-hidden p-0 pt-0 pb-0 sm:p-0 sm:pt-0 sm:pb-0 sm:max-w-5xl [&>button]:hidden',
          isEditing && !mustUnlockToView ? 'h-[calc(100dvh-3rem)] sm:h-[90vh]' : 'sm:max-h-[90vh]',
        )}
      >
        <DialogTitle className="sr-only">
          {mustUnlockToView
            ? 'Task locked — enter PIN'
            : isEditing
              ? task?.title
                ? `Edit task: ${task.title}`
                : 'Edit task'
              : 'Create new task'}
        </DialogTitle>

        {mustUnlockToView ? (
          <div className="flex min-h-[min(420px,70vh)] flex-col items-center justify-center gap-6 px-6 py-12 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-muted" aria-hidden>
              <KeyRound className="h-6 w-6 text-muted-foreground" />
            </span>
            <div className="max-w-sm space-y-2">
              <h2 className="text-lg font-semibold text-foreground">This task is locked</h2>
              <p className="text-sm text-muted-foreground">
                Enter the PIN to view details, comments, and activity. When you close this task or
                save changes, you will need the PIN again to view or edit it.
              </p>
            </div>
            <form
              className="flex w-full max-w-xs flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void verifyUnlockPin();
              }}
            >
              <label htmlFor={ids.unlockPin} className="sr-only">
                Task PIN
              </label>
              <Input
                id={ids.unlockPin}
                type="password"
                name="task-unlock-pin"
                autoComplete="new-password"
                autoFocus
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
                placeholder="Enter PIN"
                value={unlockAttempt}
                onChange={(e) => setUnlockAttempt(e.target.value)}
                className="text-center tracking-widest transition-colors"
              />
              <div className="flex items-center justify-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  className={PRESS}
                  onClick={() => { onClose(); setUnlockAttempt(''); }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={!unlockAttempt.trim()} className={cn('gap-2', PRESS)}>
                  <KeyRound aria-hidden />
                  Unlock
                </Button>
              </div>
            </form>
          </div>
        ) : (
        <>
        {/* ── Header: breadcrumb + actions, then the title ─────────── */}
        <header className="shrink-0 border-b border-border">
          <div className="flex h-12 items-center gap-1 pl-4 pr-2 sm:pl-6">
            <nav
              aria-label="Task location"
              className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground"
            >
              <span className="min-w-0 max-w-[50%] truncate" title={projectName || 'Project'}>
                {projectName || 'Project'}
              </span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/40"
                  style={currentColumn?.color ? { backgroundColor: currentColumn.color } : undefined}
                />
                <span className="truncate" title={columnTitle}>{columnTitle}</span>
              </span>
              {!isEditing && (
                <span className="hidden shrink-0 sm:inline">
                  <span aria-hidden className="mx-1 opacity-60">·</span>New task
                </span>
              )}
            </nav>

            <PresenceAvatars peers={peersOnTask} />

            {isEditing && task && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={headerIconButton}
                onClick={copyTaskUrl}
                aria-label="Copy link to task"
                title="Copy link to task"
              >
                <Link2 aria-hidden />
              </Button>
            )}

            {isEditing && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={headerIconButton}
                    aria-label="More task actions"
                    title="More actions"
                  >
                    <MoreHorizontal aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                    Task actions
                  </DropdownMenuLabel>
                  {task && user && (
                    <DropdownMenuItem onClick={() => setShowNotifyModal(true)}>
                      <Bell className="mr-2 h-4 w-4" aria-hidden />
                      Notify teammates…
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => toast.info('Reply by email — coming soon')}>
                    <Mail className="mr-2 h-4 w-4" aria-hidden />
                    Reply by email
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowMoveTask(true)} disabled={readOnlyTask}>
                    <FolderInput className="mr-2 h-4 w-4" aria-hidden />
                    Move to project…
                  </DropdownMenuItem>
                  {aiEnabled && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                        AI
                      </DropdownMenuLabel>
                      <DropdownMenuItem onClick={handleGetSmartSuggestions} disabled={readOnlyTask}>
                        <Sparkles className="mr-2 h-4 w-4 text-primary" aria-hidden />
                        Suggest priority &amp; due date
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={handleGenerateTitleFromDescription}
                        disabled={readOnlyTask || description.trim().length < 10 || aiLoading.description}
                      >
                        <Sparkles className="mr-2 h-4 w-4 text-primary" aria-hidden />
                        Title from description
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={handleExpandDescription}
                        disabled={readOnlyTask || !title.trim()}
                      >
                        <Wand2 className="mr-2 h-4 w-4 text-primary" aria-hidden />
                        Write description
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setShowDecomposition(true)}
                        disabled={readOnlyTask || !title.trim()}
                      >
                        <ListTree className="mr-2 h-4 w-4 text-primary" aria-hidden />
                        Break into subtasks
                      </DropdownMenuItem>
                    </>
                  )}
                  {onDelete && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setShowDeleteConfirm(true)}
                        disabled={readOnlyTask}
                        className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                        Delete task
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <DialogClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={headerIconButton}
                aria-label="Close"
                title="Close (Esc)"
              >
                <X aria-hidden />
              </Button>
            </DialogClose>
          </div>

          <div className="flex items-start gap-2 px-4 pb-4 sm:px-6">
            <button
              type="button"
              onClick={() => setStatus(status === 'done' ? 'todo' : 'done')}
              disabled={readOnlyTask}
              aria-pressed={status === 'done'}
              aria-label={status === 'done' ? 'Mark as not done' : 'Mark as done'}
              title={status === 'done' ? 'Mark as not done' : 'Mark as done'}
              className={cn(
                'group -ml-1.5 mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full disabled:cursor-not-allowed md:h-9 md:w-9',
                FOCUS_RING,
                PRESS,
              )}
            >
              <span
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors',
                  status === 'done'
                    ? 'border-success bg-success text-success-foreground'
                    : 'border-muted-foreground/40 group-hover:border-foreground/60',
                )}
              >
                {status === 'done' && <Check className="h-3 w-3" strokeWidth={3} aria-hidden />}
              </span>
            </button>
            <label htmlFor={ids.title} className="sr-only">
              Task title
            </label>
            <input
              id={ids.title}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                // Plain Enter moves on to the description; Cmd/Ctrl+Enter saves (dialog-level).
                if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  descriptionTextareaRef.current?.focus();
                }
              }}
              placeholder="Task title"
              autoFocus={!isEditing}
              readOnly={readOnlyTask}
              aria-readonly={readOnlyTask || undefined}
              aria-invalid={!title.trim() ? true : undefined}
              autoComplete="off"
              className="h-10 min-w-0 flex-1 rounded-md bg-transparent px-1 text-xl font-semibold tracking-tight text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring/40 md:h-9 md:text-2xl"
            />
          </div>

          {(saveError || lockReadOnly || permissionReadOnly) && (
            <div className="space-y-2 px-4 pb-4 sm:px-6">
              {saveError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive-soft-foreground"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span className="min-w-0 break-words">{saveError}</span>
                </div>
              )}
              {lockReadOnly && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground">
                  <Lock className="h-4 w-4 shrink-0 text-warning" aria-hidden />
                  {hasLockPin ? (
                    <>
                      <span className="min-w-[200px] flex-1">
                        Locked with a PIN. Enter it to edit (this device only until you clear browser data).
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className={cn('shrink-0 gap-1.5', PRESS)}
                        onClick={() => setShowUnlockGate(true)}
                      >
                        <KeyRound aria-hidden />
                        Enter PIN
                      </Button>
                    </>
                  ) : (
                    <span className="flex-1">
                      This task is locked. Only the project owner or a workspace admin can make changes.
                    </span>
                  )}
                </div>
              )}
              {permissionReadOnly && !lockReadOnly && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground">
                  <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span>
                    {isViewer
                      ? 'You have view-only access to this workspace — you cannot edit tasks.'
                      : 'You can view this task, but only the creator, assignees, project owner, or a workspace admin can change it.'}
                  </span>
                </div>
              )}
            </div>
          )}
        </header>

        {/* ── Body: one scroll region on mobile, two on md+ ─────── */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain md:grid md:grid-cols-[minmax(0,1fr)_280px] md:grid-rows-[minmax(0,1fr)] md:overflow-hidden">
          {/* Main column */}
          <div className="order-2 min-w-0 space-y-6 px-4 py-6 sm:px-6 md:order-1 md:min-h-0 md:overflow-y-auto md:overscroll-contain">
            {/* Description */}
            <section className="space-y-2">
              <div className="flex min-h-8 items-center justify-between gap-3">
                <label htmlFor={ids.description} className={SECTION_LABEL}>
                  Description
                </label>
                {aiEnabled && title.trim().length >= 3 && !readOnlyTask && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={description ? handleRefineDescription : handleExpandDescription}
                    disabled={aiLoading.description}
                    className={cn('h-8 min-h-0 gap-1.5 px-2 text-xs text-primary hover:text-primary', PRESS)}
                  >
                    {aiLoading.description ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : (
                      <Wand2 aria-hidden />
                    )}
                    {description ? 'Improve with AI' : 'Suggest with AI'}
                  </Button>
                )}
              </div>
              <Textarea
                id={ids.description}
                ref={descriptionTextareaRef}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={readOnlyTask ? 'No description' : 'Add a description, link, or note…'}
                rows={3}
                disabled={readOnlyTask}
                className="min-h-24 resize-none rounded-lg border-border bg-background px-3 py-2 text-base leading-relaxed transition-colors md:text-sm disabled:cursor-default disabled:opacity-100"
              />
              {aiError && (
                <p role="alert" className="text-xs text-destructive">{aiError}</p>
              )}
            </section>

            {/* Subtasks */}
            <section className="space-y-2" aria-labelledby={ids.subtasksHeading}>
              <div className="flex min-h-8 items-center justify-between gap-3">
                <h3 id={ids.subtasksHeading} className={cn(SECTION_LABEL, 'flex items-center gap-2')}>
                  Subtasks
                  {subtaskProgress && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium normal-case tracking-normal text-foreground/80 tabular-nums">
                      {subtaskProgress.done}/{subtaskProgress.total}
                    </span>
                  )}
                </h3>
                {aiEnabled && title.trim().length >= 3 && !readOnlyTask && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowDecomposition(true)}
                    className={cn('h-8 min-h-0 gap-1.5 px-2 text-xs text-primary hover:text-primary', PRESS)}
                  >
                    <ListTree aria-hidden />
                    Break down with AI
                  </Button>
                )}
              </div>
              {subtaskProgress && (
                <div
                  role="progressbar"
                  aria-label="Subtasks completed"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={subtaskProgress.pct}
                  className="h-1 overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="h-full w-full origin-left bg-primary motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-[cubic-bezier(0.23,1,0.32,1)]"
                    style={{ transform: `scaleX(${subtaskProgress.pct / 100})` }}
                  />
                </div>
              )}
              {subtasks.length > 0 ? (
                <ul className="space-y-0.5">
                  {subtasks.map((subtask) => (
                    <li
                      key={subtask.id}
                      className="group flex min-h-10 items-center gap-1 rounded-md pr-1 hover:bg-muted/60 md:min-h-9"
                    >
                      <button
                        type="button"
                        onClick={() => toggleSubtask(subtask.id)}
                        disabled={readOnlyTask}
                        aria-pressed={subtask.completed}
                        aria-label={`Mark "${subtask.title}" as ${subtask.completed ? 'not done' : 'done'}`}
                        className={cn(
                          'flex h-10 w-10 shrink-0 items-center justify-center rounded-md disabled:cursor-not-allowed md:h-9 md:w-9',
                          FOCUS_RING,
                          PRESS,
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-4 w-4 items-center justify-center rounded-full border transition-colors',
                            subtask.completed ? 'border-success bg-success' : 'border-muted-foreground/50',
                          )}
                        >
                          {subtask.completed && (
                            <Check className="h-3 w-3 text-success-foreground" strokeWidth={3} aria-hidden />
                          )}
                        </span>
                      </button>
                      <span
                        className={cn(
                          'min-w-0 flex-1 truncate text-sm',
                          subtask.completed ? 'text-muted-foreground line-through' : 'text-foreground',
                        )}
                        title={subtask.title}
                      >
                        {subtask.title}
                      </span>
                      {!readOnlyTask && (
                        <button
                          type="button"
                          onClick={() => removeSubtask(subtask.id)}
                          aria-label={`Remove subtask "${subtask.title}"`}
                          className={cn(
                            'flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100 md:h-8 md:w-8',
                            FOCUS_RING,
                          )}
                        >
                          <X className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No subtasks yet{readOnlyTask ? '.' : ' — add steps below to break the work down.'}
                </p>
              )}
              {!readOnlyTask && (
                <div className="flex items-center gap-1 rounded-md pr-1 focus-within:bg-muted/60">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center md:h-9 md:w-9" aria-hidden>
                    <Plus className="h-4 w-4 text-muted-foreground" />
                  </span>
                  <label htmlFor={ids.subtaskInput} className="sr-only">
                    Add a subtask
                  </label>
                  <input
                    id={ids.subtaskInput}
                    type="text"
                    value={newSubtaskTitle}
                    onChange={(e) => setNewSubtaskTitle(e.target.value)}
                    placeholder="Add a subtask…"
                    autoComplete="off"
                    enterKeyHint="done"
                    className="h-10 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:h-9 md:text-sm"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        addSubtask();
                      }
                    }}
                  />
                  {newSubtaskTitle.trim() && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={addSubtask}
                      className={cn('h-8 min-h-0 px-2 text-xs', PRESS)}
                    >
                      Add
                    </Button>
                  )}
                </div>
              )}
            </section>

            {/* Attachments (everything uploaded on this task's comments) */}
            {isEditing && task && (
              <section className="space-y-2" aria-labelledby={ids.attachmentsHeading}>
                <div className="flex min-h-8 items-center justify-between gap-3">
                  <h3 id={ids.attachmentsHeading} className={cn(SECTION_LABEL, 'flex items-center gap-2')}>
                    Attachments
                    {allAttachments.length > 0 && (
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium normal-case tracking-normal text-foreground/80 tabular-nums">
                        {allAttachments.length}
                      </span>
                    )}
                  </h3>
                  {!readOnlyTask && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setActiveTab('comments');
                        commentFileInputRef.current?.click();
                      }}
                      className={cn('h-8 min-h-0 gap-1.5 px-2 text-xs', PRESS)}
                    >
                      <Paperclip aria-hidden />
                      Attach
                    </Button>
                  )}
                </div>
                {!commentsLoaded ? (
                  <div className="h-10 rounded-lg bg-muted motion-safe:animate-pulse" role="status" aria-label="Loading attachments" />
                ) : allAttachments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No files yet{readOnlyTask ? '.' : ' — attach them to a comment.'}
                  </p>
                ) : (
                  <AttachmentPreview attachments={allAttachments} />
                )}
              </section>
            )}

            {/* First comment (create only) */}
            {!isEditing && (
              <section className="space-y-2">
                <label htmlFor={ids.firstComment} className={cn(SECTION_LABEL, 'flex min-h-8 items-center gap-1.5')}>
                  First comment
                  <span className="font-normal normal-case tracking-normal">(optional)</span>
                </label>
                <MentionTextarea
                  id={ids.firstComment}
                  value={initialComment}
                  onChange={setInitialComment}
                  members={projectAssignableMembers}
                  excludeUserId={user?.userId}
                  placeholder="Add context for your team (@ to mention)"
                  rows={2}
                  className="min-h-[72px] resize-none rounded-lg border-border bg-background px-3 py-2 text-base transition-colors md:text-sm"
                />
              </section>
            )}

            {/* Comments / Activity / Expenses (edit only) */}
            {isEditing && task && (
              <section aria-label="Discussion and history">
                {/* Lives outside the tabs so "Attach" works from any tab. */}
                <input
                  ref={commentFileInputRef}
                  type="file"
                  multiple
                  accept="*/*"
                  className="hidden"
                  tabIndex={-1}
                  aria-hidden
                  onChange={(e) => {
                    const files = e.target.files;
                    if (!files?.length) return;
                    const validFiles: File[] = [];
                    for (const file of Array.from(files)) {
                      if (file.size > MAX_FILE_SIZE) {
                        toast.error(`${file.name} exceeds 500MB limit`);
                        continue;
                      }
                      validFiles.push(file);
                    }
                    if (validFiles.length > 0) {
                      setCommentAttachmentFiles((prev) => [...prev, ...validFiles]);
                    }
                    e.target.value = '';
                  }}
                />
                <Tabs
                  value={activeTab}
                  onValueChange={(v) => setActiveTab(v as 'comments' | 'activity' | 'expenses')}
                >
                  <TabsList className="h-auto w-full justify-start gap-1 rounded-none border-b border-border bg-transparent p-0">
                    {([
                      { value: 'comments', label: 'Comments', Icon: MessageSquare, count: commentsLoaded ? commentCount : null },
                      { value: 'activity', label: 'Activity', Icon: Activity, count: null },
                      { value: 'expenses', label: 'Expenses', Icon: Receipt, count: null },
                    ] as const).map(({ value, label, Icon, count }) => (
                      <TabsTrigger
                        key={value}
                        value={value}
                        className="-mb-px h-10 gap-1.5 rounded-none border-b-2 border-transparent bg-transparent px-3 text-sm text-muted-foreground shadow-none transition-colors hover:text-foreground focus-visible:ring-offset-0 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
                      >
                        <Icon className="h-4 w-4" aria-hidden />
                        {label}
                        {count !== null && count > 0 && (
                          <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums">
                            {count}
                          </span>
                        )}
                      </TabsTrigger>
                    ))}
                  </TabsList>

                  <TabsContent value="comments" className="mt-4 space-y-4 focus-visible:ring-offset-0">
                    {!readOnlyTask && (
                      <div
                        ref={commentComposerRef}
                        className="overflow-hidden rounded-lg border border-border bg-background transition-colors focus-within:border-ring"
                      >
                        <MentionTextarea
                          value={newComment}
                          onChange={(v) => {
                            setNewComment(v);
                            if (task?.taskId) {
                              scheduleCommentTypingBroadcast(task.taskId);
                            }
                          }}
                          members={projectAssignableMembers}
                          excludeUserId={user?.userId}
                          placeholder="Write a comment… (@ to mention)"
                          aria-label="Write a comment"
                          rows={2}
                          className="min-h-[72px] resize-none border-0 bg-transparent px-3 py-2 text-base focus-visible:ring-0 focus-visible:ring-offset-0 md:text-sm"
                        />
                        {task?.taskId && typingPeers && <TypingIndicator peers={typingPeers(task.taskId)} />}

                        {commentAttachmentFiles.length > 0 && (
                          <ul className="flex flex-wrap gap-1.5 border-t border-border px-3 py-2" aria-label="Files to attach">
                            {commentAttachmentFiles.map((f, i) => (
                              <li
                                key={`${f.name}-${i}`}
                                className="inline-flex h-7 items-center gap-1 rounded-md bg-muted pl-2 text-xs"
                                title={f.name}
                              >
                                <Paperclip className="h-3 w-3 text-muted-foreground" aria-hidden />
                                <span className="max-w-[150px] truncate">{truncateFileName(f.name, 20)}</span>
                                <button
                                  type="button"
                                  onClick={() => setCommentAttachmentFiles((p) => p.filter((_, idx) => idx !== i))}
                                  aria-label={`Remove ${f.name}`}
                                  className={cn('flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-destructive', FOCUS_RING)}
                                >
                                  <X className="h-3 w-3" aria-hidden />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}

                        {showTimeSpent && (
                          <div className="flex items-center gap-2 border-t border-border px-3 py-2">
                            <label htmlFor={ids.timeSpent} className="text-xs text-muted-foreground">
                              Time spent
                            </label>
                            <Input
                              id={ids.timeSpent}
                              type="number"
                              inputMode="numeric"
                              min={0}
                              placeholder="0"
                              value={commentTimeSpentMinutes === '' ? '' : commentTimeSpentMinutes}
                              onChange={(e) => {
                                const v = e.target.value;
                                setCommentTimeSpentMinutes(v === '' ? '' : Math.max(0, parseInt(v, 10) || 0));
                              }}
                              className="h-10 w-20 rounded-md px-2 text-center text-base tabular-nums transition-colors md:h-8 md:text-sm"
                            />
                            <span className="text-xs text-muted-foreground">minutes</span>
                            <button
                              type="button"
                              onClick={() => {
                                setShowTimeSpent(false);
                                setCommentTimeSpentMinutes('');
                              }}
                              aria-label="Remove time spent"
                              className={cn('ml-auto flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground', FOCUS_RING)}
                            >
                              <X className="h-4 w-4" aria-hidden />
                            </button>
                          </div>
                        )}

                        <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/40 px-2 py-1.5">
                          <div className="flex items-center gap-0.5">
                            <EmojiPickerButton value={newComment} onChange={setNewComment} />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => commentFileInputRef.current?.click()}
                              className={cn('h-8 min-h-0 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground', PRESS)}
                            >
                              <Paperclip aria-hidden />
                              Attach
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-pressed={showTimeSpent}
                              onClick={() => setShowTimeSpent(!showTimeSpent)}
                              className={cn(
                                'h-8 min-h-0 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground',
                                showTimeSpent && 'bg-muted text-foreground',
                                PRESS,
                              )}
                            >
                              <Clock aria-hidden />
                              Time
                            </Button>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="hidden text-[11px] text-muted-foreground lg:inline">
                              {modKey}+Enter
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => void handleAddComment()}
                              disabled={(!newComment.trim() && commentAttachmentFiles.length === 0) || commentLoading}
                              aria-keyshortcuts="Meta+Enter Control+Enter"
                              className={cn('h-8 min-h-0 min-w-[5.5rem] gap-1.5 px-3', PRESS)}
                            >
                              {commentLoading ? (
                                <>
                                  <Loader2 className="animate-spin" aria-hidden />
                                  Posting
                                </>
                              ) : (
                                'Comment'
                              )}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}

                    {commentCount >= 4 && aiEnabled && (
                      <CommentSummaryCard
                        count={commentCount}
                        summary={commentSummary}
                        loading={commentSummaryLoading}
                        error={commentSummaryError}
                        open={commentSummaryOpen}
                        onToggle={() => setCommentSummaryOpen((v) => !v)}
                        onSummarize={() => void handleSummarizeComments()}
                      />
                    )}

                    {!commentsLoaded ? (
                      <ListSkeleton label="Loading comments" rows={2} />
                    ) : commentCount === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        No comments yet{readOnlyTask ? '.' : ' — start the conversation above.'}
                      </p>
                    ) : (
                      <ul className="space-y-4">
                        {taskComments.map((comment) => (
                          <li key={comment.commentId} className="group flex gap-3">
                            <Avatar className="h-8 w-8 shrink-0">
                              <AvatarImage src={comment.photoURL} alt="" />
                              <AvatarFallback className="bg-primary-soft text-xs text-primary-soft-foreground">
                                {comment.displayName?.charAt(0).toUpperCase() || '?'}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1">
                              <div className="flex min-h-8 items-center justify-between gap-2">
                                <div className="flex min-w-0 items-baseline gap-2">
                                  <span className="truncate text-sm font-medium text-foreground" title={comment.displayName}>
                                    {comment.displayName}
                                  </span>
                                  <time
                                    className="shrink-0 text-xs text-muted-foreground tabular-nums"
                                    dateTime={comment.createdAt ? new Date(comment.createdAt).toISOString() : undefined}
                                    title={comment.createdAt ? new Date(comment.createdAt).toLocaleString() : undefined}
                                  >
                                    {formatDistanceSafe(comment.createdAt)}
                                  </time>
                                </div>
                                {(comment.userId === user?.userId || isAdmin) && !readOnlyTask && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className={cn(
                                      'h-8 w-8 min-h-0 min-w-0 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100 md:min-h-0 md:min-w-0',
                                      deletingCommentId === comment.commentId && 'opacity-100',
                                    )}
                                    disabled={deletingCommentId === comment.commentId}
                                    aria-label="Delete comment"
                                    title="Delete comment"
                                    onClick={() => void handleDeleteComment(comment.commentId)}
                                  >
                                    {deletingCommentId === comment.commentId ? (
                                      <Loader2 className="animate-spin" aria-hidden />
                                    ) : (
                                      <Trash2 aria-hidden />
                                    )}
                                  </Button>
                                )}
                              </div>
                              {comment.timeSpentMinutes != null && comment.timeSpentMinutes > 0 && (
                                <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-xs text-success-soft-foreground tabular-nums">
                                  <Clock className="h-3 w-3" aria-hidden />
                                  {formatTimeLogged(comment.timeSpentMinutes)} logged
                                </span>
                              )}
                              {comment.text?.trim() && (
                                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
                                  {comment.text}
                                </p>
                              )}
                              {comment.attachments && comment.attachments.length > 0 && (
                                <AttachmentPreview attachments={comment.attachments} />
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </TabsContent>

                  <TabsContent value="activity" className="mt-4 focus-visible:ring-offset-0">
                    <ActivityList events={taskActivityEvents} loading={taskActivityLoading} />
                  </TabsContent>

                  <TabsContent value="expenses" className="mt-4 focus-visible:ring-offset-0">
                    {/* Visible to creator/assignee + owner/admin via RLS */}
                    <TaskExpensesPanel
                      taskId={task.taskId}
                      taskTitle={task.title}
                      projectId={task.projectId}
                      projectName={project?.name ?? null}
                      readOnly={readOnlyTask}
                    />
                  </TabsContent>
                </Tabs>
              </section>
            )}
          </div>

          {/* Properties panel (first on mobile) */}
          <aside
            aria-label="Task properties"
            className="order-1 space-y-4 border-b border-border bg-surface-2 px-4 py-4 sm:px-6 md:order-2 md:min-h-0 md:overflow-y-auto md:overscroll-contain md:border-b-0 md:border-l md:px-4"
          >
            <div className="space-y-1">
              <PropertyRow label="Status" htmlFor={ids.status}>
                <Select value={status} onValueChange={setStatus} disabled={readOnlyTask}>
                  <SelectTrigger id={ids.status} className={GHOST_FIELD}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {columns.map((col) => (
                      <SelectItem key={col.id} value={col.id}>
                        <span className="flex items-center gap-2">
                          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: col.color }} />
                          <span className="truncate">{col.title}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </PropertyRow>

              <PropertyRow label="Priority" htmlFor={ids.priority}>
                <Select
                  value={priority}
                  onValueChange={(v) => setPriority(v as TaskPriority)}
                  disabled={readOnlyTask}
                >
                  <SelectTrigger id={ids.priority} className={GHOST_FIELD}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PRIORITY_COLORS).map(([key, color]) => (
                      <SelectItem key={key} value={key}>
                        <span className="flex items-center gap-2">
                          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                          {key.charAt(0).toUpperCase() + key.slice(1)}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </PropertyRow>

              <PropertyRow label="Due date" htmlFor={ids.due}>
                <DayPickerPopover
                  id={ids.due}
                  value={dueDate}
                  onChange={setDueDate}
                  disabled={readOnlyTask}
                  className={cn(GHOST_FIELD, 'tabular-nums')}
                />
              </PropertyRow>

              <PropertyRow label="Assignees" labelId={ids.assignees}>
                <div role="group" aria-labelledby={ids.assignees} className="min-h-8 px-2 py-1">
                  <AssigneePicker
                    value={assignees}
                    members={projectAssignableMembers}
                    onChange={setAssignees}
                    disabled={readOnlyTask}
                  />
                </div>
              </PropertyRow>

              <PropertyRow label="Tags" htmlFor={ids.tags}>
                <div className="flex flex-wrap items-center gap-1.5 px-2 py-1">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex h-6 max-w-full items-center gap-0.5 rounded-full bg-info-soft pl-2 text-xs text-info-soft-foreground"
                      title={tag}
                    >
                      <span className="truncate">{tag}</span>
                      {!readOnlyTask && (
                        <button
                          type="button"
                          onClick={() => setTags(tags.filter((t) => t !== tag))}
                          className={cn('flex h-6 w-6 items-center justify-center rounded-full hover:text-destructive', FOCUS_RING)}
                          aria-label={`Remove tag ${tag}`}
                        >
                          <X className="h-3 w-3" aria-hidden />
                        </button>
                      )}
                    </span>
                  ))}
                  {readOnlyTask ? (
                    tags.length === 0 && <span className="text-sm text-muted-foreground">None</span>
                  ) : (
                    <input
                      id={ids.tags}
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      placeholder={tags.length ? 'Add…' : 'Add tag…'}
                      autoComplete="off"
                      className="h-8 min-w-[72px] flex-1 rounded-md bg-transparent px-1 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring md:h-7 md:text-sm"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ',') {
                          if (e.metaKey || e.ctrlKey) return;
                          e.preventDefault();
                          const v = tagInput.replace(/,/g, '').trim();
                          if (v && !tags.includes(v)) setTags([...tags, v]);
                          setTagInput('');
                        }
                      }}
                    />
                  )}
                </div>
              </PropertyRow>

              <PropertyRow label="Urgent" htmlFor={ids.urgent}>
                <div className="flex h-10 items-center gap-2 px-2 md:h-8">
                  <Switch
                    id={ids.urgent}
                    checked={urgent}
                    onCheckedChange={setUrgent}
                    disabled={readOnlyTask}
                    className="data-[state=checked]:bg-destructive"
                  />
                  {urgent && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                      Urgent
                    </span>
                  )}
                </div>
              </PropertyRow>

              <div className="pt-1">
                <MeetingProperty
                  startsAt={meetingStartsAt}
                  durationMinutes={meetingDurationMinutes}
                  onChange={handleMeetingChange}
                  readOnly={readOnlyTask}
                  isSaved={Boolean(isEditing && task?.taskId)}
                  joinDisabledReason={joinDisabledReason}
                  onJoin={handleJoinMeeting}
                  now={now}
                />
                {task?.googleMeetLink && (
                  <a
                    href={task.googleMeetLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={task.googleMeetLink}
                    className={cn(
                      'mt-1 inline-flex h-8 max-w-full items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline',
                      FOCUS_RING,
                    )}
                  >
                    <Video className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="truncate">Google Meet (old)</span>
                    <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                  </a>
                )}
              </div>

              <PropertyRow label="Lock" htmlFor={ids.lock} className="pt-1">
                <div
                  className="flex h-10 items-center gap-2 px-2 md:h-8"
                  title={
                    !canManageLockAndPin
                      ? 'Only the organization owner or an admin can lock or unlock a task'
                      : 'Only creator, assignees, and project owner can see this task'
                  }
                >
                  <Switch
                    id={ids.lock}
                    checked={isLocked}
                    onCheckedChange={setIsLocked}
                    disabled={readOnlyTask || !canManageLockAndPin}
                    aria-describedby={ids.lockHint}
                    className="data-[state=checked]:bg-warning"
                  />
                  <span className="truncate text-xs text-muted-foreground">
                    {isLocked ? 'Sensitive' : 'Off'}
                  </span>
                </div>
              </PropertyRow>
              <p id={ids.lockHint} className="sr-only">
                Locked tasks are only visible to the creator, assignees, and project owner.
              </p>

              {isLocked && canManageLockAndPin && (
                <div className="ml-2 space-y-2 border-l-2 border-border py-1 pl-3">
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    {isEditing
                      ? 'Optional PIN so assignees can unlock and edit. Leave blank to keep the current PIN.'
                      : 'Add a PIN to require collaborators to unlock before editing, or leave blank for owner/assignee-only visibility.'}
                  </p>
                  <label htmlFor={ids.pinNew} className="sr-only">New PIN</label>
                  <Input
                    id={ids.pinNew}
                    type="password"
                    name="task-new-pin"
                    autoComplete="new-password"
                    data-1p-ignore
                    data-lpignore="true"
                    data-form-type="other"
                    placeholder="New PIN"
                    value={lockPinNew}
                    onChange={(e) => setLockPinNew(e.target.value)}
                    className="h-10 rounded-md px-3 text-base transition-colors md:h-8 md:text-sm"
                  />
                  <label htmlFor={ids.pinConfirm} className="sr-only">Confirm PIN</label>
                  <Input
                    id={ids.pinConfirm}
                    type="password"
                    name="task-confirm-pin"
                    autoComplete="new-password"
                    data-1p-ignore
                    data-lpignore="true"
                    data-form-type="other"
                    placeholder="Confirm PIN"
                    value={lockPinConfirm}
                    onChange={(e) => setLockPinConfirm(e.target.value)}
                    className="h-10 rounded-md px-3 text-base transition-colors md:h-8 md:text-sm"
                  />
                  {isEditing && task?.hasLockPin && (
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      A PIN is already set. Save with blank fields to keep it, or enter a new one to replace it.
                    </p>
                  )}
                </div>
              )}
              {isLocked && isEditing && !canManageLockAndPin && task?.hasLockPin && (
                <p className="ml-2 border-l-2 border-border pl-3 text-[11px] leading-snug text-muted-foreground">
                  Only the organization owner or an admin can change the lock or PIN on this task.
                </p>
              )}
            </div>

            {aiEnabled && !readOnlyTask && (
              <div className="space-y-2 border-t border-border pt-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(GHOST_FIELD, 'text-muted-foreground hover:text-foreground', PRESS)}
                  onClick={handleGetSmartSuggestions}
                  disabled={!title.trim() || aiLoading.suggestions}
                >
                  {aiLoading.suggestions ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Sparkles className="text-primary" aria-hidden />
                  )}
                  Suggest priority &amp; due date
                </Button>
                {aiSuggestion && showAISuggestion && (
                  <div className="space-y-2 rounded-lg bg-primary-soft p-3 text-xs text-primary-soft-foreground" aria-live="polite">
                    <p className="leading-snug">{aiSuggestion.reasoning}</p>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        size="sm"
                        className={cn('h-8 min-h-0 px-3 text-xs', PRESS)}
                        onClick={handleApplySuggestions}
                      >
                        Apply
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className={cn('h-8 min-h-0 px-3 text-xs', PRESS)}
                        onClick={() => setShowAISuggestion(false)}
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {isEditing && task && (task.createdAt != null || task.updatedAt != null) && (
              <dl className="space-y-1 border-t border-border pt-4 text-[11px] text-muted-foreground tabular-nums">
                {task.createdAt != null && (
                  <div className="flex gap-1">
                    <dt>Created</dt>
                    <dd>{formatDistanceSafe(task.createdAt)}</dd>
                  </div>
                )}
                {task.updatedAt != null && (
                  <div className="flex gap-1">
                    <dt>Updated</dt>
                    <dd>{formatDistanceSafe(task.updatedAt)}</dd>
                  </div>
                )}
              </dl>
            )}
          </aside>
        </div>

        {/* ── Footer ──────────────────────────────────────── */}
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-background px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:px-6 sm:pb-3">
          <p className="min-w-0 truncate text-xs text-muted-foreground" aria-live="polite">
            {footerHint}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={loading}
              className={PRESS}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={loading || !title.trim() || readOnlyTask}
              aria-keyshortcuts="Meta+Enter Control+Enter"
              title={`${isEditing ? 'Save changes' : 'Create task'} (${modKey}+Enter)`}
              className={cn('min-w-[8.5rem] gap-2', PRESS)}
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden />
                  Saving…
                </>
              ) : isEditing ? (
                'Save changes'
              ) : (
                'Create task'
              )}
            </Button>
          </div>
        </footer>

        {showDecomposition && user && (
          <SubtaskDecompositionModal
            open={showDecomposition}
            onClose={() => setShowDecomposition(false)}
            parentTask={{ title, description }}
            projectId={projectId}
            projectName={projectName}
            userId={user.userId}
            onCreateSubtasks={async (newSubtasks) => {
              setSubtasks((prev) => [
                ...prev,
                ...newSubtasks.map((st) => ({
                  id: crypto.randomUUID(),
                  title: st.title,
                  completed: false,
                })),
              ]);
            }}
          />
        )}

        {showNotifyModal && task && user && (
          <NotifyModal
            open={showNotifyModal}
            onClose={() => setShowNotifyModal(false)}
            taskId={task.taskId}
            taskTitle={title || task.title}
            projectId={projectId}
            projectName={projectName || ''}
            members={projectAssignableMembers}
            actorUserId={user.userId}
            actorDisplayName={user.displayName || user.email || 'User'}
          />
        )}

        {showMoveTask && task && (
          <MoveTaskDialogWithProjects
            open={showMoveTask}
            onOpenChange={setShowMoveTask}
            task={{ taskId: task.taskId, title: title || task.title, status: task.status }}
            currentProjectId={projectId}
            onMoved={() => onClose()}
          />
        )}

        <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this task?</AlertDialogTitle>
              <AlertDialogDescription>
                {title.trim() ? `"${title.trim()}" and its subtasks, comments and activity` : 'This task'} will be
                permanently deleted. This can’t be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={async () => {
                  setShowDeleteConfirm(false);
                  await handleDelete();
                }}
              >
                Delete task
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={showUnlockGate} onOpenChange={setShowUnlockGate}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5" aria-hidden />
                Unlock task
              </AlertDialogTitle>
              <AlertDialogDescription>
                Enter the PIN set by a project owner or admin for this locked task.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <label htmlFor={ids.unlockPin2} className="sr-only">Task PIN</label>
            <Input
              id={ids.unlockPin2}
              type="password"
              name="task-unlock-pin-2"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              data-form-type="other"
              placeholder="PIN"
              value={unlockAttempt}
              onChange={(e) => setUnlockAttempt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void verifyUnlockPin();
              }}
              className="mt-2 transition-colors"
            />
            <AlertDialogFooter className="mt-4">
              <AlertDialogCancel onClick={() => { setShowUnlockGate(false); setUnlockAttempt(''); }}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  void verifyUnlockPin();
                }}
              >
                Unlock
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        </>
        )}
      </DialogContent>
    </Dialog>
  );
};


export default TaskModal;
