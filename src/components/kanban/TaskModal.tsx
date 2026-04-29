import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Task, TaskPriority, KanbanColumn, DEFAULT_COLUMNS, PRIORITY_COLORS,
  CreateTaskInput, TaskAssignee, Project, TaskComment,
} from '@/types';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  Trash2, Loader2, Sparkles, Wand2, MessageSquare,
  ListTree, Paperclip, X, Check, Circle, Activity, Clock,
  CheckCircle2, Lock, MoreHorizontal, Bell, Mail, Link2,
  AlertTriangle, Save, KeyRound, Users,
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
  getTaskComments,
  markNotificationsReadByTask,
  notifyTaskCommentMentions,
  subscribeToComments,
  verifyTaskLockPin,
} from '@/services/supabase/database';
import { dispatchNotificationsRefresh } from '@/lib/notificationEvents';
import { markOnboardingAi } from '@/components/onboarding/OnboardingChecklist';
import { useTaskActivity } from '@/hooks/useActivity';
import { ActivityEvent } from '@/types/activity';
import { uploadCommentAttachment } from '@/services/supabase/storage';
import { SubtaskDecompositionModal } from './SubtaskDecompositionModal';
import { NotifyModal } from './NotifyModal';
import { DayPickerPopover } from './DayPickerPopover';
import { AssigneePicker } from './AssigneePicker';
import { EmojiPickerButton } from '@/components/ui/emoji-picker';
import { MentionTextarea } from '@/components/mentions/MentionTextarea';
import { cn, formatDistanceSafe, truncateFileName } from '@/lib/utils';
import AttachmentPreview from '../ui/AttachmentPreview';
import { toast } from 'sonner';
import type { PresencePeer } from '@/hooks/usePresence';

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
  const { organization, isAdmin } = useOrganization();

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

  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');

  const [aiLoading, setAiLoading] = useState<{ description?: boolean; suggestions?: boolean }>({});
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<SmartSuggestionResponse | null>(null);
  const [showAISuggestion, setShowAISuggestion] = useState(false);

  const [activeTab, setActiveTab] = useState<'comments' | 'activity'>('comments');
  const [newComment, setNewComment] = useState('');
  const [commentAttachmentFiles, setCommentAttachmentFiles] = useState<File[]>([]);
  const [commentTimeSpentMinutes, setCommentTimeSpentMinutes] = useState<number | ''>('');
  const [showTimeSpent, setShowTimeSpent] = useState(false);
  const [commentLoading, setCommentLoading] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const [taskComments, setTaskComments] = useState<TaskComment[]>([]);
  const [commentSummary, setCommentSummary] = useState<CommentSummary | null>(null);
  const [commentSummaryLoading, setCommentSummaryLoading] = useState(false);
  const [commentSummaryError, setCommentSummaryError] = useState<string | null>(null);
  const [commentSummaryOpen, setCommentSummaryOpen] = useState(false);
  const commentFileInputRef = useRef<HTMLInputElement>(null);
  const descriptionTextareaRef = useRef<HTMLTextAreaElement>(null);
  const commentTypingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const MAX_FILE_SIZE = 2 * 1024 * 1024;

  const isEditing = !!task;
  /** Task without PIN: owner / admin / creator may edit without entering PIN. */
  const canOverrideTaskLock = useMemo(() => {
    if (!user) return false;
    if (project?.ownerId === user.userId) return true;
    if (task?.createdBy === user.userId) return true;
    return isAdmin;
  }, [user, project?.ownerId, task?.createdBy, isAdmin]);

  /** Only the user who created the task may set, change, or clear lock + PIN (create flow always allowed). */
  const isTaskCreator = Boolean(
    user && task?.createdBy && task.createdBy === user.userId,
  );
  const canManageLockAndPin = !isEditing || isTaskCreator;

  const hasLockPin = Boolean(task?.hasLockPin);
  const lockedWithPin = Boolean(isEditing && task?.isLocked && hasLockPin);
  /**
   * Edit gate.
   *  - PIN-locked: PIN is the only way through, even for the owner / admin / creator.
   *    The PIN was set explicitly to enforce a stronger gate; bypassing it for owners would
   *    defeat the feature.
   *  - No-PIN locked: owner / admin / creator can edit (no PIN exists to enter).
   */
  const readOnlyTask = Boolean(
    isEditing &&
      task?.isLocked &&
      (lockedWithPin ? !pinUnlockedSession : !canOverrideTaskLock),
  );

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
      setTitle(task.title);
      setDescription(task.description);
      setStatus(task.status);
      setPriority(task.priority);
      setDueDate(task.dueDate ? new Date(task.dueDate) : null);
      setAssignees(task.assignees || []);
      setUrgent(!!task.urgent);
      setIsLocked(!!task.isLocked);
      setTags(task.tags || []);
      setSubtasks(task.subtasks?.length ? task.subtasks : []);
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
    }
    setAiError(null);
    setSaveError(null);
    setLastSavedAt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: `task` object identity updates after realtime/refetch must not reset fields
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
      return;
    }
    const unsub = subscribeToComments(task.taskId, orgId, setTaskComments);
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

          const ownerEmail =
            ownerProfile?.email || (ownerId === user?.userId ? user?.email || '' : '');
          const ownerEmailLocal = ownerEmail.split('@')[0] || '';
          const ownerName =
            ownerProfile?.display_name ||
            (ownerId === user?.userId ? user?.displayName : '') ||
            ownerEmailLocal ||
            'Member';

          memberMap.set(ownerId, {
            userId: ownerId,
            displayName: ownerName,
            email: ownerEmail,
            photoURL: ownerProfile?.photo_url || (ownerId === user?.userId ? user?.photoURL || '' : ''),
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
            memberMap.set(uid, {
              userId: uid,
              displayName: profile?.display_name || m.displayName || m.display_name || m.email || 'Member',
              email: profile?.email || m.email || '',
              photoURL: profile?.photo_url || m.photoURL || m.photo_url || '',
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
  }, [open, projectId, project?.ownerId, user?.userId, user?.email, user?.displayName, user?.photoURL]);

  // ── AI Handlers ────────────────────────────────────────────
  const handleExpandDescription = async () => {
    if (!title.trim() || !user) return;
    setAiLoading((p) => ({ ...p, description: true }));
    setAiError(null);
    try {
      const result = await expandDescription(user.userId, { title, projectContext: projectName });
      setDescription(result.description);
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
      setDescription(result.description);
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
      setTitle(result.title);
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
      const snippets = taskComments.map((c) => ({
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
            toast.error(`${file.name} exceeds 2MB limit`);
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
      const isLockedForSave =
        isEditing && task && user && task.createdBy !== user.userId
          ? !!task.isLocked
          : isLocked;

      let lockPinHashPayload: string | null | undefined = undefined;
      let createdTaskId: string | undefined;
      const creatorControlsLock = !isEditing || isTaskCreator;

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

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className="sm:max-w-[1024px] max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0 [&>button]:top-3.5"
        aria-describedby={undefined}
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
          <div className="flex flex-col items-center justify-center px-6 py-12 sm:py-16 gap-5 text-center min-h-[min(420px,70vh)]">
            <KeyRound className="w-14 h-14 text-muted-foreground" aria-hidden />
            <div className="space-y-1 max-w-sm">
              <h2 className="text-lg font-semibold text-foreground">This task is locked</h2>
              <p className="text-sm text-muted-foreground">
                Enter the PIN to view details, comments, and activity. When you close this task or
                save changes, you will need the PIN again to view or edit it.
              </p>
            </div>
            <Input
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
              onKeyDown={(e) => {
                if (e.key === 'Enter') void verifyUnlockPin();
              }}
              className="max-w-xs bg-background border-border"
            />
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => { onClose(); setUnlockAttempt(''); }}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void verifyUnlockPin()}
                disabled={!unlockAttempt.trim()}
                className="gap-1.5"
              >
                <KeyRound className="w-4 h-4" />
                Unlock
              </Button>
            </div>
          </div>
        ) : (
        <>
        {/* ── Header ──────────────────────────────────────── */}
        <DialogHeader className="px-5 py-3 pr-14 border-b border-border space-y-0">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setStatus(status === 'done' ? 'todo' : 'done')}
              disabled={readOnlyTask}
              className={cn(
                'w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors',
                status === 'done'
                  ? 'bg-success border-success text-success-foreground'
                  : 'border-border hover:border-foreground/40',
              )}
              title={status === 'done' ? 'Mark as not done' : 'Mark as done'}
            >
              {status === 'done' && <Check className="w-3 h-3" strokeWidth={3} />}
            </button>

            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground truncate">
                {organization?.name || 'Workspace'} <span className="opacity-60">›</span>{' '}
                {projectName || 'Project'}
              </p>
            </div>

            <div className="flex items-center gap-0.5 shrink-0 h-9">
              {peersOnTask.length > 0 && (
                <div
                  className="hidden sm:flex items-center gap-1 mr-2"
                  title={`${peersOnTask
                    .map((p) => p.displayName)
                    .join(', ')} viewing this task`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                  <div className="flex -space-x-1.5">
                    {peersOnTask.slice(0, 3).map((peer) => (
                      <span key={peer.userId} className="block">
                        {peer.photoURL ? (
                          <img
                            src={peer.photoURL}
                            alt={peer.displayName}
                            className="w-5 h-5 rounded-full ring-2 ring-card object-cover"
                          />
                        ) : (
                          <span className="w-5 h-5 rounded-full bg-primary-soft text-primary-soft-foreground text-[10px] font-semibold flex items-center justify-center ring-2 ring-card">
                            {(peer.displayName || '?').charAt(0).toUpperCase()}
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                  {peersOnTask.length > 3 && (
                    <span className="text-[11px] text-muted-foreground font-medium">
                      +{peersOnTask.length - 3}
                    </span>
                  )}
                </div>
              )}
              {lastSavedAt && (
                <span
                  className="text-[11px] text-muted-foreground hidden sm:inline-flex items-center gap-1"
                  title={lastSavedAt.toLocaleTimeString()}
                >
                  <Save className="w-3 h-3" /> Saved
                </span>
              )}
              {isEditing && task && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 inline-flex items-center justify-center text-muted-foreground hover:text-foreground"
                  onClick={() => setShowNotifyModal(true)}
                  title="Notify team members"
                >
                  <Bell className="w-4 h-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0 inline-flex items-center justify-center text-muted-foreground hover:text-foreground"
                onClick={copyTaskUrl}
                disabled={!task}
                title="Copy task URL"
              >
                <Link2 className="w-4 h-4" />
              </Button>
              {isEditing && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 inline-flex items-center justify-center text-muted-foreground hover:text-foreground"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>Actions</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {aiEnabled && (
                      <>
                        <DropdownMenuItem
                          onClick={handleGetSmartSuggestions}
                          disabled={readOnlyTask}
                        >
                          <Sparkles className="w-4 h-4 mr-2 text-primary" />
                          AI: priority &amp; due date
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={handleGenerateTitleFromDescription}
                          disabled={
                            readOnlyTask ||
                            description.trim().length < 10 ||
                            aiLoading.description
                          }
                        >
                          <Sparkles className="w-4 h-4 mr-2 text-primary" />
                          AI: title from description
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={handleExpandDescription}
                          disabled={readOnlyTask || !title.trim()}
                        >
                          <Wand2 className="w-4 h-4 mr-2 text-primary" />
                          AI: write description
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setShowDecomposition(true)}
                          disabled={readOnlyTask || !title.trim()}
                        >
                          <ListTree className="w-4 h-4 mr-2 text-primary" />
                          AI: break into subtasks
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    )}
                    <DropdownMenuItem onClick={() => toast.info('Reply by email — coming soon')}>
                      <Mail className="w-4 h-4 mr-2" />
                      Reply by email
                    </DropdownMenuItem>
                    {onDelete && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setShowDeleteConfirm(true)}
                          disabled={readOnlyTask}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete task
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </DialogHeader>

        {saveError && (
          <div className="mx-5 mt-3 p-2 bg-destructive-soft text-destructive-soft-foreground rounded-md text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {saveError}
          </div>
        )}

        {readOnlyTask && (
          <div className="mx-5 mt-3 p-2.5 rounded-md text-sm flex flex-wrap items-center gap-2 bg-secondary border border-border text-foreground">
            <Lock className="w-4 h-4 shrink-0 text-warning" />
            {hasLockPin ? (
              <>
                <span className="flex-1 min-w-[200px]">
                  This task is locked with a PIN. Enter it to edit (this device only until you clear browser data).
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="shrink-0 gap-1"
                  onClick={() => setShowUnlockGate(true)}
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  Enter PIN
                </Button>
              </>
            ) : (
              <span>
                This task is locked. Only the project owner or a workspace admin can make changes.
              </span>
            )}
          </div>
        )}

        {/* ── Body: two-pane ────────────────────────────────── */}
        <form
          onSubmit={handleSubmit}
          className="flex-1 grid grid-cols-1 md:grid-cols-[1fr_300px] overflow-hidden"
        >
          {/* Left pane */}
          <div className="overflow-y-auto px-5 py-4 space-y-4 border-r border-border">
            {/* Title */}
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && title.trim()) {
                  e.preventDefault();
                  void handleSubmit();
                }
              }}
              placeholder="Task title…"
              autoFocus={!isEditing}
              disabled={readOnlyTask}
              className="text-2xl font-semibold tracking-tight border-0 px-0 h-auto py-1 placeholder:text-muted-foreground/70 focus-visible:ring-0 bg-transparent"
            />

            {/* Description */}
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 min-h-8">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground shrink-0 mb-0">
                  Description
                </Label>
                {aiEnabled && title.trim().length >= 3 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={description ? handleRefineDescription : handleExpandDescription}
                    disabled={readOnlyTask || aiLoading.description}
                    className="text-xs h-7 shrink-0 gap-1 text-primary hover:text-primary"
                  >
                    {aiLoading.description ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Wand2 className="w-3 h-3" />
                    )}
                    {description ? 'Improve with AI' : 'Suggest with AI'}
                  </Button>
                )}
              </div>
              <Textarea
                ref={descriptionTextareaRef}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add a description, link, or note…"
                rows={3}
                disabled={readOnlyTask}
                className="resize-none min-h-[6rem] text-sm leading-relaxed"
              />
              {aiError && (
                <p className="text-xs text-destructive">{aiError}</p>
              )}
            </div>

            {/* Subtasks */}
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 min-h-8">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground shrink-0 mb-0">
                  Subtasks
                  {subtaskProgress && (
                    <span className="ml-2 normal-case text-foreground/80 font-normal">
                      {subtaskProgress.done}/{subtaskProgress.total} ·{' '}
                      {subtaskProgress.pct}%
                    </span>
                  )}
                </Label>
                {aiEnabled && title.trim().length >= 3 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowDecomposition(true)}
                    disabled={readOnlyTask}
                    className="text-xs h-7 shrink-0 gap-1 text-primary hover:text-primary"
                  >
                    <ListTree className="w-3 h-3" />
                    Break with AI
                  </Button>
                )}
              </div>
              {subtaskProgress && (
                <div className="h-1 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${subtaskProgress.pct}%` }}
                  />
                </div>
              )}
              <div className="space-y-0.5">
                {subtasks.map((subtask) => (
                  <div
                    key={subtask.id}
                    className="flex items-center gap-2 py-1 px-1 rounded hover:bg-secondary group"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSubtask(subtask.id)}
                      disabled={readOnlyTask}
                      className={cn(
                        'w-4 h-4 rounded-full border flex items-center justify-center shrink-0',
                        subtask.completed
                          ? 'bg-success border-success'
                          : 'border-border',
                      )}
                    >
                      {subtask.completed && (
                        <Check className="w-3 h-3 text-success-foreground" strokeWidth={3} />
                      )}
                    </button>
                    <span
                      className={cn(
                        'text-sm flex-1',
                        subtask.completed && 'line-through text-muted-foreground',
                      )}
                    >
                      {subtask.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeSubtask(subtask.id)}
                      disabled={readOnlyTask}
                      className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 disabled:opacity-0"
                      aria-label="Remove subtask"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <div className="flex items-center gap-2 py-1 px-1">
                  <Circle className="w-4 h-4 text-muted-foreground/60 shrink-0" />
                  <input
                    type="text"
                    value={newSubtaskTitle}
                    onChange={(e) => setNewSubtaskTitle(e.target.value)}
                    placeholder="Add a subtask…"
                    disabled={readOnlyTask}
                    className="flex-1 text-sm outline-none bg-transparent placeholder:text-muted-foreground"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addSubtask();
                      }
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Initial comment (create only) */}
            {!isEditing && (
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <MessageSquare className="w-3 h-3" />
                  First comment (optional)
                </Label>
                <MentionTextarea
                  value={initialComment}
                  onChange={setInitialComment}
                  members={projectAssignableMembers}
                  excludeUserId={user?.userId}
                  placeholder="Optional: add a comment along with this task (@ to mention)"
                  rows={2}
                  className="resize-none"
                />
              </div>
            )}

            {/* Comments / Activity (edit mode only) */}
            {isEditing && task && (
              <div className="pt-2">
                <Tabs
                  value={activeTab}
                  onValueChange={(v) => setActiveTab(v as 'comments' | 'activity')}
                >
                  <TabsList className="grid w-full grid-cols-2 h-10 p-1">
                    <TabsTrigger
                      value="comments"
                      className="h-8 px-3 py-0 text-sm gap-1.5"
                    >
                      <MessageSquare className="w-4 h-4" />
                      Comments
                    </TabsTrigger>
                    <TabsTrigger
                      value="activity"
                      className="h-8 px-3 py-0 text-sm gap-1.5"
                    >
                      <Activity className="w-4 h-4" />
                      Activity
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="comments" className="mt-3 space-y-3">
                    <div className="border border-border rounded-lg bg-card">
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
                        rows={2}
                        disabled={readOnlyTask}
                        className="border-0 resize-none focus-visible:ring-0 bg-transparent"
                      />
                      {task?.taskId && typingPeers && (() => {
                        const typing = typingPeers(task.taskId);
                        if (typing.length === 0) return null;
                        const names = typing.map((p) => p.displayName);
                        const label =
                          names.length === 1
                            ? `${names[0]} is typing…`
                            : names.length === 2
                            ? `${names[0]} and ${names[1]} are typing…`
                            : `${names[0]}, ${names[1]} and ${names.length - 2} more are typing…`;
                        return (
                          <div className="px-3 pb-2 -mt-1 text-[11px] text-muted-foreground flex items-center gap-1.5">
                            <span className="inline-flex gap-0.5">
                              <span className="w-1 h-1 rounded-full bg-muted-foreground animate-pulse" />
                              <span
                                className="w-1 h-1 rounded-full bg-muted-foreground animate-pulse"
                                style={{ animationDelay: '120ms' }}
                              />
                              <span
                                className="w-1 h-1 rounded-full bg-muted-foreground animate-pulse"
                                style={{ animationDelay: '240ms' }}
                              />
                            </span>
                            {label}
                          </div>
                        );
                      })()}
                      <div className="flex items-center justify-between px-3 py-2 border-t border-border bg-muted/50">
                        <div className="flex items-center gap-1">
                          <EmojiPickerButton
                            value={newComment}
                            onChange={setNewComment}
                            disabled={readOnlyTask}
                          />
                          <button
                            type="button"
                            onClick={() => commentFileInputRef.current?.click()}
                            disabled={readOnlyTask}
                            className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs disabled:opacity-50"
                          >
                            <Paperclip className="w-3.5 h-3.5" />
                            Attach
                          </button>
                          <input
                            ref={commentFileInputRef}
                            type="file"
                            multiple
                            accept="*/*"
                            className="hidden"
                            onChange={(e) => {
                              const files = e.target.files;
                              if (!files?.length) return;
                              const validFiles: File[] = [];
                              for (const file of Array.from(files)) {
                                if (file.size > MAX_FILE_SIZE) {
                                  toast.error(`${file.name} exceeds 2MB limit`);
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
                          <button
                            type="button"
                            onClick={() => setShowTimeSpent(!showTimeSpent)}
                            disabled={readOnlyTask}
                            className={cn(
                              'p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs',
                              showTimeSpent && 'bg-secondary text-foreground',
                            )}
                          >
                            <Clock className="w-3.5 h-3.5" />
                            Time
                          </button>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          onClick={handleAddComment}
                          disabled={
                            readOnlyTask ||
                            (!newComment.trim() && commentAttachmentFiles.length === 0) ||
                            commentLoading
                          }
                        >
                          {commentLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            'Comment'
                          )}
                        </Button>
                      </div>

                      {showTimeSpent && (
                        <div className="flex items-center gap-2 px-3 py-2 border-t border-border bg-secondary/30">
                          <Input
                            type="number"
                            min={0}
                            placeholder="0"
                            value={
                              commentTimeSpentMinutes === '' ? '' : commentTimeSpentMinutes
                            }
                            onChange={(e) => {
                              const v = e.target.value;
                              setCommentTimeSpentMinutes(
                                v === '' ? '' : Math.max(0, parseInt(v, 10) || 0),
                              );
                            }}
                            className="w-20 h-8 text-center"
                          />
                          <span className="text-xs text-muted-foreground">minutes</span>
                          <button
                            type="button"
                            onClick={() => {
                              setShowTimeSpent(false);
                              setCommentTimeSpentMinutes('');
                            }}
                            className="ml-auto text-muted-foreground hover:text-foreground"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      )}

                      {commentAttachmentFiles.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 px-3 py-2 border-t border-border">
                          {commentAttachmentFiles.map((f, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center gap-1 px-2 py-1 bg-secondary rounded text-xs"
                              title={f.name}
                            >
                              <span className="truncate max-w-[150px]">
                                {truncateFileName(f.name, 20)}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setCommentAttachmentFiles((p) =>
                                    p.filter((_, idx) => idx !== i),
                                  )
                                }
                                className="text-muted-foreground hover:text-destructive"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {taskComments.length >= 4 && aiEnabled && (
                      <div className="rounded-lg border border-violet-500/30 bg-gradient-to-br from-violet-500/[0.06] via-card to-blue-500/[0.04]">
                        <div className="flex items-center justify-between gap-2 px-3 py-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-7 h-7 rounded-md bg-violet-500/10 ring-1 ring-violet-500/30 text-violet-500 flex items-center justify-center shrink-0">
                              <Sparkles className="w-3.5 h-3.5" />
                            </span>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-foreground leading-tight">
                                AI thread summary
                              </p>
                              <p className="text-[11px] text-muted-foreground leading-tight">
                                {taskComments.length} comments · TL;DR with decisions and action items
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {commentSummary && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                onClick={() => setCommentSummaryOpen((v) => !v)}
                              >
                                {commentSummaryOpen ? 'Hide' : 'Show'}
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs border-violet-500/40 text-violet-700 dark:text-violet-300 hover:bg-violet-500/10"
                              disabled={commentSummaryLoading}
                              onClick={() => void handleSummarizeComments()}
                            >
                              {commentSummaryLoading ? (
                                <>
                                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                  Reading
                                </>
                              ) : commentSummary ? (
                                'Refresh'
                              ) : (
                                <>
                                  <Sparkles className="w-3 h-3 mr-1" />
                                  Summarize
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                        {commentSummaryOpen && (
                          <div className="border-t border-violet-500/20 px-3 py-2.5 space-y-2.5">
                            {commentSummaryError && (
                              <p className="text-xs text-destructive">{commentSummaryError}</p>
                            )}
                            {commentSummaryLoading && !commentSummary && (
                              <div className="space-y-2">
                                <div className="h-3 rounded bg-muted/70 animate-pulse w-2/3" />
                                <div className="h-3 rounded bg-muted/70 animate-pulse w-1/2" />
                              </div>
                            )}
                            {commentSummary && (
                              <>
                                {commentSummary.tldr && (
                                  <p className="text-xs leading-relaxed">
                                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1.5">
                                      TL;DR
                                    </span>
                                    {commentSummary.tldr}
                                  </p>
                                )}
                                {commentSummary.decisions.length > 0 && (
                                  <div>
                                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                                      Decisions
                                    </p>
                                    <ul className="space-y-0.5 text-xs leading-relaxed">
                                      {commentSummary.decisions.map((d, i) => (
                                        <li key={i} className="flex gap-1.5">
                                          <Check className="w-3 h-3 text-emerald-500 mt-0.5 shrink-0" />
                                          <span>{d}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {commentSummary.openQuestions.length > 0 && (
                                  <div>
                                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                                      Open questions
                                    </p>
                                    <ul className="space-y-0.5 text-xs leading-relaxed">
                                      {commentSummary.openQuestions.map((q, i) => (
                                        <li key={i} className="flex gap-1.5 text-amber-700 dark:text-amber-300">
                                          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                                          <span>{q}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {commentSummary.actionItems.length > 0 && (
                                  <div>
                                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                                      Action items
                                    </p>
                                    <ul className="space-y-0.5 text-xs leading-relaxed">
                                      {commentSummary.actionItems.map((a, i) => (
                                        <li key={i} className="flex gap-1.5">
                                          <span className="text-violet-500 shrink-0">→</span>
                                          <span>
                                            <span className="font-medium">{a.owner}:</span>{' '}
                                            {a.what}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="space-y-3 max-h-72 overflow-y-auto">
                      {taskComments.map((comment) => (
                        <div key={comment.commentId} className="flex gap-3">
                          <Avatar className="w-8 h-8 shrink-0">
                            <AvatarImage src={comment.photoURL} />
                            <AvatarFallback className="bg-primary-soft text-primary-soft-foreground text-xs">
                              {comment.displayName?.charAt(0).toUpperCase() || '?'}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap justify-between">
                              <div className="flex items-center gap-2 flex-wrap min-w-0">
                                <span className="font-medium text-sm text-foreground">
                                  {comment.displayName}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {formatDistanceSafe(comment.createdAt)}
                                </span>
                              </div>
                              {(comment.userId === user?.userId || isAdmin) && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                                  disabled={readOnlyTask || deletingCommentId === comment.commentId}
                                  aria-label="Delete comment"
                                  onClick={() => void handleDeleteComment(comment.commentId)}
                                >
                                  {deletingCommentId === comment.commentId ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-4 w-4" />
                                  )}
                                </Button>
                              )}
                            </div>
                            {comment.timeSpentMinutes != null && comment.timeSpentMinutes > 0 && (
                              <span className="inline-block mt-1 px-2 py-0.5 bg-success-soft text-success-soft-foreground text-xs rounded-full">
                                {formatTimeLogged(comment.timeSpentMinutes)} logged
                              </span>
                            )}
                            {comment.text?.trim() && (
                              <p className="text-sm text-foreground mt-1 whitespace-pre-wrap break-words">
                                {comment.text}
                              </p>
                            )}
                            {comment.attachments && comment.attachments.length > 0 && (
                              <AttachmentPreview attachments={comment.attachments} />
                            )}
                          </div>
                        </div>
                      ))}
                      {taskComments.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          No comments yet
                        </p>
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent value="activity" className="mt-3 space-y-3">
                    <div className="space-y-3 max-h-72 overflow-y-auto">
                      {taskActivityLoading ? (
                        <div className="flex justify-center py-4">
                          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : taskActivityEvents.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          No activity yet for this task
                        </p>
                      ) : (
                        taskActivityEvents.map((ev: ActivityEvent) => (
                          <div key={ev.activityId} className="flex items-start gap-3 text-sm">
                            <div
                              className={cn(
                                'w-6 h-6 rounded-full flex items-center justify-center shrink-0',
                                ev.type === 'task_created' && 'bg-success-soft',
                                (ev.type === 'subtask_created' || ev.type === 'subtask_done') && 'bg-info-soft',
                                ev.type === 'comment_added' && 'bg-secondary',
                              )}
                            >
                              {ev.type === 'task_created' && (
                                <CheckCircle2 className="w-3 h-3 text-success-soft-foreground" />
                              )}
                              {(ev.type === 'subtask_created' || ev.type === 'subtask_done') && (
                                <ListTree className="w-3 h-3 text-info-soft-foreground" />
                              )}
                              {ev.type === 'comment_added' && (
                                <MessageSquare className="w-3 h-3 text-muted-foreground" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="font-medium text-foreground">{ev.displayName}</span>
                              <span className="text-muted-foreground">
                                {ev.type === 'task_created' && ' created this task'}
                                {ev.type === 'subtask_created' && ' added subtask '}
                                {ev.type === 'subtask_done' && ' completed subtask '}
                                {ev.type === 'comment_added' && ' commented'}
                              </span>
                              {(ev.type === 'subtask_created' || ev.type === 'subtask_done') && ev.payload?.subtaskTitle && (
                                <span className="text-foreground">
                                  {' '}&quot;{ev.payload.subtaskTitle}&quot;
                                </span>
                              )}
                              <span className="text-muted-foreground">
                                {' '}· {formatDistanceSafe(ev.createdAt)}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            )}
          </div>

          {/* Right pane */}
          <div className="overflow-y-auto px-4 py-4 space-y-4 bg-surface-2">
            {/* Status */}
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Status
              </Label>
              <Select value={status} onValueChange={setStatus} disabled={readOnlyTask}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {columns.map((col) => (
                    <SelectItem key={col.id} value={col.id}>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: col.color }}
                        />
                        {col.title}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Priority */}
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Priority
              </Label>
              <Select
                value={priority}
                onValueChange={(v) => setPriority(v as TaskPriority)}
                disabled={readOnlyTask}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORITY_COLORS).map(([key, color]) => (
                    <SelectItem key={key} value={key}>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: color }}
                        />
                        {key.charAt(0).toUpperCase() + key.slice(1)}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Due date */}
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Due date
              </Label>
              <DayPickerPopover value={dueDate} onChange={setDueDate} disabled={readOnlyTask} />
            </div>

            {/* Team & assignees */}
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 opacity-80" />
                Team
              </Label>
              <AssigneePicker
                value={assignees}
                members={projectAssignableMembers}
                onChange={setAssignees}
                disabled={readOnlyTask}
              />
            </div>

            {/* Tags */}
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Tags
              </Label>
              <div className="flex flex-wrap gap-1.5 items-center">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-info-soft text-info-soft-foreground rounded-full text-xs"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => setTags(tags.filter((t) => t !== tag))}
                      className="hover:text-destructive"
                      aria-label={`Remove tag ${tag}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  placeholder="Add tag…"
                  disabled={readOnlyTask}
                  className="w-24 h-7 text-xs flex-1 min-w-[80px]"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      const v = tagInput.replace(/,/g, '').trim();
                      if (v && !tags.includes(v)) setTags([...tags, v]);
                      setTagInput('');
                    }
                  }}
                />
              </div>
            </div>

            {/* Toggles */}
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Flags
              </Label>
              <div className="space-y-1">
                <label
                  className={cn(
                    'flex items-center gap-2 select-none px-2 py-1.5 rounded text-sm',
                    readOnlyTask ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-secondary',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={urgent}
                    onChange={(e) => setUrgent(e.target.checked)}
                    disabled={readOnlyTask}
                    className="rounded border-border accent-destructive"
                  />
                  <AlertTriangle className="w-4 h-4 text-destructive" />
                  <span className="text-foreground">Urgent</span>
                </label>
                <label
                  className={cn(
                    'flex items-center gap-2 select-none px-2 py-1.5 rounded text-sm',
                    readOnlyTask || (isEditing && !isTaskCreator)
                      ? 'opacity-60 cursor-not-allowed'
                      : 'cursor-pointer hover:bg-secondary',
                  )}
                  title={
                    isEditing && !isTaskCreator
                      ? 'Only the person who created this task can turn lock/PIN on or off'
                      : 'Only creator, assignees, and project owner can see this task'
                  }
                >
                  <input
                    type="checkbox"
                    checked={isLocked}
                    onChange={(e) => setIsLocked(e.target.checked)}
                    disabled={readOnlyTask || (isEditing && !isTaskCreator)}
                    className="rounded border-border accent-warning"
                  />
                  <Lock className="w-4 h-4 text-warning" />
                  <span className="text-foreground">Lock (sensitive)</span>
                </label>
                {isLocked && canManageLockAndPin && (
                  <div className="mt-2 space-y-2 pl-2 border-l-2 border-border">
                    <p className="text-[11px] text-muted-foreground">
                      Optional PIN so assignees can unlock and edit on this task.
                      {isEditing && ' Leave blank to keep the current PIN.'}
                    </p>
                    <Input
                      type="password"
                      name="task-new-pin"
                      autoComplete="new-password"
                      data-1p-ignore
                      data-lpignore="true"
                      data-form-type="other"
                      placeholder="New PIN"
                      value={lockPinNew}
                      onChange={(e) => setLockPinNew(e.target.value)}
                      className="h-8 text-xs"
                    />
                    <Input
                      type="password"
                      name="task-confirm-pin"
                      autoComplete="new-password"
                      data-1p-ignore
                      data-lpignore="true"
                      data-form-type="other"
                      placeholder="Confirm PIN"
                      value={lockPinConfirm}
                      onChange={(e) => setLockPinConfirm(e.target.value)}
                      className="h-8 text-xs"
                    />
                    {isEditing && task?.hasLockPin && (
                      <p className="text-[11px] text-muted-foreground">
                        A PIN is already set. Save with blank fields to keep it, or enter a new one to replace it.
                      </p>
                    )}
                  </div>
                )}
                {isLocked &&
                  isEditing &&
                  !canManageLockAndPin &&
                  task?.hasLockPin && (
                    <p className="mt-2 pl-2 border-l border-border text-[11px] text-muted-foreground">
                      PIN and lock can only be changed by whoever created this task.
                    </p>
                  )}
                {!isEditing && isLocked && (
                  <p className="text-[11px] text-muted-foreground mt-1 pl-2">
                    Add a PIN now to require collaborators to unlock before editing, or leave blank for owner/assignee-only visibility.
                  </p>
                )}
              </div>
            </div>

            {/* AI suggestions panel */}
            {aiEnabled && (
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  AI tools
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  onClick={handleGetSmartSuggestions}
                  disabled={readOnlyTask || !title.trim() || aiLoading.suggestions}
                >
                  {aiLoading.suggestions ? (
                    <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 mr-2 text-primary" />
                  )}
                  Suggest priority &amp; due
                </Button>
                {aiSuggestion && showAISuggestion && (
                  <div className="p-2 bg-primary-soft text-primary-soft-foreground rounded text-xs space-y-1.5">
                    <p className="opacity-90">{aiSuggestion.reasoning}</p>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        size="sm"
                        className="h-6 text-[11px]"
                        onClick={handleApplySuggestions}
                        disabled={readOnlyTask}
                      >
                        Apply
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[11px]"
                        onClick={() => setShowAISuggestion(false)}
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Created/updated meta */}
            {isEditing && task && (
              <div className="text-[11px] text-muted-foreground border-t border-border pt-3 space-y-0.5">
                {task.createdAt != null && (
                  <p>
                    Created {formatDistanceSafe(task.createdAt)}
                  </p>
                )}
                {task.updatedAt != null && (
                  <p>
                    Updated {formatDistanceSafe(task.updatedAt)}
                  </p>
                )}
              </div>
            )}
          </div>
        </form>

        {/* ── Footer ──────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-border bg-card/60 backdrop-blur-sm">
          <div className="min-h-[1.25rem]">
            {!title.trim() ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-destructive">
                <AlertTriangle className="w-3.5 h-3.5" />
                Enter a task title first
              </span>
            ) : isEditing ? (
              <span className="text-[11px] text-muted-foreground">
                Changes save when you click <span className="font-medium text-foreground">Save changes</span>.
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                Press <kbd className="rounded border border-border bg-card px-1 py-0.5 text-[10px] font-medium">⌘</kbd>
                <span className="mx-0.5">+</span>
                <kbd className="rounded border border-border bg-card px-1 py-0.5 text-[10px] font-medium">Enter</kbd> to create.
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => handleSubmit()}
              disabled={loading || !title.trim() || readOnlyTask}
              className="gap-1.5 shadow-sm"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving…
                </>
              ) : isEditing ? (
                <>
                  <Save className="w-4 h-4" />
                  Save changes
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Create task
                </>
              )}
            </Button>
          </div>
        </div>

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

        <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete task?</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this task? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                onClick={async () => {
                  setShowDeleteConfirm(false);
                  await handleDelete();
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={showUnlockGate} onOpenChange={setShowUnlockGate}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <KeyRound className="w-5 h-5" />
                Unlock task
              </AlertDialogTitle>
              <AlertDialogDescription>
                Enter the PIN set by a project owner or admin for this locked task.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input
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
              className="mt-2"
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
