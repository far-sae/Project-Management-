// tests/unit/taskModalMeeting.test.tsx
// Smoke-level checks of the redesigned TaskModal: meeting fields reach onSave,
// Join starts a TaskCalendar call for the task, Cmd/Ctrl+Enter saves.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const startMeeting = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const callState = vi.hoisted(() => ({ status: 'idle' as string }));
const org = vi.hoisted(() => ({ isViewer: false, isAdmin: true }));
// Stable identities: the modal's effects depend on these references.
const authValue = vi.hoisted(() => ({
  user: { userId: 'u1', email: 'a@b.co', displayName: 'Ana', photoURL: '', organizationId: 'o1' },
}));
const organization = vi.hoisted(() => ({ organizationId: 'o1', name: 'Acme', ownerId: 'u1', members: [] }));
const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(() => 'toast-id'),
  }),
);

vi.mock('sonner', () => ({ toast }));
vi.mock('@/hooks/useCall', () => ({
  useCall: () => ({ actions: { startMeeting }, state: callState }),
}));
vi.mock('@/services/webrtc/mediaUtils', () => ({ isMediaSupported: () => true }));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => authValue,
}));
vi.mock('@/context/OrganizationContext', () => ({
  useOrganization: () => ({
    organization,
    isAdmin: org.isAdmin,
    isViewer: org.isViewer,
  }),
}));
vi.mock('@/services/supabase', () => {
  const chain: Record<string, unknown> = {};
  for (const k of ['from', 'select', 'eq', 'in']) chain[k] = () => chain;
  chain.maybeSingle = () => Promise.resolve({ data: null });
  chain.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [] }).then(r);
  return { supabase: chain };
});
vi.mock('@/services/supabase/database', () => ({
  addCommentWithGlobalSync: vi.fn(),
  deleteComment: vi.fn(),
  deleteCommentDraft: vi.fn(),
  getCommentDraft: vi.fn().mockResolvedValue(''),
  getTaskComments: vi.fn().mockResolvedValue([]),
  markNotificationsReadByTask: vi.fn().mockResolvedValue(undefined),
  notifyTaskCommentMentions: vi.fn(),
  subscribeToComments: (_t: string, _o: string, cb: (c: unknown[]) => void) => {
    cb([]);
    return () => undefined;
  },
  upsertCommentDraft: vi.fn(),
  verifyTaskLockPin: vi.fn(),
  createNotification: vi.fn(),
}));
vi.mock('@/services/supabase/storage', () => ({ uploadCommentAttachment: vi.fn() }));
vi.mock('@/hooks/useActivity', () => ({ useTaskActivity: () => ({ events: [], loading: false }) }));
vi.mock('@/services/ai', () => ({
  isAIEnabled: () => false,
  expandDescription: vi.fn(),
  refineDescription: vi.fn(),
  suggestPriorityAndDueDate: vi.fn(),
  generateTitle: vi.fn(),
  summarizeCommentThread: vi.fn(),
  decomposeTask: vi.fn(),
  AIError: class extends Error {},
}));
vi.mock('@/components/onboarding/OnboardingChecklist', () => ({ markOnboardingAi: vi.fn() }));
vi.mock('@/components/expenses/TaskExpensesPanel', () => ({ TaskExpensesPanel: () => null }));
vi.mock('@/components/kanban/MoveTaskDialog', () => ({ MoveTaskDialogWithProjects: () => null }));

import { TaskModal } from '@/components/kanban/TaskModal';
import type { Task } from '@/types';

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  callState.status = 'idle';
  org.isViewer = false;
});

const meetingStart = new Date(Date.now() + 2 * 60 * 60 * 1000);

const task = {
  taskId: 't1',
  projectId: 'p1',
  title: 'Ship redesign',
  description: '',
  status: 'todo',
  priority: 'medium',
  dueDate: null,
  assignees: [],
  tags: [],
  subtasks: [],
  urgent: false,
  isLocked: false,
  position: 0,
  attachments: [],
  commentsCount: 0,
  createdBy: 'u1',
  createdAt: new Date(),
  updatedAt: new Date(),
  completedAt: null,
  meetingStartsAt: meetingStart,
  meetingDurationMinutes: 45,
  googleMeetLink: 'https://meet.google.com/abc-defg-hij',
} as unknown as Task;

describe('TaskModal meetings', () => {
  it('joins the task meeting as a TaskCalendar video call and closes', async () => {
    const onClose = vi.fn();
    render(
      <TaskModal open onClose={onClose} task={task} projectId="p1" projectName="Website" onSave={vi.fn()} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: /join meeting/i }));
    expect(startMeeting).toHaveBeenCalledWith(
      { type: 'project', targetId: 'p1', label: 'Ship redesign', taskId: 't1' },
      'video',
    );
    expect(onClose).toHaveBeenCalled();
    // Legacy Google Meet link is shown read-only.
    expect(screen.getByRole('link', { name: /google meet \(old\)/i }).getAttribute('href')).toBe(
      'https://meet.google.com/abc-defg-hij',
    );
  });

  it('disables Join while already in a call or for viewers', async () => {
    callState.status = 'connected';
    const { unmount } = render(
      <TaskModal open onClose={vi.fn()} task={task} projectId="p1" onSave={vi.fn()} />,
    );
    expect(((await screen.findByRole('button', { name: /join meeting/i })) as HTMLButtonElement).disabled).toBe(true);
    unmount();

    callState.status = 'idle';
    org.isViewer = true;
    render(<TaskModal open onClose={vi.fn()} task={task} projectId="p1" onSave={vi.fn()} />);
    expect(((await screen.findByRole('button', { name: /join meeting/i })) as HTMLButtonElement).disabled).toBe(true);
  });

  it('sends meeting fields with Save changes (Cmd/Ctrl+Enter)', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TaskModal open onClose={vi.fn()} task={task} projectId="p1" onSave={onSave} />);
    const titleInput = await screen.findByLabelText('Task title');
    fireEvent.keyDown(titleInput, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const payload = onSave.mock.calls[0][0];
    expect(payload.meetingStartsAt.getTime()).toBe(meetingStart.getTime());
    expect(payload.meetingDurationMinutes).toBe(45);
    expect(payload.dueDate).toBeNull();
  });

  it('creates a task with meeting fields cleared to null by default', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TaskModal open onClose={vi.fn()} projectId="p1" onSave={onSave} />);
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'New thing' } });
    fireEvent.click(screen.getByRole('button', { name: /^create task$/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const payload = onSave.mock.calls[0][0];
    expect(payload.meetingStartsAt).toBeNull();
    expect(payload.meetingDurationMinutes).toBeNull();
    expect(screen.queryByText(/google/i)).toBeNull();
  });

  it('schedules a meeting on create and includes it in the payload', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TaskModal open onClose={vi.fn()} projectId="p1" onSave={onSave} />);
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Kickoff' } });
    fireEvent.click(screen.getByRole('button', { name: /schedule meeting/i }));
    fireEvent.click(screen.getByRole('button', { name: /^create task$/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const payload = onSave.mock.calls[0][0];
    expect(payload.meetingStartsAt).toBeInstanceOf(Date);
    expect(payload.meetingStartsAt.getMinutes()).toBe(0);
    expect(payload.meetingDurationMinutes).toBe(30);
  });
});

describe('TaskModal links', () => {
  it('shows links in the description as clickable, and clicking the text edits it', async () => {
    const withLink = { ...task, description: 'Design: https://figma.com/file/abc please review' } as Task;
    render(<TaskModal open onClose={vi.fn()} task={withLink} projectId="p1" projectName="Website" onSave={vi.fn()} />);
    const link = await screen.findByRole('link', { name: 'https://figma.com/file/abc' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(screen.queryByPlaceholderText(/add a description/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /description\. press enter to edit/i }));
    const box = (await screen.findByPlaceholderText(/add a description/i)) as HTMLTextAreaElement;
    expect(box.value).toContain('https://figma.com/file/abc');
  });

  it('makes links in subtasks clickable', async () => {
    const withSub = {
      ...task,
      subtasks: [{ id: 's1', title: 'Check www.example.com/spec', completed: false }],
    } as unknown as Task;
    render(<TaskModal open onClose={vi.fn()} task={withSub} projectId="p1" projectName="Website" onSave={vi.fn()} />);
    const link = await screen.findByRole('link', { name: 'www.example.com/spec' });
    expect(link.getAttribute('href')).toBe('https://www.example.com/spec');
  });
});

