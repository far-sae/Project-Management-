export interface Workspace {
  workspaceId: string;
  name: string;
  description?: string;
  organizationId: string;
  isDefault?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWorkspaceInput {
  name: string;
  description?: string;
  isDefault?: boolean;
}

export interface UpdateWorkspaceInput {
  name?: string;
  description?: string;
  isDefault?: boolean;
}
