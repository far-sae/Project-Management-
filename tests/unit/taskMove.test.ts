import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/services/supabase/config', () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));

import { TASKS_CHANGED_EVENT, moveTaskToProject } from '@/services/supabase/taskMove';

describe('moveTaskToProject', () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: null, error: null });
  });

  it('moves the task via the move_task_to_project database function', async () => {
    await moveTaskToProject('t1', 'p2', 'todo');
    expect(rpc).toHaveBeenCalledWith('move_task_to_project', {
      p_task: 't1',
      p_project: 'p2',
      p_status: 'todo',
    });
  });

  it('keeps the current column when none is chosen', async () => {
    await moveTaskToProject('t1', 'p2');
    expect(rpc).toHaveBeenCalledWith('move_task_to_project', {
      p_task: 't1',
      p_project: 'p2',
      p_status: null,
    });
  });

  it('tells open boards to refresh, with both projects', async () => {
    const heard = vi.fn();
    window.addEventListener(TASKS_CHANGED_EVENT, heard);
    await moveTaskToProject('t1', 'p2', 'todo');
    window.removeEventListener(TASKS_CHANGED_EVENT, heard);
    expect(heard).toHaveBeenCalledTimes(1);
    expect((heard.mock.calls[0][0] as CustomEvent).detail).toEqual({ taskId: 't1', projectId: 'p2' });
  });

  it('shows the database reason when the move is refused', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "You can't add tasks to that project", code: '42501' } });
    await expect(moveTaskToProject('t1', 'p2')).rejects.toThrow("You can't add tasks to that project");
  });

  it('explains when the database update has not been applied yet', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Could not find the function', code: 'PGRST202' } });
    await expect(moveTaskToProject('t1', 'p2')).rejects.toThrow(/migration 171/);
  });

  it('does not announce a change when the move failed', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'nope' } });
    const heard = vi.fn();
    window.addEventListener(TASKS_CHANGED_EVENT, heard);
    await expect(moveTaskToProject('t1', 'p2')).rejects.toThrow();
    window.removeEventListener(TASKS_CHANGED_EVENT, heard);
    expect(heard).not.toHaveBeenCalled();
  });
});
