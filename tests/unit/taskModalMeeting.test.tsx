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


describe('TaskModal description editing', () => {
  const longText = 'Gmail account\nline two\nline three\nline four\nline five\nline six\nline seven';
  const withText = () => ({ ...task, description: longText }) as Task;
  let restoreScrollHeight: () => void = () => undefined;

  beforeEach(() => {
    const proto = HTMLTextAreaElement.prototype;
    const original = Object.getOwnPropertyDescriptor(proto, 'scrollHeight');
    Object.defineProperty(proto, 'scrollHeight', { configurable: true, get: () => 400 });
    restoreScrollHeight = () => {
      if (original) Object.defineProperty(proto, 'scrollHeight', original);
      else delete (proto as unknown as Record<string, unknown>).scrollHeight;
    };
  });
  afterEach(() => {
    restoreScrollHeight();
    delete (document as unknown as Record<string, unknown>).caretRangeFromPoint;
  });

  it('keeps the full height when you click a long description to edit it', async () => {
    render(<TaskModal open onClose={vi.fn()} task={withText()} projectId="p1" onSave={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /description\. press enter to edit/i }));
    const box = (await screen.findByPlaceholderText(/add a description/i)) as HTMLTextAreaElement;
    expect(box.style.height).toBe('400px');
  });

  it('puts the cursor where you clicked in the text', async () => {
    render(<TaskModal open onClose={vi.fn()} task={withText()} projectId="p1" onSave={vi.fn()} />);
    const view = await screen.findByRole('button', { name: /description\. press enter to edit/i });
    const textNode = Array.from(view.querySelectorAll('*'))
      .flatMap((el) => Array.from(el.childNodes))
      .find((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.startsWith('Gmail')) as Text;
    (document as unknown as { caretRangeFromPoint: () => Range }).caretRangeFromPoint = () => {
      const r = document.createRange();
      r.setStart(textNode, 5); // after "Gmail"
      return r;
    };
    fireEvent.click(view, { clientX: 10, clientY: 10 });
    const box = (await screen.findByPlaceholderText(/add a description/i)) as HTMLTextAreaElement;
    expect(box.selectionStart).toBe(5);
    expect(box.selectionEnd).toBe(5);
  });
});

describe('TaskModal team permissions', () => {
  afterEach(() => {
    org.isAdmin = true;
  });
  const othersTask = { ...task, createdBy: 'someone-else', assignees: [] } as unknown as Task;

  it('lets a team member edit an unassigned task someone else created', async () => {
    org.isAdmin = false;
    render(<TaskModal open onClose={vi.fn()} task={othersTask} projectId="p1" onSave={vi.fn()} />);
    await screen.findByLabelText('Task title');
    expect(screen.queryByText(/you can view this task/i)).toBeNull();
    expect(screen.queryByText(/view only/i)).toBeNull();
  });

  it('keeps the task read-only for someone with view-only access to the project', async () => {
    org.isAdmin = false;
    const project = {
      projectId: 'p1',
      ownerId: 'owner',
      members: [{ userId: 'u1', role: 'viewer' }],
    } as unknown as import('@/types').Project;
    render(<TaskModal open onClose={vi.fn()} task={othersTask} project={project} projectId="p1" onSave={vi.fn()} />);
    expect(await screen.findByText(/view-only access to this project/i)).toBeTruthy();
  });
});

describe('TaskModal description links while editing', () => {
  it('keeps links clickable after you click into the description to edit it', async () => {
    const withLink = { ...task, description: 'Brief: https://figma.com/file/abc and mail hello@acme.co' } as Task;
    render(<TaskModal open onClose={vi.fn()} task={withLink} projectId="p1" onSave={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /description\. press enter to edit/i }));
    const box = (await screen.findByPlaceholderText(/add a description/i)) as HTMLTextAreaElement;
    const link = screen.getByRole('link', { name: /figma\.com\/file\/abc/i });
    expect(link.getAttribute('href')).toBe('https://figma.com/file/abc');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(screen.getByRole('link', { name: /hello@acme\.co/i }).getAttribute('href')).toBe('mailto:hello@acme.co');
    // Pressing on a link must not blur the box (which would swap the view and swallow the click).
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    link.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    expect(box).toBeTruthy();
  });
});

describe('TaskModal top bar and labels', () => {
  it('toggles done from the top bar, keeping the title clear of it', async () => {
    render(<TaskModal open onClose={vi.fn()} task={task} projectId="p1" onSave={vi.fn()} />);
    const toggle = await screen.findByRole('button', { name: 'Mark as done' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.textContent).toContain('Mark complete');
    // The toggle is no longer a sibling of the title, so it can't push it sideways.
    expect(toggle.closest('header')?.contains(screen.getByLabelText('Task title'))).toBe(false);

    fireEvent.click(toggle);
    const pressed = screen.getByRole('button', { name: 'Mark as not done' });
    expect(pressed.getAttribute('aria-pressed')).toBe('true');
    expect(pressed.textContent).toContain('Completed');
  });

  it('does not put keyboard focus on the done toggle when a task opens', async () => {
    render(<TaskModal open onClose={vi.fn()} task={task} projectId="p1" onSave={vi.fn()} />);
    await screen.findByLabelText('Task title');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Copy link to task' })),
    );
  });

  it('shows the urgent badge above the title as soon as Urgent is switched on', async () => {
    render(<TaskModal open onClose={vi.fn()} task={task} projectId="p1" onSave={vi.fn()} />);
    await screen.findByLabelText('Task title');
    // Only the property label says "Urgent" to begin with.
    expect(screen.getAllByText('Urgent')).toHaveLength(1);
    fireEvent.click(screen.getByRole('switch', { name: 'Urgent' }));
    expect(screen.getAllByText('Urgent')).toHaveLength(2);
    expect(screen.getByText('On')).toBeTruthy();
  });

  it('shows the PIN fields under the Lock switch for an admin', async () => {
    render(<TaskModal open onClose={vi.fn()} task={task} projectId="p1" onSave={vi.fn()} />);
    await screen.findByLabelText('Task title');
    expect(screen.queryByLabelText('New PIN')).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'Lock' }));
    expect(screen.getByLabelText('New PIN')).toBeTruthy();
    expect(screen.getByLabelText('Confirm PIN')).toBeTruthy();
    expect(screen.getByText('Sensitive')).toBeTruthy();
  });
});
