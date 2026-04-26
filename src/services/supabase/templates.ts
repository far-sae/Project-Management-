import { supabase } from './config';
import type {
  ProjectTemplate,
  ProjectTemplateTaskSeed,
  CreateProjectTemplateInput,
  UpdateProjectTemplateInput,
} from '@/types/projectTemplate';
import type { KanbanColumn } from '@/types/task';
import { logger } from '@/lib/logger';

interface TemplateRow {
  id: string;
  owner_id: string | null;
  organization_id: string | null;
  name: string;
  description: string | null;
  columns: KanbanColumn[] | null;
  tasks: ProjectTemplateTaskSeed[] | null;
  is_builtin: boolean;
  created_at: string;
  updated_at: string;
}

const fromRow = (row: TemplateRow): ProjectTemplate => ({
  id: row.id,
  ownerId: row.owner_id,
  organizationId: row.organization_id,
  name: row.name,
  description: row.description,
  columns: row.columns ?? [],
  tasks: row.tasks ?? [],
  isBuiltin: !!row.is_builtin,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

const DEFAULT_COLUMNS: KanbanColumn[] = [
  { id: 'todo', title: 'To-do', color: '#9E9E9E', order: 0 },
  { id: 'inprogress', title: 'In progress', color: '#2196F3', order: 1 },
  { id: 'review', title: 'In review', color: '#9C27B0', order: 2 },
  { id: 'done', title: 'Done', color: '#4CAF50', order: 3 },
];

/** Built-in templates baked into the client. They render alongside any
 *  database-backed templates and don't require seeding the DB. */
export const BUILTIN_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'builtin-sprint',
    ownerId: null,
    organizationId: null,
    name: 'Sprint',
    description: 'Two-week scrum sprint with backlog, doing, review, done.',
    isBuiltin: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    columns: [
      { id: 'backlog', title: 'Backlog', color: '#9E9E9E', order: 0 },
      { id: 'todo', title: 'To-do', color: '#FF9800', order: 1 },
      { id: 'inprogress', title: 'In progress', color: '#2196F3', order: 2 },
      { id: 'review', title: 'Review', color: '#9C27B0', order: 3 },
      { id: 'done', title: 'Done', color: '#4CAF50', order: 4 },
    ],
    tasks: [
      { title: 'Sprint planning', status: 'todo', priority: 'high', dueOffsetDays: 0 },
      { title: 'Stand-up notes', status: 'todo', priority: 'medium' },
      { title: 'Backlog grooming', status: 'backlog', priority: 'medium', dueOffsetDays: 7 },
      { title: 'Sprint demo', status: 'todo', priority: 'high', dueOffsetDays: 14 },
      { title: 'Retrospective', status: 'todo', priority: 'medium', dueOffsetDays: 14 },
    ],
  },
  {
    id: 'builtin-marketing',
    ownerId: null,
    organizationId: null,
    name: 'Marketing campaign',
    description: 'Plan, produce, launch, and analyze a marketing campaign.',
    isBuiltin: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    columns: [
      { id: 'ideas', title: 'Ideas', color: '#9E9E9E', order: 0 },
      { id: 'briefing', title: 'Briefing', color: '#FF9800', order: 1 },
      { id: 'production', title: 'In production', color: '#2196F3', order: 2 },
      { id: 'review', title: 'Review', color: '#9C27B0', order: 3 },
      { id: 'live', title: 'Live', color: '#4CAF50', order: 4 },
    ],
    tasks: [
      { title: 'Audience research', status: 'briefing', priority: 'high', dueOffsetDays: 3 },
      { title: 'Campaign brief', status: 'briefing', priority: 'high', dueOffsetDays: 5 },
      { title: 'Creative concepts', status: 'production', priority: 'medium', dueOffsetDays: 10 },
      { title: 'Landing page copy', status: 'production', priority: 'medium', dueOffsetDays: 12 },
      { title: 'QA + accessibility check', status: 'review', priority: 'medium', dueOffsetDays: 14 },
      { title: 'Launch', status: 'live', priority: 'high', dueOffsetDays: 16 },
      { title: 'Post-launch report', status: 'live', priority: 'low', dueOffsetDays: 30 },
    ],
  },
  {
    id: 'builtin-product-launch',
    ownerId: null,
    organizationId: null,
    name: 'Product launch',
    description: 'Cross-functional launch checklist with milestones.',
    isBuiltin: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    columns: DEFAULT_COLUMNS,
    tasks: [
      { title: 'Define launch goals', status: 'todo', priority: 'high', dueOffsetDays: 1 },
      { title: 'Pricing & packaging', status: 'todo', priority: 'high', dueOffsetDays: 5 },
      { title: 'Product page copy', status: 'inprogress', priority: 'medium', dueOffsetDays: 10 },
      { title: 'Press kit', status: 'inprogress', priority: 'medium', dueOffsetDays: 12 },
      { title: 'Internal training', status: 'review', priority: 'medium', dueOffsetDays: 14 },
      { title: 'Customer onboarding flow', status: 'review', priority: 'high', dueOffsetDays: 16 },
      { title: 'Launch day checklist', status: 'todo', priority: 'high', dueOffsetDays: 18 },
      { title: 'Post-launch review', status: 'todo', priority: 'low', dueOffsetDays: 30 },
    ],
  },
  {
    id: 'builtin-weekly-ops',
    ownerId: null,
    organizationId: null,
    name: 'Weekly ops',
    description: 'Recurring weekly ops board for small teams.',
    isBuiltin: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    columns: [
      { id: 'todo', title: 'This week', color: '#FF9800', order: 0 },
      { id: 'inprogress', title: 'Doing', color: '#2196F3', order: 1 },
      { id: 'blocked', title: 'Blocked', color: '#F44336', order: 2 },
      { id: 'done', title: 'Done', color: '#4CAF50', order: 3 },
    ],
    tasks: [
      { title: 'Weekly priorities', status: 'todo', priority: 'high', dueOffsetDays: 0 },
      { title: 'Customer support digest', status: 'todo', priority: 'medium', dueOffsetDays: 1 },
      { title: 'Metrics review', status: 'todo', priority: 'medium', dueOffsetDays: 4 },
      { title: 'Team retro', status: 'todo', priority: 'low', dueOffsetDays: 6 },
    ],
  },
];

/** Fetch built-in + DB templates the current user can see. */
export const fetchProjectTemplates = async (params: {
  ownerId?: string | null;
  organizationId?: string | null;
}): Promise<ProjectTemplate[]> => {
  try {
    const { ownerId, organizationId } = params;
    let query = supabase
      .from('project_templates')
      .select('*')
      .order('updated_at', { ascending: false });

    const orFilters: string[] = ['is_builtin.eq.true'];
    if (ownerId) orFilters.push(`owner_id.eq.${ownerId}`);
    if (organizationId) orFilters.push(`organization_id.eq.${organizationId}`);
    query = query.or(orFilters.join(','));

    const { data, error } = await query;
    if (error) {
      logger.warn(
        'fetchProjectTemplates failed (table may be missing). Falling back to builtins:',
        error.message,
      );
      return BUILTIN_TEMPLATES;
    }
    const dbTemplates = (data || []).map((row) => fromRow(row as TemplateRow));
    // Avoid duplicates if DB also has builtins.
    const ids = new Set(dbTemplates.map((t) => t.id));
    const builtinExtras = BUILTIN_TEMPLATES.filter((t) => !ids.has(t.id));
    return [...dbTemplates, ...builtinExtras];
  } catch (e) {
    logger.warn('fetchProjectTemplates error:', e);
    return BUILTIN_TEMPLATES;
  }
};

export const createProjectTemplate = async (
  input: CreateProjectTemplateInput,
): Promise<ProjectTemplate | null> => {
  const payload = {
    owner_id: input.ownerId,
    organization_id: input.organizationId ?? null,
    name: input.name,
    description: input.description ?? null,
    columns: input.columns,
    tasks: input.tasks,
    is_builtin: false,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('project_templates')
    .insert(payload)
    .select('*')
    .single();
  if (error) {
    logger.error('createProjectTemplate failed:', error);
    return null;
  }
  return fromRow(data as TemplateRow);
};

export const updateProjectTemplate = async (
  id: string,
  patch: UpdateProjectTemplateInput,
): Promise<boolean> => {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.columns !== undefined) update.columns = patch.columns;
  if (patch.tasks !== undefined) update.tasks = patch.tasks;
  const { error } = await supabase
    .from('project_templates')
    .update(update)
    .eq('id', id);
  if (error) {
    logger.error('updateProjectTemplate failed:', error);
    return false;
  }
  return true;
};

export const deleteProjectTemplate = async (id: string): Promise<boolean> => {
  const { error } = await supabase.from('project_templates').delete().eq('id', id);
  if (error) {
    logger.error('deleteProjectTemplate failed:', error);
    return false;
  }
  return true;
};
