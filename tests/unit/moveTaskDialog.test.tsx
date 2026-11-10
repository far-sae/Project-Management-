import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const moveTaskToProject = vi.hoisted(() => vi.fn());
vi.mock('@/services/supabase/taskMove', () => ({
  moveTaskToProject: (...a: unknown[]) => moveTaskToProject(...a),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { MoveTaskDialog } from '@/components/kanban/MoveTaskDialog';
import type { Project } from '@/types';

const col = (id: string, title: string, order: number) => ({ id, title, color: '#999', order });
const proj = (projectId: string, name: string, columns?: ReturnType<typeof col>[]) =>
  ({ projectId, name, columns }) as unknown as Project;

const projects = [
  proj('p1', 'Website'),
  proj('p2', 'Mobile app', [col('backlog', 'Backlog', 0), col('todo', 'To-do', 1)]),
  proj('p3', 'Marketing', [col('ideas', 'Ideas', 0), col('live', 'Live', 1)]),
];

function renderDialog() {
  const onOpenChange = vi.fn();
  const onMoved = vi.fn();
  render(
    <MoveTaskDialog
      open
      onOpenChange={onOpenChange}
      task={{ taskId: 't1', title: 'Fix login', status: 'todo' }}
      currentProjectId="p1"
      projects={projects}
      onMoved={onMoved}
    />,
  );
  return { onOpenChange, onMoved };
}

afterEach(cleanup);
beforeEach(() => {
  moveTaskToProject.mockReset();
  moveTaskToProject.mockResolvedValue(undefined);
  toast.success.mockReset();
  toast.error.mockReset();
});

describe('MoveTaskDialog', () => {
  it('lists the other projects, not the one the task is in', () => {
    renderDialog();
    expect(screen.queryByRole('radio', { name: 'Website' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Mobile app' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Marketing' })).toBeTruthy();
  });

  it('keeps the same column when the new project has it', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('radio', { name: 'Mobile app' }));
    expect((screen.getByLabelText('Column') as HTMLSelectElement).value).toBe('todo');
  });

  it("falls back to the new project's first column otherwise", () => {
    renderDialog();
    fireEvent.click(screen.getByRole('radio', { name: 'Marketing' }));
    expect((screen.getByLabelText('Column') as HTMLSelectElement).value).toBe('ideas');
  });

  it('filters projects by name', () => {
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText('Search projects'), { target: { value: 'mark' } });
    expect(screen.queryByRole('radio', { name: 'Mobile app' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Marketing' })).toBeTruthy();
  });

  it('moves the task to the chosen project and column', async () => {
    const { onOpenChange, onMoved } = renderDialog();
    expect((screen.getByRole('button', { name: 'Move' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Marketing' }));
    fireEvent.change(screen.getByLabelText('Column'), { target: { value: 'live' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(moveTaskToProject).toHaveBeenCalledWith('t1', 'p3', 'live'));
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith('p3'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toast.success).toHaveBeenCalledWith('Moved "Fix login" to Marketing');
  });

  it('shows the reason and stays open when the move is refused', async () => {
    moveTaskToProject.mockRejectedValue(new Error("You can't add tasks to that project"));
    const { onOpenChange, onMoved } = renderDialog();
    fireEvent.click(screen.getByRole('radio', { name: 'Marketing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You can't add tasks to that project"));
    expect(onMoved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
