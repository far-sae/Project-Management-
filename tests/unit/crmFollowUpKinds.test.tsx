// Follow-ups: what kind of thing each one is, ones that repeat, and "only mine".
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CrmTask } from '@/types/crmHub';
import { isMine, nextDueDate } from '@/lib/crmFollowUpKinds';

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  calls: [] as Array<{ op: 'insert' | 'update'; id?: string; row: Record<string, unknown> }>,
  rows: new Map<string, Record<string, unknown>>(),
  insertError: null as null | { code: string; message: string },
  updateError: null as null | { code: string; message: string },
  toast: { success: vi.fn(), error: vi.fn() },
  tasks: [] as unknown[],
  refresh: vi.fn(async () => {}),
  organization: {
    organizationId: 'o',
    members: [
      { userId: 'u1', displayName: 'Sam', email: 'sam@example.com', role: 'owner', status: 'active' },
      { userId: 'u2', displayName: 'Dana', email: 'dana@example.com', role: 'member', status: 'active' },
    ],
  },
  user: { userId: 'u1', email: 'sam@example.com', displayName: 'Sam' },
}));

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/services/supabase/config', () => ({
  supabase: {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        h.calls.push({ op: 'insert', row });
        const result = h.insertError
          ? { data: null, error: h.insertError }
          : { data: { id: `made-${h.calls.length}`, created_at: '2026-11-20T10:00:00Z', updated_at: '2026-11-20T10:00:00Z', completed_at: null, ...row }, error: null };
        return { select: () => ({ single: async () => result }) };
      },
      update: (patch: Record<string, unknown>) => ({
        eq: (_column: string, id: string) => {
          h.calls.push({ op: 'update', id, row: patch });
          const row = { ...(h.rows.get(id) ?? {}), ...patch };
          if (!h.updateError) h.rows.set(id, row);
          const result = h.updateError ? { data: null, error: h.updateError } : { data: row, error: null };
          return Object.assign(Promise.resolve(result), { select: () => ({ single: async () => result }) });
        },
      }),
    }),
  },
}));
vi.mock('@/services/supabase/database', () => ({
  createTask: vi.fn(), createNotification: vi.fn(), updateTask: vi.fn(), deleteTask: vi.fn(),
}));
vi.mock('@/services/supabase/crmHub/activities', () => ({ tryLogActivity: vi.fn() }));

const list = <T,>(items: T[]) => ({ items, loading: false, error: null, refresh: h.refresh });
vi.mock('@/hooks/useCrmHub', () => ({
  useCrmTasks: () => list(h.tasks as CrmTask[]),
  useCrmContacts: () => list([{ id: 'l1', firstName: 'Priya', lastName: 'Nair' }]),
  useCrmCompanies: () => list([]),
  useCrmDeals: () => list([]),
  useWorkspaceForCreate: () => 'w',
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => ({ organization: h.organization }) }));
vi.mock('@/hooks/useProjects', () => {
  const projects = { projects: [{ projectId: 'p1', name: 'Harbour website', workspaceId: 'w', columns: [] }], loading: false };
  return { useProjects: () => projects };
});

import { FOLLOW_UP_EXTRAS_NOT_SET_UP_MESSAGE, createTask, updateTask } from '@/services/supabase/crmHub/tasks';
import { CrmTasksPage } from '@/pages/crmHub/Tasks';

const stored = (id: string, over: Row = {}): Row => ({
  id, organization_id: 'o', workspace_id: 'w', owner_id: 'u1', assigned_to: 'u1', contact_id: 'l1', company_id: null,
  deal_id: null, project_id: null, shared_task_id: null, title: 'Ring Priya', description: null,
  due_date: '2026-11-02T09:00:00.000Z', priority: 'medium', status: 'pending', completed_at: null,
  created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-01T10:00:00Z', kind: 'call', repeat_every: 'weekly', ...over,
});

beforeEach(() => {
  h.calls.length = 0;
  h.rows.clear();
  h.insertError = null;
  h.updateError = null;
  h.toast.success.mockClear();
  h.toast.error.mockClear();
  h.refresh.mockClear();
  h.tasks = [];
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the next date of a follow-up that repeats', () => {
  const at = (month: number, day: number, hour = 9, year = 2026) => new Date(year, month - 1, day, hour, 0, 0, 0);

  it('moves on one step from the date it was due', () => {
    expect(nextDueDate(at(11, 20), 'daily', at(11, 20, 15))).toEqual(at(11, 21));
    expect(nextDueDate(at(11, 20), 'weekly', at(11, 20, 15))).toEqual(at(11, 27));
    expect(nextDueDate(at(11, 20), 'monthly', at(11, 20, 15))).toEqual(at(12, 20));
  });

  it('lands in the future when the follow-up was done late', () => {
    // Due on the 2nd, done on the 20th: the 9th and the 16th are gone already.
    expect(nextDueDate(at(11, 2), 'weekly', at(11, 20, 15))).toEqual(at(11, 23));
  });

  it('still moves on when the follow-up was done early', () => {
    expect(nextDueDate(at(11, 20), 'daily', at(11, 20, 8))).toEqual(at(11, 21));
  });

  it('keeps the day of the month, and uses the last day of a shorter month', () => {
    expect(nextDueDate(at(1, 31, 9, 2027), 'monthly', at(1, 31, 15, 2027))).toEqual(at(2, 28, 9, 2027));
    expect(nextDueDate(at(1, 31, 9, 2027), 'monthly', at(3, 1, 15, 2027))).toEqual(at(3, 31, 9, 2027));
  });

  it('counts from now when the follow-up had no date', () => {
    expect(nextDueDate(null, 'weekly', at(11, 20, 15))).toEqual(at(11, 27, 15));
  });
});

describe('whose a follow-up is', () => {
  it('is mine when it is given to me, or when I made it and it is given to nobody', () => {
    expect(isMine({ assignedTo: 'u1', ownerId: 'u2' }, 'u1')).toBe(true);
    expect(isMine({ assignedTo: null, ownerId: 'u1' }, 'u1')).toBe(true);
    expect(isMine({ assignedTo: 'u2', ownerId: 'u1' }, 'u1')).toBe(false);
    expect(isMine({ assignedTo: null, ownerId: null }, 'u1')).toBe(false);
  });
});

describe('saving a follow-up', () => {
  const input = { organizationId: 'o', workspaceId: 'w', projectId: null, title: 'Ring Priya' };

  it('saves a plain to-do without the new columns, so it works before the database file is run', async () => {
    const task = await createTask(input, 'u1', { actorId: 'u1' });
    expect(h.calls[0].row).not.toHaveProperty('kind');
    expect(h.calls[0].row).not.toHaveProperty('repeat_every');
    expect(task.kind).toBe('todo');
    expect(task.repeatEvery).toBeNull();
  });

  it('saves the kind and how often it repeats', async () => {
    const task = await createTask({ ...input, kind: 'call', repeatEvery: 'weekly' }, 'u1', { actorId: 'u1' });
    expect(h.calls[0].row).toMatchObject({ kind: 'call', repeat_every: 'weekly' });
    expect(task.kind).toBe('call');
    expect(task.repeatEvery).toBe('weekly');
  });

  it('says which database file to run when the columns are not there yet', async () => {
    h.insertError = { code: 'PGRST204', message: "Could not find the 'kind' column of 'crm_tasks' in the schema cache" };
    await expect(createTask({ ...input, kind: 'email' }, 'u1', { actorId: 'u1' })).rejects.toThrow(FOLLOW_UP_EXTRAS_NOT_SET_UP_MESSAGE);
    expect(FOLLOW_UP_EXTRAS_NOT_SET_UP_MESSAGE).toContain('194_crm_follow_up_kinds.sql');
    h.updateError = { code: '42703', message: 'column "repeat_every" of relation "crm_tasks" does not exist' };
    await expect(updateTask('t1', { repeatEvery: 'daily' })).rejects.toThrow(FOLLOW_UP_EXTRAS_NOT_SET_UP_MESSAGE);
  });

  it('changes only what it is told to', async () => {
    h.rows.set('t1', stored('t1'));
    await updateTask('t1', { title: 'Ring Priya again' });
    expect(h.calls).toEqual([{ op: 'update', id: 't1', row: { title: 'Ring Priya again' } }]);
    h.calls.length = 0;
    await updateTask('t1', { kind: 'meeting', repeatEvery: null });
    expect(h.calls[0].row).toEqual({ kind: 'meeting', repeat_every: null });
  });
});

describe('completing a follow-up that repeats', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-20T15:00:00.000Z'));
  });

  it('makes the next one, with everything the same but the date, and moves the repeat to it', async () => {
    h.rows.set('t1', stored('t1'));
    const done = await updateTask('t1', { status: 'completed' });
    const made = h.calls.filter((c) => c.op === 'insert');
    expect(made).toHaveLength(1);
    expect(made[0].row).toMatchObject({
      organization_id: 'o', workspace_id: 'w', owner_id: 'u1', assigned_to: 'u1', contact_id: 'l1',
      title: 'Ring Priya', priority: 'medium', status: 'pending', kind: 'call', repeat_every: 'weekly',
      project_id: null, shared_task_id: null,
    });
    // Due on the 2nd, done on the 20th: the next Monday still to come is the 23rd.
    expect(made[0].row.due_date).toBe(nextDueDate(new Date('2026-11-02T09:00:00.000Z'), 'weekly', new Date()).toISOString());
    expect(new Date(made[0].row.due_date as string).getTime()).toBeGreaterThan(Date.now());
    // The one that is done repeats no more: un-ticking and ticking it again must not make another.
    expect(h.calls.at(-1)).toEqual({ op: 'update', id: 't1', row: { repeat_every: null } });
    expect(done.repeatEvery).toBeNull();
    expect(done.nextFollowUp?.title).toBe('Ring Priya');
    expect(done.nextFollowUp?.repeatEvery).toBe('weekly');
  });

  it('makes nothing for a follow-up that does not repeat, or one that is only started', async () => {
    h.rows.set('t1', stored('t1', { repeat_every: null }));
    h.rows.set('t2', stored('t2'));
    expect((await updateTask('t1', { status: 'completed' })).nextFollowUp).toBeUndefined();
    await updateTask('t2', { status: 'in_progress' });
    expect(h.calls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });

  it('keeps the follow-up done when the next one could not be made', async () => {
    h.rows.set('t1', stored('t1'));
    h.insertError = { code: '23514', message: 'refused' };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const done = await updateTask('t1', { status: 'completed' });
    expect(done.status).toBe('completed');
    expect(done.nextFollowUp).toBeUndefined();
    // It still repeats, so completing it again can try once more.
    expect(done.repeatEvery).toBe('weekly');
    expect(h.calls.filter((c) => c.op === 'update')).toHaveLength(1);
    warn.mockRestore();
  });
});

describe('migration 194', () => {
  const raw = readFileSync(resolve(process.cwd(), 'supabase/migrations/194_crm_follow_up_kinds.sql'), 'utf8');
  const flat = raw.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/\s+/g, ' ');

  it('can be run twice and only adds two columns', () => {
    expect(raw.toLowerCase()).toContain('safe to run more than once');
    expect(flat).toContain("alter table public.crm_tasks add column if not exists kind text not null default 'todo'");
    expect(flat).toContain('alter table public.crm_tasks add column if not exists repeat_every text');
    expect(flat).not.toMatch(/drop (table|column)/i);
    expect(flat).not.toMatch(/create table/i);
  });

  it('allows exactly the kinds and repeats the app knows', () => {
    expect(flat).toContain("check (kind in ('todo', 'call', 'email', 'meeting'))");
    expect(flat).toContain("check (repeat_every is null or repeat_every in ('daily', 'weekly', 'monthly'))");
    expect((flat.match(/if not exists \(select 1 from pg_constraint where conname = /g) ?? []).length).toBe(2);
  });
});

describe('Follow-ups page', () => {
  const task = (id: string, title: string, over: Partial<CrmTask> = {}): CrmTask => ({
    id, organizationId: 'o', workspaceId: 'w', ownerId: 'u1', assignedTo: 'u1', contactId: null, companyId: null, dealId: null,
    projectId: null, sharedTaskId: null, title, description: null, dueDate: new Date(Date.now() + 2 * 86400000),
    priority: 'medium', status: 'pending', completedAt: null, createdAt: new Date(), updatedAt: new Date(),
    kind: 'todo', repeatEvery: null, ...over,
  });
  const show = () => render(<MemoryRouter><CrmTasksPage /></MemoryRouter>);
  const titles = () => screen.getAllByRole('button').filter((b) => b.getAttribute('title') && b.className.includes('truncate')).map((b) => b.textContent);
  const choose = async (label: string, option: string) => {
    fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'ArrowDown' });
    fireEvent.keyDown(await screen.findByRole('option', { name: option }), { key: 'Enter' });
  };

  beforeEach(() => {
    h.tasks = [
      task('t1', 'Ring Priya', { kind: 'call', repeatEvery: 'weekly', contactId: 'l1' }),
      task('t2', 'Send the quote', { kind: 'email', assignedTo: 'u2' }),
      task('t3', 'Tidy the notes', { assignedTo: null }),
      task('t4', 'Kick-off', { kind: 'meeting', assignedTo: null, ownerId: 'u2' }),
    ];
  });

  it('says what kind each follow-up is and how often it repeats', () => {
    show();
    const row = (title: string) => screen.getByRole('button', { name: title }).closest('tr') as HTMLElement;
    expect(within(row('Ring Priya')).getByText('Call')).toBeTruthy();
    expect(within(row('Ring Priya')).getByText('Every week')).toBeTruthy();
    expect(within(row('Send the quote')).getByText('Email')).toBeTruthy();
    expect(within(row('Kick-off')).getByText('Meeting')).toBeTruthy();
    // A plain to-do needs no label.
    expect(within(row('Tidy the notes')).queryByText('To-do')).toBeNull();
  });

  it('shows only my follow-ups when asked', async () => {
    show();
    expect(titles()).toHaveLength(4);
    await choose('Whose follow-ups', 'Mine');
    expect(titles()).toEqual(['Ring Priya', 'Tidy the notes']);
    expect(screen.getByText('2 of 4 shown')).toBeTruthy();
  });

  it('shows only one kind when asked', async () => {
    show();
    await choose('Filter by type', 'Call');
    expect(titles()).toEqual(['Ring Priya']);
  });

  it('saves the type and the repeat chosen in the form', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'New follow-up' }));
    fireEvent.change(await screen.findByLabelText('Title *'), { target: { value: 'Check in with Priya' } });
    await choose('Type', 'Call');
    await choose('Repeat', 'Every month');
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Follow-up created'));
    expect(h.calls[0].row).toMatchObject({ title: 'Check in with Priya', kind: 'call', repeat_every: 'monthly' });
  });

  it('does not offer a repeat for a follow-up on a project board', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'New follow-up' }));
    await screen.findByLabelText('Title *');
    await choose('Repeat', 'Every week');
    await choose('Project (optional)', 'Harbour website');
    const repeat = screen.getByRole('combobox', { name: 'Repeat' }) as HTMLButtonElement;
    expect(repeat.disabled).toBe(true);
    expect(repeat.textContent).toContain('Does not repeat');
  });

  it('touches the type and the repeat only when they were changed', async () => {
    h.rows.set('t1', stored('t1'));
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Ring Priya' }));
    fireEvent.change(await screen.findByLabelText('Title *'), { target: { value: 'Ring Priya on Monday' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Follow-up updated'));
    expect(h.calls[0].row).not.toHaveProperty('kind');
    expect(h.calls[0].row).not.toHaveProperty('repeat_every');
  });

  it('says when the next one is due after a repeating follow-up is done', async () => {
    h.tasks = [task('t1', 'Ring Priya', { kind: 'call', repeatEvery: 'weekly', status: 'in_progress' })];
    h.rows.set('t1', stored('t1', { status: 'in_progress', due_date: new Date(Date.now() + 86400000).toISOString() }));
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Mark completed' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalled());
    expect(h.toast.success.mock.calls[0][0]).toMatch(/^Done\. The next one is due \d{1,2} \w{3} \d{4}, \d{2}:\d{2}\.$/);
    expect(h.refresh).toHaveBeenCalled();
  });
});
