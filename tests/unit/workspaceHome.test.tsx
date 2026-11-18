import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import {
  projectLockState,
  projectProgress,
  taskDotClass,
  welcomeTitle,
} from '@/components/workspace/projectCardModel';
import { ProjectCard } from '@/components/workspace/ProjectCard';

afterEach(cleanup);

describe('welcomeTitle', () => {
  it('greets by first name', () => {
    expect(welcomeTitle('Sam Carter')).toBe('Welcome back, Sam');
    expect(welcomeTitle('  Aisha   Khan ')).toBe('Welcome back, Aisha');
  });

  it('drops the comma when there is no name', () => {
    expect(welcomeTitle(undefined)).toBe('Welcome back');
    expect(welcomeTitle(null)).toBe('Welcome back');
    expect(welcomeTitle('   ')).toBe('Welcome back');
  });
});

describe('projectProgress', () => {
  it('rounds the share of finished tasks', () => {
    expect(projectProgress({ totalTasks: 24, completedTasks: 18 })).toEqual({ done: 18, total: 24, percent: 75 });
    expect(projectProgress({ totalTasks: 3, completedTasks: 1 })).toEqual({ done: 1, total: 3, percent: 33 });
  });

  it('is 0% for a project with no tasks or missing stats', () => {
    expect(projectProgress({ totalTasks: 0, completedTasks: 0 })).toEqual({ done: 0, total: 0, percent: 0 });
    expect(projectProgress(undefined)).toEqual({ done: 0, total: 0, percent: 0 });
  });

  it('never leaves the 0–100 range', () => {
    expect(projectProgress({ totalTasks: 2, completedTasks: 5 }).percent).toBe(100);
    expect(projectProgress({ totalTasks: 2, completedTasks: -1 }).percent).toBe(0);
  });
});

describe('projectLockState', () => {
  it('is "locked" for a PIN-locked project that is not unlocked in this session', () => {
    expect(projectLockState({ pinLocked: true, unlockedInSession: false, isOwner: false })).toBe('locked');
    expect(projectLockState({ pinLocked: true, unlockedInSession: false, isOwner: true })).toBe('locked');
  });

  it('is "unlocked" once the PIN was entered in this session', () => {
    expect(projectLockState({ pinLocked: true, unlockedInSession: true, isOwner: false })).toBe('unlocked');
  });

  it('offers "set-pin" only to the owner of a project without a PIN lock', () => {
    expect(projectLockState({ pinLocked: false, unlockedInSession: false, isOwner: true })).toBe('set-pin');
    expect(projectLockState({ pinLocked: false, unlockedInSession: false, isOwner: false })).toBeNull();
  });
});

describe('taskDotClass', () => {
  it('is red for urgent and high-priority tasks', () => {
    expect(taskDotClass({ urgent: true, priority: 'low', status: 'todo' })).toBe('bg-destructive');
    expect(taskDotClass({ priority: 'high', status: 'todo' })).toBe('bg-destructive');
  });

  it('is amber for medium and grey for low or unknown priority', () => {
    expect(taskDotClass({ priority: 'medium', status: 'todo' })).toBe('bg-warning');
    expect(taskDotClass({ priority: 'low', status: 'todo' })).toBe('bg-muted-foreground/60');
    expect(taskDotClass({ status: 'todo' })).toBe('bg-muted-foreground/60');
  });

  it('never shouts for a finished task', () => {
    expect(taskDotClass({ urgent: true, priority: 'high', status: 'done' })).toBe('bg-muted-foreground/40');
  });
});

describe('ProjectCard', () => {
  const project = {
    projectId: 'p1',
    name: 'Website relaunch',
    description: 'New marketing site and blog',
    coverColor: '#2563eb',
    stats: { totalTasks: 24, completedTasks: 18 },
  };

  it('shows the name, description and progress', () => {
    render(<ProjectCard project={project} onOpen={() => {}} />);
    expect(screen.getByRole('button', { name: 'Website relaunch' })).toBeTruthy();
    expect(screen.getByText('New marketing site and blog')).toBeTruthy();
    expect(screen.getByText('18 of 24 tasks done')).toBeTruthy();
    expect(screen.getByText('75%')).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: 'Task completion' });
    expect(bar.getAttribute('aria-valuenow')).toBe('75');
  });

  it('falls back to "No description"', () => {
    render(<ProjectCard project={{ ...project, description: '' }} onOpen={() => {}} />);
    expect(screen.getByText('No description')).toBeTruthy();
  });

  it('opens the project from the name', () => {
    const onOpen = vi.fn();
    render(<ProjectCard project={project} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Website relaunch' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('renders the lock pill for each state and keeps its click away from "open"', () => {
    const onOpen = vi.fn();
    const onLock = vi.fn();
    const { rerender } = render(
      <ProjectCard project={project} onOpen={onOpen} lock={{ state: 'locked', onClick: onLock }} />,
    );
    const locked = screen.getByRole('button', { name: 'Enter PIN to unlock project for this session' });
    expect(locked.textContent).toContain('Locked');
    fireEvent.click(locked);
    expect(onLock).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();

    rerender(<ProjectCard project={project} onOpen={onOpen} lock={{ state: 'unlocked', onClick: onLock }} />);
    expect(
      screen.getByRole('button', { name: 'Lock session, require PIN again' }).textContent,
    ).toContain('Unlocked');

    rerender(<ProjectCard project={project} onOpen={onOpen} lock={{ state: 'set-pin', onClick: onLock }} />);
    expect(
      screen.getByRole('button', { name: 'Open project settings to set lock and PIN' }).textContent,
    ).toContain('Set PIN');
  });

  it('always shows the options button when a menu is given', () => {
    render(<ProjectCard project={project} onOpen={() => {}} menu={<div>items</div>} />);
    const trigger = screen.getByRole('button', { name: 'Project options' });
    expect(trigger.className).not.toMatch(/opacity-0/);
  });

  it('has no options button without a menu', () => {
    render(<ProjectCard project={project} onOpen={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Project options' })).toBeNull();
  });

  it('shows an optional note under the progress', () => {
    render(<ProjectCard project={project} onOpen={() => {}} note="Owned by project owner" />);
    expect(screen.getByText('Owned by project owner')).toBeTruthy();
  });
});
