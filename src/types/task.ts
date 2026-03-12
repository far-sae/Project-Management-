export type TaskStatus = string; // Now supports custom column IDs
export type TaskPriority = "high" | "medium" | "low";

export interface KanbanColumn {
  id: string;
  title: string;
  color: string;
  order: number;
}

export interface TaskAssignee {
  userId: string;
  displayName: string;
  email?: string;
  photoURL?: string;
}

export interface TaskAttachment {
  fileId: string;
  fileName: string;
  fileUrl: string;
  fileType: string;
  uploadedBy: string;
  uploadedAt: Date;
  size: number;
}

export interface TaskSubtask {
  id: string;
  title: string;
  completed: boolean;
}

export interface Task {
  taskId: string;
  projectId: string;
  organizationId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  priorityColor: string;
  dueDate: Date | null;
  assignees: TaskAssignee[];
  tags?: string[];
  /** Inline subtasks (shown in task box only, not as column cards) */
  subtasks?: TaskSubtask[];
  parentTaskId?: string | null;
  /** Show as urgent beside assignees */
  urgent?: boolean;
  /** When true, only creator, assignees, and project owner can see this task */
  isLocked?: boolean;
  position: number;
  attachments: TaskAttachment[];
  commentsCount: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface CommentAttachment {
  fileId: string;
  fileName: string;
  fileUrl: string;
  fileType: string;
}

export interface TaskComment {
  commentId: string;
  taskId: string;
  organizationId?: string;
  userId: string;
  displayName: string;
  photoURL: string;
  text: string;
  attachments?: CommentAttachment[];
  timeSpentMinutes?: number;
  createdAt: Date;
  updatedAt: Date;
  isEdited: boolean;
}

export interface GlobalComment {
  commentId: string;
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string;
  organizationId: string; // Multi-tenancy: link to organization
  userId: string;
  displayName: string;
  photoURL: string;
  text: string;
  attachments?: CommentAttachment[];
  timeSpentMinutes?: number;
  createdAt: Date;
  updatedAt: Date;
  isEdited: boolean;
  visibleToUserIds: string[];
}

export interface CreateTaskInput {
  projectId: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: Date | null;
  assignees?: TaskAssignee[];
  attachments?: TaskAttachment[];
  tags?: string[];
  subtasks?: TaskSubtask[];
  parentTaskId?: string | null;
  urgent?: boolean;
  isLocked?: boolean;
  /** For activity log (task_created) */
  projectName?: string;
  createdByDisplayName?: string;
  createdByPhotoURL?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: Date | null;
  assignees?: TaskAssignee[];
  attachments?: TaskAttachment[];
  tags?: string[];
  subtasks?: TaskSubtask[];
  parentTaskId?: string | null;
  urgent?: boolean;
  isLocked?: boolean;
  position?: number;
  /** For activity log (subtask_created / subtask_done) */
  activityBy?: { userId: string; displayName: string; photoURL?: string };
  /** For notifications when assignees change */
  assigneeChangedBy?: { userId: string; displayName: string };
}

export const DEFAULT_COLUMNS: KanbanColumn[] = [
  { id: "undefined", title: "Undefined task", color: "#9E9E9E", order: 0 },
  { id: "todo", title: "To-do", color: "#FF9800", order: 1 },
  { id: "inprogress", title: "On-Progress", color: "#2196F3", order: 2 },
  { id: "done", title: "Done", color: "#4CAF50", order: 3 },
  { id: "needreview", title: "Need review", color: "#9C27B0", order: 4 },
];

// Keep for backward compatibility
export const TASK_COLUMNS: { id: string; title: string; color: string }[] =
  DEFAULT_COLUMNS.map((c) => ({
    id: c.id,
    title: c.title,
    color: c.color,
  }));

export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  high: "#FF4444",
  medium: "#FFA500",
  low: "#4CAF50",
};
