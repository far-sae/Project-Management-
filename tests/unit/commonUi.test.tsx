// Shared building blocks every redesigned page uses, so headers, number
// strips and badges look the same everywhere.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PageHeader } from '@/components/common/PageHeader';
import { StatStrip } from '@/components/common/StatStrip';
import { StatusPill } from '@/components/common/StatusPill';
import { PriorityPill, UrgentBadge, taskLevel } from '@/components/common/TaskBadges';

afterEach(cleanup);

describe('PageHeader', () => {
  it('shows the page title as the main heading, with description and actions', () => {
    render(
      <PageHeader
        title="Attendance"
        description="When your team clocked in and out."
        actions={<button type="button">Today</button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Attendance' })).toBeTruthy();
    expect(screen.getByText('When your team clocked in and out.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Today' })).toBeTruthy();
  });
});

describe('StatStrip', () => {
  it('lists each figure with its label and note', () => {
    render(
      <StatStrip
        items={[
          { label: 'Due today', value: 4, note: 'In this workspace' },
          { label: 'Overdue', value: 2, tone: 'danger' },
        ]}
      />,
    );
    expect(screen.getByText('Due today')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('In this workspace')).toBeTruthy();
    expect(screen.getByText('2').getAttribute('data-tone')).toBe('danger');
  });
});

describe('StatusPill', () => {
  it('shows the status text and records its tone', () => {
    render(<StatusPill tone="success">On the clock</StatusPill>);
    const pill = screen.getByText('On the clock');
    expect(pill.getAttribute('data-tone')).toBe('success');
  });
});

describe('Task badges', () => {
  it('labels the priority and explains it on hover', () => {
    render(<PriorityPill priority="high" />);
    expect(screen.getByText('High')).toBeTruthy();
    expect(screen.getByTitle('Priority: High')).toBeTruthy();
  });

  it('renders nothing for a task with no known priority', () => {
    const { container } = render(<PriorityPill priority={undefined} />);
    expect(container.textContent).toBe('');
  });

  it('shows an Urgent badge', () => {
    render(<UrgentBadge />);
    expect(screen.getByText('Urgent')).toBeTruthy();
  });

  it('ranks how loud a task should look', () => {
    expect(taskLevel({ urgent: true, priority: 'low', status: 'todo' })).toBe('urgent');
    expect(taskLevel({ urgent: false, priority: 'high', status: 'todo' })).toBe('high');
    expect(taskLevel({ urgent: false, priority: 'medium', status: 'todo' })).toBe('normal');
    expect(taskLevel({ urgent: true, priority: 'high', status: 'done' })).toBe('normal');
  });
});
