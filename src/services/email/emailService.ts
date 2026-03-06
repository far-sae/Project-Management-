import emailjs from "@emailjs/browser";

const EMAILJS_SERVICE_ID = import.meta.env.VITE_EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID;
const EMAILJS_PUBLIC_KEY = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;

export const sendInvitationEmail = async (params: {
  toEmail: string;
  inviterName: string;
  projectName: string;
  inviteLink: string;
  role: string;
}): Promise<boolean> => {
  try {
    await emailjs.send(
      EMAILJS_SERVICE_ID,
      EMAILJS_TEMPLATE_ID,
      {
        to_email: params.toEmail,
        to_name: params.toEmail, // ✅ add this
        inviter_name: params.inviterName,
        project_name: params.projectName,
        invite_link: params.inviteLink,
        role: params.role,
      },
      EMAILJS_PUBLIC_KEY,
    );

    console.log("✅ Email sent via EmailJS to:", params.toEmail);
    return true;
  } catch (error) {
    console.error("❌ EmailJS failed:", error);
    return false;
  }
};

export const isEmailServiceConfigured = (): boolean => {
  return (
    !!EMAILJS_SERVICE_ID &&
    !!EMAILJS_TEMPLATE_ID &&
    !!EMAILJS_PUBLIC_KEY &&
    EMAILJS_SERVICE_ID !== "undefined" &&
    EMAILJS_TEMPLATE_ID !== "undefined" &&
    EMAILJS_PUBLIC_KEY !== "undefined"
  );
};
export const openInvitationMailto = (params: {
  toEmail: string;
  inviterName: string;
  projectName: string;
  inviteLink: string;
  role: string;
}): void => {
  const subject = encodeURIComponent(`Invitation to join ${params.projectName}`);
  const body = encodeURIComponent(
    `Hello,\n\n${params.inviterName} has invited you to join the organization "${params.projectName}" as a ${params.role}.\n\nClick the link below to accept the invitation:\n${params.inviteLink}\n\nRegards,\nThe team`
  );
  window.location.href = `mailto:${params.toEmail}?subject=${subject}&body=${body}`;
};
