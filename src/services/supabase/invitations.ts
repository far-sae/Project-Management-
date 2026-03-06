import { supabase } from "./config";
import { ProjectInvitation, CreateInvitationInput } from "@/types/invitation";
import { logger } from "@/lib/logger";

export const createInvitation = async (
  projectId: string,
  projectName: string,
  inviterUserId: string,
  inviterName: string,
  inviterEmail: string,
  organizationId: string,
  input: CreateInvitationInput,
): Promise<ProjectInvitation> => {
  const invitationId = crypto.randomUUID();
  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await supabase
    .from("invitations")
    .insert({
      invitation_id: invitationId,
      project_id: projectId,
      organization_id: organizationId,
      email: input.inviteeEmail.toLowerCase().trim(),
      role: input.role,
      status: "pending",
      invited_by: inviterUserId,
      inviter_name: inviterName,
      inviter_email: inviterEmail,
      project_name: projectName,
      token,
      created_at: now,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) {
    logger.error("Failed to create invitation:", error);
    throw error;
  }

  return {
    invitationId: data.invitation_id,
    projectId: data.project_id,
    organizationId: data.organization_id,
    projectName: data.project_name || "",
    inviterUserId: data.invited_by,
    inviterName: data.inviter_name || "",
    inviterEmail: data.inviter_email || "",
    inviteeEmail: data.email,
    role: data.role,
    status: data.status,
    token: data.token,
    createdAt: new Date(data.created_at),
    expiresAt: new Date(data.expires_at),
    acceptedAt: null,
  };
};

export const getInvitationByToken = async (
  token: string,
): Promise<ProjectInvitation | null> => {
  const { data, error } = await supabase
    .from("invitations")
    .select("*")
    .eq("token", token)
    .maybeSingle();

  if (error || !data) {
    console.error("Invitation not found:", error);
    return null;
  }

  return {
    invitationId: data.invitation_id,
    projectId: data.project_id,
    organizationId: data.organization_id,
    projectName: data.project_name || "",
    inviterUserId: data.invited_by,
    inviterName: data.inviter_name || "",
    inviterEmail: data.inviter_email || "",
    inviteeEmail: data.email,
    role: data.role,
    status: data.status,
    token: data.token,
    createdAt: new Date(data.created_at),
    expiresAt: new Date(data.expires_at),
    acceptedAt: data.accepted_at ? new Date(data.accepted_at) : null,
  };
};

// Uses DB function accept_invitation (no Edge Function required)
export const acceptInvitation = async (
  invitationId: string,
  organizationId: string,
  displayName: string,
  photoURL: string,
): Promise<void> => {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) throw new Error("Not authenticated");

  const { data, error } = await supabase.rpc("accept_invitation", {
    p_invitation_id: invitationId,
    p_organization_id: organizationId,
    p_display_name: displayName ?? "",
    p_photo_url: photoURL ?? "",
  });

  if (error) {
    logger.error("acceptInvitation failed:", error);
    throw new Error(error.message || "Failed to accept invitation");
  }

  const result = data as { ok?: boolean; error?: string } | null;
  const isFailure = result == null || result.ok === false;
  if (isFailure) {
    const message =
      typeof result?.error === "string" && result.error.trim() !== ""
        ? result.error
        : "RPC returned failure";
    throw new Error(message);
  }

  logger.log("✅ Invitation accepted, org linked:", organizationId);
};

export const declineInvitation = async (
  invitationId: string,
  organizationId: string,
): Promise<void> => {
  const { error } = await supabase
    .from("invitations")
    .update({ status: "declined" })
    .eq("invitation_id", invitationId)
    .eq("organization_id", organizationId);

  if (error) {
    logger.error("Failed to decline invitation:", error);
    throw error;
  }

  logger.log("Invitation declined successfully");
};

export const getProjectInvitations = async (
  projectId: string,
  organizationId: string,
): Promise<ProjectInvitation[]> => {
  const { data, error } = await supabase
    .from("invitations")
    .select("*")
    .eq("project_id", projectId)
    .eq("organization_id", organizationId)
    .eq("status", "pending"); // ✅ ADD THIS — was fetching all statuses

  if (error) {
    logger.error("Failed to get project invitations:", error);
    return [];
  }

  return (data || []).map((inv) => ({
    invitationId: inv.invitation_id,
    projectId: inv.project_id,
    organizationId: inv.organization_id,
    projectName: inv.project_name || "",
    inviterUserId: inv.invited_by,
    inviterName: inv.inviter_name || "",
    inviterEmail: inv.inviter_email || "",
    inviteeEmail: inv.email,
    role: inv.role,
    status: inv.status,
    token: inv.token,
    createdAt: new Date(inv.created_at),
    expiresAt: new Date(inv.expires_at),
    acceptedAt: inv.accepted_at ? new Date(inv.accepted_at) : null,
  }));
};

export const cancelInvitation = async (
  invitationId: string,
  organizationId: string,
): Promise<void> => {
  const { error } = await supabase
    .from("invitations")
    .update({ status: "cancelled" })
    .eq("invitation_id", invitationId)
    .eq("organization_id", organizationId);

  if (error) {
    logger.error("Failed to cancel invitation:", error);
    throw error;
  }

  logger.log("Invitation cancelled successfully");
};

export const sendInvitationEmail = async (
  toEmail: string,
  inviterName: string,
  projectName: string,
  token: string,
  role: string,
): Promise<boolean> => {
  try {
    const inviteLink = `${window.location.origin}/accept-invite/${token}`;
    const { error } = await supabase.functions.invoke("send-invitation-email", {
      body: { toEmail, inviterName, projectName, inviteLink, role },
    });
    if (error) {
      logger.error("Failed to send invitation email:", error);
      return false;
    }
    logger.log("✅ Invitation email sent to:", toEmail);
    return true;
  } catch (err) {
    logger.error("sendInvitationEmail error:", err);
    return false;
  }
};
