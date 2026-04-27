export type NotificationType =
  | 'task_assigned'
  | 'task_updated'
  | 'task_completed'
  | 'comment_mention'
  | 'project_invite'
  | 'subscription_renewed'
  | 'task_reminder' // due date reminder (automation)
  | 'comment_added' // new comment on a task you're assigned to
  | 'project_chat_message'; // project rail chat (not @mention-only)

export interface AppNotification {
  notificationId: string;
  userId: string; // recipient
  type: NotificationType;
  title: string;
  body: string;
  /** Task/project context for navigation */
  taskId?: string;
  projectId?: string;
  /** Who triggered (e.g. who assigned) */
  actorUserId?: string;
  actorDisplayName?: string;
  read: boolean;
  createdAt: Date;
}

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  taskId?: string;
  projectId?: string;
  actorUserId?: string;
  actorDisplayName?: string;
}
