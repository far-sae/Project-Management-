// Task cards stand out by urgency and priority: urgent cards are the loudest
// (red card + "Urgent" badge), high priority next, everything else is quiet.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import { TaskCard } from '@/components/kanban/TaskCard';
import type { Task } from '@/types';

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { userId: 'me' } }) }));
vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => ({ isAdmin: false }) }));

afterEach(cleanup);

const base = {
  taskId: 't1',
  projectId: 'p1',
  organizationId: 'o1',
  title: 'Write the proposal',
  description: '',
  status: 'todo',
  priority: 'medium',
  dueDate: null,
  assignees: [],
  position: 0,
  attachments: [],
  commentsCount: 0,
  createdBy: 'me',
  createdAt: new Date(),
  updatedAt: new Date(),
  completedAt: null,
};

function renderCard(overrides: Record<string, unknown>) {
  const task = { ...base, ...overrides } as unknown as Task;
  const utils = render(
    <DndContext>
      <SortableContext items={['t1']}>
        <TaskCard task={task} />
      </SortableContext>
    </DndContext>,
  );
  const card = utils.container.querySelector('[data-task-card]') as HTMLElement;
  return { ...utils, card };
}

describe('TaskCard urgency levels', () => {
  it('marks an urgent task as the loudest level and shows the Urgent badge', () => {
    const { card } = renderCard({ urgent: true, priority: 'high' });
    expect(card.getAttribute('data-level')).toBe('urgent');
    expect(screen.getByText('Urgent')).toBeTruthy();
    expect(screen.getByText('High')).toBeTruthy();
  });

  it('marks a high priority task that is not urgent as "high"', () => {
    const { card } = renderCard({ priority: 'high' });
    expect(card.getAttribute('data-level')).toBe('high');
    expect(screen.queryByText('Urgent')).toBeNull();
  });

  it('keeps medium and low priority tasks quiet', () => {
    expect(renderCard({ priority: 'medium' }).card.getAttribute('data-level')).toBe('normal');
    cleanup();
    expect(renderCard({ priority: 'low' }).card.getAttribute('data-level')).toBe('normal');
  });

  it('stops shouting once the task is done', () => {
    const { card } = renderCard({ urgent: true, priority: 'high', status: 'done' });
    expect(card.getAttribute('data-level')).toBe('normal');
  });

  it('shows the priority as a labelled pill', () => {
    renderCard({ priority: 'low' });
    expect(screen.getByTitle('Priority: Low')).toBeTruthy();
  });
});
