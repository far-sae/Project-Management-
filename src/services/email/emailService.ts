import { supabase } from "@/services/supabase/config";
import { logger } from "@/lib/logger";

// All TaskCalendar email goes through the `send-email` Supabase Edge
// Function, which sends via Resend. (It used to be EmailJS from the
// browser; the Resend API key must stay server-side.)

type InvitationEmailParams = {
  toEmail: string;
  inviterName: string;
  projectName: string;
  inviteLink: string;
  role: string;
};

/** `ok: false` may include the HTTP `status` and a human-readable `text`. */
export type InvitationEmailResult =
  | { ok: true }
  | { ok: false; status?: number; text?: string; code?: string };

const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

async function readFunctionError(
  error: unknown,
): Promise<{ status?: number; text?: string; code?: string }> {
  const fallback = error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? "");
  const ctx = (error as { context?: unknown })?.context;
  if (ctx instanceof Response) {
    try {
      const body = (await ctx.clone().json()) as { error?: unknown; code?: unknown };
      return {
        status: ctx.status,
        text: typeof body?.error === "string" ? body.error : fallback,
        code: typeof body?.code === "string" ? body.code : undefined,
      };
    } catch {
      return { status: ctx.status, text: fallback };
    }
  }
  return { text: fallback };
}

async function sendViaFunction(
  body: Record<string, unknown>,
  label: string,
): Promise<InvitationEmailResult> {
  try {
    const { error } = await supabase.functions.invoke("send-email", { body });
    if (error) {
      const info = await readFunctionError(error);
      console.error(`[Email] ${label} send failed (status=${info.status ?? "?"}): ${info.text ?? "unknown error"}`);
      return { ok: false, ...info };
    }
    logger.log(`${label} email sent to:`, body.toEmail);
    return { ok: true };
  } catch (err) {
    const text = err instanceof Error ? err.message : "unknown error";
    console.error(`[Email] ${label} send failed: ${text}`);
    return { ok: false, text };
  }
}

export const sendInvitationEmail = async (
  params: InvitationEmailParams,
): Promise<InvitationEmailResult> => {
  const toEmail = params.toEmail.trim();
  if (!looksLikeEmail(toEmail)) return { ok: false, text: "Invalid email address" };
  return sendViaFunction(
    {
      kind: "invitation",
      toEmail,
      inviterName: params.inviterName.trim(),
      projectName: params.projectName.trim(),
      inviteLink: params.inviteLink.trim(),
      role: params.role.trim(),
    },
    "Invitation",
  );
};

/** Short, user-facing reason for a failed send (shown in toasts). */
export const getInvitationEmailFailureHint = (result: InvitationEmailResult): string => {
  if (result.ok) return "";
  if (result.code === "MISSING_RESEND_KEY") {
    return "Email isn't set up yet — add RESEND_API_KEY in Supabase → Edge Functions → Secrets.";
  }
  return result.text?.trim() ?? "";
};

/** Email sending is configured server-side now; the client can always try. */
export const isEmailServiceConfigured = (): boolean => true;
export const isNotificationEmailConfigured = (): boolean => true;

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
  const toEmail = params.toEmail.trim();
  if (!looksLikeEmail(toEmail)) return { ok: false };
  const body: Record<string, unknown> = {
    kind: "notification",
    toEmail,
    title: params.title,
    body: params.body,
  };
  if (params.actionUrl) body.actionUrl = params.actionUrl;
  return sendViaFunction(body, "Notification");
};

export const openInvitationMailto = (params: InvitationEmailParams): void => {
  const subject = encodeURIComponent(`Invitation to join ${params.projectName}`);
  const body = encodeURIComponent(
    `Hi,\n\n${params.inviterName} has invited you to join "${params.projectName}" as a ${params.role}.\n\nAccept the invitation here:\n${params.inviteLink}\n\nThis invitation expires in 7 days.\n\nRegards,\nTaskCalendar Team`,
  );
  window.location.href = `mailto:${params.toEmail}?subject=${subject}&body=${body}`;
};
