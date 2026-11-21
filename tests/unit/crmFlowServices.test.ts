// CRM flow services: follow-ups before a project exists, lead → deal, won deal → project.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  inserted: [] as Array<{ table: string; row: Record<string, unknown> }>,
  createProjectTask: vi.fn(),
  createProject: vi.fn(),
  createCompany: vi.fn(),
  updateContact: vi.fn(),
  createDeal: vi.fn(),
  linkDealHandoff: vi.fn(),
  createNotification: vi.fn(),
}));

vi.mock('@/services/supabase/config', () => ({
  supabase: {
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        h.inserted.push({ table, row });
        return {
          select: () => ({
            single: async () => ({
              data: {
                id: 'row-1', created_at: '2026-11-18T10:00:00Z', updated_at: '2026-11-18T10:00:00Z',
                completed_at: null, ...row,
              },
              error: null,
            }),
          }),
        };
      },
    }),
  },
}));
vi.mock('@/services/supabase/database', () => ({
  createTask: h.createProjectTask,
  createNotification: h.createNotification,
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  createProject: h.createProject,
}));
vi.mock('@/services/supabase/crmHub/activities', () => ({ tryLogActivity: vi.fn() }));
vi.mock('@/services/supabase/crmHub/companies', () => ({ createCompany: h.createCompany }));
vi.mock('@/services/supabase/crmHub/contacts', () => ({ updateContact: h.updateContact }));
vi.mock('@/services/supabase/crmHub/deals', () => ({
  createDeal: h.createDeal,
  linkDealHandoff: h.linkDealHandoff,
}));

import { createTask } from '@/services/supabase/crmHub/tasks';
import {
  HANDOFF_COLUMNS, HandoffLinkError, convertLeadToDeal, handoffDealToNewProject,
} from '@/services/supabase/crmHub/flow';
import type { CrmContact, CrmDeal } from '@/types/crmHub';

const lead = (over: Partial<CrmContact> = {}): CrmContact => ({
  id: 'lead-1', companyId: null, source: 'Website', firstName: 'Ana', lastName: 'Silva', email: 'ana@acme.io',
  ...over,
} as CrmContact);

const deal = (over: Partial<CrmDeal> = {}): CrmDeal => ({
  id: 'deal-1', name: 'Website rebuild', contactId: 'lead-1', companyId: 'co-1', status: 'won', projectId: null,
  ...over,
} as CrmDeal);

const actor = { userId: 'u1', email: 'u1@x.io', displayName: 'Sam', photoURL: '' };
const drafts = [
  { title: 'Kick-off call', dueInDays: 2, priority: 'high' as const },
  { title: 'Confirm scope', dueInDays: 3, priority: 'high' as const },
];

beforeEach(() => {
  h.inserted.length = 0;
  Object.values(h).forEach((v) => typeof v === 'function' && (v as ReturnType<typeof vi.fn>).mockReset());
  h.createProjectTask.mockResolvedValue({ taskId: 'shared-1' });
  h.createProject.mockResolvedValue({ projectId: 'p1', name: 'Acme – Website rebuild' });
  h.createCompany.mockResolvedValue({ id: 'co-new' });
  h.createDeal.mockImplementation(async (input: Record<string, unknown>) => ({ id: 'deal-new', ...input }));
  h.updateContact.mockResolvedValue({});
  h.linkDealHandoff.mockResolvedValue({});
});

describe('follow-ups', () => {
  const input = { organizationId: 'o', workspaceId: 'w', title: 'Call Ana back', contactId: 'lead-1' };

  it('can be saved for a lead before any project exists', async () => {
    const task = await createTask({ ...input, projectId: null }, 'u1', { actorId: 'u1' });
    expect(h.createProjectTask).not.toHaveBeenCalled();
    expect(h.inserted[0].row).toMatchObject({ project_id: null, shared_task_id: null, title: 'Call Ana back' });
    expect(task.projectId).toBeNull();
  });

  it('tells the person a CRM follow-up is given to, but not when you give it to yourself', async () => {
    await createTask({ ...input, projectId: null }, 'u1', { actorId: 'u1' });
    expect(h.createNotification).not.toHaveBeenCalled();

    await createTask({ ...input, projectId: null, assignedTo: 'u2', dueDate: '2026-11-24T09:00:00Z' }, 'u1', { actorId: 'u1' });
    expect(h.createNotification).toHaveBeenCalledTimes(1);
    expect(h.createNotification.mock.calls[0][0]).toMatchObject({ userId: 'u2', type: 'task_assigned', title: 'New follow-up for you', actorUserId: 'u1' });
    expect(h.createNotification.mock.calls[0][0].body).toContain('“Call Ana back”, due ');
  });

  it('still saves the follow-up when the person could not be told', async () => {
    h.createNotification.mockRejectedValue(new Error('down'));
    const task = await createTask({ ...input, projectId: null, assignedTo: 'u2' }, 'u1', { actorId: 'u1' });
    expect(task.title).toBe('Call Ana back');
  });

  it('also appears on the project board when a project is chosen', async () => {
    await createTask({ ...input, projectId: 'p1' }, 'u1', { actorId: 'u1' });
    // On a project, the project's own task tells the assignee.
    expect(h.createNotification).not.toHaveBeenCalled();
    expect(h.createProjectTask).toHaveBeenCalledTimes(1);
    expect(h.inserted[0].row).toMatchObject({ project_id: 'p1', shared_task_id: 'shared-1' });
  });
});

describe('converting a lead into a deal', () => {
  const base = {
    organizationId: 'o', workspaceId: 'w', actorId: 'u1', dealName: 'Acme deal', value: 5000,
    stage: { id: 's2', probability: 25, status: 'open' as const },
  };

  it('opens a deal linked to the lead, with the stage chance, and marks the lead', async () => {
    const { deal: created } = await convertLeadToDeal({ ...base, lead: lead({ companyId: 'co-1' }) });
    expect(h.createDeal.mock.calls[0][0]).toMatchObject({
      contactId: 'lead-1', companyId: 'co-1', stageId: 's2', probability: 25, status: 'open', value: 5000,
    });
    expect(h.updateContact).toHaveBeenCalledWith('lead-1', { lifecycleStage: 'opportunity', leadStatus: 'open_deal' });
    expect(created.id).toBe('deal-new');
  });

  it('creates the company first when a new company name is given', async () => {
    const { companyId } = await convertLeadToDeal({ ...base, lead: lead(), newCompanyName: ' Acme Ltd ' });
    expect(h.createCompany.mock.calls[0][0]).toMatchObject({ name: 'Acme Ltd' });
    expect(companyId).toBe('co-new');
    expect(h.createDeal.mock.calls[0][0]).toMatchObject({ companyId: 'co-new' });
    expect(h.updateContact.mock.calls[0][1]).toMatchObject({ companyId: 'co-new' });
  });

  it('opens the deal in the currency that was chosen', async () => {
    await convertLeadToDeal({ ...base, lead: lead(), currency: 'USD' });
    expect(h.createDeal.mock.calls[0][0]).toMatchObject({ value: 5000, currency: 'USD' });
  });

  it('leaves the deal in the company currency when none is chosen', async () => {
    await convertLeadToDeal({ ...base, lead: lead() });
    expect(h.createDeal.mock.calls[0][0].currency ?? null).toBeNull();
  });

  it('still succeeds when only the lead status update fails', async () => {
    h.updateContact.mockRejectedValue(new Error('nope'));
    await expect(convertLeadToDeal({ ...base, lead: lead() })).resolves.toMatchObject({ deal: { id: 'deal-new' } });
  });
});

describe('handing a won deal to a new project', () => {
  const base = {
    deal: deal(), organizationId: 'o', workspaceId: 'w', actor,
    projectName: 'Acme – Website rebuild', description: 'Won deal: Website rebuild', tasks: drafts,
  };

  it('creates a project with real columns, the starter tasks, and links the deal', async () => {
    const result = await handoffDealToNewProject(base);
    expect(h.createProject.mock.calls[0][4]).toMatchObject({ workspaceId: 'w', columns: HANDOFF_COLUMNS });
    expect(HANDOFF_COLUMNS.map((c) => c.id)).toContain('todo');
    expect(h.createProjectTask).toHaveBeenCalledTimes(2);
    expect(h.createProjectTask.mock.calls[0][1]).toMatchObject({
      projectId: 'p1', title: 'Kick-off call', status: 'todo', sourceCrmDealId: 'deal-1',
    });
    expect(h.linkDealHandoff).toHaveBeenCalledWith('deal-1', { workspaceId: 'w', projectId: 'p1' });
    expect(h.updateContact).toHaveBeenCalledWith('lead-1', { lifecycleStage: 'customer' });
    expect(result).toEqual({ projectId: 'p1', tasksCreated: 2, tasksFailed: 0 });
  });

  it('reports a starter task that failed instead of failing the hand-off', async () => {
    h.createProjectTask.mockRejectedValueOnce(new Error('nope'));
    const result = await handoffDealToNewProject(base);
    expect(result).toMatchObject({ tasksCreated: 1, tasksFailed: 1 });
    expect(h.linkDealHandoff).toHaveBeenCalled();
  });

  it('says which project was made when linking fails, and a retry does not make a second one', async () => {
    h.linkDealHandoff.mockRejectedValueOnce(new Error('link failed'));
    const error = await handoffDealToNewProject(base).catch((e) => e);
    expect(error).toBeInstanceOf(HandoffLinkError);
    expect((error as HandoffLinkError).projectId).toBe('p1');

    await handoffDealToNewProject({ ...base, existingProjectId: 'p1' });
    expect(h.createProject).toHaveBeenCalledTimes(1);
    expect(h.createProjectTask).toHaveBeenCalledTimes(2);
  });
});
