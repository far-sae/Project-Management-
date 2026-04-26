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
}
