import emailjs from "@emailjs/browser";
import { logger } from "@/lib/logger";

const EMAILJS_SERVICE_ID = import.meta.env.VITE_EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID;
const EMAILJS_PUBLIC_KEY = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;

type InvitationEmailParams = {
  toEmail: string;
  inviterName: string;
  projectName: string;
  inviteLink: string;
  role: string;
};

export const sendInvitationEmail = async (
  params: InvitationEmailParams,
): Promise<boolean> => {
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
    return false;
  }

  const templateParams = {
    to_email: cleanedEmail,
    to_name: recipientName,
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
    return true;
  } catch (error: unknown) {
    const err = error as { status?: number; text?: string; message?: string };
    logger.error("Invitation email request failed:", error);
    if (err?.status === 412) {
      logger.warn(
        "EmailJS returned 412 (Precondition Failed): check template parameter names match your EmailJS template, " +
          "service is connected, and the account allows API sends.",
      );
    }
    return false;
  }
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

export const openInvitationMailto = (params: InvitationEmailParams): void => {
  const subject = encodeURIComponent(
    `Invitation to join ${params.projectName}`,
  );
  const body = encodeURIComponent(
    `Hi,\n\n${params.inviterName} has invited you to join "${params.projectName}" as a ${params.role}.\n\nAccept the invitation here:\n${params.inviteLink}\n\nThis invitation expires in 7 days.\n\nRegards,\nTaskCalendar Team`,
  );
  window.location.href = `mailto:${params.toEmail}?subject=${subject}&body=${body}`;
};
