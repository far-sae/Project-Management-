import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import { TaskCard } from '@/components/kanban/TaskCard';
import type { Task } from '@/types';

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { userId: 'me' } }) }));
vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => ({ isAdmin: false }) }));

afterEach(cleanup);

const task = {
  taskId: 't1',
  projectId: 'p1',
  organizationId: 'o1',
  title: 'Write the proposal',
  description: '',
  status: 'general',
  priority: 'medium',
  priorityColor: '#f90',
  dueDate: null,
  assignees: [],
  position: 0,
  attachments: [],
  commentsCount: 0,
  createdBy: 'me',
  createdAt: new Date(),
  updatedAt: new Date(),
  completedAt: null,
} as unknown as Task;

function renderCard(props: Partial<React.ComponentProps<typeof TaskCard>>) {
  return render(
    <DndContext>
      <SortableContext items={['t1']}>
        <TaskCard task={task} {...props} />
      </SortableContext>
    </DndContext>,
  );
}

describe('TaskCard ✓ mark done', () => {
  it('marks the task done in one click without opening it', () => {
    const onMarkDone = vi.fn();
    const onClick = vi.fn();
    renderCard({ onMarkDone, onClick });
    fireEvent.click(screen.getByRole('button', { name: 'Mark "Write the proposal" as done' }));
    expect(onMarkDone).toHaveBeenCalledWith(task);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('has no ✓ for people who cannot change the task', () => {
    renderCard({ onMarkDone: vi.fn(), dragDisabled: true });
    expect(screen.queryByRole('button', { name: /as done/ })).toBeNull();
  });

  it('has no ✓ when the board does not offer it (view-only)', () => {
    renderCard({});
    expect(screen.queryByRole('button', { name: /as done/ })).toBeNull();
  });
});
