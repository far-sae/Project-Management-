export type ActivityType =
  | 'task_created'
  | 'task_updated'
  | 'task_viewed'
  | 'subtask_created'
  | 'subtask_done'
  | 'comment_added'
  | 'project_viewed';

export interface ActivityEvent {
  activityId: string;
  taskId: string;
  projectId: string;
  projectName?: string;
  taskTitle?: string;
  organizationId: string;
  type: ActivityType;
  userId: string;
  displayName: string;
  photoURL?: string;
  createdAt: Date;
  /** Optional payload: subtask title, status change, etc. */
  payload?: {
    subtaskId?: string;
    subtaskTitle?: string;
    completed?: boolean;
    status?: string;
    [key: string]: unknown;
  };
}

export interface CreateActivityInput {
  taskId: string;
  projectId: string;
  projectName?: string;
  taskTitle?: string;
  organizationId: string;
  type: ActivityType;
  userId: string;
  displayName: string;
  photoURL?: string;
  payload?: ActivityEvent['payload'];
}
