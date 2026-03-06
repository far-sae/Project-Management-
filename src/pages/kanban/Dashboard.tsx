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
import { ActivityEvent } from '@/types/activity';
import { Project } from '@/types';

import { Sidebar } from '@/components/sidebar/Sidebar';
import { TrialBanner } from '@/components/subscription/TrialBanner';
import { WorkspacesModal } from '@/components/workspace/WorkspacesModal';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
  Users,
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
import { supabase } from '@/services/supabase';
import { useSubscription } from '@/context/SubscriptionContext';
import LimitReachedModal from '@/components/ui/LimitReachedModal';

const PROJECT_COLORS = [
  '#f97316', '#ef4444', '#22c55e', '#3b82f6',
  '#a855f7', '#ec4899', '#14b8a6', '#f59e0b',
];

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { organization } = useOrganization();
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
    loading: tasksLoading,
  } = useAllTasks();

  const orgId = organization?.organizationId || user?.organizationId || (user ? `local-${user.userId}` : '');
  const { events: activityEvents, loading: activityLoading } = useActivity(orgId || null);

  const {
    workspaces,
    addWorkspace,
    editWorkspace,
    removeWorkspace,
    DEFAULT_WORKSPACE_ID,
  } = useWorkspaces();


  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCreateWorkspaceModal, setShowCreateWorkspaceModal] = useState(false);
  const [showTrialBanner, setShowTrialBanner] = useState(true);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [selectedColor, setSelectedColor] = useState(PROJECT_COLORS[0]);
  const [selectedProjectWorkspaceId, setSelectedProjectWorkspaceId] = useState<string>(DEFAULT_WORKSPACE_ID);
  const [creating, setCreating] = useState(false);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [showEditWorkspaceModal, setShowEditWorkspaceModal] = useState(false);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [editingWorkspaceName, setEditingWorkspaceName] = useState('');

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

  const [showWorkspacesModal, setShowWorkspacesModal] = useState(false);

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(() => {
    return localStorage.getItem('selectedWorkspaceId') || DEFAULT_WORKSPACE_ID;
  });

  useEffect(() => {
    if (!selectedWorkspaceId || selectedWorkspaceId === "__default__") {
      setSelectedWorkspaceId(DEFAULT_WORKSPACE_ID);
    }
  }, [DEFAULT_WORKSPACE_ID]);

  const ALL_WORKSPACES_ID = '__ALL_WORKSPACES__';

  const handleWorkspaceChange = (id: string) => {
    setSelectedWorkspaceId(id);
    localStorage.setItem('selectedWorkspaceId', id);
  };


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


  // ── Handlers ──────────────────────────────────────────────
  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;

    setCreating(true);
    setCreateError(null);
    const toastId = toast.loading('Creating project...');

    try {
      let actualWorkspaceId = selectedProjectWorkspaceId;

      if (actualWorkspaceId === DEFAULT_WORKSPACE_ID) {
        const defaultWorkspace = workspaces.find(w => w.isDefault) || workspaces[0];

        if (defaultWorkspace) {
          actualWorkspaceId = defaultWorkspace.workspaceId;
        } else {
          const { data: workspace } = await supabase
            .from('workspaces')
            .select('workspace_id')
            .eq('organization_id', orgId)
            .eq('is_default', true)
            .single();

          if (workspace) {
            actualWorkspaceId = workspace.workspace_id;
          }
        }
      }

      const project = await addProject({
        name: newProjectName,
        description: newProjectDescription,
        coverColor: selectedColor,
        workspaceId: actualWorkspaceId,
        startDate: newProjectStartDate || null,
        endDate: newProjectEndDate || null,
      });

      if (project) {
        setShowCreateModal(false);
        setNewProjectName('');
        setNewProjectDescription('');
        setNewProjectStartDate('');
        setNewProjectEndDate('');
        setCreateError(null);
        toast.success('Project created', { id: toastId });
        navigate(`/project/${project.projectId}`);
      } else {
        const msg = projectsError || 'Failed to create project. Please try again.';
        setCreateError(msg);
        toast.error(msg, { id: toastId });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create project.';
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
  };
  const handleEditProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProject || !editName.trim()) return;
    if (editingProject.ownerId !== user?.userId) {
      toast.error('Only the project owner can edit this project.');
      return;
    }

    const toastId = toast.loading('Updating project...');
    try {
      const success = await editProject(editingProject.projectId, {
        name: editName.trim(),
        description: editDescription,
        startDate: editStartDate || null,
        endDate: editEndDate || null,
      });
      if (success) {
        setEditingProject(null);
        setEditName('');
        setEditDescription('');
        toast.success('Project updated', { id: toastId });
      } else {
        toast.error('Failed to update project', { id: toastId });
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to update project',
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
      const msg = err instanceof Error ? err.message : 'Failed to create workspace';
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
      setShowEditWorkspaceModal(true);
    }
  };

  const handleEditWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingWorkspaceId || !editingWorkspaceName.trim()) return;
    const toastId = toast.loading('Updating workspace...');
    try {
      await editWorkspace(editingWorkspaceId, { name: editingWorkspaceName.trim() });
      toast.success('Workspace updated', { id: toastId });
      setShowEditWorkspaceModal(false);
      setEditingWorkspaceId(null);
      setEditingWorkspaceName('');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to update workspace',
        { id: toastId }
      );
    }
  };

  const openDeleteWorkspaceDialog = (workspaceId: string, workspaceName: string) => {
    if (workspaceId === DEFAULT_WORKSPACE_ID) return;
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
        if (selectedWorkspaceId === deleteDialog.id) handleWorkspaceChange(DEFAULT_WORKSPACE_ID);
        setShowEditWorkspaceModal(false);
        setEditingWorkspaceId(null);
        toast.success('Workspace deleted', { id: toastId });
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to delete workspace',
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
          err instanceof Error ? err.message : 'Failed to delete project',
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
    : selectedWorkspaceId === DEFAULT_WORKSPACE_ID
      ? projects.filter((p) => {
        const defaultWs = workspaces.find(w => w.isDefault);
        return p.workspaceId === defaultWs?.workspaceId;
      })
      : projects.filter((p) => p.workspaceId === selectedWorkspaceId);

  const sharedProjects = projects.filter(
    (p) => p.ownerId !== user?.userId
  );

  // If current workspace filter hides all projects but user has shared projects,
  // switch to "All Workspaces" so shared projects are visible without sharing workspace.
  useEffect(() => {
    if (
      selectedWorkspaceId !== ALL_WORKSPACES_ID &&
      sharedProjects.length > 0 &&
      projects.length > 0 &&
      filteredProjects.length === 0
    ) {
      handleWorkspaceChange(ALL_WORKSPACES_ID);
    }
  }, [selectedWorkspaceId, sharedProjects.length, projects.length, filteredProjects.length]);

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

  const activityInWorkspace = useMemo(
    () => {
      if (selectedWorkspaceId === ALL_WORKSPACES_ID) {
        return activityEvents;
      }
      return activityEvents.filter((ev) => workspaceProjectIds.has(ev.projectId));
    },
    [activityEvents, workspaceProjectIds, selectedWorkspaceId]
  );

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

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        {showTrialBanner && (
          <TrialBanner variant="full" onDismiss={() => setShowTrialBanner(false)} />
        )}

        <div className="p-8 animate-fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-gray-900">
                Welcome back, {user?.displayName?.split(' ')[0]}!
              </h1>
              <p className="text-gray-500">Your command center – tasks, activity, and projects</p>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {/* Workspace selector */}
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-700">Workspace</span>
                <Select value={selectedWorkspaceId} onValueChange={handleWorkspaceChange}>
                  <SelectTrigger className="w-[200px] bg-white">
                    <SelectValue placeholder="Select workspace" />
                  </SelectTrigger>

                  <SelectContent>
                    {workspaceListForSelect.map((w) => (
                      <SelectItem key={w.workspaceId} value={w.workspaceId}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowWorkspacesModal(true)}
                >
                  <ListTree className="w-4 h-4 mr-2" />
                  View All
                </Button>

                {selectedWorkspaceId !== DEFAULT_WORKSPACE_ID &&
                  selectedWorkspaceId !== ALL_WORKSPACES_ID && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onClick={() => openEditWorkspace(selectedWorkspaceId)}>
                          <Edit className="w-4 h-4 mr-2" />
                          Edit workspace
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-red-600"
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
              </div>

              {/* Action buttons */}
              <Button
                onClick={() => setShowCreateWorkspaceModal(true)}
                variant="outline"
                size="sm"
              >
                <Plus className="w-4 h-4 mr-1" />
                New Workspace
              </Button>
              <Button
                onClick={() => { setShowCreateModal(true); setCreateError(null); }}
                className="bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600"
              >
                <Plus className="w-4 h-4 mr-2" />
                New Project
              </Button>
            </div>
          </div>

          <Tabs defaultValue="overview" className="space-y-6">
            <TabsList className="grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>

            {/* OVERVIEW TAB */}
            <TabsContent value="overview" className="space-y-6">
              {/* Quick stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-gray-500">Tasks for Today</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-orange-600">
                      {todayTasksInWorkspace.length}
                    </div>
                    <p className="text-xs text-gray-500">Due today in this workspace</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-gray-500">My Tasks</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {tasksAssignedToMeInWorkspace.length}
                    </div>
                    <p className="text-xs text-gray-500">Assigned to you</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-gray-500">Upcoming</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-blue-600">
                      {upcomingTasksInWorkspace.length}
                    </div>
                    <p className="text-xs text-gray-500">Next deadlines</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-gray-500">Overdue</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-red-600">
                      {overdueTasksInWorkspace.length}
                    </div>
                    <p className="text-xs text-gray-500">Needs attention</p>
                  </CardContent>
                </Card>
              </div>

              {/* Tasks for Today */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CheckSquare className="w-5 h-5 text-orange-500" />
                    Tasks for Today
                  </CardTitle>
                  <CardDescription>
                    Tasks due today – stay on top of your deadlines
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {tasksLoading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
                    </div>
                  ) : todayTasksInWorkspace.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      <Clock className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                      <p className="font-medium">No tasks due today</p>
                      <p className="text-sm mb-4">You’re all caught up in this workspace.</p>
                      {/* <Button size="sm" variant="outline" onClick={() => setShowCreateModal(true)}>
                        Create Project
                      </Button> */}
                    </div>

                  ) : (
                    <div className="space-y-2">
                      {todayTasksInWorkspace.map((task) => (
                        <div
                          key={task.taskId}
                          onClick={() => navigate(`/project/${task.projectId}`)}
                          className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 cursor-pointer group"
                        >
                          <div>
                            <p className="font-medium">{task.title}</p>
                            <p className="text-xs text-gray-500">
                              {getProjectName(task.projectId)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs px-2 py-0.5 rounded bg-gray-100 capitalize">
                              {task.status}
                            </span>
                            <ArrowRight className="w-4 h-4 text-gray-400 opacity-0 group-hover:opacity-100" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Upcoming deadlines */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="w-5 h-5 text-blue-500" />
                    Upcoming Deadlines
                  </CardTitle>
                  <CardDescription>Next 10 tasks by due date</CardDescription>
                </CardHeader>
                <CardContent>
                  {tasksLoading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
                    </div>
                  ) : upcomingTasksInWorkspace.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      <CheckSquare className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                      <p>No upcoming tasks in this workspace</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {upcomingTasksInWorkspace.slice(0, 10).map((task) => (
                        <div
                          key={task.taskId}
                          onClick={() => navigate(`/project/${task.projectId}`)}
                          className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 cursor-pointer group"
                        >
                          <div>
                            <p className="font-medium">{task.title}</p>
                            <p className="text-xs text-gray-500">
                              {getProjectName(task.projectId)} •{' '}
                              {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : ''}
                            </p>
                          </div>
                          <ArrowRight className="w-4 h-4 text-gray-400 opacity-0 group-hover:opacity-100" />
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Projects */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FolderKanban className="w-5 h-5 text-orange-500" />
                    Projects
                  </CardTitle>
                  <CardDescription>Your workspace projects</CardDescription>
                </CardHeader>
                <CardContent>
                  {projectsLoading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
                    </div>
                  ) : filteredProjects.length === 0 ? (
                    <Card className="border-dashed">
                      <CardContent className="flex flex-col items-center justify-center py-16">
                        <FolderKanban className="w-16 h-16 text-gray-300 mb-4" />
                        <h3 className="text-lg font-medium text-gray-900 mb-2">No projects yet</h3>
                        <p className="text-gray-500 mb-4">
                          Create your first project to get started
                        </p>
                        <Button
                          onClick={() => setShowCreateModal(true)}
                          className="bg-gradient-to-r from-orange-500 to-red-500"
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          Create Project
                        </Button>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {filteredProjects.map((project) => (
                        <Card
                          key={project.projectId}
                          className="cursor-pointer hover:shadow-xl hover:-translate-y-1 transition-all duration-200 group"                        >
                          <div
                            className="h-2 rounded-t-lg"
                            style={{ backgroundColor: project.coverColor }}
                          />
                          <CardHeader className="flex flex-row items-start justify-between">
                            <div
                              className="flex-1 group-hover:text-orange-600 transition-colors"
                              onClick={() => navigate(`/project/${project.projectId}`)}
                            >
                              <CardTitle className="text-lg">{project.name}</CardTitle>
                              <CardDescription className="line-clamp-2">
                                {project.description || 'No description'}
                              </CardDescription>
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  <MoreHorizontal className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => navigate(`/project/${project.projectId}`)}
                                >
                                  <Files className="w-4 h-4 mr-2" />
                                  Open
                                </DropdownMenuItem>
                                {project.ownerId === user?.userId && (
                                  <DropdownMenuItem
                                    onClick={() => openEditProject(project)}
                                  >
                                    <Pencil className="w-4 h-4 mr-2" />
                                    Edit
                                  </DropdownMenuItem>
                                )}
                                {project.ownerId === user?.userId && (
                                  <DropdownMenuItem
                                    className="text-red-600"
                                    onClick={() => openDeleteProjectDialog(project.projectId, project.name)}
                                  >
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    Delete
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </CardHeader>
                          <CardContent onClick={() => navigate(`/project/${project.projectId}`)}>
                            <div className="flex items-center justify-between text-sm text-gray-500">
                              <span>{project.stats.totalTasks} tasks</span>
                              <span>{project.stats.completedTasks} completed</span>
                            </div>
                            <div className="mt-2">
                              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-green-500 rounded-full transition-all duration-500 ease-out"
                                  style={{
                                    width: project.stats.totalTasks > 0
                                      ? `${(project.stats.completedTasks / project.stats.totalTasks) * 100}%`
                                      : '0%',
                                  }}
                                />
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}

                      <Card
                        className="border-dashed cursor-pointer hover:border-orange-300 hover:bg-orange-50 transition-colors"
                        onClick={() => setShowCreateModal(true)}
                      >
                        <CardContent className="flex flex-col items-center justify-center h-full min-h-[180px]">
                          <Plus className="w-8 h-8 text-gray-400 mb-2" />
                          <p className="text-gray-500">Add new project</p>
                        </CardContent>
                      </Card>
                    </div>
                  )}
                </CardContent>
              </Card>

              {sharedProjects.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="w-5 h-5 text-blue-500" />
                      Shared with me
                    </CardTitle>
                    <CardDescription>Projects you've been invited to</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {sharedProjects.map((project) => (
                        <Card
                          key={project.projectId}
                          className="cursor-pointer hover:shadow-lg transition-shadow group"
                          onClick={() => navigate(`/project/${project.projectId}`)}
                        >
                          <div
                            className="h-2 rounded-t-lg"
                            style={{ backgroundColor: project.coverColor }}
                          />
                          <CardHeader>
                            <CardTitle className="text-lg">{project.name}</CardTitle>
                            <CardDescription className="line-clamp-2">
                              {project.description || 'No description'}
                            </CardDescription>
                          </CardHeader>
                          <CardContent>
                            <div className="flex items-center justify-between text-sm text-gray-500 mb-2">
                              <span>{project.stats.totalTasks} tasks</span>
                              <span>{project.stats.completedTasks} completed</span>
                            </div>
                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-500 rounded-full"
                                style={{
                                  width: project.stats.totalTasks > 0
                                    ? `${(project.stats.completedTasks / project.stats.totalTasks) * 100}%`
                                    : '0%',
                                }}
                              />
                            </div>
                            <p className="text-xs text-gray-400 mt-2">
                              Owned by project owner
                            </p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* ACTIVITY TAB */}
            <TabsContent value="activity" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="w-5 h-5 text-orange-500" />
                    All Activity
                  </CardTitle>
                  <CardDescription>
                    Task created, subtasks, comments and updates – chronological order
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {activityLoading ? (
                    <div className="flex justify-center py-12">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {Array.from({ length: 6 }).map((_, i) => (
                          <div key={i} className="animate-pulse bg-white p-6 rounded-xl shadow">
                            <div className="h-3 bg-gray-200 rounded mb-4 w-1/2" />
                            <div className="h-2 bg-gray-200 rounded mb-2 w-full" />
                            <div className="h-2 bg-gray-200 rounded w-3/4" />
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : activityInWorkspace.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <Activity className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                      <p className="text-lg font-medium">No activity yet</p>
                      <p className="text-sm">
                        Creating tasks, adding subtasks and commenting will show here
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {activityInWorkspace.map((ev: ActivityEvent) => (
                        <div
                          key={ev.activityId}
                          onClick={() => navigate(`/project/${ev.projectId}`)}
                          className="p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer group"
                        >
                          <div className="flex items-start gap-3">
                            {ev.photoURL ? (
                              <img
                                src={ev.photoURL}
                                alt={ev.displayName}
                                className="w-10 h-10 rounded-full object-cover"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center text-orange-700 font-medium">
                                {ev.displayName?.charAt(0)?.toUpperCase() ?? '?'}
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap gap-2 mb-1">
                                <span className="font-medium text-gray-900">{ev.displayName}</span>
                                <span className="text-gray-500">
                                  {ev.type === 'task_created' && ' created task '}
                                  {ev.type === 'subtask_created' && ' added subtask '}
                                  {ev.type === 'subtask_done' && ' completed subtask '}
                                  {ev.type === 'comment_added' && ' commented on '}
                                  {ev.type === 'task_updated' && ' updated task '}
                                </span>
                                <span className="text-sm font-medium text-blue-600 truncate">
                                  {ev.taskTitle}
                                </span>
                                {(ev.type === 'subtask_created' || ev.type === 'subtask_done') &&
                                  ev.payload?.subtaskTitle && (
                                    <span className="text-sm text-gray-600 truncate">
                                      "{ev.payload.subtaskTitle}"
                                    </span>
                                  )}
                              </div>
                              {ev.projectName && (
                                <div className="text-xs text-gray-500 mb-1">
                                  in {ev.projectName}
                                </div>
                              )}
                              <div className="flex items-center gap-2 text-xs text-gray-500">
                                {ev.type === 'task_created' && (
                                  <CheckCircle2 className="w-3 h-3 text-green-600" />
                                )}
                                {(ev.type === 'subtask_created' || ev.type === 'subtask_done') && (
                                  <ListTree className="w-3 h-3 text-blue-600" />
                                )}
                                {ev.type === 'comment_added' && (
                                  <MessageSquare className="w-3 h-3 text-gray-500" />
                                )}
                                {formatDistanceToNow(new Date(ev.createdAt), { addSuffix: true })}
                                <ArrowRight className="w-4 h-4 ml-auto opacity-0 group-hover:opacity-100" />
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
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

          <form onSubmit={handleCreateProject} className="space-y-4">
            {createError && (
              <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{createError}</p>
            )}
            <div className="space-y-2">
              <Label>Workspace</Label>
              <Select
                value={selectedProjectWorkspaceId}
                onValueChange={setSelectedProjectWorkspaceId}
              >
                <SelectTrigger className="w-[200px] bg-white shadow-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_WORKSPACE_ID}>Default</SelectItem>
                  {workspaces.map((w) => (
                    <SelectItem key={w.workspaceId} value={w.workspaceId}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="projectName">Project Name</Label>
              <Input
                id="projectName"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Enter project name"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="projectDescription">Description</Label>
              <Input
                id="projectDescription"
                value={newProjectDescription}
                onChange={(e) => setNewProjectDescription(e.target.value)}
                placeholder="Enter project description"
              />
            </div>

            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex gap-2">
                {PROJECT_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setSelectedColor(color)}
                    className={cn(
                      'w-8 h-8 rounded-full transition-transform',
                      selectedColor === color && 'ring-2 ring-offset-2 ring-gray-400 scale-110'
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            {/* Start & End Date */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="newStartDate">Start Date</Label>
                <Input
                  id="newStartDate"
                  type="date"
                  value={newProjectStartDate}
                  onChange={(e) => setNewProjectStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newEndDate">End Date</Label>
                <Input
                  id="newEndDate"
                  type="date"
                  value={newProjectEndDate}
                  onChange={(e) => setNewProjectEndDate(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowCreateModal(false);
                  setNewProjectStartDate('');
                  setNewProjectEndDate('');
                }}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-gradient-to-r from-orange-500 to-red-500"
                disabled={creating || !newProjectName.trim()}
              >
                {creating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
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
              <Label htmlFor="workspaceName">Workspace Name</Label>
              <Input
                id="workspaceName"
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                placeholder="e.g. Securovix LTD, Home App Pro"
                required
              />
            </div>
            <DialogFooter>
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
                className="bg-gradient-to-r from-orange-500 to-red-500"
                disabled={creatingWorkspace || !newWorkspaceName.trim()}
              >
                {creatingWorkspace && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
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
              <Label htmlFor="editWorkspaceName">Workspace Name</Label>
              <Input
                id="editWorkspaceName"
                value={editingWorkspaceName}
                onChange={(e) => setEditingWorkspaceName(e.target.value)}
                placeholder="Workspace name"
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowEditWorkspaceModal(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-gradient-to-r from-orange-500 to-red-500"
                disabled={!editingWorkspaceName.trim()}
              >
                Save
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
          </DialogHeader>
          <form onSubmit={handleEditProject} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="editProjectName">Project Name</Label>
              <Input
                id="editProjectName"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Project name"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editProjectDescription">Description</Label>
              <Input
                id="editProjectDescription"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Optional description"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="editStartDate">Start Date</Label>
                <Input
                  id="editStartDate"
                  type="date"
                  value={editStartDate}
                  onChange={(e) => setEditStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editEndDate">End Date</Label>
                <Input
                  id="editEndDate"
                  type="date"
                  value={editEndDate}
                  onChange={(e) => setEditEndDate(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter>
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
        defaultWorkspaceId={DEFAULT_WORKSPACE_ID}
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
        <AlertDialogContent className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
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
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-red-500 hover:bg-red-600">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Dashboard;
