import emailjs from '@emailjs/browser';
import { logger } from '@/lib/logger';

const PUBLIC_KEY = import.meta.env.VITE_EMAILJS_PUBLIC_KEY as string | undefined;
const SERVICE_ID = import.meta.env.VITE_EMAILJS_SERVICE_ID as string | undefined;
const TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TASK_ASSIGNED_TEMPLATE_ID as
  | string
  | undefined;

export function isTaskAssignedEmailConfigured(): boolean {
  return Boolean(PUBLIC_KEY && SERVICE_ID && TEMPLATE_ID);
}

/** Optional: notify assignee by email when EmailJS env vars are set. */
export async function sendTaskAssignedEmail(params: {
  toEmail: string;
  assigneeDisplayName?: string;
  taskTitle: string;
  projectName: string;
  actorDisplayName: string;
  taskUrl?: string;
}): Promise<void> {
  if (!isTaskAssignedEmailConfigured()) return;
  try {
    await emailjs.send(
      SERVICE_ID!,
      TEMPLATE_ID!,
      {
        to_email: params.toEmail,
        assignee_name: params.assigneeDisplayName ?? '',
        task_title: params.taskTitle,
        project_name: params.projectName,
        actor_name: params.actorDisplayName,
        task_url: params.taskUrl ?? '',
      },
      { publicKey: PUBLIC_KEY! },
    );
  } catch (e) {
    logger.warn('sendTaskAssignedEmail failed:', e);
  }
}
