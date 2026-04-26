export type SavedViewScope = 'my' | 'project' | 'org';

export interface SavedViewFilters {
  status?: string;
  searchQuery?: string;
  assigneeUserIds?: string[];
  priority?: string[];
  tags?: string[];
}

export interface SavedViewSort {
  by?: 'manual' | 'priority' | 'due' | 'recent';
}

export interface SavedView {
  id: string;
  ownerId: string;
  organizationId?: string | null;
  scope: SavedViewScope;
  projectId?: string | null;
  name: string;
  filters: SavedViewFilters;
  sort: SavedViewSort;
  density?: 'comfortable' | 'compact' | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSavedViewInput {
  ownerId: string;
  organizationId?: string | null;
  scope: SavedViewScope;
  projectId?: string | null;
  name: string;
  filters?: SavedViewFilters;
  sort?: SavedViewSort;
  density?: 'comfortable' | 'compact' | null;
}

export interface UpdateSavedViewInput {
  name?: string;
  filters?: SavedViewFilters;
  sort?: SavedViewSort;
  density?: 'comfortable' | 'compact' | null;
  scope?: SavedViewScope;
  projectId?: string | null;
}
