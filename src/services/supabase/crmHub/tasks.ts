import { supabase } from '../config';
import type {
  CrmTask, CreateTaskInput, UpdateTaskInput, TaskPriority, TaskStatus,
} from '@/types/crmHub';
import { tryLogActivity } from './activities';
import { applyWorkspaceFilter } from './workspaceFilter';
import {
  createNotification,
  createTask as createProjectTask,
  updateTask as updateProjectTask,
  deleteTask as deleteProjectTask,
} from '../database';
import type { TaskAssignee } from '@/types/task';
import { isFollowUpKind, isFollowUpRepeat, nextDueDate } from '@/lib/crmFollowUpKinds';

/** Shown when a follow-up needs the type or repeat columns and the database does not have them yet. */
export const FOLLOW_UP_EXTRAS_NOT_SET_UP_MESSAGE =
  'Follow-up types and repeats are not set up yet: run supabase/migrations/194_crm_follow_up_kinds.sql in the Supabase SQL editor.';

/** The database said it has no such column: migration 194 has not been run. */
const columnsMissing = (error: { code?: string; message?: string }): boolean =>
  (error.code === 'PGRST204' || error.code === '42703') && /kind|repeat_every/.test(error.message ?? '');

interface TaskRow {
  id: string;
  organization_id: string;
  workspace_id: string | null;
  owner_id: string | null;
  assigned_to: string | null;
  contact_id: string | null;
  company_id: string | null;
  deal_id: string | null;
  project_id: string | null;
  shared_task_id: string | null;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  // From migration 194. Absent until it is run.
  kind?: string | null;
  repeat_every?: string | null;
}

const mapTask = (r: TaskRow): CrmTask => ({
  id: r.id,
  organizationId: r.organization_id,
  workspaceId: r.workspace_id ?? null,
  ownerId: r.owner_id,
  assignedTo: r.assigned_to,
  contactId: r.contact_id,
  companyId: r.company_id,
  dealId: r.deal_id,
  projectId: r.project_id,
  sharedTaskId: r.shared_task_id,
  title: r.title,
  description: r.description,
  dueDate: r.due_date ? new Date(r.due_date) : null,
  priority: r.priority,
  status: r.status,
  completedAt: r.completed_at ? new Date(r.completed_at) : null,
  createdAt: new Date(r.created_at),
  updatedAt: new Date(r.updated_at),
  kind: isFollowUpKind(r.kind) ? r.kind : 'todo',
  repeatEvery: isFollowUpRepeat(r.repeat_every) ? r.repeat_every : null,
});

interface ListTasksOptions {
  contactId?: string;
  companyId?: string;
  dealId?: string;
}

export const listTasks = async (
  organizationId: string,
  opts: ListTasksOptions & { workspaceId?: string | null } = {},
): Promise<CrmTask[]> => {
  let q = supabase
    .from('crm_tasks')
    .select('*')
    .eq('organization_id', organizationId)
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (opts.contactId) q = q.eq('contact_id', opts.contactId);
  if (opts.companyId) q = q.eq('company_id', opts.companyId);
  if (opts.dealId) q = q.eq('deal_id', opts.dealId);
  q = applyWorkspaceFilter(q, opts.workspaceId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(mapTask);
};

export interface LinkedTaskOptions {
  actorId: string;
  assignee?: TaskAssignee | null;
  projectName?: string;
  sharedStatus?: string;
}

const projectPriority = (priority: TaskPriority | undefined): 'low' | 'medium' | 'high' =>
  priority === 'urgent' ? 'high' : priority ?? 'medium';

export const createTask = async (
  input: CreateTaskInput,
  ownerId: string | null,
  options: LinkedTaskOptions,
): Promise<CrmTask> => {
  // A follow-up on a lead or an open deal has no project yet: it lives in
  // the CRM only. With a project it is mirrored onto that project's board.
  const sharedTask = !input.projectId ? null : await createProjectTask(options.actorId, {
    projectId: input.projectId,
    projectName: options.projectName,
    title: input.title,
    description: input.description ?? undefined,
    dueDate: input.dueDate ? new Date(input.dueDate) : null,
    priority: projectPriority(input.priority),
    urgent: input.priority === 'urgent',
    status: options.sharedStatus,
    assignees: options.assignee ? [options.assignee] : [],
    sourceCrmDealId: input.dealId ?? null,
    sourceCrmContactId: input.contactId ?? null,
  }, input.organizationId);

  const { data, error } = await supabase
    .from('crm_tasks')
    .insert({
      organization_id: input.organizationId,
      workspace_id: input.workspaceId,
      project_id: input.projectId ?? null,
      shared_task_id: sharedTask?.taskId ?? null,
      owner_id: ownerId,
      assigned_to: input.assignedTo ?? ownerId,
      contact_id: input.contactId ?? null,
      company_id: input.companyId ?? null,
      deal_id: input.dealId ?? null,
      title: input.title,
      description: input.description ?? null,
      due_date: input.dueDate ?? null,
      priority: input.priority ?? 'medium',
      status: input.status ?? 'pending',
      // Sent only when they say something, so a plain follow-up saves before migration 194 is run.
      ...(input.kind && input.kind !== 'todo' ? { kind: input.kind } : {}),
      // A follow-up on a project board does not repeat: its copy on the board would not.
      ...(input.repeatEvery && !input.projectId ? { repeat_every: input.repeatEvery } : {}),
    })
    .select()
    .single();
  if (error) {
    if (sharedTask) await deleteProjectTask(sharedTask.taskId, input.organizationId).catch(() => undefined);
    throw columnsMissing(error) ? new Error(FOLLOW_UP_EXTRAS_NOT_SET_UP_MESSAGE) : error;
  }
  const task = mapTask(data);
  // A follow-up on a project tells its assignee through the project's own task. One that lives
  // in the CRM only had no way to: the person it was given to learned of it by chance.
  if (!sharedTask && task.assignedTo && task.assignedTo !== options.actorId) {
    try {
      await createNotification({
        userId: task.assignedTo,
        type: 'task_assigned',
        title: 'New follow-up for you',
        body: task.dueDate
          ? `“${task.title}”, due ${new Date(task.dueDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}. Find it under CRM, Follow-ups.`
          : `“${task.title}”. Find it under CRM, Follow-ups.`,
        actorUserId: options.actorId,
      });
    } catch (err) {
      // The follow-up is saved; a notification that could not be written must not make that look failed.
      console.warn('[crm] could not tell the assignee about the follow-up', err);
    }
  }
  return task;
};

export const updateTask = async (
  id: string,
  input: UpdateTaskInput,
  options?: Pick<LinkedTaskOptions, 'assignee' | 'sharedStatus'>,
): Promise<CrmTask & { nextFollowUp?: CrmTask }> => {
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.dueDate !== undefined) patch.due_date = input.dueDate;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.status !== undefined) {
    patch.status = input.status;
    patch.completed_at = input.status === 'completed' ? new Date().toISOString() : null;
  }
  if (input.assignedTo !== undefined) patch.assigned_to = input.assignedTo;
  if (input.contactId !== undefined) patch.contact_id = input.contactId;
  if (input.companyId !== undefined) patch.company_id = input.companyId;
  if (input.dealId !== undefined) patch.deal_id = input.dealId;
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.repeatEvery !== undefined) patch.repeat_every = input.repeatEvery;

  const { data, error } = await supabase
    .from('crm_tasks')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw columnsMissing(error) ? new Error(FOLLOW_UP_EXTRAS_NOT_SET_UP_MESSAGE) : error;
  const task: CrmTask & { nextFollowUp?: CrmTask } = mapTask(data);
  if (task.sharedTaskId) {
    await updateProjectTask(task.sharedTaskId, {
      title: input.title,
      description: input.description ?? undefined,
      dueDate: input.dueDate === undefined ? undefined : input.dueDate ? new Date(input.dueDate) : null,
      priority: input.priority === undefined ? undefined : projectPriority(input.priority),
      urgent: input.priority === undefined ? undefined : input.priority === 'urgent',
      status: options?.sharedStatus,
      assignees: options?.assignee === undefined ? undefined : options.assignee ? [options.assignee] : [],
    }, task.organizationId);
  }
  if (input.status === 'completed') {
    tryLogActivity(
      {
        organizationId: task.organizationId,
        workspaceId: task.workspaceId,
        type: 'task_completed',
        taskId: task.id,
        contactId: task.contactId,
        companyId: task.companyId,
        dealId: task.dealId,
        description: task.title,
      },
      task.ownerId,
    );
    const next = await makeNextFollowUp(task);
    if (next) {
      task.nextFollowUp = next;
      task.repeatEvery = null;
    }
  }
  return task;
};

/**
 * A repeating follow-up was completed: the next one is made, the same in
 * everything but its date, and the repeat moves to it. The completed one stops
 * repeating, so un-ticking and ticking it again cannot make a second copy.
 * Never fails the completion it is part of.
 */
async function makeNextFollowUp(done: CrmTask): Promise<CrmTask | null> {
  if (!done.repeatEvery || done.sharedTaskId || done.projectId) return null;
  try {
    const { data, error } = await supabase
      .from('crm_tasks')
      .insert({
        organization_id: done.organizationId,
        workspace_id: done.workspaceId,
        project_id: null,
        shared_task_id: null,
        owner_id: done.ownerId,
        assigned_to: done.assignedTo,
        contact_id: done.contactId,
        company_id: done.companyId,
        deal_id: done.dealId,
        title: done.title,
        description: done.description,
        due_date: nextDueDate(done.dueDate, done.repeatEvery, new Date()).toISOString(),
        priority: done.priority,
        status: 'pending',
        kind: done.kind,
        repeat_every: done.repeatEvery,
      })
      .select()
      .single();
    if (error) throw error;
    const stopped = await supabase.from('crm_tasks').update({ repeat_every: null }).eq('id', done.id);
    if (stopped.error) console.warn('[crm] the completed follow-up still says it repeats', stopped.error);
    return mapTask(data);
  } catch (err) {
    console.warn('[crm] could not make the next follow-up', err);
    return null;
  }
}

export const deleteTask = async (id: string): Promise<void> => {
  const { data: row } = await supabase
    .from('crm_tasks')
    .select('shared_task_id, organization_id')
    .eq('id', id)
    .maybeSingle();
  const { error } = await supabase.from('crm_tasks').delete().eq('id', id);
  if (error) throw error;
  if (row?.shared_task_id) {
    await deleteProjectTask(row.shared_task_id as string, row.organization_id as string);
  }
};
