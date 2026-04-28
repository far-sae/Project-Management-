import emailjs from "@emailjs/browser";
import { logger } from "@/lib/logger";

const EMAILJS_SERVICE_ID = import.meta.env.VITE_EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID;
const EMAILJS_NOTIFICATION_TEMPLATE_ID =
  import.meta.env.VITE_EMAILJS_NOTIFICATION_TEMPLATE_ID ||
  import.meta.env.VITE_EMAILJS_TASK_ASSIGNED_TEMPLATE_ID ||
  EMAILJS_TEMPLATE_ID;
const EMAILJS_PUBLIC_KEY = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;

type InvitationEmailParams = {
  toEmail: string;
  inviterName: string;
  projectName: string;
  inviteLink: string;
  role: string;
};

/** `ok: false` may include `status` (e.g. 412) and `text` from EmailJS (e.g. Gmail reconnect message). */
export type InvitationEmailResult =
  | { ok: true }
  | { ok: false; status?: number; text?: string };

function parseEmailJsSendError(error: unknown): { status?: number; text?: string } {
  if (error && typeof error === "object") {
    const o = error as { status?: unknown; text?: unknown };
    const status = typeof o.status === "number" ? o.status : undefined;
    const text = typeof o.text === "string" ? o.text : undefined;
    if (status !== undefined || text !== undefined) {
      return { status, text };
    }
  }
  if (error instanceof Error) {
    return { text: error.message };
  }
  return {};
}

export const sendInvitationEmail = async (
  params: InvitationEmailParams,
): Promise<InvitationEmailResult> => {
  const cleanedEmail = params.toEmail.trim();
  const recipientName = cleanedEmail.split("@")[0] || cleanedEmail;
  const inviterName = params.inviterName.trim();
  const projectName = params.projectName.trim();
  const inviteLink = params.inviteLink.trim();
  const role = params.role.trim();

  if (
    !EMAILJS_SERVICE_ID ||
    !EMAILJS_TEMPLATE_ID ||
    !EMAILJS_PUBLIC_KEY
  ) {
    logger.warn("EmailJS not configured; skipping invitation email");
    return { ok: false };
  }

  const templateParams = {
    to_email: cleanedEmail,
    to_name: recipientName,
    /** Common in EmailJS default templates (maps to “To Email” in the template editor). */
    user_email: cleanedEmail,
    name: inviterName,
    email: cleanedEmail,
    invitee_email: cleanedEmail,
    inviter_name: inviterName,
    from_name: inviterName,
    sender_name: inviterName,
    project_name: projectName,
    company_name: projectName,
    team_name: projectName,
    workspace_name: projectName,
    invite_link: inviteLink,
    invitation_link: inviteLink,
    action_url: inviteLink,
    role,
    user_role: role,
    subject: `Invitation to join ${projectName}`,
    preheader: `${inviterName} invited you to join ${projectName} as ${role}.`,
    greeting: `Hi ${recipientName},`,
    intro_text: `${inviterName} has invited you to join "${projectName}" as a ${role}.`,
    button_text: "Accept Invitation",
    expiry_text: "This invitation expires in 7 days.",
    message: [
      `Hi ${cleanedEmail},`,
      "",
      `${inviterName} has invited you to join "${projectName}" as a ${role}.`,
      "",
      `Accept the invitation here: ${inviteLink}`,
      "",
      "This invitation expires in 7 days.",
      "",
      "Regards,",
      "TaskCalendar Team",
    ].join("\n"),
  };

  try {
    await emailjs.send(
      EMAILJS_SERVICE_ID,
      EMAILJS_TEMPLATE_ID,
      templateParams,
      { publicKey: EMAILJS_PUBLIC_KEY },
    );

    logger.log("Invitation email sent to:", cleanedEmail);
    return { ok: true };
  } catch (error: unknown) {
    const { status, text } = parseEmailJsSendError(error);
    logger.error("Invitation email request failed:", error, status, text);
    if (status === 412) {
      logger.warn(
        "EmailJS 412: often Gmail / OAuth — reconnect the email service in EmailJS (Services → " +
          "Edit → Reconnect) and allow “Send email on your behalf”. Also verify template variable names. " +
          (text ? `Server said: ${text}` : ""),
      );
    }
    return { ok: false, status, text };
  }
};

/** Shorter line for toasts; full fix is always reconnecting the mail service in the EmailJS dashboard. */
export const getInvitationEmailFailureHint = (
  result: InvitationEmailResult,
): string => {
  if (result.ok) return "";
  if (result.status === 412) {
    return (
      "EmailJS: reconnect your mail service (e.g. Gmail) in the EmailJS dashboard " +
      "(Email Services → Edit → Reconnect; invalid OAuth grants show as 412 " +
      "\"Gmail_API: Invalid grant\")."
    );
  }
  const trimmed = result.text?.trim() ?? "";
  return trimmed ? trimmed : "";
};

export const isEmailServiceConfigured = (): boolean => {
  return Boolean(
    EMAILJS_SERVICE_ID &&
      EMAILJS_TEMPLATE_ID &&
      EMAILJS_PUBLIC_KEY &&
      EMAILJS_SERVICE_ID !== "undefined" &&
      EMAILJS_TEMPLATE_ID !== "undefined" &&
      EMAILJS_PUBLIC_KEY !== "undefined",
  );
};

export const isNotificationEmailConfigured = (): boolean => {
  return Boolean(
    EMAILJS_SERVICE_ID &&
      EMAILJS_NOTIFICATION_TEMPLATE_ID &&
      EMAILJS_PUBLIC_KEY &&
      EMAILJS_SERVICE_ID !== "undefined" &&
      EMAILJS_NOTIFICATION_TEMPLATE_ID !== "undefined" &&
      EMAILJS_PUBLIC_KEY !== "undefined",
  );
};

export const sendNotificationEmail = async (params: {
  toEmail: string;
  toName?: string;
  title: string;
  body: string;
  actorDisplayName?: string;
  projectName?: string;
  taskTitle?: string;
  actionUrl?: string;
}): Promise<InvitationEmailResult> => {
  const cleanedEmail = params.toEmail.trim();
  if (!cleanedEmail || !cleanedEmail.includes("@")) return { ok: false };
  if (!isNotificationEmailConfigured()) {
    logger.warn("EmailJS notification template not configured; skipping notification email");
    return { ok: false };
  }

  const toName = params.toName?.trim() || cleanedEmail.split("@")[0] || cleanedEmail;
  const templateParams = {
    to_email: cleanedEmail,
    to_name: toName,
    user_email: cleanedEmail,
    email: cleanedEmail,
    subject: params.title,
    title: params.title,
    notification_title: params.title,
    message: params.body,
    notification_body: params.body,
    body: params.body,
    actor_name: params.actorDisplayName || "",
    from_name: params.actorDisplayName || "TaskCalendar",
    project_name: params.projectName || "",
    task_title: params.taskTitle || "",
    action_url: params.actionUrl || "",
    task_url: params.actionUrl || "",
    preheader: params.body,
  };

  try {
    await emailjs.send(
      EMAILJS_SERVICE_ID!,
      EMAILJS_NOTIFICATION_TEMPLATE_ID!,
      templateParams,
      { publicKey: EMAILJS_PUBLIC_KEY! },
    );
    logger.log("Notification email sent to:", cleanedEmail);
    return { ok: true };
  } catch (error: unknown) {
    const { status, text } = parseEmailJsSendError(error);
    logger.warn("Notification email request failed:", error, status, text);
    return { ok: false, status, text };
  }
};

export const openInvitationMailto = (params: InvitationEmailParams): void => {
  const subject = encodeURIComponent(
    `Invitation to join ${params.projectName}`,
  );
  const body = encodeURIComponent(
    `Hi,\n\n${params.inviterName} has invited you to join "${params.projectName}" as a ${params.role}.\n\nAccept the invitation here:\n${params.inviteLink}\n\nThis invitation expires in 7 days.\n\nRegards,\nTaskCalendar Team`,
  );
  window.location.href = `mailto:${params.toEmail}?subject=${subject}&body=${body}`;
};
