import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const state = vi.hoisted(() => ({
  user: { userId: 'u1', displayName: 'Sam Carter', organizationId: 'org-1' } as Record<string, unknown> | null,
  projects: [] as Record<string, unknown>[],
  tasks: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
  navigate: vi.fn(),
}));

vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => state.navigate,
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('@/context/OrganizationContext', () => ({
  useOrganization: () => ({ organization: { organizationId: 'org-1', members: [] }, isAdmin: true }),
}));
vi.mock('@/context/SubscriptionContext', () => ({
  useSubscription: () => ({ refreshSubscription: vi.fn() }),
}));
vi.mock('@/hooks/useProjects', () => ({
  useProjects: () => ({
    projects: state.projects,
    loading: false,
    addProject: vi.fn(),
    editProject: vi.fn(),
    removeProject: vi.fn(),
    error: null,
    limitModal: { open: false, message: '' },
    closeLimitModal: vi.fn(),
  }),
}));
vi.mock('@/hooks/useAllTasks', () => ({
  useAllTasks: () => ({
    todayTasks: state.tasks,
    upcomingTasks: state.tasks,
    tasksAssignedToMe: state.tasks,
    overdueTasks: state.tasks.slice(0, 1),
    tasks: state.tasks,
    loading: false,
  }),
}));
vi.mock('@/hooks/useActivity', () => ({
  useActivity: () => ({ events: state.events, loading: false }),
}));
vi.mock('@/hooks/useWorkspaces', () => ({
  useWorkspaces: () => ({
    workspaces: [{ workspaceId: 'ws-a', name: 'Marketing', isDefault: false, organizationId: 'org-1' }],
    loading: false,
    addWorkspace: vi.fn(),
    editWorkspace: vi.fn(),
    removeWorkspace: vi.fn(),
    refresh: vi.fn(),
  }),
}));
vi.mock('@/hooks/useSelectedWorkspace', () => ({
  ALL_WORKSPACES_ID: '__ALL_WORKSPACES__',
  UNASSIGNED_WORKSPACE_ID: '__UNASSIGNED_PROJECTS__',
  useSelectedWorkspace: () => ({ selectedId: '__ALL_WORKSPACES__', select: vi.fn() }),
}));
vi.mock('@/components/subscription/TrialBanner', () => ({ TrialBanner: () => null }));
vi.mock('@/components/ui/LimitReachedModal', () => ({ default: () => null }));
vi.mock('@/services/supabase/templates', () => ({ fetchProjectTemplates: vi.fn().mockResolvedValue([]) }));
vi.mock('@/services/supabase/database', () => ({ createTask: vi.fn(), verifyProjectLockPin: vi.fn() }));
vi.mock('@/services/supabase/projectMove', () => ({ moveProjectToWorkspace: vi.fn() }));

import { Dashboard } from '@/pages/kanban/Dashboard';

const project = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  projectId: id,
  name,
  description: '',
  coverColor: '#2563eb',
  ownerId: 'u1',
  stats: { totalTasks: 4, completedTasks: 1 },
  ...extra,
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Dashboard />
    </MemoryRouter>,
  );

beforeEach(() => {
  window.localStorage.setItem('onboarding_v1', JSON.stringify({ dismissed: true }));
  state.user = { userId: 'u1', displayName: 'Sam Carter', organizationId: 'org-1' };
  state.projects = [
    project('p1', 'Website relaunch'),
    project('p2', 'Client onboarding', { ownerId: 'u2', isLocked: true, hasLockPin: true }),
  ];
  state.tasks = [
    { taskId: 't1', projectId: 'p1', title: 'Write homepage copy', status: 'todo', priority: 'high', dueDate: '2026-11-20' },
    { taskId: 't2', projectId: 'p2', title: 'Send welcome pack', status: 'done', priority: 'low', dueDate: '2026-11-21' },
  ];
  state.events = [
    {
      activityId: 'a1',
      projectId: 'p1',
      projectName: 'Website relaunch',
      taskTitle: 'Write homepage copy',
      type: 'task_created',
      displayName: 'Sara',
      createdAt: new Date().toISOString(),
    },
  ];
  state.navigate.mockReset();
});
afterEach(cleanup);

describe('Dashboard (workspace home)', () => {
  it('greets by first name and keeps every header control', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome back, Sam' })).toBeTruthy();
    expect(screen.getByText('Tasks, activity and projects across your workspace.')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Workspace' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View All' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New Workspace' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New Project' })).toBeTruthy();
  });

  it('says just "Welcome back" when the user has no name', () => {
    state.user = { userId: 'u1', organizationId: 'org-1' };
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeTruthy();
  });

  it('shows the four figures with Overdue in the danger tone', () => {
    renderPage();
    for (const label of ['Tasks for Today', 'My Tasks', 'Upcoming', 'Overdue']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    const overdue = screen.getByText('Needs attention').parentElement as HTMLElement;
    expect(within(overdue).getByText('1').getAttribute('data-tone')).toBe('danger');
  });

  it('lists projects with an always-visible menu and the lock control', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Projects' })).toBeTruthy();
    expect(screen.getByText('2 projects')).toBeTruthy();
    // p2 is shared with me, so it shows in both grids.
    expect(screen.getAllByRole('button', { name: 'Client onboarding' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Project options' }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: 'Open project settings to set lock and PIN' })).toBeTruthy();
    expect(
      screen.getAllByRole('button', { name: 'Enter PIN to unlock project for this session' }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Shared with me' })).toBeTruthy();
    expect(screen.getByText('Owned by project owner')).toBeTruthy();
  });

  it('opens a project from its card and the PIN dialog from the lock pill', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Website relaunch' }));
    expect(state.navigate).toHaveBeenCalledWith('/project/p1');

    state.navigate.mockReset();
    fireEvent.click(screen.getAllByRole('button', { name: 'Enter PIN to unlock project for this session' })[0]);
    expect(screen.getByRole('heading', { name: 'Enter project PIN' })).toBeTruthy();
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it('opens Create New Project from the header button and the dashed tile', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    expect(screen.getByRole('heading', { name: 'Create New Project' })).toBeTruthy();
  });

  it('has the side column cards and switches to Activity from "View all"', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Upcoming Deadlines' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Tasks for Today' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Workspace Pulse' })).toBeTruthy();
    expect(screen.getByText('50% complete')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Latest Activity' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'View all' }));
    expect(screen.getByRole('heading', { name: 'All Activity' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Activity' }).getAttribute('aria-selected')).toBe('true');
  });

  it('shows the empty state with one Create Project button when there are no projects', () => {
    state.projects = [];
    renderPage();
    expect(screen.getByText('No projects yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));
    expect(screen.getByRole('heading', { name: 'Create New Project' })).toBeTruthy();
  });
});
