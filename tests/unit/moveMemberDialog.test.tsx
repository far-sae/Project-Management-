import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const moveProjectMember = vi.hoisted(() => vi.fn());
vi.mock('@/services/supabase/projectMembers', () => ({
  moveProjectMember: (...a: unknown[]) => moveProjectMember(...a),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { MoveMemberDialog } from '@/components/team/MoveMemberDialog';
import type { Project } from '@/types';

const proj = (projectId: string, name: string, ownerId = 'owner', members: { userId: string }[] = []) =>
  ({ projectId, name, ownerId, members }) as unknown as Project;

const projects = [
  proj('p-wrong', 'Website'),
  proj('p-right', 'Mobile app'),
  proj('p-other', 'Marketing'),
  proj('p-has-sam', 'Support', 'owner', [{ userId: 'u-sam' }]),
  proj('p-sam-owns', 'Sam side project', 'u-sam'),
];

const member = { userId: 'u-sam', email: 'sam@x.com', displayName: 'Sam', role: 'member' as const };

function renderDialog() {
  const onOpenChange = vi.fn();
  const onMoved = vi.fn();
  render(
    <MoveMemberDialog
      open
      onOpenChange={onOpenChange}
      member={member}
      currentProjectId="p-wrong"
      organizationId="org-1"
      projects={projects}
      onMoved={onMoved}
    />,
  );
  return { onOpenChange, onMoved };
}

afterEach(cleanup);
beforeEach(() => {
  moveProjectMember.mockReset();
  moveProjectMember.mockResolvedValue(undefined);
  toast.success.mockReset();
  toast.error.mockReset();
});

describe('MoveMemberDialog', () => {
  it('lists only projects the person is not already in', () => {
    renderDialog();
    expect(screen.queryByRole('radio', { name: 'Website' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Support' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Sam side project' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Mobile app' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Marketing' })).toBeTruthy();
  });

  it('moves the person, keeping their role, and unassigns old tasks by default', async () => {
    const { onOpenChange, onMoved } = renderDialog();
    expect((screen.getByRole('button', { name: 'Move' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Mobile app' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    await waitFor(() =>
      expect(moveProjectMember).toHaveBeenCalledWith({
        fromProjectId: 'p-wrong',
        toProjectId: 'p-right',
        organizationId: 'org-1',
        userId: 'u-sam',
        email: 'sam@x.com',
        role: 'member',
        unassignTasks: true,
      }),
    );
    await waitFor(() => expect(onMoved).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toast.success).toHaveBeenCalledWith('Moved Sam from Website to Mobile app');
  });

  it('can keep their task assignments in the old project', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('radio', { name: 'Marketing' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /unassign/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    await waitFor(() =>
      expect(moveProjectMember).toHaveBeenCalledWith(expect.objectContaining({ unassignTasks: false })),
    );
  });

  it('shows the reason and still refreshes when the move only half worked', async () => {
    moveProjectMember.mockRejectedValue(new Error("Sam was added to the new project, but couldn't be removed from the old one: nope"));
    const { onMoved } = renderDialog();
    fireEvent.click(screen.getByRole('radio', { name: 'Mobile app' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onMoved).toHaveBeenCalled();
  });
});
