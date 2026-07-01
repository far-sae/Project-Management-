import { supabase } from '../config';
import type {
  CrmTask, CreateTaskInput, UpdateTaskInput, TaskPriority, TaskStatus,
} from '@/types/crmHub';
import { tryLogActivity } from './activities';

interface TaskRow {
  id: string;
  organization_id: string;
  owner_id: string | null;
  assigned_to: string | null;
  contact_id: string | null;
  company_id: string | null;
  deal_id: string | null;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

const mapTask = (r: TaskRow): CrmTask => ({
  id: r.id,
  organizationId: r.organization_id,
  ownerId: r.owner_id,
  assignedTo: r.assigned_to,
  contactId: r.contact_id,
  companyId: r.company_id,
  dealId: r.deal_id,
  title: r.title,
  description: r.description,
  dueDate: r.due_date ? new Date(r.due_date) : null,
  priority: r.priority,
  status: r.status,
  completedAt: r.completed_at ? new Date(r.completed_at) : null,
  createdAt: new Date(r.created_at),
  updatedAt: new Date(r.updated_at),
});

interface ListTasksOptions {
  contactId?: string;
  companyId?: string;
  dealId?: string;
}

export const listTasks = async (organizationId: string, opts: ListTasksOptions = {}): Promise<CrmTask[]> => {
  let q = supabase
    .from('crm_tasks')
    .select('*')
    .eq('organization_id', organizationId)
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (opts.contactId) q = q.eq('contact_id', opts.contactId);
  if (opts.companyId) q = q.eq('company_id', opts.companyId);
  if (opts.dealId) q = q.eq('deal_id', opts.dealId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(mapTask);
};

export const createTask = async (input: CreateTaskInput, ownerId: string | null): Promise<CrmTask> => {
  const { data, error } = await supabase
    .from('crm_tasks')
    .insert({
      organization_id: input.organizationId,
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
    })
    .select()
    .single();
  if (error) throw error;
  return mapTask(data);
};

export const updateTask = async (id: string, input: UpdateTaskInput): Promise<CrmTask> => {
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

  const { data, error } = await supabase
    .from('crm_tasks')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  const task = mapTask(data);
  if (input.status === 'completed') {
    tryLogActivity(
      {
        organizationId: task.organizationId,
        type: 'task_completed',
        taskId: task.id,
        contactId: task.contactId,
        companyId: task.companyId,
        dealId: task.dealId,
        description: task.title,
      },
      task.ownerId,
    );
  }
  return task;
};

export const deleteTask = async (id: string): Promise<void> => {
  const { error } = await supabase.from('crm_tasks').delete().eq('id', id);
  if (error) throw error;
};
