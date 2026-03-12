import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Task, TaskPriority, KanbanColumn, DEFAULT_COLUMNS, PRIORITY_COLORS,
  CreateTaskInput, TaskAssignee, Project, TaskComment,
} from '@/types';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
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
  Calendar, Trash2, Loader2, Sparkles, Wand2, MessageSquare,
  ListTree, Paperclip, UserPlus, X, GripVertical, Check,
  Circle, FileText, Link2, Activity, Clock, CheckCircle2, Lock,
  MoreHorizontal, Copy, Bell, Mail,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { supabase } from '@/services/supabase';
import {
  isAIEnabled, expandDescription, refineDescription,
  suggestPriorityAndDueDate, AIError, SmartSuggestionResponse,
} from '@/services/ai';
import { addCommentWithGlobalSync, subscribeToComments } from '@/services/supabase/database';
import { useTaskActivity } from '@/hooks/useActivity';
import { ActivityEvent } from '@/types/activity';
import { uploadCommentAttachment } from '@/services/supabase/storage';
import { SubtaskDecompositionModal } from './SubtaskDecompositionModal';
import { NotifyModal } from './NotifyModal';
import { EmojiPickerButton } from '@/components/ui/emoji-picker';
import { cn, truncateFileName } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import AttachmentPreview from '../ui/AttachmentPreview';
import { toast } from 'sonner';

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
}

export const TaskModal: React.FC<TaskModalProps> = ({
  open, onClose, task, projectId, projectName, project,
  onSave, onDelete, onCreateSubtasks: _onCreateSubtasks,
  initialStatus = 'undefined', columns = DEFAULT_COLUMNS,
}) => {
  const { user } = useAuth();
  const { organization } = useOrganization();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<string>(initialStatus);
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [dueDate, setDueDate] = useState('');
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [urgent, setUrgent] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [initialComment, setInitialComment] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Subtasks
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');

  // AI states
  const [aiLoading, setAiLoading] = useState<{ title?: boolean; description?: boolean; suggestions?: boolean; }>({});
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<SmartSuggestionResponse | null>(null);
  const [showAISuggestion, setShowAISuggestion] = useState(false);

  // Comment states
  const [activeTab, setActiveTab] = useState<'comments' | 'activity'>('comments');
  const [newComment, setNewComment] = useState('');
  const [commentAttachmentFiles, setCommentAttachmentFiles] = useState<File[]>([]);
  const [commentTimeSpentMinutes, setCommentTimeSpentMinutes] = useState<number | ''>('');
  const [showTimeSpent, setShowTimeSpent] = useState(false);
  const [commentLoading, setCommentLoading] = useState(false);
  const [taskComments, setTaskComments] = useState<TaskComment[]>([]);
  const commentFileInputRef = useRef<HTMLInputElement>(null);
  const descriptionTextareaRef = useRef<HTMLTextAreaElement>(null);

  const MAX_FILE_SIZE = 2 * 1024 * 1024; // 1MB

  const isEditing = !!task;
  const aiEnabled = isAIEnabled();
  const orgId = organization?.organizationId || user?.organizationId || (user ? `local-${user.userId}` : '');
  const { events: taskActivityEvents, loading: taskActivityLoading } = useTaskActivity(
    open && task?.taskId ? task.taskId : null,
    orgId || null
  );

  const [showDecomposition, setShowDecomposition] = useState(false);
  const [showDescription, setShowDescription] = useState(false);
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [projectAssignableMembers, setProjectAssignableMembers] = useState<Array<{
    userId: string;
    displayName: string;
    email: string;
    photoURL: string;
  }>>([]);

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description);
      setStatus(task.status);
      setPriority(task.priority);
      setDueDate(task.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : '');
      setAssignees(task.assignees || []);
      setUrgent(!!task.urgent);
      setIsLocked(!!task.isLocked);
      setTags(task.tags || []);
      setSubtasks(task.subtasks?.length ? task.subtasks : []);
    } else {
      setTitle(''); setDescription(''); setStatus(initialStatus);
      setPriority('medium'); setDueDate(''); setAssignees([]);
      setUrgent(false); setIsLocked(false); setInitialComment(''); setTags([]); setSubtasks([]);
    }
    setAiError(null);
  }, [task, initialStatus]);

  // Filter out assignees who are no longer in the project (removed members)
  useEffect(() => {
    if (!task || projectAssignableMembers.length === 0) return;
    const validIds = new Set(projectAssignableMembers.map((m) => m.userId));
    const currentAssignees = task.assignees || [];
    const filtered = currentAssignees.filter((a) => validIds.has(a.userId));
    if (filtered.length !== currentAssignees.length) {
      setAssignees(filtered);
    }
  }, [task?.taskId, projectAssignableMembers]);

  useEffect(() => {
    if (!open || !task?.taskId || !orgId) { setTaskComments([]); return; }
    const unsub = subscribeToComments(task.taskId, orgId, setTaskComments);
    return () => unsub();
  }, [open, task?.taskId, orgId]);

  useEffect(() => {
    if (!open) {
      setAiError(null); setAiSuggestion(null);
      setShowAISuggestion(false); setAiLoading({});
      setActiveTab('comments'); setShowTimeSpent(false);
      setShowDescription(false);
    }
  }, [open]);

  // Auto-expand description textarea as user types
  useEffect(() => {
    const el = descriptionTextareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 4.5 * 16)}px`;
  }, [description, showDescription]);

  useEffect(() => {
    const loadAssignableMembers = async () => {
      if (!open || !projectId) {
        setProjectAssignableMembers([]);
        return;
      }

      try {
        // Fetch project with members - project.members is the source of truth (excludes removed members)
        const { data: projectRow } = await supabase
          .from('projects')
          .select('owner_id, members')
          .eq('project_id', projectId)
          .maybeSingle();

        const ownerId = projectRow?.owner_id || project?.ownerId || null;
        const membersFromProject = (projectRow?.members || []) as Array<{ userId?: string; user_id?: string; email?: string; displayName?: string; display_name?: string; photoURL?: string; photo_url?: string }>;

        const { data: acceptedInvites } = await supabase
          .from('invitations')
          .select('email')
          .eq('project_id', projectId)
          .eq('status', 'accepted');

        const acceptedEmails = Array.from(new Set(
          (acceptedInvites || [])
            .map((i: any) => (i.email || '').toLowerCase().trim())
            .filter((email: string) => !!email),
        ));

        const memberMap = new Map<string, {
          userId: string;
          displayName: string;
          email: string;
          photoURL: string;
        }>();

        // Add owner
        if (ownerId) {
          const { data: ownerProfile } = await supabase
            .from('user_profiles')
            .select('id, email, display_name, photo_url')
            .eq('id', ownerId)
            .maybeSingle();

          memberMap.set(ownerId, {
            userId: ownerId,
            displayName: ownerProfile?.display_name || (ownerId === user?.userId ? (user?.displayName || 'Owner') : 'Owner'),
            email: ownerProfile?.email || (ownerId === user?.userId ? user?.email : ''),
            photoURL: ownerProfile?.photo_url || (ownerId === user?.userId ? (user?.photoURL || '') : ''),
          });
        }

        // Add members from project.members (current project state - excludes removed)
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

        // Add accepted invitations not already in project.members (e.g. newly accepted)
        if (acceptedEmails.length > 0) {
          const { data: profiles } = await supabase
            .from('user_profiles')
            .select('id, email, display_name, photo_url')
            .in('email', acceptedEmails);

          for (const p of profiles || []) {
            if (memberMap.has(p.id)) continue;
            memberMap.set(p.id, {
              userId: p.id,
              displayName: p.display_name || p.email || 'Member',
              email: p.email || '',
              photoURL: p.photo_url || '',
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
          user ? [{
            userId: user.userId,
            displayName: user.displayName || user.email || 'You',
            email: user.email || '',
            photoURL: user.photoURL || '',
          }] : [],
        );
      }
    };

    loadAssignableMembers();
  }, [open, projectId, project?.ownerId, user?.userId, user?.email, user?.displayName, user?.photoURL]);

  // ── AI Handlers ──────────────────────────────────────────
  const handleExpandDescription = async () => {
    if (!title.trim() || !user) return;
    setAiLoading((p) => ({ ...p, description: true }));
    setAiError(null);
    try {
      const result = await expandDescription(user.userId, { title, projectContext: projectName });
      setAiError(null);
      setDescription(result.description);
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
      setAiError(null);
      setDescription(result.description);
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
      setAiError(null);
      setAiSuggestion(result);
      setShowAISuggestion(true);
    } catch (error) {
      setAiError((error as AIError).message);
    } finally {
      setAiLoading((p) => ({ ...p, suggestions: false }));
    }
  };

  const handleApplySuggestions = () => {
    if (!aiSuggestion) return;
    setPriority(aiSuggestion.priority);
    if (aiSuggestion.dueDate) setDueDate(aiSuggestion.dueDate.toISOString().split('T')[0]);
    setShowAISuggestion(false);
  };

  // ── Comment Handler ───────────────────────────────────────
  const handleAddComment = useCallback(async () => {
    if ((!newComment.trim() && commentAttachmentFiles.length === 0) || !task || !user) return;
    setCommentLoading(true);
    const toastId = toast.loading('Posting comment...');
    try {
      let attachments: { fileId: string; fileName: string; fileUrl: string; fileType: string; }[] = [];

      for (const file of commentAttachmentFiles) {
        try {
          if (file.size > MAX_FILE_SIZE) {
            toast.error(`${file.name} exceeds 1MB limit`);
            continue;
          }

          const uploaded = await uploadCommentAttachment(file, task.taskId, orgId, {
            projectId,
            userId: user.userId,
            userName: user.displayName || 'Unknown',
          });
          attachments.push(uploaded);
        } catch (err) {
          toast.error(`Upload failed: ${file.name}`);
        }
      }

      const timeSpent = typeof commentTimeSpentMinutes === 'number' ? commentTimeSpentMinutes : undefined;


      // const visibleToUserIds = (organization?.members?.map(m => m.userId) || [user.userId])
      //   .filter((id, i, arr) => arr.indexOf(id) === i);

      const visibleToUserIds = Array.from(
        new Set(
          [
            user.userId,
            ...projectAssignableMembers.map((m) => m.userId).filter((id) => !!id),
          ],
        ),
      );

      await addCommentWithGlobalSync(
        task.taskId, projectId, projectName || '', task.title,
        user.userId, user.displayName || 'Unknown', user.photoURL || '',
        newComment.trim() || '', visibleToUserIds, orgId,
        attachments.length > 0 ? attachments : undefined, timeSpent,
      );

      setNewComment('');
      setCommentAttachmentFiles([]);
      setCommentTimeSpentMinutes('');
      setShowTimeSpent(false);
      toast.success('Comment posted', { id: toastId });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to add comment',
        { id: toastId }
      );
    } finally {
      setCommentLoading(false);
    }
  }, [newComment, commentAttachmentFiles, commentTimeSpentMinutes, task, user, orgId, projectId, projectName, projectAssignableMembers]);

  // ── Subtask Handlers ──────────────────────────────────────
  const addSubtask = () => {
    if (!newSubtaskTitle.trim()) return;
    setSubtasks([...subtasks, { id: crypto.randomUUID(), title: newSubtaskTitle.trim(), completed: false }]);
    setNewSubtaskTitle('');
  };

  const toggleSubtask = (id: string) =>
    setSubtasks(subtasks.map(s => s.id === id ? { ...s, completed: !s.completed } : s));

  // ── Submit / Delete ───────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !user) return;
    setSaveError(null);
    setLoading(true);
    try {
      const basePayload = {
        title, description, status, priority,
        dueDate: dueDate ? new Date(dueDate) : null,
        assignees: assignees.length > 0 ? assignees : undefined,
        tags: tags.length > 0 ? tags : undefined,
        subtasks: subtasks.length > 0 ? subtasks : undefined,
        urgent,
        isLocked,
      };

      if (isEditing) {
        const updatePayload = { ...basePayload } as Partial<Task> & {
          activityBy?: { userId: string; displayName: string; photoURL?: string; };
          assigneeChangedBy?: { userId: string; displayName: string; };
        };
        if (subtasks.length > 0 || (task?.subtasks?.length ?? 0) > 0) {
          updatePayload.activityBy = { userId: user.userId, displayName: user.displayName || 'User', photoURL: user.photoURL || '' };
        }
        if (assignees.length > 0) {
          updatePayload.assigneeChangedBy = { userId: user.userId, displayName: user.displayName || 'User' };
        }
        await onSave(updatePayload);
        toast.success('Task updated');
      } else {
        await onSave({
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
      toast.error(
        error instanceof Error ? error.message : 'Failed to delete task',
        { id: toastId }
      );
    } finally {
      setLoading(false);
    }
  };

  const formatTimeLogged = (minutes: number) => {
    const h = Math.floor(minutes / 60), m = minutes % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  };

  const getDueDateLabel = () => {
    if (!dueDate) return 'Set due date';
    const d = new Date(dueDate);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.ceil((d.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Merged member list helper
  const getProjectMembers = () => {
    return projectAssignableMembers;
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-hidden flex flex-col" aria-describedby={undefined}>

        <DialogHeader className="pb-0 border-b-0">
          <div className="flex items-start gap-3">
            {!isEditing && <DialogTitle className="sr-only">Create New Task</DialogTitle>}
            <button
              type="button"
              onClick={() => setStatus(status === 'done' ? 'todo' : 'done')}
              className={cn(
                'w-6 h-6 rounded border-2 flex items-center justify-center mt-0.5 shrink-0 transition-colors',
                status === 'done' ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 hover:border-gray-400'
              )}
            >
              {status === 'done' && <Check className="w-4 h-4" />}
            </button>
            <div className="flex-1 min-w-0">
              {isEditing ? (
                <DialogTitle className="text-xl font-semibold text-gray-900 mb-1">{title}</DialogTitle>
              ) : (
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Task title *"
                  autoFocus
                  className="text-xl font-semibold border-0 border-b-2 border-gray-200 focus:border-orange-400 p-0 rounded-none h-auto focus-visible:ring-0 placeholder:text-gray-400"
                />
              )}
              <p className="text-sm text-gray-500">{organization?.name || 'Workspace'} » {projectName || 'Project'}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {urgent && <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">Urgent</span>}
              {assignees.length > 0 && (
                <div className="flex items-center gap-1 text-sm text-gray-500">
                  <UserPlus className="w-4 h-4" /><span>{assignees.length}</span>
                </div>
              )}
              {isEditing && task && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-gray-500 hover:text-orange-600"
                  onClick={() => setShowNotifyModal(true)}
                  title="Notify team members"
                >
                  <Bell className="w-4 h-4" />
                </Button>
              )}
              {isEditing && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-500 hover:text-gray-700">
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onClick={() => { /* Move - would need column picker */ toast.info('Move task - use drag & drop or change status'); }}>
                      Move task...
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { /* Copy task */ toast.info('Copy task - coming soon'); }}>
                      Copy task...
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={async () => {
                        try {
                          const url = `${window.location.origin}/project/${projectId}?taskId=${task?.taskId}`;
                          await navigator.clipboard.writeText(url);
                          toast.success('Task URL copied');
                        } catch {
                          toast.error('Unable to copy task URL');
                        }
                      }}
                    >
                      Copy task URL
                    </DropdownMenuItem>
                    {aiEnabled && (
                      <DropdownMenuItem onClick={() => { handleGetSmartSuggestions(); setShowAISuggestion(true); }}>
                        <Sparkles className="w-4 h-4 mr-2 text-amber-500" />
                        AI Tools
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => toast.info('Reply by email - coming soon')}>
                      <Mail className="w-4 h-4 mr-2" />
                      Reply by email
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {onDelete && (
                      <DropdownMenuItem
                        onClick={() => setShowDeleteConfirm(true)}
                        className="text-red-600 focus:text-red-600"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto space-y-4 pt-4">
          {saveError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-700">{saveError}</p>
            </div>
          )}

          {/* Tag task */}
          <div className="flex items-center gap-2 text-sm">
            <button type="button" onClick={() => setTagInput(tagInput || ' ')}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900 px-2 py-1 rounded hover:bg-gray-100">
              <Paperclip className="w-4 h-4" />Tag task
            </button>
          </div>

          {(tags.length > 0 || tagInput) && (
            <div className="flex flex-wrap gap-2 items-center">
              {tags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded text-sm">
                  {tag}
                  <button type="button" onClick={() => setTags(tags.filter(t => t !== tag))} className="hover:text-red-600">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="Add tag..."
                className="w-24 h-7 text-sm"
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
          )}

          {/* Urgent + Lock + Assignee */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)}
                className="rounded border-gray-300 text-red-600 focus:ring-red-500" />
              <span className="text-sm font-medium text-gray-700">Urgent</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none" title="Only creator, assignees, and project owner can see this task">
              <input type="checkbox" checked={isLocked} onChange={(e) => setIsLocked(e.target.checked)}
                className="rounded border-gray-300 text-amber-600 focus:ring-amber-500" />
              <Lock className="w-4 h-4 text-amber-600" />
              <span className="text-sm font-medium text-gray-700">Lock (sensitive)</span>
            </label>

            <div className="flex items-center gap-2 flex-wrap">
              {assignees.map((a) => (
                <div key={a.userId} className="flex items-center gap-2 bg-gray-50 rounded-md px-2 py-1.5">
                  <Avatar className="w-8 h-8">
                    <AvatarImage src={a.photoURL} />
                    <AvatarFallback className="bg-teal-500 text-white text-sm">{a.displayName?.charAt(0).toUpperCase() || '?'}</AvatarFallback>
                  </Avatar>
                  <div className="leading-tight max-w-[180px]">
                    <p className="text-sm text-gray-800 truncate">{a.displayName}</p>
                    {a.email && <p className="text-xs text-gray-500 truncate">{a.email}</p>}
                  </div>
                  <button type="button" onClick={() => setAssignees(assignees.filter(x => x.userId !== a.userId))} className="text-gray-400 hover:text-red-600">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}

              <Select value="" onValueChange={(userId) => {
                const merged = getProjectMembers();
                const m = merged.find(mem => mem.userId === userId);
                if (m && !assignees.some(a => a.userId === userId)) {
                  setAssignees([
                    ...assignees,
                    {
                      userId: m.userId,
                      displayName: m.displayName || m.email || 'Unknown',
                      email: m.email || '',
                      photoURL: m.photoURL || '',
                    },
                  ]);
                }
              }}>
                <SelectTrigger className="w-auto h-8 border-dashed">
                  <UserPlus className="w-3.5 h-3.5 mr-1" />
                  <span className="text-gray-500 text-sm">+ Assign</span>
                </SelectTrigger>
                <SelectContent>
                  {(() => {
                    const merged = getProjectMembers();
                    if (merged.length === 0) {
                      return (
                        <div className="p-3 text-sm text-gray-500 text-center">
                          No members yet.{' '}
                          <a href="/team" className="text-orange-500 underline">Invite members</a>
                        </div>
                      );
                    }
                    return merged.map((m) => (
                      <SelectItem key={m.userId} value={m.userId} disabled={assignees.some(a => a.userId === m.userId)}>
                        <div className="flex items-center gap-2 min-w-0">
                          <Avatar className="h-5 w-5">
                            <AvatarImage src={m.photoURL} />
                            <AvatarFallback className="text-xs">{(m.displayName || m.email || '?').charAt(0).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div className="leading-tight min-w-0">
                            <p className="truncate">{m.displayName || m.email || 'Unknown'}</p>
                            {m.email && <p className="text-xs text-gray-500 truncate">{m.email}</p>}
                          </div>
                          {assignees.some(a => a.userId === m.userId) && <Check className="h-3.5 w-3.5 text-green-500 ml-auto" />}
                        </div>
                      </SelectItem>
                    ));
                  })()}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Due date */}
          <div className="flex items-center gap-3">
            <Calendar className="w-4 h-4 text-gray-400" />
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-auto h-8 text-sm" />
            <span className="text-sm text-gray-600">{getDueDateLabel()}</span>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 border-t border-b py-2">
            <button type="button" onClick={() => setShowDescription(!showDescription)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded">
              <FileText className="w-4 h-4" />{description ? 'Edit description' : 'Add description'}
            </button>
            {aiEnabled && (
              <button type="button" onClick={() => setShowDecomposition(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded">
                <ListTree className="w-4 h-4" />Add subtasks (AI)
              </button>
            )}
            <button type="button" disabled
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-400 rounded cursor-not-allowed">
              <Link2 className="w-4 h-4" />Add dependencies
            </button>
          </div>

          {/* Initial comment (create only) */}
          {!isEditing && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-gray-500" />
                Add a comment (optional)
              </Label>
              <Textarea
                value={initialComment}
                onChange={(e) => setInitialComment(e.target.value)}
                placeholder="Write a comment to add when creating this task..."
                rows={2}
                className="resize-none"
              />
            </div>
          )}

          {/* Description */}
          {(showDescription || description) && (
            <div className="space-y-2">
              <Textarea
                ref={descriptionTextareaRef}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add a description..."
                rows={3}
                className="resize-none min-h-[4.5rem] overflow-hidden"
              />
              {aiEnabled && (
                <div className="flex items-center gap-2 flex-wrap">
                  {!description && title.trim().length >= 3 && (
                    <Button type="button" variant="ghost" size="sm" onClick={handleExpandDescription} disabled={aiLoading.description} className="text-xs text-purple-600 hover:text-purple-700">
                      {aiLoading.description ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Wand2 className="w-3 h-3 mr-1" />}
                      Suggest description
                    </Button>
                  )}
                  {description && title.trim().length >= 3 && (
                    <Button type="button" variant="ghost" size="sm" onClick={handleRefineDescription} disabled={aiLoading.description} className="text-xs text-purple-600 hover:text-purple-700">
                      {aiLoading.description ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Wand2 className="w-3 h-3 mr-1" />}
                      Improve / expand
                    </Button>
                  )}
                  {aiError && (
                    <span className="text-xs text-red-500">{aiError}</span>
                  )}
                </div>
              )}
              {task?.createdBy && (
                <p className="text-xs text-gray-400">Added by {task.createdBy} · {task.createdAt ? formatDistanceToNow(new Date(task.createdAt), { addSuffix: true }) : ''}</p>
              )}
            </div>
          )}

          {/* Subtasks */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-gray-700">Subtasks</h4>
            <div className="space-y-1">
              {subtasks.map((subtask) => (
                <div key={subtask.id} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-50 group">
                  <GripVertical className="w-4 h-4 text-gray-300 cursor-grab opacity-0 group-hover:opacity-100" />
                  <button type="button" onClick={() => toggleSubtask(subtask.id)}
                    className={cn('w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0', subtask.completed ? 'bg-green-500 border-green-500' : 'border-gray-300')}>
                    {subtask.completed && <Check className="w-3 h-3 text-white" />}
                  </button>
                  <span className={cn('text-sm flex-1', subtask.completed && 'line-through text-gray-400')}>{subtask.title}</span>
                </div>
              ))}
              <div className="flex items-center gap-2 py-1.5 px-2">
                <div className="w-4" />
                <Circle className="w-5 h-5 text-gray-300 shrink-0" />
                <input type="text" value={newSubtaskTitle} onChange={(e) => setNewSubtaskTitle(e.target.value)}
                  placeholder="Add a subtask..." className="flex-1 text-sm outline-none bg-transparent placeholder:text-gray-400"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSubtask(); } }} />
              </div>
            </div>
          </div>

          {/* Comments / Activity */}
          {isEditing && task && (
            <div className="border-t pt-4">
              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'comments' | 'activity')}>
                <TabsList className="grid w-full grid-cols-2 h-9">
                  <TabsTrigger value="comments" className="text-sm"><MessageSquare className="w-4 h-4 mr-1.5" />Comments</TabsTrigger>
                  <TabsTrigger value="activity" className="text-sm"><Activity className="w-4 h-4 mr-1.5" />All Activity</TabsTrigger>
                </TabsList>

                <TabsContent value="comments" className="mt-3 space-y-3">
                  <div className="border rounded-lg">
                    <Textarea value={newComment} onChange={(e) => setNewComment(e.target.value)} placeholder="Write a comment..." rows={2} className="border-0 resize-none focus-visible:ring-0" />
                    <div className="flex items-center justify-between px-3 py-2 border-t bg-gray-50/50">
                      <div className="flex items-center gap-1">
                        <EmojiPickerButton value={newComment} onChange={setNewComment} />
                        <button type="button" onClick={() => commentFileInputRef.current?.click()}
                          className="p-1.5 rounded hover:bg-gray-200 text-gray-500 flex items-center gap-1 text-sm">
                          <Paperclip className="w-4 h-4" />Attach files
                        </button>
                        <input
                          ref={commentFileInputRef}
                          type="file"
                          multiple accept="*/*"
                          className="hidden"
                          onChange={(e) => {
                            const files = e.target.files;
                            if (!files?.length) return;

                            const validFiles: File[] = [];

                            for (const file of Array.from(files)) {
                              if (file.size > MAX_FILE_SIZE) {
                                toast.error(`${file.name} exceeds 1MB limit`);
                                continue;
                              }
                              validFiles.push(file);
                            }

                            if (validFiles.length > 0) {
                              setCommentAttachmentFiles(prev => [...prev, ...validFiles]);
                            }

                            e.target.value = '';
                          }}
                        />
                        <button type="button" onClick={() => setShowTimeSpent(!showTimeSpent)}
                          className={cn('p-1.5 rounded hover:bg-gray-200 text-gray-500 flex items-center gap-1 text-sm', showTimeSpent && 'bg-gray-200')}>
                          <Clock className="w-4 h-4" />Time spent
                        </button>
                      </div>
                      <Button type="button" size="sm" onClick={handleAddComment} disabled={(!newComment.trim() && commentAttachmentFiles.length === 0) || commentLoading}>
                        {commentLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Comment'}
                      </Button>
                    </div>

                    {showTimeSpent && (
                      <div className="flex items-center gap-2 px-3 py-2 border-t bg-gray-50">
                        <Select defaultValue="today">
                          <SelectTrigger className="w-24 h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="today">Today</SelectItem>
                            <SelectItem value="yesterday">Yesterday</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input type="number" min={0} placeholder="0:00"
                          value={commentTimeSpentMinutes === '' ? '' : commentTimeSpentMinutes}
                          onChange={(e) => { const v = e.target.value; setCommentTimeSpentMinutes(v === '' ? '' : Math.max(0, parseInt(v, 10) || 0)); }}
                          className="w-16 h-8 text-center" />
                        <span className="text-xs text-gray-500">min</span>
                        <button type="button" onClick={() => { setShowTimeSpent(false); setCommentTimeSpentMinutes(''); }} className="text-gray-400 hover:text-gray-600">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}

                    {commentAttachmentFiles.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 px-3 py-2 border-t">
                        {commentAttachmentFiles.map((f, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 rounded text-xs"
                            title={f.name}
                          >
                            <span className="truncate max-w-[150px]">
                              {truncateFileName ? truncateFileName(f.name, 20) : f.name.substring(0, 20) + '...'}
                            </span>
                            <button type="button" onClick={() => setCommentAttachmentFiles(p => p.filter((_, idx) => idx !== i))} className="text-gray-500 hover:text-red-600">
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-3 max-h-48 overflow-y-auto">
                    {taskComments.map((comment) => (
                      <div key={comment.commentId} className="flex gap-3">
                        <Avatar className="w-8 h-8 shrink-0">
                          <AvatarImage src={comment.photoURL} />
                          <AvatarFallback className="bg-teal-500 text-white text-xs">{comment.displayName?.charAt(0).toUpperCase() || '?'}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm text-gray-900">{comment.displayName}</span>
                            <span className="text-xs text-gray-500">{formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}</span>
                          </div>
                          {comment.timeSpentMinutes != null && comment.timeSpentMinutes > 0 && (
                            <span className="inline-block mt-1 px-2 py-0.5 bg-green-100 text-green-800 text-xs rounded-full">
                              {formatTimeLogged(comment.timeSpentMinutes)} - {new Date(comment.createdAt).toLocaleDateString() === new Date().toLocaleDateString() ? 'Today' : 'Yesterday'}
                            </span>
                          )}
                          {comment.text?.trim() && <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap break-words">{comment.text}</p>}
                          {comment.attachments && comment.attachments.length > 0 && <AttachmentPreview attachments={comment.attachments} />}
                        </div>
                      </div>
                    ))}
                    {taskComments.length === 0 && <p className="text-sm text-gray-500 text-center py-4">No comments yet</p>}
                  </div>
                </TabsContent>

                <TabsContent value="activity" className="mt-3 space-y-3">
                  <div className="space-y-3 max-h-64 overflow-y-auto">
                    {taskActivityLoading ? (
                      <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
                    ) : taskActivityEvents.length === 0 ? (
                      <p className="text-sm text-gray-500 text-center py-4">No activity yet for this task</p>
                    ) : (
                      taskActivityEvents.map((ev: ActivityEvent) => (
                        <div key={ev.activityId} className="flex items-start gap-3 text-sm">
                          <div className={cn('w-6 h-6 rounded-full flex items-center justify-center shrink-0',
                            ev.type === 'task_created' && 'bg-green-100',
                            (ev.type === 'subtask_created' || ev.type === 'subtask_done') && 'bg-blue-100',
                            ev.type === 'comment_added' && 'bg-gray-200'
                          )}>
                            {ev.type === 'task_created' && <CheckCircle2 className="w-3 h-3 text-green-600" />}
                            {(ev.type === 'subtask_created' || ev.type === 'subtask_done') && <ListTree className="w-3 h-3 text-blue-600" />}
                            {ev.type === 'comment_added' && <MessageSquare className="w-3 h-3 text-gray-500" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="font-medium">{ev.displayName}</span>
                            <span className="text-gray-500">
                              {ev.type === 'task_created' && ' created this task'}
                              {ev.type === 'subtask_created' && ' added subtask '}
                              {ev.type === 'subtask_done' && ' completed subtask '}
                              {ev.type === 'comment_added' && ' commented'}
                            </span>
                            {(ev.type === 'subtask_created' || ev.type === 'subtask_done') && ev.payload?.subtaskTitle && (
                              <span className="text-gray-600"> "{ev.payload.subtaskTitle}"</span>
                            )}
                            <span className="text-gray-400"> · {formatDistanceToNow(new Date(ev.createdAt), { addSuffix: true })}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}

          {/* Status & Priority (new tasks only) */}
          {!isEditing && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {columns.map((col) => (
                      <SelectItem key={col.id} value={col.id}>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: col.color }} />{col.title}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PRIORITY_COLORS).map(([key, color]) => (
                      <SelectItem key={key} value={key}>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                          {key.charAt(0).toUpperCase() + key.slice(1)}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* AI Suggestions */}
          {aiEnabled && !isEditing && title.trim().length >= 3 && (
            <div className="space-y-2">
              <Button type="button" variant="outline" size="sm" className="w-full border-purple-200 hover:bg-purple-50 text-purple-600" onClick={handleGetSmartSuggestions} disabled={aiLoading.suggestions}>
                {aiLoading.suggestions ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Getting AI Suggestions...</> : <><Sparkles className="w-4 h-4 mr-2" />Get Smart Priority & Due Date</>}
              </Button>
              {aiSuggestion && showAISuggestion && (
                <div className="p-3 bg-purple-50 border border-purple-200 rounded-md">
                  <p className="text-xs text-purple-700 mb-2">{aiSuggestion.reasoning}</p>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" onClick={handleApplySuggestions} className="bg-purple-600 hover:bg-purple-700">Apply</Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setShowAISuggestion(false)}>Ignore</Button>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="pt-4 border-t">
            {isEditing && onDelete && (
              <Button type="button" variant="destructive" onClick={handleDelete} disabled={loading}>
                <Trash2 className="w-4 h-4 mr-2" />Delete
              </Button>
            )}
            <div className="flex gap-2 ml-auto items-center">
              {!title.trim() && <span className="text-xs text-red-400">Enter a task title first</span>}
              <Button type="button" variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
              <Button type="submit" onClick={(e) => { e.preventDefault(); handleSubmit(e as unknown as React.FormEvent); }}
                className="bg-gradient-to-r from-orange-500 to-red-500" disabled={loading || !title.trim()}>
                {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : isEditing ? 'Save Changes' : 'Create Task'}
              </Button>
            </div>
          </DialogFooter>
        </form>

        {showDecomposition && user && (
          <SubtaskDecompositionModal
            open={showDecomposition}
            onClose={() => setShowDecomposition(false)}
            parentTask={{ title, description }}
            projectId={projectId}
            projectName={projectName}
            userId={user.userId}
            onCreateSubtasks={async (newSubtasks) => {
              setSubtasks(prev => [...prev, ...newSubtasks.map(st => ({ id: crypto.randomUUID(), title: st.title, completed: false }))]);
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
            members={getProjectMembers()}
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
                className="bg-red-500 hover:bg-red-600"
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
      </DialogContent>
    </Dialog>
  );
};

export default TaskModal;
