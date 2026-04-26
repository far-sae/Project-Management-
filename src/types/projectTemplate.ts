import type { KanbanColumn } from './task';

/** A task seed inside a project template. Stored as JSON, no IDs. */
export interface ProjectTemplateTaskSeed {
  title: string;
  description?: string;
  status?: string;
  priority?: 'low' | 'medium' | 'high';
  /** Days from project creation when this task is due. */
  dueOffsetDays?: number;
  tags?: string[];
  subtasks?: { title: string }[];
}

export interface ProjectTemplate {
  id: string;
  ownerId?: string | null;
  organizationId?: string | null;
  name: string;
  description?: string | null;
  columns: KanbanColumn[];
  tasks: ProjectTemplateTaskSeed[];
  isBuiltin: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProjectTemplateInput {
  ownerId: string;
  organizationId?: string | null;
  name: string;
  description?: string;
  columns: KanbanColumn[];
  tasks: ProjectTemplateTaskSeed[];
}

export interface UpdateProjectTemplateInput {
  name?: string;
  description?: string;
  columns?: KanbanColumn[];
  tasks?: ProjectTemplateTaskSeed[];
}
