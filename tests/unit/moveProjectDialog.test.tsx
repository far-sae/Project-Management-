import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const moveProjectToWorkspace = vi.fn();
vi.mock('@/services/supabase/projectMove', () => ({
  moveProjectToWorkspace: (...a: unknown[]) => moveProjectToWorkspace(...a),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { MoveProjectDialog } from '@/components/workspace/MoveProjectDialog';
import type { Workspace } from '@/types/workspace';

const ws = (id: string, name: string, isDefault = false) =>
  ({ workspaceId: id, name, isDefault, organizationId: 'org-1' }) as unknown as Workspace;
const workspaces = [ws('ws-a', 'Marketing'), ws('ws-b', 'Clients'), ws('ws-c', 'Default Workspace', true)];

function renderDialog(project = { projectId: 'p1', name: 'Website', workspaceId: 'ws-a' as string | null }) {
  const onOpenChange = vi.fn();
  render(
    <MoveProjectDialog
      open
      onOpenChange={onOpenChange}
      project={project}
      workspaces={workspaces}
    />,
  );
  return { onOpenChange };
}

afterEach(cleanup);
beforeEach(() => {
  moveProjectToWorkspace.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe('MoveProjectDialog', () => {
  it('lists the other workspaces (not the current one) plus "No workspace"', () => {
    renderDialog();
    expect(screen.queryByRole('radio', { name: 'Marketing' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Clients' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'General' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'No workspace' })).toBeTruthy();
    expect(screen.getByText(/tasks, comments, files and chat/i)).toBeTruthy();
  });

  it('hides "No workspace" when the project already has none', () => {
    renderDialog({ projectId: 'p1', name: 'Website', workspaceId: null });
    expect(screen.queryByRole('radio', { name: 'No workspace' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Marketing' })).toBeTruthy();
  });

  it('keeps Move disabled until a destination is chosen', () => {
    renderDialog();
    const move = screen.getByRole('button', { name: /^move$/i }) as HTMLButtonElement;
    expect(move.disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Clients' }));
    expect(move.disabled).toBe(false);
  });

  it('moves the project, confirms, and closes', async () => {
    moveProjectToWorkspace.mockResolvedValue(undefined);
    const { onOpenChange } = renderDialog();
    fireEvent.click(screen.getByRole('radio', { name: 'Clients' }));
    fireEvent.click(screen.getByRole('button', { name: /^move$/i }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(moveProjectToWorkspace).toHaveBeenCalledWith('p1', 'ws-b');
    expect(toast.success).toHaveBeenCalledWith('Moved "Website" to Clients');
  });

  it('passes null for "No workspace"', async () => {
    moveProjectToWorkspace.mockResolvedValue(undefined);
    renderDialog();
    fireEvent.click(screen.getByRole('radio', { name: 'No workspace' }));
    fireEvent.click(screen.getByRole('button', { name: /^move$/i }));
    await waitFor(() => expect(moveProjectToWorkspace).toHaveBeenCalledWith('p1', null));
  });

  it('shows the error and stays open when the move fails', async () => {
    moveProjectToWorkspace.mockRejectedValue(new Error("You don't have permission to move this project."));
    const { onOpenChange } = renderDialog();
    fireEvent.click(screen.getByRole('radio', { name: 'Clients' }));
    fireEvent.click(screen.getByRole('button', { name: /^move$/i }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("You don't have permission to move this project."),
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('explains when there is nowhere to move to', () => {
    render(
      <MoveProjectDialog
        open
        onOpenChange={vi.fn()}
        project={{ projectId: 'p1', name: 'Website', workspaceId: null }}
        workspaces={[]}
        />,
    );
    expect(screen.getByText(/no other workspace/i)).toBeTruthy();
  });
});
