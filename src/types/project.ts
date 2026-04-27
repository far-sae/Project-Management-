import { KanbanColumn } from "./task";

export interface ProjectMember {
  userId: string;
  email: string;
  displayName: string;
  photoURL: string;
  role: "owner" | "admin" | "member" | "viewer";
  addedAt: Date;
}

export interface ProjectSettings {
  isArchived: boolean;
  visibility: "private" | "team";
}

export interface ProjectStats {
  totalTasks: number;
  completedTasks: number;
  membersCount: number;
}

export interface Project {
  projectId: string;
  name: string;
  description: string;
  coverColor: string;
  ownerId: string;
  organizationId: string;
  workspaceId?: string; // Optional: group projects by workspace
  createdAt: Date;
  updatedAt: Date;
  members: ProjectMember[];
  settings: ProjectSettings;
  stats: ProjectStats;
  columns?: KanbanColumn[];
  startDate?: Date | null;
  endDate?: Date | null;
  /** When true with hasLockPin, the UI may require a PIN to open the project (owner / org admin can bypass). */
  isLocked?: boolean;
  /** True when a lock PIN is configured; the hash is not sent to clients. */
  hasLockPin?: boolean;
  /** Bumps when the project PIN changes; used to scope session unlock. */
  lockPinVersion?: number;
}

export interface CreateProjectInput {
  name: string;
  description: string;
  coverColor: string;
  workspaceId?: string;
  startDate?: string | null;
  endDate?: string | null;
  columns?: KanbanColumn[];
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  coverColor?: string;
  workspaceId?: string;
  members?: ProjectMember[];
  settings?: Partial<ProjectSettings>;
  columns?: KanbanColumn[];
  startDate?: string | null;
  endDate?: string | null;
  isLocked?: boolean;
  lockPinHash?: string | null;
}
