import type { PageKey } from "@/lib/pageCatalog";

export interface Workspace {
  workspaceId: string;
  name: string;
  description?: string;
  organizationId: string;
  isDefault?: boolean;
  /** Quick Menu items enabled here. `null`/`undefined` = all enabled. */
  menuPages?: PageKey[] | null;
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
  /** `null` resets to "all enabled". `undefined` leaves the column untouched. */
  menuPages?: PageKey[] | null;
}
