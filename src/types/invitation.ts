export interface ProjectInvitation {
  invitationId: string;
  projectId: string;
  organizationId: string;  // Multi-tenancy: link to organization
  projectName: string;
  inviterUserId: string;
  inviterName: string;
  inviterEmail: string;
  inviteeEmail: string;
  role: 'admin' | 'member' | 'viewer';
  /** Optional custom role (custom_roles.role_id). When set, the member gets
   *  this role on accept; `role` stays as a safe built-in baseline. */
  customRoleId: string | null;
  status: 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled';
  token: string;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
}

export interface CreateInvitationInput {
  projectId: string;
  inviteeEmail: string;
  role: 'admin' | 'member' | 'viewer';
  /** Optional custom role to grant on accept. */
  customRoleId?: string | null;
}
