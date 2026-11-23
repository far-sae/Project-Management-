import { publicMessage } from '@/lib/publicError';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useProjects } from '@/hooks/useProjects';
import { useAllTasks } from '@/hooks/useAllTasks';
import { useActivity } from '@/hooks/useActivity';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import {
  ALL_WORKSPACES_ID,
  UNASSIGNED_WORKSPACE_ID,
  useSelectedWorkspace,
} from '@/hooks/useSelectedWorkspace';
import { ActivityEvent } from '@/types/activity';
import { Project } from '@/types';

import { TrialBanner } from '@/components/subscription/TrialBanner';
import { WorkspacesModal } from '@/components/workspace/WorkspacesModal';
import { MoveProjectDialog } from '@/components/workspace/MoveProjectDialog';
import { ProjectCard } from '@/components/workspace/ProjectCard';
import {
  projectLockState,
  taskDotClass,
  welcomeTitle,
} from '@/components/workspace/projectCardModel';
import {
  ColorSwatchRow,
  DIALOG_FOOTER,
  FIELD_LABEL,
  FormError,
  PROJECT_COLORS,
  TemplatePicker,
} from '@/components/workspace/ProjectFormParts';
import { PageHeader } from '@/components/common/PageHeader';
import { StatStrip } from '@/components/common/StatStrip';

import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Plus,
  FolderKanban,
  Loader2,
  MoreHorizontal,
  Trash2,
  Edit,
  CheckSquare,
  Clock,
  MessageSquare,
  Activity,
  ArrowRight,
  ListTree,
  CheckCircle2,
  Pencil,
  Files,
  ArrowRightLeft,
} from 'lucide-react';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { getWorkspaceDisplayName } from '@/lib/workspaceDisplay';
import { useSubscription } from '@/context/SubscriptionContext';
import LimitReachedModal from '@/components/ui/LimitReachedModal';
import { fetchProjectTemplates } from '@/services/supabase/templates';
import type { ProjectTemplate } from '@/types/projectTemplate';
import { createTask, verifyProjectLockPin } from '@/services/supabase/database';
import { Lock, KeyRound } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { getPageDef, type PageKey } from '@/lib/pageCatalog';
import { QUICK_MENU_PAGE_KEYS, menuPagesForSave } from '@/lib/workspaceScope';
import {
  hashLockPin,
  clearProjectLockUnlockedInSession,
  isProjectLockUnlockedInSession,
  setProjectLockUnlockedInSession,
} from '@/lib/projectLockPin';
import { OnboardingChecklist } from '@/components/onboarding/OnboardingChecklist';

function projectPinLocked(project: Project) {
  return Boolean(project.isLocked && project.hasLockPin);
}

const PROJECT_GRID = 'grid gap-3 p-3 grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))]';

/** A clickable row inside a list card. */
const LIST_ROW =
  'flex min-h-11 w-full items-center gap-3 border-b border-border/60 px-4 text-left transition-colors last:border-0 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';

const MENU_ITEM_DANGER = 'text-destructive focus:text-destructive';

/** Bordered box with a title row and a list (or empty state) underneath. */
const ListCard: React.FC<{ title: string; meta?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  meta,
  children,
}) => (
  <section className="overflow-hidden rounded-lg border border-border bg-card">
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-b border-border px-4 py-2">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {meta && <div className="text-xs text-muted-foreground">{meta}</div>}
    </div>
    {children}
  </section>
);

const EmptyState: React.FC<{
  icon: React.ElementType;
  title: string;
  hint?: string;
  className?: string;
  children?: React.ReactNode;
}> = ({ icon: Icon, title, hint, className, children }) => (
  <div className={cn('flex flex-col items-center justify-center px-4 py-8 text-center', className)}>
    <Icon className="mb-2 h-5 w-5 text-muted-foreground" aria-hidden />
    <p className="text-sm font-medium text-foreground">{title}</p>
    {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    {children && <div className="mt-4">{children}</div>}
  </div>
);

const SectionSpinner: React.FC = () => (
  <div className="flex justify-center py-8">
    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
  </div>
);

const ActivityAvatar: React.FC<{ ev: Pick<ActivityEvent, 'photoURL' | 'displayName'>; className?: string }> = ({
  ev,
  className,
}) =>
  ev.photoURL ? (
    <img src={ev.photoURL} alt={ev.displayName} className={cn('shrink-0 rounded-full object-cover', className)} />
  ) : (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-foreground/10 font-semibold text-foreground',
        className,
      )}
    >
      {ev.displayName?.charAt(0)?.toUpperCase() ?? '?'}
    </span>
  );

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { organization, isAdmin: canEditWorkspaceMenu } = useOrganization();
  const location = useLocation();
  const { refreshSubscription } = useSubscription();

  const {
    projects,
    loading: projectsLoading,
    addProject,
    editProject,
    removeProject,
    error: projectsError,
    limitModal: projectLimitModal,   // ← rename to avoid conflict
    closeLimitModal: closeProjectLimitModal,
  } = useProjects();

  const [limitModal, setLimitModal] = useState<{ open: boolean; message: string; }>({
    open: false,
    message: '',
  });

  const activeLimitModal = projectLimitModal.open ? projectLimitModal : limitModal;
  const closeActiveLimitModal = () => {
    closeProjectLimitModal();
    setLimitModal({ open: false, message: '' });
  };

  const {
    todayTasks,
    upcomingTasks,
    tasksAssignedToMe,
    overdueTasks,
    tasks,
    loading: tasksLoading,
  } = useAllTasks();

  const orgId = organization?.organizationId || user?.organizationId || (user ? `local-${user.userId}` : '');
  const { events: activityEvents, loading: activityLoading } = useActivity(orgId || null);

  const {
    workspaces,
    loading: workspacesLoading,
    addWorkspace,
    editWorkspace,
    removeWorkspace,
    refresh: refreshWorkspaces,
  } = useWorkspaces();


  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createTab, setCreateTab] = useState<'blank' | 'template'>('blank');
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<ProjectTemplate | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [showCreateWorkspaceModal, setShowCreateWorkspaceModal] = useState(false);
  const [showTrialBanner, setShowTrialBanner] = useState(true);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [selectedColor, setSelectedColor] = useState(PROJECT_COLORS[0]);
  const [selectedProjectWorkspaceId, setSelectedProjectWorkspaceId] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [showEditWorkspaceModal, setShowEditWorkspaceModal] = useState(false);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [editingWorkspaceName, setEditingWorkspaceName] = useState('');
  const [editingMenuPages, setEditingMenuPages] = useState<PageKey[]>(QUICK_MENU_PAGE_KEYS);

  // Project being moved to another workspace (null = dialog closed).
  const [moveProject, setMoveProject] = useState<Project | null>(null);

  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    type: 'project' | 'workspace' | null;
    id: string | null;
    name: string;
  }>({ open: false, type: null, id: null, name: '' });

  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const [newProjectStartDate, setNewProjectStartDate] = useState('');
  const [newProjectEndDate, setNewProjectEndDate] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editProjectLocked, setEditProjectLocked] = useState(false);
  const [editLockPinNew, setEditLockPinNew] = useState('');
  const [editLockPinConfirm, setEditLockPinConfirm] = useState('');

  const [lockDialogProject, setLockDialogProject] = useState<Project | null>(null);
  const [lockDialogPin, setLockDialogPin] = useState('');
  const [lockDialogError, setLockDialogError] = useState(false);
  const [lockDialogSubmitting, setLockDialogSubmitting] = useState(false);
  const [lockSessionNonce, setLockSessionNonce] = useState(0);

  const [showWorkspacesModal, setShowWorkspacesModal] = useState(false);

  // Overview / Activity; controlled so "View all" in Latest Activity can switch.
  const [homeTab, setHomeTab] = useState('overview');

  const {
    selectedId: selectedWorkspaceId,
    select: handleWorkspaceChange,
  } = useSelectedWorkspace();


  // Detect Stripe success redirect and poll for updated subscription
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('subscription') !== 'success') return;

    navigate('/dashboard', { replace: true });
    toast.success('🎉 Subscription activated! Welcome aboard.');

    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      await refreshSubscription();
      if (attempts >= 5) clearInterval(poll);
    }, 2000);

    return () => clearInterval(poll);
  }, [location.search]);



  useEffect(() => {
    if (showCreateModal && projectsError) setCreateError(projectsError);
  }, [showCreateModal, projectsError]);

  useEffect(() => {
    if (!showCreateModal) return;
    let cancelled = false;
    setTemplatesLoading(true);
    fetchProjectTemplates({
      ownerId: user?.userId ?? null,
      organizationId: orgId || null,
    })
      .then((rows) => {
        if (!cancelled) setTemplates(rows);
      })
      .catch((err) => {
        console.warn('Failed to load templates', err);
      })
      .finally(() => {
        if (!cancelled) setTemplatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showCreateModal, user?.userId, orgId]);

  useEffect(() => {
    if (createTab === 'template' && selectedTemplate && !newProjectName.trim()) {
      setNewProjectName(selectedTemplate.name);
    }
  }, [createTab, selectedTemplate, newProjectName]);


  // ── Handlers ──────────────────────────────────────────────
  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;

    setCreating(true);
    setCreateError(null);
    const toastId = toast.loading('Creating project...');

    try {
      const useTemplate = createTab === 'template' && selectedTemplate;

      const project = await addProject({
        name: newProjectName,
        description: newProjectDescription || (useTemplate ? selectedTemplate!.description ?? '' : ''),
        coverColor: selectedColor,
        // A project always belongs to a workspace.
        workspaceId: selectedProjectWorkspaceId || mainWorkspaceId || undefined,
        startDate: newProjectStartDate || null,
        endDate: newProjectEndDate || null,
        columns: useTemplate ? selectedTemplate!.columns : undefined,
      });

      if (project) {
        if (useTemplate && selectedTemplate!.tasks.length > 0 && user) {
          try {
            for (const seed of selectedTemplate!.tasks) {
              await createTask(
                user.userId,
                {
                  projectId: project.projectId,
                  title: seed.title,
                  description: seed.description ?? '',
                  status: seed.status ?? selectedTemplate!.columns[0]?.id ?? 'undefined',
                  priority: seed.priority ?? 'medium',
                  tags: seed.tags ?? [],
                },
                orgId,
              );
            }
          } catch (seedErr) {
            console.warn('Template seed task creation failed', seedErr);
          }
        }

        setShowCreateModal(false);
        setNewProjectName('');
        setNewProjectDescription('');
        setNewProjectStartDate('');
        setNewProjectEndDate('');
        setSelectedTemplate(null);
        setCreateTab('blank');
        setCreateError(null);
        toast.success('Project created', { id: toastId });
        navigate(`/project/${project.projectId}`);
      } else {
        const msg = projectsError || 'Failed to create project. Please try again.';
        setCreateError(msg);
        toast.error(msg, { id: toastId });
      }
    } catch (err) {
      const msg = publicMessage(err, 'Failed to create project.');
      setCreateError(msg);
      toast.error(msg, { id: toastId });
    } finally {
      setCreating(false);
    }
  };

  const openEditProject = (project: Project) => {
    if (project.ownerId !== user?.userId) {
      toast.error('Only the project owner can edit this project.');
      return;
    }
    setEditingProject(project);
    setEditName(project.name);
    setEditDescription(project.description || '');
    setEditStartDate(
      project.startDate ? new Date(project.startDate).toISOString().split('T')[0] : ''
    );
    setEditEndDate(
      project.endDate ? new Date(project.endDate).toISOString().split('T')[0] : ''
    );
    setEditProjectLocked(!!project.isLocked);
    setEditLockPinNew('');
    setEditLockPinConfirm('');
  };

  const closeProjectLockDialog = () => {
    setLockDialogProject(null);
    setLockDialogPin('');
    setLockDialogError(false);
  };

  const handleRelockSessionOnCard = (p: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    clearProjectLockUnlockedInSession(p.projectId, p.lockPinVersion ?? 0);
    setLockSessionNonce((n) => n + 1);
    toast.info('Session locked. Enter your PIN to open this project again.');
  };

  const handleSubmitProjectLockPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lockDialogProject) return;
    setLockDialogSubmitting(true);
    try {
      const ok = await verifyProjectLockPin(lockDialogProject.projectId, lockDialogPin);
      if (ok) {
        setProjectLockUnlockedInSession(
          lockDialogProject.projectId,
          lockDialogProject.lockPinVersion ?? 0,
        );
        toast.success('Unlocked for this session. Leaving the project locks it again.');
        closeProjectLockDialog();
        setLockSessionNonce((n) => n + 1);
      } else {
        setLockDialogError(true);
        toast.error('Incorrect PIN');
      }
    } catch (err) {
      setLockDialogError(true);
      // Our own sentence when there is one; nothing when the error is the database's or the network's.
      const detail = publicMessage(err, '');
      toast.error(
        detail
          ? `Could not verify your PIN. ${detail}`
          : 'Could not verify your PIN. Check your connection and try again.',
      );
    } finally {
      setLockDialogSubmitting(false);
    }
  };

  const handleEditProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProject || !editName.trim()) return;
    if (editingProject.ownerId !== user?.userId) {
      toast.error('Only the project owner can edit this project.');
      return;
    }

    let lockPinHashPayload: string | null | undefined = undefined;
    if (!editProjectLocked) {
      lockPinHashPayload = null;
      clearProjectLockUnlockedInSession(
        editingProject.projectId,
        editingProject.lockPinVersion ?? 0,
      );
    } else if (editLockPinNew.trim()) {
      if (editLockPinNew !== editLockPinConfirm) {
        toast.error('PIN and confirmation do not match');
        return;
      }
      lockPinHashPayload = await hashLockPin(editLockPinNew, editingProject.projectId);
    } else if (editingProject.hasLockPin) {
      lockPinHashPayload = undefined;
    } else {
      toast.error('Set a lock PIN, or turn off "Lock with PIN".');
      return;
    }

    const toastId = toast.loading('Updating project...');
    try {
      const success = await editProject(editingProject.projectId, {
        name: editName.trim(),
        description: editDescription,
        startDate: editStartDate || null,
        endDate: editEndDate || null,
        isLocked: editProjectLocked,
        ...(lockPinHashPayload !== undefined ? { lockPinHash: lockPinHashPayload } : {}),
      });
      if (success) {
        setEditingProject(null);
        setEditName('');
        setEditDescription('');
        setEditProjectLocked(false);
        setEditLockPinNew('');
        setEditLockPinConfirm('');
        setLockSessionNonce((n) => n + 1);
        toast.success('Project updated', { id: toastId });
      } else {
        toast.error('Failed to update project', { id: toastId });
      }
    } catch (err) {
      toast.error(
        publicMessage(err, 'Failed to update project'),
        { id: toastId }
      );
    }
  };

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspaceName.trim()) return;
    setCreatingWorkspace(true);
    const toastId = toast.loading('Creating workspace...');
    try {
      const w = await addWorkspace({ name: newWorkspaceName.trim() });
      if (w) {
        setShowCreateWorkspaceModal(false);
        setNewWorkspaceName('');
        handleWorkspaceChange(w.workspaceId);
        toast.success('Workspace created', { id: toastId });
      } else {
        toast.error('Failed to create workspace', { id: toastId });
      }
    } catch (err) {
      const msg = publicMessage(err, 'Failed to create workspace');
      if (msg.includes('limit') || msg.includes('reached')) {
        setLimitModal({ open: true, message: msg });
        toast.dismiss(toastId);
      } else {
        toast.error(msg, { id: toastId });
      }
    } finally {
      setCreatingWorkspace(false);
    }
  };

  const openEditWorkspace = (workspaceId: string) => {
    const w = workspaces.find((x) => x.workspaceId === workspaceId);
    if (w) {
      setEditingWorkspaceId(workspaceId);
      setEditingWorkspaceName(w.name);
      // null = all enabled → every toggle on.
      setEditingMenuPages(w.menuPages ?? QUICK_MENU_PAGE_KEYS);
      setShowEditWorkspaceModal(true);
    }
  };

  const handleEditWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingWorkspaceId || !editingWorkspaceName.trim()) return;
    const toastId = toast.loading('Updating workspace...');
    try {
      await editWorkspace(editingWorkspaceId, {
        name: editingWorkspaceName.trim(),
        ...(canEditWorkspaceMenu
          ? { menuPages: menuPagesForSave(editingMenuPages) }
          : {}),
      });
      toast.success('Workspace updated', { id: toastId });
      setShowEditWorkspaceModal(false);
      setEditingWorkspaceId(null);
      setEditingWorkspaceName('');
    } catch (err) {
      toast.error(
        publicMessage(err, 'Failed to update workspace'),
        { id: toastId }
      );
    }
  };

  const openDeleteWorkspaceDialog = (workspaceId: string, workspaceName: string) => {
    if (
      workspaceId === ALL_WORKSPACES_ID ||
      workspaceId === UNASSIGNED_WORKSPACE_ID
    ) {
      return;
    }
    setDeleteDialog({ open: true, type: 'workspace', id: workspaceId, name: workspaceName });
  };

  const openDeleteProjectDialog = (projectId: string, projectName: string) => {
    const project = projects.find((p) => p.projectId === projectId);
    if (project && project.ownerId !== user?.userId) {
      toast.error('Only the project owner can delete this project.');
      return;
    }
    setDeleteDialog({ open: true, type: 'project', id: projectId, name: projectName });
  };

  const handleConfirmDelete = async () => {
    if (!deleteDialog.id || !deleteDialog.type) return;

    if (deleteDialog.type === 'workspace') {
      const toastId = toast.loading('Deleting workspace...');
      try {
        await removeWorkspace(deleteDialog.id);
        if (selectedWorkspaceId === deleteDialog.id) handleWorkspaceChange(ALL_WORKSPACES_ID);
        setShowEditWorkspaceModal(false);
        setEditingWorkspaceId(null);
        toast.success('Workspace deleted', { id: toastId });
      } catch (err) {
        toast.error(
          publicMessage(err, 'Failed to delete workspace'),
          { id: toastId }
        );
      }
    } else if (deleteDialog.type === 'project') {
      const toastId = toast.loading('Deleting project...');
      try {
        await removeProject(deleteDialog.id);
        toast.success('Project deleted', { id: toastId });
      } catch (err) {
        toast.error(
          publicMessage(err, 'Failed to delete project'),
          { id: toastId }
        );
      }
    }
    setDeleteDialog({ open: false, type: null, id: null, name: '' });
  };

  const projectMap = useMemo(() => {
    return Object.fromEntries(projects.map(p => [p.projectId, p.name]));
  }, [projects]);

  const getProjectName = (id: string) => projectMap[id] || "Unknown";

  const filteredProjects = selectedWorkspaceId === ALL_WORKSPACES_ID
    ? projects
    : selectedWorkspaceId === UNASSIGNED_WORKSPACE_ID
      ? projects.filter((p) => !p.workspaceId)
      : projects.filter((p) => p.workspaceId === selectedWorkspaceId);

  // "Shared with me" follows the workspace like every other list on the page.
  // (It used to list every workspace's projects, and an empty workspace used to
  // flip the whole app to "All workspaces" behind the user's back.)
  const sharedProjects = filteredProjects.filter(
    (p) => p.ownerId !== user?.userId
  );

  const workspaceProjectIds = useMemo(
    () => new Set(filteredProjects.map((p) => p.projectId)),
    [filteredProjects]
  );

  const filterTasksByWorkspace = useCallback(
    <T extends { projectId: string; }>(taskList: T[]): T[] => {
      if (selectedWorkspaceId === ALL_WORKSPACES_ID) {
        return taskList;
      }
      return taskList.filter((t) => workspaceProjectIds.has(t.projectId));
    },
    [workspaceProjectIds, selectedWorkspaceId]
  );

  const todayTasksInWorkspace = filterTasksByWorkspace(todayTasks);
  const upcomingTasksInWorkspace = filterTasksByWorkspace(upcomingTasks);
  const tasksAssignedToMeInWorkspace = filterTasksByWorkspace(tasksAssignedToMe);
  const overdueTasksInWorkspace = filterTasksByWorkspace(overdueTasks);
  const allTasksInWorkspace = filterTasksByWorkspace(tasks);
  const completedTasksInWorkspace = allTasksInWorkspace.filter((t) => t.status === 'done').length;
  const completionRate = allTasksInWorkspace.length > 0
    ? Math.round((completedTasksInWorkspace / allTasksInWorkspace.length) * 100)
    : 0;
  const activeProjectsInWorkspace = filteredProjects.filter((p) => p.stats.totalTasks > 0).length;
  const lockedProjectsInWorkspace = filteredProjects.filter(projectPinLocked).length;

  const activityInWorkspace = useMemo(
    () => {
      if (selectedWorkspaceId === ALL_WORKSPACES_ID) {
        return activityEvents;
      }
      return activityEvents.filter((ev) => workspaceProjectIds.has(ev.projectId));
    },
    [activityEvents, workspaceProjectIds, selectedWorkspaceId]
  );
  const recentActivityInWorkspace = activityInWorkspace.slice(0, 5);

  const workspaceListForSelect = useMemo(() => {
    const list: Array<any> = [{
      workspaceId: ALL_WORKSPACES_ID,
      name: 'All Workspaces',
      organizationId: '',
      isDefault: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }];

    const seen = new Set([ALL_WORKSPACES_ID]);

    workspaces.forEach(w => {
      if (!seen.has(w.workspaceId)) {
        seen.add(w.workspaceId);
        list.push({
          ...w,
          isDefault: w.isDefault ?? false,
        });
      }
    });

    return list;
  }, [workspaces]);

  const isRealWorkspaceSelected =
    selectedWorkspaceId !== ALL_WORKSPACES_ID && selectedWorkspaceId !== UNASSIGNED_WORKSPACE_ID;
  const mainWorkspaceId = (workspaces.find((w) => w.isDefault) ?? workspaces[0])?.workspaceId ?? '';

  const openCreateProject = () => {
    // A new project starts in the workspace being looked at, so it shows up where it was made;
    // from "All workspaces" it starts in the organisation's main one. There is no "no workspace".
    setSelectedProjectWorkspaceId(isRealWorkspaceSelected ? selectedWorkspaceId : mainWorkspaceId);
    setShowCreateModal(true);
    setCreateError(null);
  };

  /** One project card with its lock control and options menu. */
  const renderProjectCard = (project: Project, note?: string) => {
    void lockSessionNonce;
    const isOwner = project.ownerId === user?.userId;
    const lockState = projectLockState({
      pinLocked: projectPinLocked(project),
      unlockedInSession: isProjectLockUnlockedInSession(
        project.projectId,
        project.lockPinVersion ?? 0,
      ),
      isOwner,
    });
    const openProject = () => navigate(`/project/${project.projectId}`);

    return (
      <ProjectCard
        key={project.projectId}
        project={project}
        onOpen={openProject}
        note={note}
        lock={
          lockState && {
            state: lockState,
            onClick: (e) => {
              if (lockState === 'unlocked') {
                handleRelockSessionOnCard(project, e);
              } else if (lockState === 'locked') {
                setLockDialogProject(project);
                setLockDialogPin('');
                setLockDialogError(false);
              } else {
                openEditProject(project);
              }
            },
          }
        }
        menu={
          <>
            <DropdownMenuItem onClick={openProject}>
              <Files className="w-4 h-4 mr-2" />
              Open
            </DropdownMenuItem>
            {isOwner && (
              <DropdownMenuItem onClick={() => openEditProject(project)}>
                <Pencil className="w-4 h-4 mr-2" />
                Edit
              </DropdownMenuItem>
            )}
            {(isOwner || canEditWorkspaceMenu) && workspaces.length > 0 && (
              <DropdownMenuItem onClick={() => setMoveProject(project)}>
                <ArrowRightLeft className="w-4 h-4 mr-2" />
                Move to workspace
              </DropdownMenuItem>
            )}
            {isOwner && (
              <DropdownMenuItem
                className={MENU_ITEM_DANGER}
                onClick={() => openDeleteProjectDialog(project.projectId, project.name)}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </DropdownMenuItem>
            )}
          </>
        }
      />
    );
  };

  return (
    <>
      <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden bg-background">
        {showTrialBanner && (
          <TrialBanner variant="full" onDismiss={() => setShowTrialBanner(false)} />
        )}

        <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">
          <PageHeader
            title={welcomeTitle(user?.displayName)}
            description="Tasks, activity and projects across your workspace."
            actions={
              <>
                <Select value={selectedWorkspaceId} onValueChange={handleWorkspaceChange}>
                  <SelectTrigger aria-label="Workspace" className="w-[200px] max-w-full">
                    <SelectValue placeholder="Select workspace" />
                  </SelectTrigger>

                  <SelectContent>
                    {workspaceListForSelect.map((w) => (
                      <SelectItem key={w.workspaceId} value={w.workspaceId}>
                        {getWorkspaceDisplayName(w)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button
                  variant="outline"
                  onClick={() => {
                    setShowWorkspacesModal(true);
                    void refreshWorkspaces({ silent: true });
                  }}
                >
                  <ListTree className="w-4 h-4" />
                  View All
                </Button>

                {isRealWorkspaceSelected && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="Workspace options">
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onClick={() => openEditWorkspace(selectedWorkspaceId)}>
                        <Edit className="w-4 h-4 mr-2" />
                        Edit workspace
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className={MENU_ITEM_DANGER}
                        onClick={() => {
                          const ws = workspaces.find(w => w.workspaceId === selectedWorkspaceId);
                          openDeleteWorkspaceDialog(selectedWorkspaceId, ws?.name || 'this workspace');
                        }}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete workspace
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                <Button onClick={() => setShowCreateWorkspaceModal(true)} variant="outline">
                  <Plus className="w-4 h-4" />
                  New Workspace
                </Button>
                <Button onClick={openCreateProject}>
                  <Plus className="w-4 h-4" />
                  New Project
                </Button>
              </>
            }
          />

          <OnboardingChecklist />

          <Tabs value={homeTab} onValueChange={setHomeTab}>
            <TabsList className="w-full">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>

            {/* OVERVIEW TAB */}
            <TabsContent value="overview" className="mt-6">
              <div className="flex flex-col gap-6">
                <StatStrip
                  items={[
                    {
                      label: 'Tasks for Today',
                      value: todayTasksInWorkspace.length,
                      note: 'Due today in this workspace',
                    },
                    {
                      label: 'My Tasks',
                      value: tasksAssignedToMeInWorkspace.length,
                      note: 'Assigned to you',
                    },
                    {
                      label: 'Upcoming',
                      value: upcomingTasksInWorkspace.length,
                      note: 'Next deadlines',
                    },
                    {
                      label: 'Overdue',
                      value: overdueTasksInWorkspace.length,
                      note: 'Needs attention',
                      tone: 'danger',
                    },
                  ]}
                />

                <div className="flex flex-wrap items-start gap-6">
                  {/* Main column */}
                  <div className="flex min-w-0 flex-[1_1_480px] flex-col gap-6">
                    {/* Projects */}
                    <ListCard
                      title="Projects"
                      meta={
                        !projectsLoading && (
                          <span className="tabular-nums">
                            {filteredProjects.length}{' '}
                            {filteredProjects.length === 1 ? 'project' : 'projects'}
                          </span>
                        )
                      }
                    >
                      {projectsLoading ? (
                        <SectionSpinner />
                      ) : filteredProjects.length === 0 ? (
                        <EmptyState
                          icon={FolderKanban}
                          title="No projects yet"
                          hint="Create your first project to get started"
                          className="py-12"
                        >
                          <Button onClick={() => setShowCreateModal(true)}>
                            <Plus className="w-4 h-4" />
                            Create Project
                          </Button>
                        </EmptyState>
                      ) : (
                        <div className={PROJECT_GRID}>
                          {filteredProjects.map((project) => renderProjectCard(project))}

                          <button
                            type="button"
                            onClick={() => setShowCreateModal(true)}
                            className="flex min-h-32 items-center justify-center gap-1.5 rounded-lg border border-dashed border-foreground/20 bg-background text-sm font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <Plus className="h-4 w-4" aria-hidden />
                            New project
                          </button>
                        </div>
                      )}
                    </ListCard>

                    {/* Upcoming deadlines */}
                    <ListCard title="Upcoming Deadlines" meta="Next 10 tasks by due date">
                      {tasksLoading ? (
                        <SectionSpinner />
                      ) : upcomingTasksInWorkspace.length === 0 ? (
                        <EmptyState icon={CheckSquare} title="No upcoming tasks in this workspace" />
                      ) : (
                        upcomingTasksInWorkspace.slice(0, 10).map((task) => (
                          <button
                            key={task.taskId}
                            type="button"
                            onClick={() => navigate(`/project/${task.projectId}`)}
                            className={cn(LIST_ROW, 'flex-wrap gap-y-0.5 py-2 sm:flex-nowrap')}
                          >
                            <span className="min-w-0 basis-full truncate text-sm font-medium text-foreground sm:flex-1 sm:basis-0">
                              {task.title}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground sm:max-w-[40%] sm:flex-none">
                              {getProjectName(task.projectId)}
                            </span>
                            <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:w-20">
                              {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : ''}
                            </span>
                          </button>
                        ))
                      )}
                    </ListCard>

                    {/* Shared with me */}
                    {sharedProjects.length > 0 && (
                      <ListCard title="Shared with me" meta="Projects you've been invited to">
                        <div className={PROJECT_GRID}>
                          {sharedProjects.map((project) =>
                            renderProjectCard(project, 'Owned by project owner'),
                          )}
                        </div>
                      </ListCard>
                    )}
                  </div>

                  {/* Side column */}
                  <div className="flex w-full min-w-0 shrink-0 flex-col gap-6 xl:w-[24rem]">
                    {/* Tasks for Today */}
                    <ListCard
                      title="Tasks for Today"
                      meta={
                        !tasksLoading && (
                          <span className="tabular-nums">
                            {todayTasksInWorkspace.length}{' '}
                            {todayTasksInWorkspace.length === 1 ? 'task' : 'tasks'}
                          </span>
                        )
                      }
                    >
                      {tasksLoading ? (
                        <SectionSpinner />
                      ) : todayTasksInWorkspace.length === 0 ? (
                        <EmptyState
                          icon={Clock}
                          title="No tasks due today"
                          hint="You’re all caught up in this workspace."
                        />
                      ) : (
                        todayTasksInWorkspace.map((task) => (
                          <button
                            key={task.taskId}
                            type="button"
                            onClick={() => navigate(`/project/${task.projectId}`)}
                            className={cn(LIST_ROW, 'gap-2.5 py-2')}
                          >
                            <span
                              aria-hidden
                              className={cn('h-1.5 w-1.5 shrink-0 rounded-full', taskDotClass(task))}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-foreground">
                                {task.title}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {getProjectName(task.projectId)}
                              </span>
                            </span>
                            <span className="max-w-[40%] shrink-0 truncate rounded border border-border px-1.5 text-xs capitalize leading-[18px] text-muted-foreground">
                              {task.status}
                            </span>
                          </button>
                        ))
                      )}
                    </ListCard>

                    {/* Workspace Pulse */}
                    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
                      <div className="flex items-baseline justify-between gap-3">
                        <h2 className="text-sm font-semibold text-foreground">Workspace Pulse</h2>
                        <span className="text-sm font-semibold tabular-nums text-foreground">
                          {completionRate}% complete
                        </span>
                      </div>
                      <div
                        className="h-1 overflow-hidden rounded-full bg-foreground/10"
                        role="progressbar"
                        aria-valuenow={completionRate}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label="Workspace completion"
                      >
                        <div
                          className="h-full rounded-full bg-foreground/70"
                          style={{ width: `${completionRate}%` }}
                        />
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs tabular-nums text-muted-foreground">
                        <span>
                          <strong className="font-semibold text-foreground">{allTasksInWorkspace.length}</strong>{' '}
                          total tasks
                        </span>
                        <span>
                          <strong className="font-semibold text-foreground">{completedTasksInWorkspace}</strong>{' '}
                          completed
                        </span>
                        <span>
                          <strong className="font-semibold text-foreground">{activeProjectsInWorkspace}</strong>{' '}
                          active projects
                        </span>
                        <span>
                          <strong className="font-semibold text-foreground">{lockedProjectsInWorkspace}</strong>{' '}
                          PIN locked projects
                        </span>
                      </div>
                    </section>

                    {/* Latest Activity */}
                    <ListCard
                      title="Latest Activity"
                      meta={
                        <button
                          type="button"
                          onClick={() => setHomeTab('activity')}
                          className="rounded-sm font-medium text-foreground underline underline-offset-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          View all
                        </button>
                      }
                    >
                      {activityLoading ? (
                        <SectionSpinner />
                      ) : recentActivityInWorkspace.length === 0 ? (
                        <EmptyState icon={Activity} title="No recent activity yet." />
                      ) : (
                        recentActivityInWorkspace.map((ev) => (
                          <button
                            key={ev.activityId}
                            type="button"
                            onClick={() => navigate(`/project/${ev.projectId}`)}
                            className={cn(LIST_ROW, 'items-start gap-2.5 py-2.5')}
                          >
                            <ActivityAvatar ev={ev} className="h-6 w-6 text-xs" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium leading-[18px] text-foreground">
                                {ev.taskTitle || ev.projectName || 'Project activity'}
                              </span>
                              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                {ev.displayName} · {formatDistanceToNow(new Date(ev.createdAt), { addSuffix: true })}
                              </span>
                            </span>
                          </button>
                        ))
                      )}
                    </ListCard>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* ACTIVITY TAB */}
            <TabsContent value="activity" className="mt-6">
              <ListCard
                title="All Activity"
                meta="Task created, subtasks, comments and updates – chronological order"
              >
                {activityLoading ? (
                  <SectionSpinner />
                ) : activityInWorkspace.length === 0 ? (
                  <EmptyState
                    icon={Activity}
                    title="No activity yet"
                    hint="Creating tasks, adding subtasks and commenting will show here"
                    className="py-12"
                  />
                ) : (
                  activityInWorkspace.map((ev: ActivityEvent) => (
                    <button
                      key={ev.activityId}
                      type="button"
                      onClick={() => navigate(`/project/${ev.projectId}`)}
                      className={cn(LIST_ROW, 'group items-start py-3')}
                    >
                      <ActivityAvatar ev={ev} className="h-8 w-8 text-xs" />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap gap-x-1.5 text-sm leading-5">
                          <span className="font-medium text-foreground">{ev.displayName}</span>
                          <span className="text-muted-foreground">
                            {ev.type === 'task_created' && 'created task'}
                            {ev.type === 'subtask_created' && 'added subtask'}
                            {ev.type === 'subtask_done' && 'completed subtask'}
                            {ev.type === 'comment_added' && 'commented on'}
                            {ev.type === 'task_updated' && 'updated task'}
                          </span>
                          <span className="min-w-0 truncate font-medium text-foreground">
                            {ev.taskTitle}
                          </span>
                          {(ev.type === 'subtask_created' || ev.type === 'subtask_done') &&
                            ev.payload?.subtaskTitle && (
                              <span className="min-w-0 truncate text-muted-foreground">
                                "{ev.payload.subtaskTitle}"
                              </span>
                            )}
                        </span>
                        {ev.projectName && (
                          <span className="block truncate text-xs text-muted-foreground">
                            in {ev.projectName}
                          </span>
                        )}
                        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                          {ev.type === 'task_created' && (
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          )}
                          {(ev.type === 'subtask_created' || ev.type === 'subtask_done') && (
                            <ListTree className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          )}
                          {ev.type === 'comment_added' && (
                            <MessageSquare className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          )}
                          {formatDistanceToNow(new Date(ev.createdAt), { addSuffix: true })}
                        </span>
                      </span>
                      <ArrowRight
                        className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                        aria-hidden
                      />
                    </button>
                  ))
                )}
              </ListCard>
            </TabsContent>
          </Tabs>
        </div>
      </main>

      {/* Create Project Dialog */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
          </DialogHeader>

          <Tabs value={createTab} onValueChange={(v) => setCreateTab(v as 'blank' | 'template')}>
            <TabsList className="w-full">
              <TabsTrigger value="blank">Blank project</TabsTrigger>
              <TabsTrigger value="template">From template</TabsTrigger>
            </TabsList>

            <TabsContent value="template" className="mt-3">
              <TemplatePicker
                templates={templates}
                loading={templatesLoading}
                selectedId={selectedTemplate?.id}
                onSelect={setSelectedTemplate}
              />
            </TabsContent>
          </Tabs>

          <form onSubmit={handleCreateProject} className="space-y-4">
            {createError && <FormError>{createError}</FormError>}
            <div className="space-y-2">
              <Label className={FIELD_LABEL}>Workspace</Label>
              <Select
                value={selectedProjectWorkspaceId}
                onValueChange={setSelectedProjectWorkspaceId}
              >
                <SelectTrigger className="sm:w-[240px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((w) => (
                    <SelectItem key={w.workspaceId} value={w.workspaceId}>
                      {getWorkspaceDisplayName(w)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="projectName" className={FIELD_LABEL}>Project Name</Label>
              <Input
                id="projectName"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Enter project name"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="projectDescription" className={FIELD_LABEL}>Description</Label>
              <Input
                id="projectDescription"
                value={newProjectDescription}
                onChange={(e) => setNewProjectDescription(e.target.value)}
                placeholder="Enter project description"
              />
            </div>

            <div className="space-y-2">
              <Label className={FIELD_LABEL}>Color</Label>
              <ColorSwatchRow value={selectedColor} onChange={setSelectedColor} />
            </div>

            {/* Start & End Date */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="newStartDate" className={FIELD_LABEL}>Start Date</Label>
                <Input
                  id="newStartDate"
                  type="date"
                  value={newProjectStartDate}
                  onChange={(e) => setNewProjectStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newEndDate" className={FIELD_LABEL}>End Date</Label>
                <Input
                  id="newEndDate"
                  type="date"
                  value={newProjectEndDate}
                  onChange={(e) => setNewProjectEndDate(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter className={DIALOG_FOOTER}>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowCreateModal(false);
                  setNewProjectStartDate('');
                  setNewProjectEndDate('');
                  setSelectedTemplate(null);
                  setCreateTab('blank');
                }}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  creating ||
                  !newProjectName.trim() ||
                  (createTab === 'template' && !selectedTemplate)
                }
              >
                {creating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Project'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Create Workspace Dialog */}
      <Dialog open={showCreateWorkspaceModal} onOpenChange={setShowCreateWorkspaceModal}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Create New Workspace</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateWorkspace} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="workspaceName" className={FIELD_LABEL}>Workspace Name</Label>
              <Input
                id="workspaceName"
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                placeholder="e.g. Securovix LTD, Home App Pro"
                required
              />
            </div>
            <DialogFooter className={DIALOG_FOOTER}>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowCreateWorkspaceModal(false)}
                disabled={creatingWorkspace}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={creatingWorkspace || !newWorkspaceName.trim()}
              >
                {creatingWorkspace && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                Create Workspace
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Workspace Dialog */}
      <Dialog
        open={showEditWorkspaceModal}
        onOpenChange={(open) => {
          if (!open) {
            setShowEditWorkspaceModal(false);
            setEditingWorkspaceId(null);
          }
        }}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Edit Workspace</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditWorkspace} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="editWorkspaceName" className={FIELD_LABEL}>Workspace Name</Label>
              <Input
                id="editWorkspaceName"
                value={editingWorkspaceName}
                onChange={(e) => setEditingWorkspaceName(e.target.value)}
                placeholder="Workspace name"
                required
              />
            </div>
            {canEditWorkspaceMenu && (
              <div className="space-y-2">
                <Label className={FIELD_LABEL}>Menu items in this workspace</Label>
                <p className="text-xs text-muted-foreground">
                  Hidden items disappear from the sidebar for everyone in this
                  workspace. Role permissions still apply on top.
                </p>
                <div className="overflow-hidden rounded-lg border border-border">
                  {QUICK_MENU_PAGE_KEYS.map((key) => {
                    const def = getPageDef(key);
                    const on = editingMenuPages.includes(key);
                    return (
                      <div
                        key={key}
                        className="flex min-h-11 items-center justify-between gap-3 border-b border-border/60 px-3 py-1.5 last:border-0"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {def?.label ?? key}
                          </p>
                          {def?.group && (
                            <p className="truncate text-xs text-muted-foreground">{def.group}</p>
                          )}
                        </div>
                        <Switch
                          checked={on}
                          onCheckedChange={(checked) =>
                            setEditingMenuPages((prev) =>
                              checked
                                ? QUICK_MENU_PAGE_KEYS.filter(
                                    (k) => k === key || prev.includes(k),
                                  )
                                : prev.filter((k) => k !== key),
                            )
                          }
                          aria-label={`Show ${def?.label ?? key}`}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <DialogFooter className={DIALOG_FOOTER}>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowEditWorkspaceModal(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!editingWorkspaceName.trim()}
              >
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Project PIN (session unlock from dashboard) */}
      <Dialog
        open={!!lockDialogProject}
        onOpenChange={(open) => {
          if (!open) {
            closeProjectLockDialog();
          }
        }}
      >
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <form onSubmit={handleSubmitProjectLockPin} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Enter project PIN</DialogTitle>
              <DialogDescription>
                {lockDialogProject
                  ? `Unlock "${lockDialogProject.name}" for this browser session. Leaving the project locks it again.`
                  : 'Enter your project PIN to unlock this project for your current browser session.'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="dashboard-project-lock-pin" className={FIELD_LABEL}>PIN</Label>
              <Input
                id="dashboard-project-lock-pin"
                type="password"
                autoComplete="off"
                value={lockDialogPin}
                onChange={(e) => {
                  setLockDialogPin(e.target.value);
                  setLockDialogError(false);
                }}
                className={cn(lockDialogError && 'border-destructive')}
                placeholder="••••"
              />
            </div>
            <DialogFooter className={DIALOG_FOOTER}>
              <Button
                type="button"
                variant="outline"
                onClick={closeProjectLockDialog}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={lockDialogSubmitting}>
                {lockDialogSubmitting && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                <KeyRound className="h-4 w-4" />
                Unlock session
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Project Dialog */}
      <Dialog
        open={!!editingProject}
        onOpenChange={(open) => !open && setEditingProject(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
            <DialogDescription>Update the project name, description, dates, and lock or PIN options.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditProject} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="editProjectName" className={FIELD_LABEL}>Project Name</Label>
              <Input
                id="editProjectName"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Project name"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editProjectDescription" className={FIELD_LABEL}>Description</Label>
              <Input
                id="editProjectDescription"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Optional description"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="editStartDate" className={FIELD_LABEL}>Start Date</Label>
                <Input
                  id="editStartDate"
                  type="date"
                  value={editStartDate}
                  onChange={(e) => setEditStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editEndDate" className={FIELD_LABEL}>End Date</Label>
                <Input
                  id="editEndDate"
                  type="date"
                  value={editEndDate}
                  onChange={(e) => setEditEndDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    Lock with PIN
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Only you (the project owner) can set or change this PIN. Everyone with access—including
                    you—must enter it to open the project in each browser session.
                  </p>
                </div>
                <Switch
                  checked={editProjectLocked}
                  onCheckedChange={(v) => {
                    setEditProjectLocked(v);
                    if (!v) {
                      setEditLockPinNew('');
                      setEditLockPinConfirm('');
                    }
                  }}
                />
              </div>
              {editProjectLocked && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="editProjectLockPin" className={FIELD_LABEL}>PIN {editingProject?.hasLockPin ? '(change)' : ''}</Label>
                    <Input
                      id="editProjectLockPin"
                      type="password"
                      autoComplete="new-password"
                      value={editLockPinNew}
                      onChange={(e) => setEditLockPinNew(e.target.value)}
                      placeholder={editingProject?.hasLockPin ? 'New PIN' : 'Set PIN'}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="editProjectLockPinConfirm" className={FIELD_LABEL}>Confirm PIN</Label>
                    <Input
                      id="editProjectLockPinConfirm"
                      type="password"
                      autoComplete="new-password"
                      value={editLockPinConfirm}
                      onChange={(e) => setEditLockPinConfirm(e.target.value)}
                      placeholder="Confirm"
                    />
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className={DIALOG_FOOTER}>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingProject(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!editName.trim()}>
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Workspaces View All Modal */}
      <MoveProjectDialog
        open={moveProject !== null}
        onOpenChange={(next) => {
          if (!next) setMoveProject(null);
        }}
        project={moveProject}
        workspaces={workspaces}
      />

      <WorkspacesModal
        open={showWorkspacesModal}
        onOpenChange={setShowWorkspacesModal}
        workspaces={workspaces}
        projects={projects}
        onEditWorkspace={openEditWorkspace}
        onDeleteWorkspace={(workspaceId) => {
          const ws = workspaces.find(w => w.workspaceId === workspaceId);
          openDeleteWorkspaceDialog(workspaceId, ws?.name || 'this workspace');
        }}
        onCreateWorkspace={() => {
          setShowWorkspacesModal(false);
          setShowCreateWorkspaceModal(true);
        }}
        onSelectWorkspace={handleWorkspaceChange}
        loading={workspacesLoading}
        onRefresh={() => void refreshWorkspaces()}
      />

      {/* ✅ Plan limit modal — shows when project/workspace limit is hit */}
      <LimitReachedModal
        open={activeLimitModal.open}
        onClose={closeActiveLimitModal}
        title={activeLimitModal.message?.toLowerCase().includes('workspace') ? 'Workspace Limit Reached' : 'Project Limit Reached'}
        message={activeLimitModal.message}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialog.open} onOpenChange={(open) => !open && setDeleteDialog({ open: false, type: null, id: null, name: '' })}>
        <AlertDialogContent className="w-[calc(100%-2rem)] max-w-md rounded-xl border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base tracking-tight">
              Delete {deleteDialog.type === 'workspace' ? 'Workspace' : 'Project'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteDialog.type === 'workspace' ? (
                <>
                  Are you sure you want to delete <strong>{deleteDialog.name}</strong>?
                  All projects and tasks inside this workspace will be permanently deleted.
                  This action cannot be undone.
                </>
              ) : (
                <>
                  Are you sure you want to delete <strong>{deleteDialog.name}</strong>? This action cannot be undone. All tasks and data in this project will be permanently removed.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteDialog({ open: false, type: null, id: null, name: '' })}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className={buttonVariants({ variant: 'destructive' })}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default Dashboard;
